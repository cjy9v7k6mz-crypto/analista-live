/**
 * syncCore.js — Núcleo de sincronização multi-dispositivo.
 *
 * PRINCÍPIOS (nenhum deles é negociável durante um jogo):
 *  1. OFFLINE-FIRST — tudo é escrito primeiro no IndexedDB. A sincronização é
 *     um efeito secundário; se falhar, o analista nem dá por isso.
 *  2. FILA DE SAÍDA — o que não conseguiu ser enviado fica em `syncQueue` e é
 *     reenviado sozinho quando a ligação voltar. Nunca há botão "sincronizar".
 *  3. SEM DUPLICADOS — cada envio tem um id único e o recetor guarda o que já
 *     aplicou (`syncApplied`). Reenviar a mesma coisa duas vezes é inofensivo
 *     (operação idempotente), o que torna a rede instável um problema menor.
 *  4. TRANSPORTE ABSTRATO — o núcleo não sabe se está a falar com o Supabase,
 *     com outro separador do browser, ou com outra coisa qualquer no futuro.
 *     Isto permitiu testar toda esta lógica sem depender da nuvem.
 *
 * O transporte tem de oferecer:
 *   connect(code, { onMessage, onStatus })  -> Promise
 *   send(envelope)                          -> Promise (rejeita se falhar)
 *   fetchSince(code, sinceTs)               -> Promise<envelope[]>  (recuperação)
 *   disconnect()
 */

