/**
 * coachDashboard.js — Ecrã do banco (treinador/staff).
 *
 * Desenhado para ser LIDO, não operado: letra grande, contraste alto, pouca
 * informação por ecrã. O treinador deve perceber o estado do jogo em 2-3
 * segundos, de pé, com o iPad na mão.
 *
 * Só lê e guarda momentos — nunca altera os dados de análise (ver permissões).
 * Os dados chegam por sincronização e ficam espelhados no IndexedDB local, por
 * isso continua a mostrar o último estado conhecido mesmo se a rede cair.
 */

const CoachDashboard = {
  match: null,
  occurrences: [],
  players: [],
  messages: [],
  filter: 'all',        // all | own | opponent | important | moments
  timeFilter: 'all',    // all | last5 | last10 | 1T | 2T
  timerTick: null,
  unsubscribe: [],

  async render(root, params) {
    const session = await SyncCore.activeSession();
    // Código no endereço (QR / link do analista): se for diferente da sessão
    // ativa, o utilizador quer ESTE jogo — mostra a entrada para ligar ao novo.
    let urlCode = '';
    try { urlCode = (new URLSearchParams(location.hash.split('?')[1] || '').get('code') || '').trim().toUpperCase(); } catch (e) { /* ignora */ }
    if (urlCode && (!session || session.code !== urlCode)) {
      return this.renderJoin(root, session);
    }
    if (!session || session.role !== SyncCore.ROLES.COACH || !session.matchId) {
      return this.renderJoin(root, session);
    }
    this.session = session;
    await this.loadData();

    root.innerHTML = this.template();
    this.bind();
    this.startClock();
    this.subscribe();
  },

  // ---------- Entrada na sessão ----------
  async renderJoin(root, session) {
    // Código vindo do QR / link partilhado pelo analista (#/coach?code=ABC123).
    let codeFromUrl = '';
    try {
      const qs = (location.hash.split('?')[1] || '');
      codeFromUrl = (new URLSearchParams(qs).get('code') || '').trim().toUpperCase();
    } catch (e) { /* ignora */ }

    root.innerHTML = `
      <div class="screen coach-join">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Modo Banco</h1>
          <span></span>
        </header>
        <div class="coach-join-card">
          <h2>Entrar num jogo</h2>
          <p class="muted">Pede ao analista o código de 6 caracteres que aparece em “Ligar Dispositivo”.</p>
          <input id="coach-code" class="coach-code-input" maxlength="6" placeholder="ABC123" autocapitalize="characters" autocomplete="off" value="${Utils.escapeHtml(codeFromUrl)}">
          <p class="ng-error" id="coach-error" hidden></p>
          <button class="btn btn-primary btn-block btn-lg" id="coach-join">Entrar</button>
          ${session && session.role === SyncCore.ROLES.COACH
            ? '<p class="muted">Há uma sessão anterior por terminar.</p><button class="btn btn-block" id="coach-forget">Esquecer sessão anterior</button>'
            : ''}
        </div>
      </div>`;

    const forget = document.getElementById('coach-forget');
    if (forget) forget.addEventListener('click', async () => {
      await SyncCore.leaveSession();
      this.render(document.getElementById('app-root'));
    });

    const err = () => document.getElementById('coach-error');
    // Null-safe: o processo de ligação é assíncrono e o utilizador pode já ter
    // saído deste ecrã quando a resposta chega.
    const showErr = (msg) => { const e = err(); if (e) { e.innerHTML = msg; e.hidden = false; } };
    const setBtn = (disabled, text) => { const b = document.getElementById('coach-join'); if (b) { b.disabled = disabled; b.textContent = text; } };

    document.getElementById('coach-join').addEventListener('click', async () => {
      const codeEl = document.getElementById('coach-code');
      if (!codeEl) return;
      const code = codeEl.value.trim().toUpperCase();
      if (code.length < 4) return showErr('Escreve o código que aparece no dispositivo do analista.');
      const e0 = err(); if (e0) e0.hidden = true;
      setBtn(true, 'A ligar…');

      try {
        const cloud = await SyncTransports.isCloud();
        const transport = await SyncTransports.pick();
        await SyncCore.joinSession(code, transport);

        // Espera pelo estado do jogo, informando o que está a acontecer em vez
        // de deixar o ecrã parado sem explicação.
        for (let i = 0; i < 12; i++) {
          // O utilizador saiu do ecrã entretanto: aborta em silêncio.
          if (!document.getElementById('coach-join')) return;
          if (SyncCore.session?.matchId) {
            const m = await DB.get(DB.STORES.matches, SyncCore.session.matchId);
            if (m) return this.render(document.getElementById('app-root'));
          }
          setBtn(true, `À espera do jogo… (${i + 1})`);
          await new Promise((r) => setTimeout(r, 1000));
          await SyncCore.catchUp(0);
        }

        // Falhou: explicar a causa provável em vez de um erro genérico.
        setBtn(false, 'Tentar novamente');
        if (!cloud) {
          showErr('<strong>Supabase não configurado neste dispositivo.</strong><br>Sem isso, só é possível ligar separadores do mesmo iPad. Vai a Definições → Sincronização e cola o URL e a chave anon.');
        } else if (SyncCore.status === 'offline') {
          showErr('<strong>Sem ligação ao Supabase.</strong><br>Verifica a internet e se o URL e a chave estão corretos em Definições.');
        } else {
          showErr('<strong>Ligado, mas não chegou nenhum jogo com este código.</strong><br>Confirma o código no iPad do analista. Se estiver certo, pede-lhe para abrir novamente “Ligar dispositivo do banco” — isso reenvia o estado do jogo.');
        }
      } catch (e) {
        setBtn(false, 'Tentar novamente');
        showErr('Não foi possível ligar: ' + Utils.escapeHtml(e.message));
      }
    });

    // Chegou com código no endereço (QR ou link do analista): liga-se sozinho.
    if (codeFromUrl && codeFromUrl.length >= 4) {
      document.getElementById('coach-join').click();
    }
  },

  async loadData() {
    this.match = await DB.get(DB.STORES.matches, this.session.matchId);
    if (!this.match) return;
    this.occurrences = await AppState.getOccurrences(this.match.id);
    const ids = [this.match.teams?.own?.teamId, this.match.teams?.opponent?.teamId].filter(Boolean);
    this.players = [];
    for (const id of ids) this.players.push(...await AppState.getTeamPlayers(id));
    this.messages = (await DB.getAllByIndex(DB.STORES.messages, 'matchId', this.match.id))
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  // ---------- Ecrã principal ----------
  template() {
    const m = this.match;
    const st = MatchStats.compute(m, this.occurrences);
    const periodLabel = PERIOD_LABELS[m.currentPeriod] || '';
    const finished = m.status === 'finished';
    const halftime = m.currentPeriod === PERIODS.HALF_TIME;

    return `
      <div class="screen coach-screen">
        <header class="coach-top">
          <div class="coach-scoreline">
            <span class="coach-team">${Utils.escapeHtml(m.team)}</span>
            <span class="coach-score">${m.score.team} <span class="coach-dash">-</span> ${m.score.opponent}</span>
            <span class="coach-team">${Utils.escapeHtml(m.opponent)}</span>
          </div>
          <div class="coach-clock-row">
            <button class="btn btn-tiny" id="coach-exit" title="Sair do Modo Banco">✕ Sair</button>
            <span class="coach-clock" id="coach-clock">--:--</span>
            <span class="coach-period ${finished ? 'is-finished' : ''}">${finished ? 'JOGO TERMINADO' : (halftime ? 'INTERVALO' : periodLabel)}</span>
            <span class="conn-badge" id="coach-conn">•</span>
          </div>
        </header>

        ${halftime || finished ? `<div class="coach-banner">${finished ? '⏹ Jogo terminado — resumo abaixo' : '⏱ Intervalo — resumo da parte'}</div>` : ''}

        <div class="coach-body">
          <section class="coach-stats">
            <table class="coach-stats-table">
              ${['goals', 'shots', 'shotsOnTarget', 'corners', 'foulsCommitted', 'yellowCards']
                .map((k) => {
                  const label = MatchStats.STAT_KEYS.find((x) => x.key === k)?.label || k;
                  return `<tr><td class="cs-own">${st.own[k]}</td><td class="cs-label">${label}</td><td class="cs-opp">${st.opp[k]}</td></tr>`;
                }).join('')}
            </table>
          </section>

          <section class="coach-feed-wrap">
            <div class="coach-filters">
              ${[['all', 'Todos'], ['own', m.team], ['opponent', m.opponent], ['important', 'Importantes'], ['moments', '⭐ Momentos']]
                .map(([k, l]) => `<button class="coach-filter ${this.filter === k ? 'active' : ''}" data-filter="${k}">${Utils.escapeHtml(l)}</button>`).join('')}
            </div>
            <div class="coach-filters coach-filters-time">
              ${[['all', 'Jogo'], ['last5', '5 min'], ['last10', '10 min'], ['1T', '1ª P'], ['2T', '2ª P']]
                .map(([k, l]) => `<button class="coach-filter ${this.timeFilter === k ? 'active' : ''}" data-time="${k}">${l}</button>`).join('')}
            </div>
            <div class="coach-feed" id="coach-feed"></div>
          </section>

          <aside class="coach-side">
            <button class="btn btn-primary btn-block btn-lg" id="coach-save-moment">⭐ Guardar Momento</button>
            <h3 class="coach-side-title">Mensagens do Analista</h3>
            <div class="coach-messages" id="coach-messages"></div>
          </aside>
        </div>

        <div class="coach-toast" id="coach-toast" hidden></div>
      </div>`;
  },

  filteredEvents() {
    const nowMin = this.currentMinute();
    return this.occurrences
      .filter((o) => {
        if (this.filter === 'own') return o.team === 'own';
        if (this.filter === 'opponent') return o.team === 'opponent';
        if (this.filter === 'important') return o.priority === 'critical' || ['golo', 'cartao', 'substituicao', 'momento'].includes(o.source);
        if (this.filter === 'moments') return o.source === 'momento' || o.meta?.moment || o.coachSaved;
        return true;
      })
      .filter((o) => {
        if (this.timeFilter === '1T') return o.period === '1T';
        if (this.timeFilter === '2T') return o.period === '2T';
        if (this.timeFilter === 'last5') return o.minute >= nowMin - 5;
        if (this.timeFilter === 'last10') return o.minute >= nowMin - 10;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  },

  ICONS: {
    golo: '⚽', cartao: '🟨', substituicao: '🔄', momento: '⭐', remate: '🎯',
    falta: '⚠️', canto: '🚩', defesa: '🧤', nota: '📝', banco: '📣', event: '▪️',
  },

  renderFeed() {
    const feed = document.getElementById('coach-feed');
    if (!feed) return;
    const list = this.filteredEvents().slice(0, 60);
    if (!list.length) { feed.innerHTML = '<p class="muted coach-empty">Sem acontecimentos para este filtro.</p>'; return; }
    feed.innerHTML = list.map((o) => {
      const players = (o.playerIds || []).map((id) => this.players.find((p) => p.id === id)).filter(Boolean);
      const icon = this.ICONS[o.source] || this.ICONS.event;
      const sideCls = o.team === 'own' ? 'is-own' : (o.team === 'opponent' ? 'is-opp' : '');
      return `
        <div class="coach-event ${sideCls} ${o.coachSaved ? 'is-saved' : ''}">
          <span class="coach-event-time">${String(o.minute).padStart(2, '0')}:${String(o.second).padStart(2, '0')}</span>
          <span class="coach-event-icon">${icon}</span>
          <span class="coach-event-name">${Utils.escapeHtml(o.eventName)}${players.length ? ` — ${players.map((p) => Utils.escapeHtml(p.shortName || p.name)).join(', ')}` : ''}</span>
          ${o.note ? `<span class="coach-event-note">${Utils.escapeHtml(o.note)}</span>` : ''}
        </div>`;
    }).join('');
  },

  renderMessages() {
    const box = document.getElementById('coach-messages');
    if (!box) return;
    if (!this.messages.length) { box.innerHTML = '<p class="muted">Sem mensagens.</p>'; return; }
    box.innerHTML = this.messages.slice(0, 12).map((msg) => `
      <div class="coach-msg prio-${msg.priority || 'normal'}">
        <span class="coach-msg-head">${msg.icon || '🧠'} ${Utils.escapeHtml(msg.title || 'Analista')} <span class="muted">${String(msg.minute ?? '').padStart(2, '0')}'</span></span>
        <p>${Utils.escapeHtml(msg.text || '')}</p>
      </div>`).join('');
  },

  /** Minuto atual reconstruído a partir do snapshot do cronómetro. */
  currentMinute() {
    const snap = this.match?.timerSnapshot;
    if (!snap) return 0;
    let ms = snap.periodElapsedMs || 0;
    if (snap.running && snap.savedAt) ms += Math.max(0, Date.now() - snap.savedAt);
    let base = 0;
    if (snap.period === '2T') base = 45;
    if (snap.period === 'ET1') base = 90;
    if (snap.period === 'ET2') base = 105;
    return base + Math.floor(ms / 60000) + Math.floor((snap.manualOffsetSec || 0) / 60);
  },

  clockLabel() {
    const snap = this.match?.timerSnapshot;
    if (!snap) return '--:--';
    let ms = snap.periodElapsedMs || 0;
    if (snap.running && snap.savedAt) ms += Math.max(0, Date.now() - snap.savedAt);
    let base = 0;
    if (snap.period === '2T') base = 45;
    if (snap.period === 'ET1') base = 90;
    if (snap.period === 'ET2') base = 105;
    const total = base * 60 + Math.floor(ms / 1000) + (snap.manualOffsetSec || 0);
    const mm = Math.max(0, Math.floor(total / 60));
    const ss = Math.max(0, total % 60);
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  },

  startClock() {
    clearInterval(this.timerTick);
    const paint = () => {
      const el = document.getElementById('coach-clock');
      if (el) el.textContent = this.clockLabel();
    };
    paint();
    // Rede de segurança: além de reagir às mensagens recebidas, o banco
    // reconfirma o estado do jogo (resultado, parte, fim) a cada segundo a
    // partir do espelho local. Se uma mensagem se perder ou chegar atrasada,
    // o ecrã do treinador corrige-se sozinho em vez de ficar desatualizado.
    this.timerTick = setInterval(async () => {
      paint();
      if (!this.session?.matchId) return;
      const fresh = await DB.get(DB.STORES.matches, this.session.matchId);
      if (!fresh) return;
      const changed = !this.match
        || fresh.currentPeriod !== this.match.currentPeriod
        || fresh.status !== this.match.status
        || fresh.score?.team !== this.match.score?.team
        || fresh.score?.opponent !== this.match.score?.opponent;
      if (changed) {
        await this.loadData();
        this.repaint();
      }
    }, 1000);
  },

  /** Redesenha o ecrã mantendo filtros, relógio e subscrições ativas. */
  repaint() {
    const root = document.getElementById('app-root');
    if (!root || !this.match) return;
    const scroll = document.getElementById('coach-feed')?.scrollTop || 0;
    root.innerHTML = this.template();
    this.bind();
    this.startClock();
    const feed = document.getElementById('coach-feed');
    if (feed) feed.scrollTop = scroll;
  },

  bind() {
    document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      this.filter = b.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
      this.renderFeed();
    }));
    document.querySelectorAll('[data-time]').forEach((b) => b.addEventListener('click', () => {
      this.timeFilter = b.dataset.time;
      document.querySelectorAll('[data-time]').forEach((x) => x.classList.toggle('active', x === b));
      this.renderFeed();
    }));
    document.getElementById('coach-save-moment').addEventListener('click', () => this.saveMoment());

    // Sair do Modo Banco: encerra a sessão para não voltar a abrir este jogo
    // automaticamente na próxima utilização.
    document.getElementById('coach-exit').addEventListener('click', async () => {
      if (!confirm('Sair do Modo Banco?\n\nA ligação a este jogo é encerrada. Podes voltar a entrar com um código novo.')) return;
      clearInterval(this.timerTick);
      this.unsubscribe.forEach((fn) => fn());
      this.unsubscribe = [];
      this.match = null;
      this.session = null;
      await SyncCore.leaveSession();
      window.location.hash = '#/dashboard';
    });

    this.renderFeed();
    this.renderMessages();
    this.paintConnection(SyncCore.status);
  },

  /** O staff marca um instante relevante. Fica identificado como COACH_SAVED. */
  async saveMoment() {
    const min = this.currentMinute();
    const occ = {
      id: Utils.uid('occ'),
      matchId: this.match.id,
      timestamp: Date.now(),
      period: this.match.timerSnapshot?.period || this.match.currentPeriod || '1T',
      minute: min,
      second: 0,
      category: 'momento',
      categoryLabel: 'Momento',
      eventName: 'Momento (banco)',
      eventType: 'neutral',
      priority: 'important',
      note: '',
      source: 'momento',
      playerIds: [],
      team: null,
      meta: { coachSaved: true },
      coachSaved: true,
      createdAt: Date.now(),
    };
    await AppState.addOccurrence(occ);
    this.occurrences.push(occ);
    SyncCore.publish('occurrence', 'upsert', occ);
    this.renderFeed();
    this.flash('⭐ Momento guardado');
  },

  flash(text) {
    const el = document.getElementById('coach-toast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { el.hidden = true; }, 2500);
  },

  paintConnection(status) {
    const el = document.getElementById('coach-conn');
    if (!el) return;
    const map = { online: ['🟢', 'Ligado'], syncing: ['🟡', 'A sincronizar'], offline: ['🔴', 'Sem ligação — a mostrar o último estado'] };
    const [icon, label] = map[status] || map.offline;
    el.textContent = icon;
    el.title = label;
    el.className = `conn-badge conn-${status}`;
  },

  /** Atualiza resultado e período a partir do jogo já carregado. */
  paintScore() {
    if (!this.match) return;
    const scoreEl = document.querySelector('.coach-score');
    if (scoreEl) scoreEl.innerHTML = `${this.match.score.team} <span class="coach-dash">-</span> ${this.match.score.opponent}`;
    const perEl = document.querySelector('#coach-period');
    if (perEl) perEl.textContent = PERIOD_LABELS[this.match.currentPeriod] || '';
  },

  /** Reage a tudo o que chega do analista, sem refresh manual. */
  subscribe() {
    this.unsubscribe.forEach((fn) => fn());
    this.unsubscribe = [
      SyncCore.onStatus((st) => this.paintConnection(st)),
      SyncCore.onMessage(async (env) => {
        // Qualquer envelope faz o banco reler o estado do jogo a partir da base
        // de dados local. É barato e elimina a dependência de um tipo concreto
        // de mensagem chegar primeiro — o placar nunca fica desatualizado por
        // causa da ordem de chegada.
        await this.loadData();
        this.paintScore();
        this.renderFeed();
        this.renderMessages();

        if (env.entityType === 'occurrence' && env.payload?.source === 'golo') {
          this.flash('⚽ ' + (env.payload.eventName || 'Golo'));
        } else if (env.entityType === 'message') {
          const p = env.payload || {};
          this.flash(`${p.icon || '🧠'} ${p.text || 'Nova mensagem'}`);
        }
      }),
    ];
  },
};

window.CoachDashboard = CoachDashboard;
