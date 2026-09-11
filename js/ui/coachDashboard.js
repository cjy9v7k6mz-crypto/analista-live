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
    this.role = session.coachRole || 'adjunto';
    if (!this._filterSetByUser) this.filter = this.roleDefaultFilter();
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
          <label class="field"><span>A tua função</span>
            <select id="coach-role">
              <option value="adjunto">Adjunto — vista completa</option>
              <option value="principal">Treinador — só o essencial</option>
              <option value="gr">Treinador de GR — foco defensivo</option>
            </select>
          </label>
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

      const role = document.getElementById('coach-role')?.value || 'adjunto';
      try {
        const cloud = await SyncTransports.isCloud();
        const transport = await SyncTransports.pick();
        await SyncCore.joinSession(code, transport);
        if (SyncCore.session) {
          SyncCore.session.coachRole = role;
          try { await DB.put(DB.STORES.sessions, SyncCore.session); } catch (e) { /* ignora */ }
        }

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
      <div class="screen coach-screen" data-role="${this.role || 'adjunto'}">
        <header class="coach-top">
          <div class="coach-scoreline">
            <span class="coach-team">${Utils.escapeHtml(m.team)}</span>
            <span class="coach-score">${m.score.team} <span class="coach-dash">-</span> ${m.score.opponent}</span>
            <span class="coach-team">${Utils.escapeHtml(m.opponent)}</span>
          </div>
          <div class="coach-clock-row">
            <button class="btn btn-tiny" id="coach-exit" title="Sair do Modo Banco">✕ Sair</button>
            <button class="btn btn-tiny coach-role-chip" id="coach-role-chip" title="Mudar de função">👤 ${this.ROLE_LABELS[this.role] || 'Adjunto'}</button>
            <span class="coach-clock" id="coach-clock">--:--</span>
            <span class="coach-period ${finished ? 'is-finished' : ''}">${finished ? 'JOGO TERMINADO' : (halftime ? 'INTERVALO' : periodLabel)}</span>
            <span class="conn-badge" id="coach-conn">•</span>
          </div>
        </header>

        <div id="coach-period-summary"></div>

        <div class="coach-body">
          <section class="coach-stats">
            <table class="coach-stats-table" id="coach-stats-table">${this.statRows(st)}</table>
            <div class="coach-momentum" id="coach-momentum"></div>
          </section>

          <section class="coach-centre">
            <div class="coach-pitch-wrap" id="coach-pitch"></div>
            <div class="coach-feed-wrap">
              <div class="coach-filters">
                ${[['all', 'Todos'], ['own', m.team], ['opponent', m.opponent], ['important', 'Importantes'], ['moments', '⭐ Momentos'], ['gr', '🧤 GR']]
                  .map(([k, l]) => `<button class="coach-filter ${this.filter === k ? 'active' : ''}" data-filter="${k}">${Utils.escapeHtml(l)}</button>`).join('')}
              </div>
              <div class="coach-filters coach-filters-time">
                ${[['all', 'Jogo'], ['last5', '5 min'], ['last10', '10 min'], ['1T', '1ª P'], ['2T', '2ª P']]
                  .map(([k, l]) => `<button class="coach-filter ${this.timeFilter === k ? 'active' : ''}" data-time="${k}">${l}</button>`).join('')}
              </div>
              <div class="coach-feed" id="coach-feed"></div>
            </div>
          </section>

          <aside class="coach-side">
            <button class="btn btn-primary btn-block btn-lg" id="coach-save-moment">⭐ Guardar Momento</button>
            <button class="btn btn-block" id="coach-propose-sub">🔁 Propor substituição</button>
            <div class="coach-sub-status" id="coach-sub-status" hidden></div>
            <button class="btn btn-block" id="coach-talk">📣 Falar com o analista</button>
            <h3 class="coach-side-title">Conversa com o analista</h3>
            <div class="coach-messages" id="coach-messages"></div>
          </aside>
        </div>

        <div class="coach-toast" id="coach-toast" hidden></div>
        <div class="coach-spotlight-banner" id="coach-spotlight" hidden></div>

        <dialog id="dlg-coach-sub" class="dialog">
          <div class="dialog-card">
            <div class="stats-head"><h3>🔁 Propor substituição</h3><button type="button" class="icon-btn" id="coach-sub-close">✕</button></div>
            <p class="muted">O analista confirma e regista. Serve para alinharem a alteração.</p>
            <p class="field-label">Sai</p>
            <div class="coach-sub-grid" id="coach-sub-out"></div>
            <p class="field-label">Entra</p>
            <div class="coach-sub-grid" id="coach-sub-in"></div>
            <div class="dialog-actions">
              <button type="button" class="btn btn-primary" id="coach-sub-send" disabled>Enviar proposta</button>
            </div>
          </div>
        </dialog>

        <dialog id="dlg-coach-moment" class="dialog">
          <div class="dialog-card">
            <h3>⭐ Momento <span class="muted" id="coach-moment-time"></span></h3>
            <textarea id="coach-moment-note" rows="3" placeholder="O que viste? (opcional — ajuda o analista a perceber o teu olhar)"></textarea>
            <div class="dialog-actions">
              <button type="button" class="btn" id="coach-moment-cancel">Cancelar</button>
              <button type="button" class="btn btn-primary" id="coach-moment-save">Guardar</button>
            </div>
          </div>
        </dialog>

        <dialog id="dlg-coach-talk" class="dialog">
          <div class="dialog-card">
            <div class="stats-head"><h3>📣 Falar com o analista</h3><button type="button" class="icon-btn" id="coach-talk-close">✕</button></div>
            <div class="coach-talk-presets" id="coach-talk-presets"></div>
            <textarea id="coach-talk-text" rows="3" placeholder="Escrever ao analista…"></textarea>
            <div class="dialog-actions">
              <button type="button" class="btn btn-primary" id="coach-talk-send">Enviar</button>
            </div>
          </div>
        </dialog>
      </div>`;
  },

  /** Perguntas / pedidos rápidos do banco para o analista. */
  TALK_PRESETS: [
    { icon: '👀', text: 'Foca-te nos comportamentos do lateral direito deles.' },
    { icon: '🧭', text: 'Dá-me leitura do nosso meio-campo.' },
    { icon: '⚽', text: 'Avisa-me na próxima bola parada a favor.' },
    { icon: '🔁', text: 'Vou fazer alteração — quem está a render menos?' },
    { icon: '⏱', text: 'Como estamos de forma física? Quem está a cair?' },
    { icon: '🎯', text: 'Onde estão a aparecer os espaços deles?' },
  ],

  // ---------- Funções (papéis) no banco ----------
  ROLE_LABELS: { principal: 'Treinador', adjunto: 'Adjunto', gr: 'Treinador de GR' },
  ROLES_ORDER: ['adjunto', 'principal', 'gr'],
  role: 'adjunto',

  roleDefaultFilter() {
    if (this.role === 'principal') return 'important';
    if (this.role === 'gr') return 'gr';
    return 'all';
  },

  async setRole(role) {
    this.role = role;
    this.filter = this.roleDefaultFilter();
    if (this.session) {
      this.session.coachRole = role;
      try { await DB.put(DB.STORES.sessions, this.session); } catch (e) { /* ignora */ }
    }
    this.repaint();
  },

  cycleRole() {
    const i = this.ROLES_ORDER.indexOf(this.role);
    this.setRole(this.ROLES_ORDER[(i + 1) % this.ROLES_ORDER.length]);
  },

  // ---------- Resumo de período (empurrado no intervalo / fim) ----------
  renderPeriodSummary() {
    const box = document.getElementById('coach-period-summary');
    if (!box || !this.match) return;
    const finished = this.match.status === 'finished';
    const halftime = this.match.currentPeriod === PERIODS.HALF_TIME;
    if (!finished && !halftime) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;

    const counts = {};
    this.occurrences.forEach((o) => { if (o.planEventId) counts[o.planEventId] = (counts[o.planEventId] || 0) + 1; });
    const withCounts = (this.match.observationPlan || [])
      .map((e) => ({ ...e, count: counts[e.id] || 0 })).filter((e) => e.count > 0);
    const trendCfg = (window.AppState && AppState.settings && AppState.settings.trendConfig) || undefined;
    const problems = withCounts.filter((e) => e.type === 'negative').sort((a, b) => b.count - a.count).slice(0, 5);
    const positives = withCounts.filter((e) => e.type === 'positive').sort((a, b) => b.count - a.count).slice(0, 5);
    const trending = withCounts.filter((e) => Utils.getTrendLevel(e.count, trendCfg).showBadge).sort((a, b) => b.count - a.count).slice(0, 5);
    const bench = this.occurrences.filter((o) => o.source === 'banco');
    const moments = this.occurrences.filter((o) => o.source === 'momento');

    const list = (arr, fn) => arr.length ? arr.map(fn).join('') : '<p class="muted">—</p>';
    box.innerHTML = `
      <div class="coach-summary ${finished ? 'is-finished' : ''}">
        <div class="coach-summary-head">
          <span>${finished ? '⏹ FIM DO JOGO' : '⏱ INTERVALO'}</span>
          <strong>${Utils.escapeHtml(this.match.team)} ${this.match.score.team} - ${this.match.score.opponent} ${Utils.escapeHtml(this.match.opponent)}</strong>
          <button class="btn btn-tiny" id="coach-summary-collapse">Ver detalhe ▾</button>
        </div>
        <div class="coach-summary-grid" id="coach-summary-grid">
          <section><h4>🔴 Problemas</h4>${list(problems, (e) => `<div class="cs-line"><span>${Utils.escapeHtml(e.name)}</span><strong>${e.count}×</strong></div>`)}</section>
          <section><h4>🟢 Positivos</h4>${list(positives, (e) => `<div class="cs-line"><span>${Utils.escapeHtml(e.name)}</span><strong>${e.count}×</strong></div>`)}</section>
          <section><h4>⚠️ Tendências</h4>${list(trending, (e) => `<div class="cs-line"><span>${Utils.escapeHtml(e.name)}</span><strong>${e.count}× ${Utils.getTrendLevel(e.count, trendCfg).label}</strong></div>`)}</section>
          <section><h4>🚨 Banco</h4>${list(bench.slice(-5), (o) => `<div class="cs-line"><span>${String(o.minute).padStart(2, '0')}' ${Utils.escapeHtml(o.eventName)}</span></div>`)}</section>
          <section><h4>⭐ Momentos</h4>${list(moments.slice(-5), (o) => `<div class="cs-line"><span>${String(o.minute).padStart(2, '0')}'</span>${o.note ? `<span class="muted">"${Utils.escapeHtml(o.note)}"</span>` : ''}</div>`)}</section>
        </div>
      </div>`;
    const grid = box.querySelector('#coach-summary-grid');
    const btn = box.querySelector('#coach-summary-collapse');
    btn.addEventListener('click', () => {
      const hidden = grid.hasAttribute('hidden');
      if (hidden) { grid.removeAttribute('hidden'); btn.textContent = 'Esconder ▴'; }
      else { grid.setAttribute('hidden', ''); btn.textContent = 'Ver detalhe ▾'; }
    });
  },

  // ---------- Propor substituição ----------
  openSubProposeSheet() {
    const dlg = document.getElementById('dlg-coach-sub');
    if (!dlg) return;
    const ownTeamId = this.match.teams?.own?.teamId;
    const players = this.players.filter((p) => p.teamId === ownTeamId);
    const state = LineupState.compute(this.match, 'own');
    const onField = players.filter((p) => state.onFieldIds.has(p.id));
    const benchPool = players.filter((p) => !state.onFieldIds.has(p.id) && !state.subbedOffIds.has(p.id));

    let outId = null; let inId = null;
    const chip = (p, kind) => `<button class="coach-sub-chip" data-${kind}="${p.id}">${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.shortName || p.name)}</button>`;
    dlg.querySelector('#coach-sub-out').innerHTML = onField.length ? onField.map((p) => chip(p, 'out')).join('') : '<p class="muted">Onze não definido.</p>';
    dlg.querySelector('#coach-sub-in').innerHTML = benchPool.length ? benchPool.map((p) => chip(p, 'in')).join('') : '<p class="muted">Sem suplentes disponíveis.</p>';

    const sendBtn = dlg.querySelector('#coach-sub-send');
    const refresh = () => { sendBtn.disabled = !(outId && inId); };
    dlg.querySelectorAll('[data-out]').forEach((b) => b.addEventListener('click', () => {
      outId = b.dataset.out;
      dlg.querySelectorAll('[data-out]').forEach((x) => x.classList.toggle('selected', x === b));
      refresh();
    }));
    dlg.querySelectorAll('[data-in]').forEach((b) => b.addEventListener('click', () => {
      inId = b.dataset.in;
      dlg.querySelectorAll('[data-in]').forEach((x) => x.classList.toggle('selected', x === b));
      refresh();
    }));
    sendBtn.onclick = () => {
      const outP = players.find((p) => p.id === outId);
      const inP = players.find((p) => p.id === inId);
      this.sendSubIntent(outP, inP);
      dlg.close();
    };
    dlg.showModal();
  },

  sendSubIntent(outP, inP) {
    if (!outP || !inP) return;
    this._pendingSub = {
      id: Utils.uid('si'),
      status: 'propose',
      outId: outP.id, inId: inP.id,
      outName: outP.name, inName: inP.name,
      minute: this.currentMinute(),
      at: Date.now(),
    };
    SyncCore.publish('sub_intent', 'propose', this._pendingSub);
    this.renderSubStatus('⏳ Proposta enviada — à espera do analista', 'pending');
    this.flash('Proposta de substituição enviada');
  },

  renderSubStatus(text, kind) {
    const el = document.getElementById('coach-sub-status');
    if (!el) return;
    if (!text) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.className = `coach-sub-status is-${kind || 'pending'}`;
    el.innerHTML = Utils.escapeHtml(text);
  },

  filteredEvents() {
    const nowMin = this.currentMinute();
    return this.occurrences
      .filter((o) => {
        if (this.filter === 'own') return o.team === 'own';
        if (this.filter === 'opponent') return o.team === 'opponent';
        if (this.filter === 'important') return o.priority === 'critical' || ['golo', 'cartao', 'substituicao', 'momento'].includes(o.source);
        if (this.filter === 'moments') return o.source === 'momento' || o.meta?.moment || o.coachSaved;
        if (this.filter === 'gr') return o.source === 'defesa' || o.source === 'golo'
          || (o.team === 'opponent' && ['remate', 'canto', 'falta'].includes(o.source));
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
    if (!this.messages.length) { box.innerHTML = '<p class="muted">Ainda sem conversa. Usa “📣 Falar com o analista”.</p>'; return; }
    box.innerHTML = this.messages.slice(0, 16).map((msg) => {
      const mine = msg.sender === 'coach';
      return `
      <div class="coach-msg prio-${msg.priority || 'normal'} ${mine ? 'is-mine' : ''}">
        <span class="coach-msg-head">${mine ? '🫱 Eu' : `${msg.icon || '🧠'} ${Utils.escapeHtml(msg.title || 'Analista')}`} <span class="muted">${String(msg.minute ?? '').padStart(2, '0')}'</span></span>
        <p>${Utils.escapeHtml(msg.text || '')}</p>
      </div>`;
    }).join('');
  },

  statRows(st) {
    return ['goals', 'shots', 'shotsOnTarget', 'corners', 'foulsCommitted', 'yellowCards'].map((k) => {
      const label = MatchStats.STAT_KEYS.find((x) => x.key === k)?.label || k;
      return `<tr><td class="cs-own">${st.own[k]}</td><td class="cs-label">${label}</td><td class="cs-opp">${st.opp[k]}</td></tr>`;
    }).join('');
  },

  renderStats() {
    const t = document.getElementById('coach-stats-table');
    if (!t || !this.match) return;
    t.innerHTML = this.statRows(MatchStats.compute(this.match, this.occurrences));
  },

  // ---------- Campo ao vivo ----------
  renderPitch() {
    const wrap = document.getElementById('coach-pitch');
    if (!wrap || !this.match) return;

    const sideLayer = (side) => {
      const players = this.players.filter((p) => p.teamId === this.match.teams?.[side]?.teamId);
      const state = LineupState.compute(this.match, side);
      return state.positions.map((pos) => {
        const p = players.find((x) => x.id === pos.playerId);
        const status = p ? state.statusByPlayerId.get(p.id) : null;
        const cls = `coach-token ${side === 'own' ? 'is-own' : 'is-opp'} ${status === 'sub_in' ? 'is-sub-in' : ''} ${this._spotlightId && p && p.id === this._spotlightId ? 'is-spotlight' : ''}`;
        // A nossa equipa ataca para CIMA (top = 100 - y); o adversário ataca para
        // BAIXO no mesmo campo (top = y) — os dois onze cabem numa só imagem.
        const top = side === 'own' ? (100 - pos.y) : pos.y;
        return `<button class="${cls}" style="left:${pos.x}%; top:${top}%" ${p ? `data-coach-player="${p.id}"` : ''} title="${p ? Utils.escapeHtml(p.name) : pos.role}">
          <span class="coach-token-num">${p ? (p.number || '') : ''}</span>
          <span class="coach-token-name">${p ? Utils.escapeHtml(p.shortName || p.name) : pos.role}</span>
        </button>`;
      }).join('');
    };

    // Pins de remates / faltas dos últimos ~12 min (ou tudo se o jogo for curto).
    const nowMin = this.currentMinute();
    const recent = this.occurrences.filter((o) => (o.minute ?? 0) >= nowMin - 12);
    const pins = recent.filter((o) => (o.source === 'remate' && o.meta?.origin) || (o.source === 'falta' && o.meta?.location))
      .map((o) => {
        const xy = o.source === 'remate' ? o.meta.origin : o.meta.location;
        const isGoal = o.source === 'remate' && o.meta?.result === 'goal';
        const sym = o.source === 'falta' ? '×' : (isGoal ? '★' : '•');
        return `<span class="coach-pin ${o.team === 'own' ? 'is-own' : 'is-opp'} ${isGoal ? 'is-goal' : ''}" style="left:${xy.x * 100}%; top:${xy.y * 100}%">${sym}</span>`;
      }).join('');

    const hasLineup = (this.match.teams?.own?.positions || []).length || (this.match.teams?.opponent?.positions || []).length;
    wrap.innerHTML = hasLineup ? `
      <div class="pitch-map coach-pitch">
        ${Pitch.svg()}
        <div class="pitch-map-layer">
          ${sideLayer('own')}
          ${sideLayer('opponent')}
          ${pins}
        </div>
      </div>
      <div class="coach-pitch-legend">
        <span><b class="dot own"></b> ${Utils.escapeHtml(this.match.team)} <span class="muted">↑</span></span>
        <span><b class="dot opp"></b> ${Utils.escapeHtml(this.match.opponent)} <span class="muted">↓</span></span>
        <span class="muted">★ golo · • remate · × falta (últ. 12′)</span>
      </div>` : '<p class="muted coach-empty">Onze inicial ainda não foi definido pelo analista.</p>';

    wrap.querySelectorAll('[data-coach-player]').forEach((b) =>
      b.addEventListener('click', () => this.showPlayerCard(b.dataset.coachPlayer)));
  },

  showPlayerCard(playerId) {
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return;
    const evs = this.occurrences.filter((o) => (o.playerIds || []).includes(playerId));
    const shots = evs.filter((e) => e.source === 'remate').length;
    const goals = evs.filter((e) => e.source === 'remate' && e.meta?.result === 'goal').length;
    const fouls = evs.filter((e) => e.source === 'falta' && e.meta?.committedById === playerId).length;
    const cards = evs.filter((e) => e.source === 'cartao').length;
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head"><h3>${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.name)}</h3><button type="button" class="icon-btn" data-close>✕</button></div>
        <p class="muted">${Utils.escapeHtml(p.position || '')}</p>
        <div class="coach-card-stats">
          <div><strong>${evs.length}</strong><span>ações</span></div>
          <div><strong>${shots}</strong><span>remates</span></div>
          <div><strong>${goals}</strong><span>golos</span></div>
          <div><strong>${fouls}</strong><span>faltas</span></div>
          <div><strong>${cards}</strong><span>cartões</span></div>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-close]').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  },

  // ---------- Momentum ----------
  renderMomentum() {
    const el = document.getElementById('coach-momentum');
    if (!el || !this.match) return;
    const nowMin = this.currentMinute();
    const m = MatchStats.momentum(this.occurrences, Math.max(0, nowMin - 5), nowMin + 1);
    const ownPct = m.total ? m.ownPct : 50;
    // Estado ambiente: verde se estamos claramente por cima, vermelho se abaixo.
    const mood = !m.total ? '' : (ownPct >= 62 ? 'is-up' : (ownPct <= 38 ? 'is-down' : ''));
    document.querySelector('.coach-screen')?.setAttribute('data-mood', mood || 'even');
    el.innerHTML = `
      <div class="coach-momentum-label"><span>Momentum</span><span class="muted">últ. 5 min</span></div>
      <div class="coach-momentum-bar ${mood}">
        <div class="coach-momentum-fill own" style="width:${ownPct}%"></div>
        <div class="coach-momentum-fill opp" style="width:${100 - ownPct}%"></div>
      </div>
      <div class="coach-momentum-ends"><span>${ownPct}%</span><span>${100 - ownPct}%</span></div>`;
  },

  // ---------- Spotlight recebido do analista ----------
  receiveSpotlight(payload) {
    if (!payload || !payload.playerId) return;
    // Ignora spotlights antigos que cheguem por recuperação de histórico.
    if (payload.at && Date.now() - payload.at > 15000) return;
    this._spotlightId = payload.playerId;
    const p = this.players.find((x) => x.id === payload.playerId);
    const banner = document.getElementById('coach-spotlight');
    if (banner) {
      banner.innerHTML = `👉 O analista está a apontar: <strong>${p ? (p.number ? '#' + p.number + ' ' : '') + Utils.escapeHtml(p.name) : Utils.escapeHtml(payload.name || 'jogador')}</strong>`;
      banner.hidden = false;
    }
    this.renderPitch();
    clearTimeout(this._spotlightTimer);
    this._spotlightTimer = setTimeout(() => {
      this._spotlightId = null;
      const b = document.getElementById('coach-spotlight');
      if (b) b.hidden = true;
      this.renderPitch();
    }, 8000);
  },

  // ---------- Momento com nota ----------
  openMomentSheet() {
    const dlg = document.getElementById('dlg-coach-moment');
    if (!dlg) return this.saveMoment('');
    document.getElementById('coach-moment-time').textContent = `${String(this.currentMinute()).padStart(2, '0')}'`;
    document.getElementById('coach-moment-note').value = '';
    dlg.showModal();
  },

  // ---------- Falar com o analista ----------
  openTalkSheet() {
    const dlg = document.getElementById('dlg-coach-talk');
    if (!dlg) return;
    document.getElementById('coach-talk-presets').innerHTML = this.TALK_PRESETS.map((p, i) =>
      `<button type="button" class="btn coach-talk-preset" data-talk="${i}">${p.icon} ${Utils.escapeHtml(p.text)}</button>`).join('');
    document.getElementById('coach-talk-text').value = '';
    dlg.querySelectorAll('[data-talk]').forEach((b) => b.addEventListener('click', () => {
      this.sendToAnalyst(this.TALK_PRESETS[Number(b.dataset.talk)].icon, this.TALK_PRESETS[Number(b.dataset.talk)].text);
      dlg.close();
    }));
    dlg.showModal();
  },

  async sendToAnalyst(icon, text, priority = 'normal') {
    text = String(text || '').trim();
    if (!text) return;
    const msg = {
      id: Utils.uid('msg'),
      matchId: this.match.id,
      sender: 'coach',
      icon, title: 'Banco', text,
      priority,
      minute: this.currentMinute(),
      period: this.match.timerSnapshot?.period || this.match.currentPeriod || '1T',
      createdAt: Date.now(),
      readStatus: false,
    };
    await DB.put(DB.STORES.messages, msg);
    this.messages.unshift(msg);
    SyncCore.publish('message', 'upsert', msg);
    this.renderMessages();
    this.flash('Enviado ao analista');
  },

  /** Minutos já decorridos ANTES do período do snapshot (o resto vem de periodElapsedMs). */
  _clockBaseMin(snap) {
    // 'FT' = fim do jogo, o periodElapsedMs é o da 2ª parte → base 45.
    return { '1T': 0, HT: 0, '2T': 45, ET1: 90, ET2: 105, FT: 45 }[snap.period] ?? 0;
  },

  _clockMs(snap) {
    let ms = snap.periodElapsedMs || 0;
    if (snap.running && snap.savedAt) ms += Math.max(0, Date.now() - snap.savedAt);
    return ms;
  },

  /** Minuto atual reconstruído a partir do snapshot do cronómetro. */
  currentMinute() {
    const snap = this.match?.timerSnapshot;
    if (!snap) return 0;
    return this._clockBaseMin(snap) + Math.floor(this._clockMs(snap) / 60000) + Math.floor((snap.manualOffsetSec || 0) / 60);
  },

  clockLabel() {
    const snap = this.match?.timerSnapshot;
    if (!snap) return '--:--';
    const total = this._clockBaseMin(snap) * 60 + Math.floor(this._clockMs(snap) / 1000) + (snap.manualOffsetSec || 0);
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
    // Se houver um diálogo aberto (propor substituição, escrever ao analista…),
    // não recriamos o ecrã todo — atualizamos só os painéis, para não fechar o
    // que o treinador está a fazer.
    if (document.querySelector('dialog[open]')) {
      this.paintScore();
      this.renderFeed();
      this.renderMessages();
      this.renderPitch();
      this.renderMomentum();
      this.renderStats();
      this.renderPeriodSummary();
      return;
    }
    const scroll = document.getElementById('coach-feed')?.scrollTop || 0;
    root.innerHTML = this.template();
    this.bind();
    this.startClock();
    this.renderPitch();
    this.renderMomentum();
    this.renderStats();
    this.renderPeriodSummary();
    if (this._pendingSub) this.renderSubStatus('⏳ Proposta enviada — à espera do analista', 'pending');
    const feed = document.getElementById('coach-feed');
    if (feed) feed.scrollTop = scroll;
  },

  bind() {
    document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      this.filter = b.dataset.filter;
      this._filterSetByUser = true;
      document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
      this.renderFeed();
    }));
    document.getElementById('coach-role-chip').addEventListener('click', () => this.cycleRole());
    document.getElementById('coach-propose-sub').addEventListener('click', () => this.openSubProposeSheet());
    document.getElementById('coach-sub-close').addEventListener('click', () => document.getElementById('dlg-coach-sub').close());
    document.querySelectorAll('[data-time]').forEach((b) => b.addEventListener('click', () => {
      this.timeFilter = b.dataset.time;
      document.querySelectorAll('[data-time]').forEach((x) => x.classList.toggle('active', x === b));
      this.renderFeed();
    }));
    document.getElementById('coach-save-moment').addEventListener('click', () => this.openMomentSheet());
    document.getElementById('coach-talk').addEventListener('click', () => this.openTalkSheet());

    const mDlg = document.getElementById('dlg-coach-moment');
    document.getElementById('coach-moment-cancel').addEventListener('click', () => mDlg.close());
    document.getElementById('coach-moment-save').addEventListener('click', () => {
      const note = document.getElementById('coach-moment-note').value.trim();
      mDlg.close();
      this.saveMoment(note);
    });

    const tDlg = document.getElementById('dlg-coach-talk');
    document.getElementById('coach-talk-close').addEventListener('click', () => tDlg.close());
    document.getElementById('coach-talk-send').addEventListener('click', () => {
      const text = document.getElementById('coach-talk-text').value.trim();
      if (!text) { document.getElementById('coach-talk-text').focus(); return; }
      this.sendToAnalyst('📣', text);
      tDlg.close();
    });

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
    this.renderPitch();
    this.renderMomentum();
    this.renderStats();
    this.renderPeriodSummary();
    if (this._pendingSub) this.renderSubStatus('⏳ Proposta enviada — à espera do analista', 'pending');
    this.paintConnection(SyncCore.status);
  },

  /** O staff marca um instante relevante. Fica identificado como COACH_SAVED. */
  async saveMoment(note = '') {
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
      note: note || '',
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
    this.flash(note ? '⭐ Momento + nota guardados' : '⭐ Momento guardado');
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
    const perEl = document.querySelector('.coach-period');
    if (perEl) {
      const finished = this.match.status === 'finished';
      const halftime = this.match.currentPeriod === PERIODS.HALF_TIME;
      perEl.textContent = finished ? 'JOGO TERMINADO' : (halftime ? 'INTERVALO' : (PERIOD_LABELS[this.match.currentPeriod] || ''));
      perEl.classList.toggle('is-finished', finished);
    }
  },

  /** Reage a tudo o que chega do analista, sem refresh manual. */
  subscribe() {
    this.unsubscribe.forEach((fn) => fn());
    this.unsubscribe = [
      SyncCore.onStatus((st) => this.paintConnection(st)),
      SyncCore.onMessage(async (env) => {
        // O spotlight é efémero — não mexe nos dados, só acende um jogador.
        if (env.entityType === 'spotlight') { this.receiveSpotlight(env.payload); return; }
        // Resposta do analista à nossa proposta de substituição.
        if (env.entityType === 'sub_intent') { this._onSubIntentResolved(env.payload); return; }

        // Qualquer outro envelope faz o banco reler o estado do jogo a partir da
        // base de dados local. É barato e elimina a dependência de um tipo
        // concreto de mensagem chegar primeiro — o placar nunca fica
        // desatualizado por causa da ordem de chegada.
        await this.loadData();
        this.paintScore();
        this.renderFeed();
        this.renderMessages();
        this.renderPitch();
        this.renderMomentum();
        this.renderStats();
        this.renderPeriodSummary();

        if (env.entityType === 'occurrence' && env.payload?.source === 'golo') {
          this.flash('⚽ ' + (env.payload.eventName || 'Golo'));
        } else if (env.entityType === 'message' && env.payload?.sender !== 'coach') {
          const p = env.payload || {};
          this.flash(`${p.icon || '🧠'} ${p.text || 'Nova mensagem'}`);
        }
      }),
    ];
  },

  /** O analista confirmou/ignorou a proposta de substituição do banco. */
  _onSubIntentResolved(p) {
    if (!p || !p.status || p.status === 'propose') return;
    // Resposta antiga a chegar por recuperação de histórico (reconexão) — ignora.
    if (p.at && Date.now() - p.at > 5 * 60 * 1000) return;
    if (this._pendingSub && p.id && p.id !== this._pendingSub.id) return;
    // Já não temos proposta em curso e a resposta não é recente: não mostres nada.
    if (!this._pendingSub && (!p.at || Date.now() - p.at > 30 * 1000)) return;
    this._pendingSub = null;
    if (p.status === 'done') {
      this.renderSubStatus('✅ Substituição confirmada pelo analista', 'done');
      this.flash('✅ Substituição confirmada');
    } else {
      this.renderSubStatus('✋ Proposta não avançou', 'rejected');
      this.flash('O analista não avançou com a troca');
    }
    setTimeout(() => this.renderSubStatus(''), 6000);
  },
};

window.CoachDashboard = CoachDashboard;
