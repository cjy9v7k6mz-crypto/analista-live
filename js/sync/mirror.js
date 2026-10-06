/**
 * mirror.js — Espelho da Equipa: o que está no iPad do analista fica sempre
 * disponível, a qualquer hora, para a equipa técnica consultar.
 *
 * DOIS PAPÉIS, NUNCA OS DOIS NO MESMO APARELHO:
 *  - `writer` (o iPad do analista): cada gravação na base de dados local marca
 *    o registo como "por enviar"; um envio em lote leva-os para o Supabase. Sem
 *    rede, ficam à espera e saem quando a ligação voltar. Sem botão.
 *  - `reader` (adjunto, treinador, equipa técnica): vai buscar o que mudou desde
 *    a última vez, escreve no seu IndexedDB e a app mostra os ecrãs de sempre,
 *    só que em modo consulta.
 *
 * PORQUE NÃO É A `sync_events`: aquela é um histórico que cresce a cada envio e
 * é apagado ao fim de 2 dias. Aqui há UMA linha por registo, substituída quando
 * o registo muda — o espaço ocupado acompanha os dados reais (ver
 * supabase-espelho.sql) e cabe à larga no plano gratuito.
 *
 * COMO SE DÁ PELAS ALTERAÇÕES: em vez de pedir a cada ecrã que se lembre de
 * publicar (foi assim que os cartões chegaram a não aparecer no banco), o
 * próprio `DB.put/delete` avisa o espelho. E como um aviso em memória se perde
 * se o iOS matar a app, cada arranque compara tudo com o que já foi enviado
 * (`mirrorPushed`, uma impressão digital por registo) e manda só a diferença.
 *
 * A configuração vive num registo PRÓPRIO das definições ('mirror'), pela mesma
 * razão do 'device' em syncCore.js: o `AppState.saveSettings` grava a sua cópia
 * em memória por cima do registo 'app' inteiro.
 */