const SyncCore = {
  transport: null,
  session: null,        // { id, code, matchId, role }
  deviceId: null,
  status: 'offline',    // offline | syncing | online
  _listeners: [],
  _statusListeners: [],
  _flushing: false,
  _flushTimer: null,

  ROLES: { ANALYST: 'analyst', COACH: 'coach' },

  async init() {
    // Identidade de ESTA instância da aplicação. Serve para não aplicarmos o
    // eco dos nossos próprios envios.
    //
    // Fica em sessionStorage (por separador) e não no IndexedDB: dois
    // separadores do mesmo browser partilham a base de dados, e se
    // partilhassem também o identificador cada um ignoraria as mensagens do
    // outro, julgando serem suas. Em dispositivos distintos o efeito é o
    // mesmo — identificadores diferentes — mas assim funciona nos dois casos.
    try {
      const cached = sessionStorage.getItem('al_instance_id');
      if (cached) this.deviceId = cached;
      else {
        this.deviceId = Utils.uid('dev');
        sessionStorage.setItem('al_instance_id', this.deviceId);
      }
    } catch (e) {
      this.deviceId = Utils.uid('dev'); // sessionStorage indisponível: id volátil
    }
    // Reenvia o que ficou pendente assim que a rede voltar.
    window.addEventListener('online', () => this.flush());
    window.addEventListener('offline', () => this._setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.flush(); });
  },

  /** Código curto e legível para o segundo dispositivo entrar na sessão. */
  generateCode() {
    // Sem caracteres ambíguos (0/O, 1/I) — é para ser lido de um ecrã e escrito à mão.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  },

  // ---------- Sessões ----------

  /** Cria (ou reutiliza) a sessão do analista para um jogo. */
  async createSession(match, transport) {
    const existing = (await DB.getAll(DB.STORES.sessions)).find((s) => s.matchId === match.id && s.role === this.ROLES.ANALYST);
    const session = existing || {
      id: Utils.uid('sess'),
      code: this.generateCode(),
      matchId: match.id,
      role: this.ROLES.ANALYST,
      createdAt: Date.now(),
      status: 'live',
    };
    await DB.put(DB.STORES.sessions, session);
    this.session = session;
    if (transport) await this.connect(transport);
    // O primeiro envio leva o estado completo do jogo, para quem entrar depois
    // ter tudo (não só o que acontecer daí para a frente).
    await this.publishSnapshot(match);
    return session;
  },

  /** O dispositivo do banco entra numa sessão existente através do código. */
  async joinSession(code, transport) {
    const session = {
      id: Utils.uid('sess'),
      code: String(code || '').trim().toUpperCase(),
      matchId: null, // preenchido quando chegar o snapshot
      role: this.ROLES.COACH,
      createdAt: Date.now(),
      status: 'live',
    };
    await DB.put(DB.STORES.sessions, session);
    this.session = session;
    await this.connect(transport);
    // Pede tudo o que já aconteceu antes de entrarmos.
    await this.catchUp(0);
    // Rede de segurança: se por alguma razão o snapshot não ficou associado
    // (por exemplo por já ter sido processado noutro momento), procura-o
    // diretamente no histórico. Sem matchId o banco não sabe que jogo mostrar.
    if (!this.session.matchId) await this._resolveMatchFromHistory();
    return session;
  },

  /** Procura no histórico o snapshot mais recente e liga a sessão ao jogo. */
  async _resolveMatchFromHistory() {
    if (!this.transport || typeof this.transport.fetchSince !== 'function') return false;
    try {
      const list = await this.transport.fetchSince(this.session.code, 0);
      const snap = [...list].reverse().find((e) => e.entityType === 'snapshot' && e.payload && e.payload.match);
      if (!snap) return false;
      this.session.matchId = snap.payload.match.id;
      await DB.put(DB.STORES.sessions, this.session);
      // Reaplica o conteúdo do snapshot (é idempotente) para o banco ter tudo.
      await this._apply(snap);
      return true;
    } catch (e) {
      return false;
    }
  },

  /** Descobre o jogo da sessão a partir do último snapshot disponível. */
  async resolveMatchFromHistory() {
    if (!this.transport || !this.session) return null;
    if (typeof this.transport.fetchSince !== 'function') return null;
    try {
      const list = await this.transport.fetchSince(this.session.code, 0);
      const snap = [...list].reverse().find((e) => e.entityType === 'snapshot' && e.payload?.match);
      if (!snap) return null;
      await this._apply(snap);       // idempotente: reescreve o mesmo estado
      this.session.matchId = snap.payload.match.id;
      await DB.put(DB.STORES.sessions, this.session);
      return this.session.matchId;
    } catch (e) {
      return null;
    }
  },

  /**
   * Sai da sessão atual: corta a ligação e apaga o registo local, para que o
   * dispositivo não volte a entrar sozinho no mesmo jogo da próxima vez.
   * Os dados do jogo que já foram recebidos ficam no dispositivo — só a
   * ligação é encerrada.
   */
  async leaveSession() {
    const sess = this.session;
    await this.disconnect();
    if (sess) await DB.delete(DB.STORES.sessions, sess.id).catch(() => {});
    this.session = null;
    return true;
  },

  async activeSession() {
    if (this.session) return this.session;
    const all = await DB.getAll(DB.STORES.sessions);
    return all.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
  },

  async connect(transport) {
    this.transport = transport;
    this._setStatus('syncing');
    try {
      await this.transport.connect(this.session.code, {
        onMessage: (env) => this.receive(env),
        onStatus: (st) => this._setStatus(st),
      });
      this._setStatus('online');
      await this.flush();
      // Recupera SEMPRE o que possa ter passado enquanto estivemos desligados
      // (app fechada, separador a recarregar, rede em baixo). É idempotente:
      // o que já foi aplicado é ignorado pela deduplicação.
      await this.catchUp(0);
    } catch (e) {
      console.warn('Sync: ligação falhou, a continuar offline', e);
      this._setStatus('offline');
    }
  },

  async disconnect() {
    if (this.transport) await this.transport.disconnect().catch(() => {});
    this.transport = null;
    this._setStatus('offline');
  },

  // ---------- Envio ----------

  /**
   * Coloca uma alteração na fila e tenta enviá-la já.
   * Devolve imediatamente — nunca bloqueia a interface do analista.
   */
  async publish(entityType, operation, payload) {
    if (!this.session) return null;
    const env = {
      id: Utils.uid('env'),
      sessionCode: this.session.code,
      deviceId: this.deviceId,
      entityType,                 // match | occurrence | message | moment | timer
      entityId: payload?.id || null,
      operation,                  // upsert | delete | snapshot
      payload,
      createdAt: Date.now(),
      status: 'pending',
      retryCount: 0,
    };
    await DB.put(DB.STORES.syncQueue, env);
    this.flush(); // sem await: o registo do evento não espera pela rede
    return env;
  },

  /**
   * Estado completo do jogo — usado ao criar sessão e a pedido de quem entra.
   *
   * IMPORTANTE: as imagens (fotos de jogadores e logótipos) NÃO seguem no
   * snapshot. São ficheiros base64 que facilmente somam vários MB e fariam o
   * envio falhar — e o ecrã do banco não precisa delas para nada. Vão apenas
   * os dados necessários para mostrar o jogo.
   */
  async publishSnapshot(match) {
    const occurrences = await AppState.getOccurrences(match.id);
    const ownId = match.teams?.own?.teamId;
    const oppId = match.teams?.opponent?.teamId;
    const teams = [];
    const players = [];
    for (const id of [ownId, oppId].filter(Boolean)) {
      const t = await DB.get(DB.STORES.teams, id);
      if (t) teams.push({ id: t.id, name: t.name, abbreviation: t.abbreviation, colorPrimary: t.colorPrimary });
      players.push(...(await AppState.getTeamPlayers(id)).map((p) => ({
        id: p.id, teamId: p.teamId, name: p.name, shortName: p.shortName,
        number: p.number, position: p.position,
      })));
    }
    // O jogo vai sem os desenhos e sem o plano completo de imagens.
    const lightMatch = { ...match };
    delete lightMatch.teamSnapshot; // contém fotos; não é preciso no banco
    return this.publish('snapshot', 'snapshot', { match: lightMatch, occurrences, teams, players });
  },

  /** Envia tudo o que está pendente. Seguro chamar em qualquer altura. */
  async flush() {
    if (this._flushing || !this.transport || !this.session) return;
    this._flushing = true;
    try {
      const pending = (await DB.getAll(DB.STORES.syncQueue))
        .filter((e) => e.status === 'pending')
        .sort((a, b) => a.createdAt - b.createdAt);
      if (pending.length) this._setStatus('syncing');

      for (const env of pending) {
        try {
          await this.transport.send(env);
          // Confirmado: sai da fila. Guardamos só o essencial em memória.
          await DB.delete(DB.STORES.syncQueue, env.id);
        } catch (e) {
          env.retryCount = (env.retryCount || 0) + 1;
          env.lastError = String(e && e.message ? e.message : e);
          console.warn('Sync: envio falhou', env.entityType, env.lastError);
          this.lastError = env.lastError;
          await DB.put(DB.STORES.syncQueue, env);
          this._setStatus('offline');
          this._scheduleRetry();
          return; // pára aqui: mantém a ordem dos eventos
        }
      }
      this._setStatus(this.transport ? 'online' : 'offline');
    } finally {
      this._flushing = false;
    }
  },

  _scheduleRetry() {
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flush(), 5000);
  },

  async pendingCount() {
    return (await DB.getAll(DB.STORES.syncQueue)).filter((e) => e.status === 'pending').length;
  },

  // ---------- Receção ----------

  /**
   * Aplica um envelope vindo de outro dispositivo.
   * Ignora o que veio de nós próprios e o que já foi aplicado — é isto que
   * torna seguro reenviar em caso de dúvida.
   */
  async receive(env) {
    if (!env || !env.id) return;
    if (env.deviceId === this.deviceId) return;             // eco do próprio dispositivo
    // Sem sessão ativa não há contexto para aplicar nada. Descartar aqui (e NÃO
    // marcar como aplicado) é essencial: se marcássemos, a deduplicação
    // impediria que estes envelopes voltassem a ser processados quando o
    // dispositivo entrasse na sessão — e o jogo nunca apareceria.
    if (!this.session) return;
    if (env.sessionCode && this.session.code && env.sessionCode !== this.session.code) return;
    const seen = await DB.get(DB.STORES.syncApplied, env.id);
    if (seen) return;                                        // já aplicado
    await DB.put(DB.STORES.syncApplied, { id: env.id, at: Date.now() });

    try {
      await this._apply(env);
    } catch (e) {
      console.warn('Sync: falha ao aplicar envelope', env.entityType, e);
      return;
    }
    this._listeners.forEach((fn) => { try { fn(env); } catch (e) { /* um ouvinte não pode partir os outros */ } });
  },

  async _apply(env) {
    const p = env.payload;
    if (env.entityType === 'snapshot') {
      // Espelho local do jogo, para o banco funcionar mesmo que perca a ligação.
      if (this.session && !this.session.matchId && p.match) {
        this.session.matchId = p.match.id;
        await DB.put(DB.STORES.sessions, this.session);
      }
      if (p.match) await DB.put(DB.STORES.matches, p.match);
      for (const t of p.teams || []) {
        const existing = await DB.get(DB.STORES.teams, t.id);
        if (!existing) await DB.put(DB.STORES.teams, { ...t, isOwnTeam: false, profile: {}, scouting: null, createdAt: Date.now() });
      }
      for (const pl of p.players || []) {
        const existing = await DB.get(DB.STORES.players, pl.id);
        if (!existing) await DB.put(DB.STORES.players, pl);
      }
      for (const o of p.occurrences || []) await DB.put(DB.STORES.occurrences, o);
      return;
    }
    if (env.entityType === 'occurrence') {
      if (env.operation === 'delete') await DB.delete(DB.STORES.occurrences, env.entityId);
      else await DB.put(DB.STORES.occurrences, p);
      return;
    }
    if (env.entityType === 'match') {
      // O jogo é sempre do analista: aplicamos tal e qual (fonte única).
      await DB.put(DB.STORES.matches, p);
      return;
    }
    if (env.entityType === 'message' || env.entityType === 'moment') {
      await DB.put(DB.STORES.messages, p);
      return;
    }
  },

  /** Recupera o que se perdeu enquanto estivemos sem ligação. */
  async catchUp(sinceTs = 0) {
    if (!this.transport || !this.session) return 0;
    if (typeof this.transport.fetchSince !== 'function') return 0;
    try {
      const list = await this.transport.fetchSince(this.session.code, sinceTs);
      for (const env of list) await this.receive(env);
      this._setStatus('online');
      return list.length;
    } catch (e) {
      this._setStatus('offline');
      return 0;
    }
  },

  // ---------- Estado / observadores ----------
  onMessage(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter((f) => f !== fn); }; },
  onStatus(fn) { this._statusListeners.push(fn); fn(this.status); return () => { this._statusListeners = this._statusListeners.filter((f) => f !== fn); }; },

  _setStatus(st) {
    if (this.status === st) return;
    this.status = st;
    this._statusListeners.forEach((fn) => { try { fn(st); } catch (e) { /* ignora */ } });
  },
};

window.SyncCore = SyncCore;