const Mirror = {
  /** O que vai para a nuvem. Fica de fora o que é deste aparelho (fila de
   *  sincronização, sessões, mensagens do jogo, cópias de segurança locais). */
  STORES: ['matches', 'occurrences', 'players', 'library', 'plans', 'opponents',
    'teams', 'formations', 'drawings', 'competitions', 'referees'],

  /** Das definições, só o que muda a leitura dos números e dos relatórios. */
  META_KEYS: ['teamName', 'analystName', 'trendConfig', 'reportTemplate', 'scoutingReportTemplate'],

  PULL_PAGE: 400,
  PUSH_MAX_ROWS: 300,
  PUSH_MAX_BYTES: 1500000,
  ROW_MAX_BYTES: 1800000,
  POLL_MS: 60000,
  LIVE_GAP_MS: 30000,      // durante um jogo, no máximo um envio a cada 30 s
  IDLE_DELAY_MS: 3000,

  cfg: null,
  _raw: null,
  _dirty: new Map(),
  _fullScan: false,
  _flushing: false,
  _flushTimer: null,
  _retryMs: 0,
  _pulling: null,
  _pollTimer: null,
  _listeners: [],
  _lastBlockedToast: 0,
  _booted: false,

  // ------------------------------------------------------------------
  // Funções puras (testadas em tests/specs.js)
  // ------------------------------------------------------------------

  /** O registo tal como vai para a nuvem. */
  slim(store, rec) {
    if (!rec) return rec;
    if (store === 'matches') {
      // As fotos dos dois plantéis, repetidas em cada jogo. Foi isto que levou
      // a `sync_events` aos 815 MB. Os plantéis seguem à parte (teams/players).
      const m = { ...rec };
      delete m.teamSnapshot;
      return m;
    }
    return rec;
  },

  metaFromSettings(s) {
    const out = {};
    for (const k of this.META_KEYS) if (s && s[k] !== undefined) out[k] = s[k];
    return out;
  },

  /** Impressão digital de um texto (cyrb53). Serve para "mudou ou não". */
  hash(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + str.length;
  },

  keyOf(store, id) { return `${store}\u0001${id}`; },

  /** Chave aleatória, 32 bytes em base64url (43 caracteres). */
  newKey() {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return this._b64url(String.fromCharCode(...b));
  },

  _b64url(bin) { return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  _unb64url(s) {
    const p = s.replace(/-/g, '+').replace(/_/g, '/');
    return atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  },

  /** O link que o analista partilha. Leva tudo: não há código para escrever. */
  encodeLink(base, { url, anonKey, readKey }) {
    const json = JSON.stringify({ u: url, k: anonKey, r: readKey });
    const bin = unescape(encodeURIComponent(json));
    return `${String(base).replace(/#.*$/, '')}#/equipa/${this._b64url(bin)}`;
  },

  /** Aceita o link inteiro, só a parte depois de #/equipa/, ou lixo (devolve null). */
  decodeLink(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const m = raw.match(/#\/equipa\/([A-Za-z0-9_-]+)/);
    const token = m ? m[1] : (/^[A-Za-z0-9_-]{40,}$/.test(raw) ? raw : null);
    if (!token) return null;
    try {
      const o = JSON.parse(decodeURIComponent(escape(this._unb64url(token))));
      if (!o || typeof o.u !== 'string' || typeof o.k !== 'string' || typeof o.r !== 'string') return null;
      // https sempre; http só para um Supabase local de testes.
      const urlOk = /^https:\/\//.test(o.u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o.u);
      if (!urlOk || o.r.length < 24 || o.k.length < 20) return null;
      return { url: o.u, anonKey: o.k, readKey: o.r };
    } catch (e) {
      return null;
    }
  },

  /** Divide as linhas em lotes que o servidor aceita sem engasgar. */
  chunk(rows, maxBytes = this.PUSH_MAX_BYTES, maxRows = this.PUSH_MAX_ROWS) {
    const out = [];
    let cur = [];
    let size = 0;
    for (const r of rows) {
      const n = r._size || 0;
      if (cur.length && (cur.length >= maxRows || size + n > maxBytes)) {
        out.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(r);
      size += n;
    }
    if (cur.length) out.push(cur);
    return out;
  },

  /**
   * Quem consulta é muitas vezes o mesmo aparelho do Modo Banco. Durante o jogo
   * o canal do banco chega primeiro (segundos) e o espelho depois (até 30 s).
   * Uma linha do espelho mais antiga do que o que o banco já tem não escreve
   * por cima — senão o placar andava para trás durante meio minuto.
   */
  shouldApplyRow(row, local, liveMatchId) {
    if (!liveMatchId || !local || !row || row.payload == null) return true;
    if (row.store !== 'matches' && row.store !== 'occurrences') return true;
    const mid = row.store === 'matches' ? row.payload.id : row.payload.matchId;
    if (mid !== liveMatchId) return true;
    const stamp = (r) => r.updatedAt || r.createdAt || r.timestamp || 0;
    return stamp(row.payload) >= stamp(local);
  },

  /** Ecrãs que não fazem sentido em modo consulta (são para registar ou editar). */
  blockedRoute(hash) {
    const h = String(hash || '');
    if (/^#\/(new-game|library)$/.test(h) || /^#\/pair\//.test(h)) return { to: 'home' };
    const m = h.match(/^#\/(plan|lineup|live|halftime)\/(.+)$/);
    if (m) return { to: 'match', matchId: m[2] };
    return null;
  },

  /** O que a faixa de estado diz a quem consulta. */
  freshness(cfg, now = Date.now(), online = true) {
    if (!cfg || cfg.role !== 'reader') return null;
    if (cfg.revoked) return { state: 'bad', text: 'Este link deixou de ter acesso — pede o novo ao analista' };
    if (!cfg.lastCheckAt) return { state: 'wait', text: 'A descarregar os dados do analista…' };
    const since = (ts) => {
      const s = Math.max(0, Math.round((now - ts) / 1000));
      if (s < 60) return 'agora mesmo';
      const min = Math.round(s / 60);
      if (min < 60) return `há ${min} min`;
      const h = Math.round(min / 60);
      if (h < 24) return `há ${h} h`;
      const d = Math.round(h / 24);
      return d === 1 ? 'ontem' : `há ${d} dias`;
    };
    const change = cfg.lastChangeAt ? `última alteração do analista ${since(cfg.lastChangeAt)}` : 'sem alterações ainda';
    const stale = !online || (now - cfg.lastCheckAt) > 3 * this.POLL_MS;
    if (stale) return { state: 'stale', text: `Sem ligação · dados de ${since(cfg.lastCheckAt)} (${change})` };
    return { state: 'ok', text: `Em dia · ${change}` };
  },

  // ------------------------------------------------------------------
  // Estado
  // ------------------------------------------------------------------

  isWriter() { return !!(this.cfg && this.cfg.role === 'writer'); },
  isReader() { return !!(this.cfg && this.cfg.role === 'reader'); },

  onChange(fn) { this._listeners.push(fn); },
  _emit(info) { this._listeners.forEach((fn) => { try { fn(info); } catch (e) { /* ignora */ } }); },

  async _saveCfg(patch) {
    this.cfg = { ...(this.cfg || {}), ...patch, key: 'mirror' };
    await this._raw.put(DB.STORES.settings, this.cfg);
    return this.cfg;
  },

  /**
   * Chamado no arranque, ANTES de qualquer outra coisa escrever na base de
   * dados (a biblioteca por omissão, as migrações): o papel decide se essas
   * escritas vão para a nuvem ou se nem chegam a acontecer.
   */
  async init() {
    this._install();
    try { this.cfg = await DB.get(DB.STORES.settings, 'mirror'); } catch (e) { this.cfg = null; }
    if (this.isWriter()) {
      this._fullScan = true;
      this._schedule(8000);
    }
    if (this.isReader()) {
      document.body.classList.add('is-reader');
      this._startPolling();
    }
    window.addEventListener('online', () => {
      if (this.isWriter()) this._schedule(1000);
      if (this.isReader()) this.pull().catch(() => {});
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.isWriter() && this._dirty.size) this.flush();
      if (document.visibilityState === 'visible' && this.isReader()) this.pull().catch(() => {});
    });
    setTimeout(() => { this._booted = true; }, 3000);
  },

  /** Envolve as escritas do DB. As funções originais ficam em `_raw`. */
  _install() {
    if (this._raw) return;
    const raw = {
      put: DB.put.bind(DB),
      bulkPut: DB.bulkPut.bind(DB),
      delete: DB.delete.bind(DB),
      clear: DB.clear.bind(DB),
      get: DB.get.bind(DB),
      getAll: DB.getAll.bind(DB),
    };
    this._raw = raw;
    const self = this;
    const replicated = (store) => self.STORES.includes(store);

    DB.put = async function (store, value) {
      if (self.isReader() && replicated(store) && !self._writeAllowed()) return self._blocked(value);
      const r = await raw.put(store, value);
      if (self.isWriter()) {
        if (replicated(store) && value) self.markDirty(store, value.id);
        else if (store === DB.STORES.settings && value && value.key === 'app') self.markDirty('meta', 'app');
      }
      return r;
    };
    DB.bulkPut = async function (store, values) {
      if (self.isReader() && replicated(store) && !self._writeAllowed()) return self._blocked(true);
      const r = await raw.bulkPut(store, values);
      if (self.isWriter() && replicated(store)) (values || []).forEach((v) => v && self.markDirty(store, v.id));
      return r;
    };
    DB.delete = async function (store, key) {
      if (self.isReader() && replicated(store) && !self._writeAllowed()) return self._blocked(true);
      const r = await raw.delete(store, key);
      if (self.isWriter() && replicated(store)) self.markDirty(store, key);
      return r;
    };
    DB.clear = async function (store) {
      if (self.isReader() && replicated(store) && !self._writeAllowed()) return self._blocked(true);
      const r = await raw.clear(store);
      // Restaurar um backup limpa e repõe tudo: a comparação completa resolve
      // o que mudou e o que desapareceu.
      if (self.isWriter() && replicated(store)) { self._fullScan = true; self._schedule(self.IDLE_DELAY_MS); }
      return r;
    };
  },

  /**
   * Em modo consulta, os dados são do analista. Exceções: o que o canal do
   * jogo aplica (o banco a receber o jogo em direto) e o próprio Modo Banco
   * (aquecimentos, propostas) — esses continuam a funcionar como sempre.
   */
  _writeAllowed() {
    if (window.SyncCore && SyncCore._applyingDepth > 0) return true;
    return String(location.hash || '').startsWith('#/coach');
  },

  _blocked(ret) {
    const now = Date.now();
    if (this._booted && now - this._lastBlockedToast > 8000 && typeof window.toast === 'function') {
      this._lastBlockedToast = now;
      window.toast('Modo consulta: as alterações não são guardadas. Os dados são os do analista.');
    }
    return ret;
  },

  // ------------------------------------------------------------------
  // Ligação (REST direto às funções; não precisa da biblioteca do Supabase)
  // ------------------------------------------------------------------

  _conn() {
    if (this.isReader()) return { url: this.cfg.url, anonKey: this.cfg.anonKey };
    const s = (window.AppState && AppState.settings) || {};
    const url = window.TransportSupabase ? TransportSupabase.normalizeUrl(s.supabaseUrl) : s.supabaseUrl;
    return { url: url || (this.cfg && this.cfg.url), anonKey: (s.supabaseAnonKey || '').trim() || (this.cfg && this.cfg.anonKey) };
  },

  async _rpc(name, body, conn = this._conn()) {
    if (!conn.url || !conn.anonKey) throw new Error('O Supabase não está configurado neste aparelho.');
    let r;
    try {
      r = await fetch(`${conn.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: conn.anonKey,
          Authorization: `Bearer ${conn.anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const err = new Error('Sem ligação à internet.');
      err.offline = true;
      throw err;
    }
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) {
      const msg = (data && data.message) || String(text).slice(0, 200) || `HTTP ${r.status}`;
      const err = new Error(r.status === 404 && /function/i.test(msg)
        ? 'O Supabase ainda não tem o espelho. Corre o ficheiro supabase-espelho.sql no SQL Editor.'
        : msg);
      err.status = r.status;
      err.revoked = /link sem acesso/.test(msg);
      throw err;
    }
    return data;
  },

  // ------------------------------------------------------------------
  // iPad do analista (writer)
  // ------------------------------------------------------------------

  async activate() {
    if (this.isReader()) throw new Error('Este aparelho está em modo consulta.');
    const conn = this._conn();
    if (!conn.url || !conn.anonKey) throw new Error('Configura primeiro o Supabase (URL e chave) nesta página.');
    const writeKey = (this.cfg && this.cfg.writeKey) || this.newKey();
    const readKey = (this.cfg && this.cfg.readKey) || this.newKey();
    await this._rpc('mirror_register', { p_write: writeKey, p_read: readKey }, conn);
    await this._saveCfg({ role: 'writer', writeKey, readKey, url: conn.url, anonKey: conn.anonKey, activatedAt: Date.now(), lastError: null });
    this._fullScan = true;
    return this.flush();
  },

  async rotateReadKey() {
    if (!this.isWriter()) throw new Error('Só no iPad do analista.');
    const readKey = this.newKey();
    await this._rpc('mirror_rotate_read', { p_write: this.cfg.writeKey, p_new_read: readKey });
    await this._saveCfg({ readKey });
    return readKey;
  },

  /** Desliga a partilha neste iPad (os dados na nuvem ficam até serem apagados no Supabase). */
  async deactivate() {
    this._dirty.clear();
    clearTimeout(this._flushTimer);
    await this._saveCfg({ role: null });
  },

  shareLink() {
    if (!this.isWriter()) return null;
    const conn = this._conn();
    return this.encodeLink(location.origin + location.pathname, { url: conn.url, anonKey: conn.anonKey, readKey: this.cfg.readKey });
  },

  async status() {
    const key = this.isWriter() ? this.cfg.writeKey : this.cfg && this.cfg.readKey;
    if (!key) return null;
    return this._rpc('mirror_status', { p_key: key });
  },

  markDirty(store, id) {
    if (id == null) return;
    this._dirty.set(this.keyOf(store, id), { store, id: String(id) });
    this._schedule();
  },

  pendingCount() { return this._dirty.size; },

  _liveMatchRunning() {
    const m = window.AppState && AppState.currentMatch;
    return !!(m && m.status === 'in_progress');
  },

  _schedule(delay) {
    if (!this.isWriter()) return;
    if (this._flushTimer) return;
    let d = delay;
    if (d == null) {
      d = this.IDLE_DELAY_MS;
      if (this._liveMatchRunning()) {
        const gap = Date.now() - (this.cfg.lastPushAt || 0);
        d = Math.max(d, this.LIVE_GAP_MS - gap);
      }
    }
    this._flushTimer = setTimeout(() => { this._flushTimer = null; this.flush(); }, Math.max(0, d));
  },

  /**
   * Compara tudo o que está no aparelho com o que já foi enviado. Marca o que
   * mudou e o que desapareceu. Cede a vez ao ecrã a cada poucas centenas de
   * registos: nunca pode prender o LIVE.
   */
  async _scan() {
    const pushed = new Map((await this._raw.getAll(DB.STORES.mirrorPushed)).map((r) => [r.k, r.h]));
    const seen = new Set();
    let n = 0;
    for (const store of this.STORES) {
      const all = await this._raw.getAll(store);
      for (const rec of all) {
        if (!rec || rec.id == null) continue;
        const k = this.keyOf(store, rec.id);
        seen.add(k);
        if (pushed.get(k) !== this.hash(JSON.stringify(this.slim(store, rec)))) {
          this._dirty.set(k, { store, id: String(rec.id) });
        }
        if (++n % 300 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    }
    for (const k of pushed.keys()) {
      if (seen.has(k)) continue;
      const [store, id] = k.split('\u0001');
      if (store !== 'meta') this._dirty.set(k, { store, id });
    }
    this._dirty.set(this.keyOf('meta', 'app'), { store: 'meta', id: 'app' });
  },

  async flush() {
    if (!this.isWriter() || this._flushing) return;
    this._flushing = true;
    clearTimeout(this._flushTimer);
    this._flushTimer = null;
    let entries = [];
    const confirmed = new Set();
    try {
      if (this._fullScan) {
        this._fullScan = false;
        await this._scan();
      }
      entries = [...this._dirty.values()];
      this._dirty.clear();
      if (!entries.length) return;

      const rows = [];
      const skipped = [];
      for (const e of entries) {
        const k = this.keyOf(e.store, e.id);
        let payload;
        if (e.store === 'meta') payload = this.metaFromSettings(window.AppState && AppState.settings);
        else payload = this.slim(e.store, await this._raw.get(e.store, e.id)) || null;
        const json = payload === null ? 'null' : JSON.stringify(payload);
        const prev = await this._raw.get(DB.STORES.mirrorPushed, k);
        if (payload === null) {
          if (!prev) continue;                       // nunca foi enviado: nada a apagar
        } else if (prev && prev.h === this.hash(json)) {
          continue;                                  // igual ao que lá está
        }
        if (json.length > this.ROW_MAX_BYTES) { skipped.push(`${e.store}/${e.id}`); continue; }
        rows.push({ s: e.store, i: e.id, p: payload, _k: k, _h: payload === null ? null : this.hash(json), _size: json.length });
      }

      for (const lote of this.chunk(rows)) {
        await this._rpc('mirror_push', { p_write: this.cfg.writeKey, p_rows: lote.map(({ s, i, p }) => ({ s, i, p })) });
        for (const r of lote) {
          if (r._h === null) await this._raw.delete(DB.STORES.mirrorPushed, r._k);
          else await this._raw.put(DB.STORES.mirrorPushed, { k: r._k, h: r._h });
          confirmed.add(r._k);
        }
      }
      entries = [];
      this._retryMs = 0;
      await this._saveCfg({
        lastPushAt: rows.length ? Date.now() : (this.cfg.lastPushAt || null),
        lastError: skipped.length ? `Demasiado grande para enviar: ${skipped.join(', ')}` : null,
      });
      this._emit({ kind: 'pushed', count: rows.length });
    } catch (err) {
      // O que não foi confirmado volta para a lista e tenta-se mais tarde.
      for (const e of entries) {
        const k = this.keyOf(e.store, e.id);
        if (!confirmed.has(k) && !this._dirty.has(k)) this._dirty.set(k, e);
      }
      this._retryMs = Math.min(Math.max(this._retryMs * 2, 30000), 300000);
      try { await this._saveCfg({ lastError: err.message, lastErrorAt: Date.now() }); } catch (e) { /* ignora */ }
      this._emit({ kind: 'error', error: err.message });
      if (!err.offline) console.warn('Espelho: envio falhou', err.message);
    } finally {
      this._flushing = false;
      if (this._dirty.size) this._schedule(this._retryMs || undefined);
    }
  },

  // ------------------------------------------------------------------
  // Equipa técnica (reader)
  // ------------------------------------------------------------------

  /** Primeira vez neste aparelho: confirma o link e descarrega tudo. */
  async pair(text, { onProgress } = {}) {
    if (this.isWriter()) throw new Error('Este é o iPad do analista — não pode ser também o de consulta.');
    const link = this.decodeLink(text);
    if (!link) throw new Error('Este link não é válido. Pede ao analista que o volte a partilhar.');
    // Confirma o acesso antes de mudar seja o que for neste aparelho.
    await this._rpc('mirror_pull', { p_read: link.readKey, p_since: 0, p_limit: 1 }, link);
    const same = this.isReader() && this.cfg.readKey === link.readKey;
    await this._saveCfg({
      role: 'reader', url: link.url, anonKey: link.anonKey, readKey: link.readKey,
      cursor: same ? (this.cfg.cursor || 0) : 0, revoked: false, pairedAt: Date.now(),
    });
    document.body.classList.add('is-reader');
    // O mesmo aparelho serve para o Modo Banco: fica já configurado.
    if (window.AppState && AppState.settings && !AppState.settings.supabaseUrl) {
      await AppState.saveSettings({ supabaseUrl: link.url, supabaseAnonKey: link.anonKey });
    }
    const n = await this.pull({ onProgress });
    this._startPolling();
    return n;
  },

  /** Sair do modo consulta: apaga a cópia (é só uma cópia) e liberta o aparelho. */
  async unpair() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    for (const s of this.STORES) await this._raw.clear(s);
    await this._saveCfg({ role: null, readKey: null, cursor: 0, lastCheckAt: null, lastChangeAt: null });
    document.body.classList.remove('is-reader');
  },

  _startPolling() {
    clearInterval(this._pollTimer);
    setTimeout(() => this.pull().catch(() => {}), 800);
    this._pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') this.pull().catch(() => {});
    }, this.POLL_MS);
  },

  /** Vai buscar o que mudou. Chamadas sobrepostas juntam-se na mesma. */
  pull(opts = {}) {
    if (!this.isReader()) return Promise.resolve(0);
    if (!this._pulling) this._pulling = this._pull(opts).finally(() => { this._pulling = null; });
    return this._pulling;
  },

  async _pull({ onProgress } = {}) {
    let total = 0;
    const touched = new Set();
    try {
      for (;;) {
        const rows = await this._rpc('mirror_pull', { p_read: this.cfg.readKey, p_since: this.cfg.cursor || 0, p_limit: this.PULL_PAGE });
        if (!Array.isArray(rows) || !rows.length) break;
        const liveId = window.SyncCore && SyncCore.session && SyncCore.session.role === 'coach' ? SyncCore.session.matchId : null;
        let lastChange = this.cfg.lastChangeAt || 0;
        for (const row of rows) {
          await this._applyRow(row, liveId);
          touched.add(row.store);
          const t = Date.parse(row.updated_at);
          if (t > lastChange) lastChange = t;
        }
        total += rows.length;
        await this._saveCfg({ cursor: rows[rows.length - 1].rev, lastChangeAt: lastChange || null });
        if (onProgress) onProgress(total);
        if (rows.length < this.PULL_PAGE) break;
      }
      await this._saveCfg({ lastCheckAt: Date.now(), revoked: false, lastError: null });
    } catch (err) {
      await this._saveCfg({ lastError: err.message, revoked: !!err.revoked });
      this._emit({ kind: 'error', error: err.message });
      throw err;
    }
    if (touched.has('library') && window.AppState) await AppState.loadLibrary();
    this._emit({ kind: 'pulled', count: total, stores: [...touched] });
    return total;
  },

  async _applyRow(row, liveId) {
    if (row.store === 'meta') {
      if (row.payload && window.AppState) await AppState.saveSettings(this.metaFromSettings(row.payload));
      return;
    }
    if (!this.STORES.includes(row.store)) return;
    if (row.payload == null) {
      await this._raw.delete(row.store, row.id);
      return;
    }
    if (liveId) {
      const local = await this._raw.get(row.store, row.id);
      if (!this.shouldApplyRow(row, local, liveId)) return;
    }
    await this._raw.put(row.store, row.payload);
  },
};

window.Mirror = Mirror;
