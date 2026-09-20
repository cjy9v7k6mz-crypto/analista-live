/**
 * live.js — Painel LIVE. O ecrã mais importante da aplicação.
 * Tudo aqui é pensado para 1 toque, sem menus, sem perder o jogo de vista.
 */

const LiveScreen = {
  match: null,
  occurrences: [],
  activeCategory: 'bola',
  historyOpen: false,
  historyFilter: { category: 'all', priority: 'all', period: 'all' },
  ownTeam: null,
  opponentTeam: null,
  ownPlayers: [],
  opponentPlayers: [],
  teamPanelSide: null, // 'own' | 'opponent' | null (fechado)

  async render(root, params) {
    // Registos que ficaram por gravar (disco cheio, por exemplo): última
    // tentativa antes de mudar de jogo, para não irem à vida em silêncio.
    if (this._unsaved && this._unsaved.length) {
      await this.retryUnsaved(true);
      this._unsaved = this._unsaved.filter((o) => o.matchId === params.matchId);
      this.renderUnsavedBanner();
    }
    this.match = await DB.get(DB.STORES.matches, params.matchId);
    if (!this.match) { window.location.hash = '#/dashboard'; return; }
    this.occurrences = await AppState.getOccurrences(this.match.id);
    await AppState.setActiveMatch(this.match);

    // Equipas/plantéis deste jogo (para os grafismos e o seletor de jogador)
    const ownTeamId = this.match.teams?.own?.teamId;
    const opponentTeamId = this.match.teams?.opponent?.teamId;
    this.ownTeam = ownTeamId ? await DB.get(DB.STORES.teams, ownTeamId) : null;
    this.opponentTeam = opponentTeamId ? await DB.get(DB.STORES.teams, opponentTeamId) : null;
    this.ownPlayers = ownTeamId ? await AppState.getTeamPlayers(ownTeamId) : [];
    this.opponentPlayers = opponentTeamId ? await AppState.getTeamPlayers(opponentTeamId) : [];

    // Recupera/inicia o cronómetro
    if (AppState.timer) AppState.timer.destroy();
    AppState.timer = new MatchTimer(this.match.timerSnapshot, (state) => this.onTick(state));
    // aplica período guardado no match caso o snapshot não tenha
    if (this.match.currentPeriod && this.match.currentPeriod !== PERIODS.NOT_STARTED && AppState.timer.period === PERIODS.NOT_STARTED) {
      AppState.timer.period = this.match.currentPeriod;
    }
    // Transição explícita de período (ex: vindo do ecrã de Intervalo) — sinalizada
    // pelo ecrã anterior via AppState.pendingPeriodStart, para evitar depender de
    // timing entre o hashchange e a criação do timer.
    if (AppState.pendingPeriodStart) {
      const nextPeriod = AppState.pendingPeriodStart;
      AppState.pendingPeriodStart = null;
      AppState.timer.start(nextPeriod);
      this.match.currentPeriod = nextPeriod;
      await AppState.persistMatch();
      this.publishMatchState(); // o banco precisa de saber que a parte mudou
    } else if (AppState.timer.wasRunning) {
      // O jogo estava a decorrer quando a app foi fechada/recarregada: retoma
      // automaticamente, já com o tempo real decorrido recuperado no construtor.
      AppState.timer.resume();
      await AppState.persistMatch();
    }

    root.innerHTML = this.template();
    this.renderButtons();
    this.renderFocosStrip();
    this.renderHistory();
    this.renderOnzeStrip();
    this.renderScoreControls();
    this.bindEvents();
    this.updateTopBar();
  },

  template() {
    const m = this.match;
    return `
      <div class="screen live-screen">
        <header class="live-topbar">
          <div class="live-topbar-left">
            <button class="team-chip" id="btn-show-own-team" title="Ver Nossa Equipa">
              ${this.ownTeam ? teamBadge(this.ownTeam) : ''}
              <span>${Utils.escapeHtml(m.team)}</span>
            </button>
          </div>
          <div class="live-score" id="live-score" title="Toque para marcar golo · duplo toque para corrigir">
            <span class="score-val" data-team="team">${m.score.team}</span>
            <span class="score-sep">-</span>
            <span class="score-val" data-team="opponent">${m.score.opponent}</span>
          </div>
          <button class="team-chip" id="btn-show-opponent-team" title="Ver Adversário">
            ${this.opponentTeam ? teamBadge(this.opponentTeam) : ''}
            <span>${Utils.escapeHtml(m.opponent)}</span>
          </button>
          <span class="live-period" id="live-period">—</span>
          <div class="live-clock" id="live-clock">00:00</div>
          <div class="live-topbar-actions">
            <button class="btn btn-topbar" id="btn-pause" title="Pausa">⏸</button>
            <button class="btn btn-topbar" id="btn-halftime" title="Intervalo">⏱ Intervalo</button>
            <button class="btn btn-topbar btn-danger-outline" id="btn-end" title="Terminar">⏹ Terminar</button>
            <button class="icon-btn" id="btn-more" title="Mais">⋮</button>
          </div>
        </header>

        <div class="sub-intent-card" id="sub-intent-card" hidden></div>
        <div class="onze-strip" id="onze-strip"></div>
        <div class="focos-strip" id="focos-strip"></div>

        <div class="live-body">
          <main class="live-main">
            <nav class="cat-tabs" id="cat-tabs">
              ${this.categoryTabs()}
            </nav>
            <div class="event-grid" id="event-grid"></div>
          </main>

          <aside class="live-side">
            <div class="quick-actions">
              <button class="quick-btn quick-momento" id="btn-momento">⭐<span>Momento</span></button>
              <button class="quick-btn quick-banco" id="btn-banco">🚨<span>Banco</span></button>
              <button class="quick-btn quick-nota" id="btn-nota">📝<span>Nota</span></button>
              <button class="quick-btn quick-new" id="btn-new-event">＋<span>Novo Evento</span></button>
              <button class="quick-btn quick-stats" id="btn-stats">📊<span>Stats</span></button>
              <button class="quick-btn quick-sketch" id="btn-sketch">✏️<span>Manuscrito</span></button>
              <button class="quick-btn quick-bench" id="btn-bench-msg">📣<span>Comunicar</span></button>
            </div>
            <div class="history-panel">
              <div class="history-head">
                <h3>Histórico</h3>
                <button class="btn btn-tiny" id="btn-open-history">Ver tudo</button>
              </div>
              <!-- Sempre à mão: corrigir um engano custa 1 toque, e repetir o
                   registo anterior evita refazer o percurso todo. -->
              <div class="history-quickbar" id="history-quickbar"></div>
              <div class="history-feed" id="history-feed"></div>
            </div>
          </aside>
        </div>

        <div class="team-panel-overlay" id="team-panel-overlay" hidden style="display:none">
          <div class="team-panel">
            <div class="team-panel-head">
              <h2 id="team-panel-title">Equipa</h2>
              <button class="icon-btn" id="btn-close-team-panel">✕</button>
            </div>
            <div id="team-panel-body" class="team-panel-body"></div>
          </div>
        </div>
      </div>

      ${this.dialogsTemplate()}
    `;
  },

  categoryTabs() {
    const cats = [{ id: 'bola', name: '⚔️ Bola' }, { id: 'all', name: 'Todos' }, ...window.AnalistaLiveData.CATEGORIES];
    return cats.map((c) => `<button class="cat-tab ${this.activeCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${c.name}</button>`).join('');
  },

  dialogsTemplate() {
    return `
      <dialog id="dlg-transition-classify" class="dialog dialog-transition">
        <div class="dialog-card">
          <div class="stats-head"><h3>O que aconteceu aqui?</h3><button type="button" class="icon-btn" id="tc-cancel">✕</button></div>
          <div class="transition-classify-actions">
            <button type="button" class="btn btn-lg tc-loss" data-tc="perda">🔴 PERDA</button>
            <button type="button" class="btn btn-lg tc-recover" data-tc="recuperacao">🟢 RECUPERAÇÃO</button>
          </div>
        </div>
      </dialog>

      <dialog id="dlg-transitions-map" class="dialog dialog-wide">
        <div class="dialog-card">
          <div class="stats-head"><h3>🗺 Mapa de Perdas &amp; Recuperações</h3><button type="button" class="icon-btn" id="tmap-close">✕</button></div>
          <div class="tmap-filters">
            <span class="tmap-filter-group">
              <button class="btn btn-tiny" data-tmf="all">Tudo</button>
              <button class="btn btn-tiny" data-tmf="perda">🔴 Perdas</button>
              <button class="btn btn-tiny" data-tmf="recuperacao">🟢 Recuperações</button>
            </span>
            <span class="tmap-filter-group">
              <button class="btn btn-tiny" data-tmp="all">Jogo</button>
              <button class="btn btn-tiny" data-tmp="1T">1ª P</button>
              <button class="btn btn-tiny" data-tmp="2T">2ª P</button>
              <button class="btn btn-tiny" data-tmp="last">Últ. 10'</button>
            </span>
          </div>
          <div id="tmap-body"></div>
          <div class="dialog-actions"><button type="button" class="btn" id="tmap-close2">Fechar</button></div>
        </div>
      </dialog>

      <dialog id="dlg-patterns" class="dialog dialog-wide">
        <div class="dialog-card">
          <div class="stats-head"><h3>🔗 Padrões do Jogo</h3><button type="button" class="icon-btn" id="pat-close">✕</button></div>
          <div id="pat-body"></div>
          <div class="dialog-actions"><button type="button" class="btn" id="pat-close2">Fechar</button></div>
        </div>
      </dialog>

      <dialog id="dlg-momento" class="dialog">
        <div class="dialog-card">
          <h3>⭐ Momento</h3>
          <p class="muted" id="momento-time"></p>
          <textarea id="momento-note" rows="3" placeholder="Nota opcional..."></textarea>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-momento">Cancelar</button>
            <button type="button" class="btn" id="save-momento-sketch">Guardar + ✏️ Desenhar</button>
            <button type="button" class="btn btn-primary" id="save-momento">Guardar Momento</button>
          </div>
        </div>
      </dialog>

      <dialog id="dlg-banco" class="dialog">
        <div class="dialog-card">
          <h3>🚨 Banco</h3>
          <p class="muted" id="banco-time"></p>
          <div class="banco-options" id="banco-options">
            ${window.AnalistaLiveData.BENCH_ACTIONS.map((a) => `<button class="btn btn-lg banco-opt" data-banco="${a}">${a}</button>`).join('')}
          </div>
          <textarea id="banco-note" rows="2" placeholder="Nota opcional..." style="display:none"></textarea>
          <div class="dialog-actions" id="banco-actions" style="display:none">
            <button type="button" class="btn" id="cancel-banco">Cancelar</button>
            <button type="button" class="btn btn-primary" id="save-banco">Guardar</button>
          </div>
        </div>
      </dialog>

      <dialog id="dlg-nota" class="dialog">
        <div class="dialog-card">
          <h3>📝 Nota Rápida</h3>
          <p class="muted" id="nota-time"></p>
          <textarea id="nota-text" rows="4" placeholder="Escreve a tua nota..." autofocus></textarea>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-nota">Cancelar</button>
            <button type="button" class="btn btn-primary" id="save-nota">Guardar Nota</button>
          </div>
        </div>
      </dialog>

      <dialog id="dlg-new-event-live" class="dialog">
        <form id="form-new-event-live" class="dialog-card">
          <h3>＋ Novo Evento</h3>
          <label class="field"><span>Nome</span><input name="name" required autofocus></label>
          <label class="field"><span>Categoria</span>
            <select name="category">${window.AnalistaLiveData.CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
          </label>
          <label class="field"><span>Prioridade</span>
            <select name="priority">
              <option value="critical">🔴 Crítico</option>
              <option value="important" selected>🟡 Importante</option>
              <option value="complementary">🟢 Complementar</option>
            </select>
          </label>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-new-event-live">Cancelar</button>
            <button type="submit" class="btn btn-primary">Adicionar ao painel</button>
          </div>
        </form>
      </dialog>

      <dialog id="dlg-more" class="dialog">
        <div class="dialog-card">
          <h3>Mais opções</h3>
          <div class="more-list">
            <button class="more-item" id="more-correct-time">🕓 Corrigir minuto</button>
            <button class="more-item" id="more-stoppage">➕ Adicionar compensação</button>
            <button class="more-item" id="more-card">🟨 Registar cartão</button>
            <button class="more-item" id="more-sub">🔁 Registar substituição</button>
            <button class="more-item" id="more-tactic">♟ Mudança tática</button>
            <button class="more-item" id="more-pair">📲 Ligar dispositivo do banco</button>
            <button class="more-item" id="more-mode-manage">🛠 Biblioteca de eventos</button>
            <button class="more-item" id="more-home">🏠 Ir para o início — o jogo continua</button>
          </div>
          <div class="dialog-actions"><button type="button" class="btn" id="cancel-more">Fechar</button></div>
        </div>
      </dialog>

      <dialog id="dlg-history-full" class="dialog dialog-wide">
        <div class="dialog-card">
          <h3>Histórico Completo</h3>
          <div class="history-filters" id="history-filters"></div>
          <div class="history-full-list" id="history-full-list"></div>
          <div class="dialog-actions"><button type="button" class="btn" id="cancel-history-full">Fechar</button></div>
        </div>
      </dialog>

      <dialog id="dlg-edit-occurrence" class="dialog">
        <form id="form-edit-occurrence" class="dialog-card">
          <h3>Editar Registo</h3>
          <input type="hidden" name="id">
          <div class="field-row">
            <label class="field"><span>Minuto</span><input name="minute" type="number" min="0" max="130"></label>
            <label class="field"><span>Segundo</span><input name="second" type="number" min="0" max="59"></label>
            <label class="field"><span>Parte</span>
              <select name="period">
                <option value="1T">1ª Parte</option>
                <option value="2T">2ª Parte</option>
                <option value="ET1">Prolong. 1</option>
                <option value="ET2">Prolong. 2</option>
              </select>
            </label>
          </div>
          <label class="field"><span>Evento</span><input name="eventName"></label>
          <label class="field"><span>Prioridade</span>
            <select name="priority">
              <option value="critical">🔴 Crítico</option>
              <option value="important">🟡 Importante</option>
              <option value="complementary">🟢 Complementar</option>
            </select>
          </label>
          <label class="field"><span>Nota</span><textarea name="note" rows="2"></textarea></label>
          <button type="button" class="btn btn-small" id="edit-occ-players">Alterar jogador(es) associado(s)</button>
          <div class="dialog-actions">
            <button type="button" class="btn btn-danger" id="delete-occurrence">Apagar Registo</button>
            <button type="button" class="btn" id="cancel-edit-occurrence">Cancelar</button>
            <button type="submit" class="btn btn-primary">Guardar</button>
          </div>
        </form>
      </dialog>
    `;
  },

  onTick(state) {
    const clock = document.getElementById('live-clock');
    if (clock) clock.textContent = state.gameTimeLabel;
    const btnPause = document.getElementById('btn-pause');
    if (btnPause) btnPause.textContent = state.running ? '⏸' : '▶';

    // Persiste o estado do cronómetro periodicamente (a cada ~10s) enquanto
    // corre. Assim, se o iPad bloquear ou o Safari for terminado sem aviso, o
    // instante de referência guardado é recente e o tempo recuperado é exato.
    if (state.running) {
      const now = Date.now();
      if (!this._lastClockPersist || now - this._lastClockPersist > 10000) {
        this._lastClockPersist = now;
        AppState.persistMatch();
        // O snapshot do cronómetro vai junto: o banco reconstrói o minuto a
        // partir de running/savedAt/elapsed, não de um "67:32" fixo.
        this.publishMatchState();
      }
    }
  },

  updateTopBar() {
    const periodEl = document.getElementById('live-period');
    if (periodEl) periodEl.textContent = PERIOD_LABELS[AppState.timer.period] || '—';
    this.onTick(AppState.timer.getState());

    const period = AppState.timer.period;
    // Se o jogo ainda não começou, oferece iniciar 1ª parte diretamente no botão pausa
    const btnPause = document.getElementById('btn-pause');
    if (period === PERIODS.NOT_STARTED) {
      btnPause.textContent = '▶ Iniciar 1ª Parte';
      btnPause.classList.add('btn-start-emphasis');
    } else {
      btnPause.classList.remove('btn-start-emphasis');
    }

    // "Intervalo" só faz sentido durante a 1ª parte — mostrá-lo noutras alturas
    // deixava reiniciar a 2ª parte por engano (o cronómetro voltava a zero).
    const btnHT = document.getElementById('btn-halftime');
    if (btnHT) btnHT.hidden = period !== PERIODS.FIRST_HALF;
    // "Terminar" só depois de o jogo arrancar.
    const btnEnd = document.getElementById('btn-end');
    if (btnEnd) btnEnd.hidden = period === PERIODS.NOT_STARTED;
  },

  countFor(planEventId) {
    return this.occurrences.filter((o) => o.planEventId === planEventId).length;
  },

  renderButtons() {
    const grid = document.getElementById('event-grid');
    if (!grid) return;

    // Separador "⚔️ Bola" — o campo para registar perdas e recuperações é o
    // conteúdo principal do painel.
    if (this.activeCategory === 'bola') {
      this.renderBolaPanel();
      return;
    }

    const plan = this.match.observationPlan || [];
    // Os "Meus Focos" vivem agora na faixa recolhível por cima — aqui a vista
    // "Todos" mostra o plano completo, sem bloco destacado.
    const sorted = this.activeCategory === 'all' ? plan : plan.filter((e) => e.category === this.activeCategory);

    if (sorted.length === 0) {
      grid.innerHTML = '<p class="muted empty-grid-msg">Sem eventos nesta categoria. Usa "＋ Novo Evento" para adicionar.</p>';
      return;
    }

    grid.innerHTML = `<div class="event-btn-grid">${sorted.map((e) => this.eventButtonHTML(e, e.isFocus)).join('')}</div>`;
  },

  // ---------- Faixa recolhível "Meus Focos" ----------
  renderFocosStrip() {
    const strip = document.getElementById('focos-strip');
    if (!strip) return;
    const focos = (this.match.observationPlan || []).filter((e) => e.isFocus);
    if (focos.length === 0) { strip.innerHTML = ''; strip.hidden = true; return; }
    strip.hidden = false;
    const collapsed = AppState.settings?.focosStripCollapsed;
    strip.innerHTML = `
      <button class="focos-strip-toggle" id="btn-toggle-focos">${collapsed ? `▾ Focos (${focos.length})` : '▴ Focos'}</button>
      <div class="focos-strip-row ${collapsed ? 'is-collapsed' : ''}">
        ${focos.map((e) => {
          const count = this.countFor(e.id);
          const trend = Utils.getTrendLevel(count, AppState.settings.trendConfig);
          return `<button class="foco-chip priority-${e.priority} type-${e.type || 'neutral'} ${trend.showBadge ? 'is-trending' : ''}" data-plan-id="${e.id}">
            <span class="foco-chip-name">${Utils.escapeHtml(e.name)}</span>
            <span class="foco-chip-count">${count}</span>
          </button>`;
        }).join('')}
      </div>`;
    document.getElementById('btn-toggle-focos').addEventListener('click', async () => {
      await AppState.saveSettings({ focosStripCollapsed: !collapsed });
      this.renderFocosStrip();
    });
  },

  // ---------- Painel "Bola": perdas & recuperações ----------
  transitionsList() {
    return this.occurrences.filter((o) => o.source === 'perda' || o.source === 'recuperacao');
  },

  renderBolaPanel() {
    const grid = document.getElementById('event-grid');
    if (!grid) return;
    const own = this.ownTeam ? LineupState.annotatedRoster(this.match, 'own', this.ownPlayers).filter((p) => p._onField) : [];
    const opp = this.opponentTeam ? LineupState.annotatedRoster(this.match, 'opponent', this.opponentPlayers).filter((p) => p._onField) : [];
    const state = this.ownTeam ? LineupState.compute(this.match, 'own') : { positions: [] };

    const all = this.transitionsList();
    const nPerdas = all.filter((o) => o.source === 'perda').length;
    const nRec = all.filter((o) => o.source === 'recuperacao').length;
    const last = [...all].sort((a, b) => b.timestamp - a.timestamp)[0];

    // Rasto: últimos 12 pontos, mais antigos mais transparentes.
    const recent = [...all].filter((o) => o.meta?.location).sort((a, b) => a.timestamp - b.timestamp).slice(-12);
    const markers = recent.map((o, i) => {
      const xy = o.meta.location;
      const op = 0.35 + 0.65 * ((i + 1) / recent.length);
      const isLast = last && o.id === last.id;
      return `<span class="bola-marker ${o.source === 'perda' ? 'is-loss' : 'is-recover'} ${isLast ? 'is-latest' : ''}" style="left:${xy.x * 100}%; top:${xy.y * 100}%; opacity:${op.toFixed(2)}"></span>`;
    }).join('');

    // Onze da nossa equipa como referência (não interativo — o toque é para a localização).
    const tokens = (state.positions || []).map((pos) => {
      const p = this.ownPlayers.find((x) => x.id === pos.playerId);
      return `<span class="bola-token" style="left:${pos.x}%; top:${100 - pos.y}%">${p ? (p.number || '') : ''}</span>`;
    }).join('');

    grid.innerHTML = `
      <div class="bola-panel">
        <div class="bola-pitch" id="bola-pitch">
          ${Pitch.svg()}
          <div class="pitch-map-layer">${tokens}${markers}</div>
          <div class="bola-hint">Toca onde a bola mudou de dono</div>
        </div>
        <div class="bola-bar">
          <span class="bola-tally">🔴 Perdas <strong>${nPerdas}</strong> · 🟢 Recuperações <strong>${nRec}</strong>${last ? ` · última ${String(last.minute).padStart(2, '0')}'` : ''}</span>
          <span class="bola-bar-actions">
            <button class="btn btn-tiny" id="bola-undo" ${all.length ? '' : 'disabled'}>↶ Desfazer</button>
            <button class="btn btn-tiny" id="bola-map">🗺 Mapa</button>
            <button class="btn btn-tiny" id="bola-patterns">🔗 Padrões</button>
          </span>
        </div>
      </div>`;

    document.getElementById('bola-pitch').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      this.openTransitionClassify({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) });
    });
    document.getElementById('bola-undo').addEventListener('click', () => this.undoLastTransition());
    document.getElementById('bola-map').addEventListener('click', () => this.openTransitionsMap());
    document.getElementById('bola-patterns').addEventListener('click', () => this.openPatterns());
    this._bolaOnField = { own, opp };
  },

  openTransitionClassify(xy) {
    const dlg = document.getElementById('dlg-transition-classify');
    if (!dlg) return;
    dlg.querySelector('#tc-cancel').onclick = () => dlg.close();
    dlg.querySelector('[data-tc="perda"]').onclick = () => { dlg.close(); this.runTransitionFlow('perda', xy); };
    dlg.querySelector('[data-tc="recuperacao"]').onclick = () => { dlg.close(); this.runTransitionFlow('recuperacao', xy); };
    dlg.showModal();
  },

  async runTransitionFlow(kind, xy) {
    const { own, opp } = this._bolaOnField || { own: [], opp: [] };
    const ourName = this.match.team;
    const oppName = this.match.opponent;
    // Passo 1: o nosso jogador (quem perdeu numa PERDA, quem recuperou numa RECUPERAÇÃO).
    const r1 = await PlayerPicker.open({
      title: kind === 'perda' ? `Quem perdeu — ${ourName}` : `Quem recuperou — ${ourName}`,
      groups: [{ label: ourName, players: own }], multi: false,
    });
    if (r1 === null) return; // cancelado — não regista nada
    const ownP = r1.players[0] || null;
    // Passo 2: o adversário (o espelho).
    const r2 = await PlayerPicker.open({
      title: kind === 'perda' ? `Quem recuperou — ${oppName}` : `Quem perdeu — ${oppName}`,
      groups: [{ label: oppName, players: opp }], multi: false,
    });
    if (r2 === null) return;
    const oppP = r2.players[0] || null;
    await this.saveTransition(kind, xy, ownP, oppP);
  },

  async saveTransition(kind, xy, ownP, oppP) {
    const occ = await this.recordOccurrence({
      eventName: kind === 'perda'
        ? `Perda de bola${ownP ? ' (' + (ownP.shortName || ownP.name) + ')' : ''}`
        : `Recuperação${ownP ? ' (' + (ownP.shortName || ownP.name) + ')' : ''}`,
      category: 'nossa_equipa',
      team: 'own',
      priority: kind === 'perda' ? 'important' : 'complementary',
      source: kind,
      type: kind === 'perda' ? 'negative' : 'positive',
      playerIds: [ownP?.id, oppP?.id].filter(Boolean),
      meta: { location: xy, ownPlayerId: ownP?.id || null, oppPlayerId: oppP?.id || null },
    });
    this.renderBolaPanel();
    this.renderHistory();
    this.renderFocosStrip();
    return occ;
  },

  async undoLastTransition() {
    const last = [...this.transitionsList()].sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!last) return;
    await AppState.deleteOccurrence(last.id);
    this.occurrences = this.occurrences.filter((o) => o.id !== last.id);
    SyncCore.publish('occurrence', 'delete', { id: last.id });
    this.renderBolaPanel();
    this.renderHistory();
    toast('Último registo removido');
  },

  openTransitionsMap() {
    const dlg = document.getElementById('dlg-transitions-map');
    if (!dlg) return;
    this._tmapFilter = this._tmapFilter || 'all';
    this._tmapPeriod = this._tmapPeriod || 'all';
    const paint = () => {
      const nowMin = AppState.timer ? AppState.timer.getGameTimeParts().minute : 999;
      dlg.querySelector('#tmap-body').innerHTML = MatchStats.renderTransitionsMapHTML(
        this.occurrences, this.match.team, this.match.opponent, this._tmapFilter, this._tmapPeriod, nowMin);
      dlg.querySelectorAll('[data-tmf]').forEach((b) => b.classList.toggle('active', b.dataset.tmf === this._tmapFilter));
      dlg.querySelectorAll('[data-tmp]').forEach((b) => b.classList.toggle('active', b.dataset.tmp === this._tmapPeriod));
    };
    dlg.querySelectorAll('[data-tmf]').forEach((b) => b.onclick = () => { this._tmapFilter = b.dataset.tmf; paint(); });
    dlg.querySelectorAll('[data-tmp]').forEach((b) => b.onclick = () => { this._tmapPeriod = b.dataset.tmp; paint(); });
    paint();
    dlg.showModal();
  },

  eventButtonHTML(e, isFocus) {
    const count = this.countFor(e.id);
    const trend = Utils.getTrendLevel(count, AppState.settings.trendConfig);
    return `
      <button class="event-btn ${isFocus ? 'event-btn-focus' : ''} priority-${e.priority} type-${e.type || 'neutral'}" data-plan-id="${e.id}">
        <span class="event-btn-name">${Utils.escapeHtml(e.name)}</span>
        <span class="event-btn-cat">${Utils.categoryLabel(e.category)}</span>
        <span class="event-btn-count">${count} ${count === 1 ? 'ocorrência' : 'ocorrências'}</span>
        ${trend.showBadge ? `<span class="event-btn-trend">⚠️ ${trend.label}</span>` : ''}
      </button>
    `;
  },

  renderHistory() {
    const feed = document.getElementById('history-feed');
    if (!feed) return;
    const recent = [...this.occurrences].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
    if (recent.length === 0) {
      feed.innerHTML = '<p class="muted">Sem registos ainda.</p>';
      this.renderQuickBar();
      return;
    }
    feed.innerHTML = recent.map((o) => this.historyRow(o)).join('');
    // A barra acompanha sempre o histórico: quem chama um, atualiza o outro.
    this.renderQuickBar();
  },

  // ---------- Desfazer global · Repetir último ----------

  /** Fontes que se repetem tal e qual. Ficam de fora as que mexem no placar,
   *  nos cartões ou no onze — essas exigem o fluxo completo, não um atalho. */
  REPEATABLE_SOURCES: ['event', 'momento', 'perda', 'recuperacao', 'nota', 'banco'],

  lastOccurrence() {
    return [...this.occurrences].sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  },

  lastRepeatable() {
    return [...this.occurrences]
      .filter((o) => this.REPEATABLE_SOURCES.includes(o.source))
      .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  },

  renderQuickBar() {
    const bar = document.getElementById('history-quickbar');
    if (!bar) return;
    const last = this.lastOccurrence();
    const rep = this.lastRepeatable();
    const short = (s, n = 18) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    bar.innerHTML = `
      <button class="btn btn-tiny btn-undo" id="btn-undo-last" ${last ? '' : 'disabled'}
              title="${last ? 'Remover: ' + Utils.escapeHtml(last.eventName) : 'Nada para desfazer'}">↶ Desfazer</button>
      <button class="btn btn-tiny" id="btn-repeat-last" ${rep ? '' : 'disabled'}
              title="${rep ? 'Repetir: ' + Utils.escapeHtml(rep.eventName) : 'Nada para repetir'}">↻ ${rep ? Utils.escapeHtml(short(rep.eventName)) : 'Repetir'}</button>
    `;
    const undo = document.getElementById('btn-undo-last');
    const repeat = document.getElementById('btn-repeat-last');
    if (undo) undo.addEventListener('click', () => this.undoLast());
    if (repeat) repeat.addEventListener('click', () => this.repeatLast());
  },

  /**
   * Remove o último registo, seja de que tipo for, desfazendo também o efeito
   * que ele teve fora da lista de ocorrências (placar, cartões, substituições).
   * Sem confirmação de propósito — em jogo, corrigir tem de custar um toque; o
   * aviso diz o que saiu para não haver dúvida.
   */
  async undoLast() {
    const occ = this.lastOccurrence();
    if (!occ) return;
    await this.deleteOccurrenceWithEffects(occ);
    Utils.vibrate(20);
    toast(`Removido: ${occ.eventName}`);
  },

  /**
   * Apaga uma ocorrência e reverte o que ela provocou no jogo (placar, cartões,
   * substituição). É o único caminho usado pelo desfazer e pelo apagar no
   * histórico, para os dois nunca divergirem. A reversão em si está em
   * MatchEffects (pura, coberta pelos testes).
   */
  async deleteOccurrenceWithEffects(occ) {
    const effects = MatchEffects.reverse(this.match, occ);
    await AppState.deleteOccurrence(occ.id);
    this.occurrences = this.occurrences.filter((o) => o.id !== occ.id);
    SyncCore.publish('occurrence', 'delete', { id: occ.id });
    await AppState.persistMatch();
    this.publishMatchState();

    this.updateTopBar();
    const scoreEl = document.querySelector('#live-score [data-team="team"]');
    if (scoreEl && this.match.score) {
      scoreEl.textContent = this.match.score.team;
      document.querySelector('#live-score [data-team="opponent"]').textContent = this.match.score.opponent;
    }
    this.renderButtons();
    this.renderFocosStrip();
    this.renderOnzeStrip();
    this.renderHistory();
    if (this.activeCategory === 'bola') this.renderBolaPanel();
    this.renderStatsIfOpen();
    return effects;
  },

  /** Repete o último registo repetível, com os mesmos dados, na hora atual. */
  async repeatLast() {
    const src = this.lastRepeatable();
    if (!src) return;
    await this.recordOccurrence({
      eventName: src.eventName,
      category: src.category,
      priority: src.priority,
      source: src.source,
      type: src.eventType,
      note: src.note,
      planEventId: src.planEventId,
      playerIds: [...(src.playerIds || [])],
      team: src.team,
      // Cópia rasa basta: `meta` só tem valores simples e `location` é
      // substituída por uma nova cópia para os dois registos não partilharem
      // o mesmo objeto.
      meta: src.meta ? { ...src.meta, ...(src.meta.location ? { location: { ...src.meta.location } } : {}) } : null,
    });
    this.renderButtons();
    this.renderFocosStrip();
    this.renderHistory();
    if (this.activeCategory === 'bola') this.renderBolaPanel();
    this.renderStatsIfOpen();
    toast(`Repetido: ${src.eventName}`);
  },

  /** Padrões do jogo — leitura derivada, sem pedir nenhum registo novo. */
  openPatterns() {
    const dlg = document.getElementById('dlg-patterns');
    if (!dlg) return;
    dlg.querySelector('#pat-body').innerHTML = MatchStats.renderPatternsHTML(
      this.occurrences, this.match, (id) => {
        const p = this.findPlayerById(id);
        return p ? (p.shortName || p.name) : null;
      });
    dlg.showModal();
  },

  historyRow(o) {
    const t = `${String(o.minute).padStart(2, '0')}:${String(o.second).padStart(2, '0')}`;
    const players = (o.playerIds || []).map((id) => this.findPlayerById(id)).filter(Boolean);
    const playerChips = players.length
      ? `<span class="history-players">${players.map((p) => `<span class="history-player-chip" data-open-player="${p.id}">${Utils.escapeHtml(p.shortName || p.name)}</span>`).join('')}</span>`
      : `<button class="history-add-player" data-tag-player="${o.id}" title="Adicionar jogador">+ jogador</button>`;
    return `<div class="history-row source-${o.source} ${o._unsaved ? 'is-unsaved' : ''}">
      <span class="history-time">${t}</span>
      <span class="history-label">${o._unsaved ? '<span class="history-unsaved" title="Ainda não foi guardado no dispositivo">⚠️</span> ' : ''}${Utils.escapeHtml(o.eventName)}</span>
      ${playerChips}
    </div>`;
  },

  renderScoreControls() {
    // placeholder para futura expansão (golos detalhados) — já ligado no bindEvents
  },

  /**
   * Faixa compacta sempre visível com os onze em campo de ambas as equipas
   * (item pedido explicitamente: consultar jogadores sem ter de abrir o painel
   * de equipa). Nunca ocupa mais do que uma faixa fina — não compete com os
   * botões de eventos. Pode ser recolhida para ganhar espaço.
   */
  renderOnzeStrip() {
    const strip = document.getElementById('onze-strip');
    if (!strip) return;
    const collapsed = AppState.settings?.onzeStripCollapsed;
    const ownOnField = this.ownTeam ? LineupState.annotatedRoster(this.match, 'own', this.ownPlayers).filter((p) => p._onField) : [];
    const oppOnField = this.opponentTeam ? LineupState.annotatedRoster(this.match, 'opponent', this.opponentPlayers).filter((p) => p._onField) : [];

    if (!this.ownTeam && !this.opponentTeam) { strip.innerHTML = ''; return; }

    const row = (label, list) => `
      <div class="onze-strip-row">
        <span class="onze-strip-label">${Utils.escapeHtml(label)}</span>
        <div class="onze-strip-players">
          ${list.length ? list.map((p) => `
            <button class="onze-chip ${p._status === 'sub_in' ? 'is-sub-in' : ''}" data-open-player="${p.id}" title="${Utils.escapeHtml(p.name)}">
              ${playerAvatar(p, 'sm')}
              <span class="onze-chip-num">${p.number || ''}</span>
            </button>
          `).join('') : '<span class="muted onze-strip-empty">Onze não definido</span>'}
        </div>
      </div>`;

    strip.innerHTML = `
      <button class="onze-strip-toggle" id="btn-toggle-onze-strip" title="${collapsed ? 'Mostrar onze' : 'Esconder onze'}">${collapsed ? '▾ Onze' : '▴'}</button>
      <div class="onze-strip-rows ${collapsed ? 'is-collapsed' : ''}">
        ${row(this.match.team, ownOnField)}
        ${row(this.match.opponent, oppOnField)}
      </div>
    `;

    // Toque curto = ficha do jogador. Pressão longa = "apontar" este jogador no
    // ecrã do banco (spotlight partilhado) — os dois dispositivos ficam a olhar
    // para o mesmo sítio.
    strip.querySelectorAll('[data-open-player]').forEach((el) => {
      let lp = null;
      let fired = false;
      const startLP = () => {
        fired = false;
        lp = setTimeout(() => {
          fired = true;
          Utils.vibrate(12);
          this.spotlightPlayer(el.dataset.openPlayer);
        }, 480);
      };
      const cancelLP = () => clearTimeout(lp);
      el.addEventListener('pointerdown', startLP);
      el.addEventListener('pointerup', cancelLP);
      el.addEventListener('pointercancel', cancelLP);
      el.addEventListener('pointerleave', cancelLP);
      el.addEventListener('click', () => {
        if (fired) { fired = false; return; }
        window.location.hash = `#/player/${this.match.id}/${el.dataset.openPlayer}`;
      });
    });
    document.getElementById('btn-toggle-onze-strip').addEventListener('click', async () => {
      await AppState.saveSettings({ onzeStripCollapsed: !collapsed });
      this.renderOnzeStrip();
    });
  },

  async recordOccurrence({ eventName, category, priority, source, note, planEventId, type, playerIds, team, meta }) {
    const parts = AppState.timer.getGameTimeParts();
    const occ = {
      id: Utils.uid('occ'),
      matchId: this.match.id,
      timestamp: Date.now(),
      period: parts.period,
      minute: parts.minute,
      second: parts.second,
      category,
      categoryLabel: Utils.categoryLabel(category),
      eventName,
      eventType: type || 'neutral',
      priority: priority || 'important',
      note: note || '',
      source, // event | momento | banco | nota | golo | cartao | substituicao | remate | canto | falta | stat_quick
      planEventId: planEventId || null,
      playerIds: playerIds || [],
      // "own" (nossa equipa) | "opponent" (adversário) | null — quando aplicável, deriva
      // automaticamente da categoria para não obrigar todos os pontos de chamada a passá-lo.
      team: team || (category === 'nossa_equipa' ? 'own' : category === 'adversario' ? 'opponent' : null),
      meta: meta || null, // dados específicos (remate: origem/resultado/zona; falta: local/tipo; etc.)
      createdAt: Date.now(),
    };
    this.occurrences.push(occ);
    // A gravação É verificada. Antes, uma falha do IndexedDB (disco cheio,
    // transação abortada) rejeitava em silêncio: o evento aparecia no
    // histórico, o analista seguia o jogo, e o registo nunca tinha existido.
    try {
      await AppState.addOccurrence(occ);
      await AppState.persistMatch();
      // Cada registo bem sucedido é também a oportunidade de recuperar os que
      // falharam antes — sem obrigar o analista a carregar em nada.
      if (this._unsaved && this._unsaved.length) this.retryUnsaved(true);
    } catch (e) {
      this.flagUnsaved(occ, e);
    }
    // Sincronização silenciosa: entra na fila e segue. Se não houver rede,
    // fica pendente e é enviada sozinha mais tarde — o registo nunca espera.
    SyncCore.publish('occurrence', 'upsert', occ);
    Utils.vibrate(15);
    return occ;
  },

  // ---------- Registos por gravar ----------
  // Ficam à vista até serem gravados. O princípio é simples: a app nunca pode
  // dizer que guardou uma coisa que não guardou.
  _unsaved: [],

  flagUnsaved(occ, err) {
    occ._unsaved = true;
    if (!this._unsaved.includes(occ)) this._unsaved.push(occ);
    CrashGuard.record('gravação', `${occ.eventName}: ${(err && err.name) || 'erro'}`, err && err.stack, 'recordOccurrence', false);
    this._lastWriteError = err;
    this.renderUnsavedBanner();
    this.renderHistory();
  },

  async retryUnsaved(silent = false) {
    const pending = [...this._unsaved];
    if (!pending.length) return;
    for (const occ of pending) {
      try {
        await AppState.addOccurrence(occ);
        delete occ._unsaved;
        this._unsaved = this._unsaved.filter((o) => o !== occ);
      } catch (e) {
        this._lastWriteError = e;
        break; // se um falha, os seguintes falham pelo mesmo motivo
      }
    }
    try { await AppState.persistMatch(); } catch (e) { /* já está sinalizado */ }
    this.renderUnsavedBanner();
    this.renderHistory();
    if (!this._unsaved.length && !silent) toast('✅ Registos guardados');
  },

  renderUnsavedBanner() {
    let el = document.getElementById('unsaved-banner');
    const n = this._unsaved.length;
    if (!n) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'unsaved-banner';
      el.className = 'unsaved-banner';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <span class="unsaved-banner-text">⚠️ ${n} ${n === 1 ? 'registo não foi guardado' : 'registos não foram guardados'}. ${Utils.escapeHtml(DB.writeErrorText(this._lastWriteError))}</span>
      <button type="button" class="btn btn-tiny" id="unsaved-retry">Tentar guardar</button>`;
    el.querySelector('#unsaved-retry').addEventListener('click', () => this.retryUnsaved());
  },

  /** Devolve o jogador (com a equipa a que pertence) a partir do seu ID, procurando em ambos os plantéis. */
  findPlayerById(playerId) {
    return this.ownPlayers.find((p) => p.id === playerId) || this.opponentPlayers.find((p) => p.id === playerId) || null;
  },

  /** Grupos padrão (nossa equipa + adversário) já anotados com estado em campo/banco, para o PlayerPicker. */
  pickerGroups() {
    return [
      { label: this.match.team, players: LineupState.annotatedRoster(this.match, 'own', this.ownPlayers) },
      { label: this.match.opponent, players: LineupState.annotatedRoster(this.match, 'opponent', this.opponentPlayers) },
    ];
  },

  /** Abre o seletor rápido de jogador com as duas equipas como grupos, e associa o resultado à ocorrência indicada. */
  async tagPlayersOnOccurrence(occ, { multi = true } = {}) {
    const result = await PlayerPicker.open({
      title: occ.eventName,
      groups: this.pickerGroups(),
      multi,
    });
    if (!result) return; // cancelado — mantém como estava
    occ.playerIds = result.players.map((p) => p.id);
    await AppState.updateOccurrence(occ);
    this.renderHistory();
  },

  flashButton(btn) {
    if (!btn) return;
    btn.classList.add('is-pressed');
    setTimeout(() => btn.classList.remove('is-pressed'), 220);
  },

  /**
   * Liga o gesto "1 toque regista · pressão longa (~480ms) marca jogador" a um
   * contentor com botões `[data-plan-id]`. Usado tanto na grelha de eventos
   * como na faixa de focos — o mesmo comportamento, dois sítios.
   */
  bindQuickEventTriggers(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    let pressTimer = null;
    let longPressPlanId = null;
    el.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('[data-plan-id]');
      if (!btn) return;
      longPressPlanId = null;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        longPressPlanId = btn.dataset.planId;
        Utils.vibrate(8);
        btn.classList.add('is-longpress-armed');
      }, 480);
    });
    el.addEventListener('pointerup', () => clearTimeout(pressTimer));
    el.addEventListener('pointercancel', () => { clearTimeout(pressTimer); longPressPlanId = null; });
    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-plan-id]');
      if (!btn) return;
      const planEvent = (this.match.observationPlan || []).find((p) => p.id === btn.dataset.planId);
      if (!planEvent) return;
      this.flashButton(btn);
      const wasLongPress = longPressPlanId === planEvent.id;
      longPressPlanId = null;
      btn.classList.remove('is-longpress-armed');
      const occ = await this.recordOccurrence({
        eventName: planEvent.name,
        category: planEvent.category,
        priority: planEvent.priority,
        type: planEvent.type,
        source: 'event',
        planEventId: planEvent.id,
      });
      this.renderButtons();
      this.renderFocosStrip();
      this.renderHistory();
      if (wasLongPress) {
        await this.tagPlayersOnOccurrence(occ);
      }
    });
  },

  bindEvents() {
    // Tabs de categoria
    document.getElementById('cat-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-cat]');
      if (!tab) return;
      this.activeCategory = tab.dataset.cat;
      document.querySelectorAll('.cat-tab').forEach((t) => t.classList.toggle('active', t === tab));
      this.renderButtons();
    });

    // Botões de evento (grelha e faixa de focos) — 1 toque regista imediatamente;
    // pressão longa (~500ms) abre o seletor de jogador logo a seguir, para quem
    // já sabe quem foi.
    this.bindQuickEventTriggers('event-grid');
    this.bindQuickEventTriggers('focos-strip');

    // Cronómetro
    document.getElementById('btn-pause').addEventListener('click', async () => {
      if (AppState.timer.period === PERIODS.NOT_STARTED) {
        AppState.timer.start(PERIODS.FIRST_HALF);
        this.match.currentPeriod = PERIODS.FIRST_HALF;
        document.getElementById('btn-pause').classList.remove('btn-start-emphasis');
      } else if (AppState.timer.running) {
        AppState.timer.pause();
      } else {
        AppState.timer.resume();
      }
      this.updateTopBar();
      await AppState.persistMatch();
      this.publishMatchState();
    });

    document.getElementById('btn-halftime').addEventListener('click', async () => {
      AppState.timer.pause();
      this.match.currentPeriod = PERIODS.HALF_TIME;
      await AppState.persistMatch();
      this.publishMatchState();
      window.location.hash = `#/halftime/${this.match.id}`;
    });

    document.getElementById('btn-end').addEventListener('click', async () => {
      if (!confirm('Terminar o jogo? Vais poder consultar o resumo completo a seguir.')) return;
      AppState.timer.pause();
      AppState.timer.period = PERIODS.FINISHED;
      this.match.status = 'finished';
      this.match.currentPeriod = PERIODS.FINISHED;
      await AppState.persistMatch();
      this.publishMatchState();
      window.location.hash = `#/postgame/${this.match.id}`;
    });

    // Placar rápido: toque = +1 golo; duplo toque = corrigir (-1)
    this.bindScoreTaps();

    // Histórico: tag rápida de jogador ("+jogador") e navegação para ficha do jogador
    document.getElementById('history-feed').addEventListener('click', async (e) => {
      const tagBtn = e.target.closest('[data-tag-player]');
      const chip = e.target.closest('[data-open-player]');
      if (tagBtn) {
        const occ = this.occurrences.find((o) => o.id === tagBtn.dataset.tagPlayer);
        if (occ) await this.tagPlayersOnOccurrence(occ);
      } else if (chip) {
        window.location.hash = `#/player/${this.match.id}/${chip.dataset.openPlayer}`;
      }
    });

    // Painel de equipa (grafismo do onze inicial)
    document.getElementById('btn-show-own-team').addEventListener('click', () => this.openTeamPanel('own'));
    document.getElementById('btn-show-opponent-team').addEventListener('click', () => this.openTeamPanel('opponent'));
    document.getElementById('btn-close-team-panel').addEventListener('click', () => this.closeTeamPanel());
    document.getElementById('team-panel-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'team-panel-overlay') this.closeTeamPanel();
    });

    // MOMENTO
    const dlgMomento = document.getElementById('dlg-momento');
    document.getElementById('btn-momento').addEventListener('click', () => {
      document.getElementById('momento-time').textContent = `Minuto atual: ${AppState.timer.getGameTimeLabel()}`;
      document.getElementById('momento-note').value = '';
      dlgMomento.showModal();
    });
    document.getElementById('cancel-momento').addEventListener('click', () => dlgMomento.close());
    document.getElementById('save-momento').addEventListener('click', async () => {
      const note = document.getElementById('momento-note').value.trim();
      await this.recordOccurrence({ eventName: 'Momento', category: 'momento', priority: 'important', source: 'momento', note, type: 'neutral' });
      dlgMomento.close();
      this.renderHistory();
      toast('⭐ Momento guardado');
    });
    // Momento + apontamento manuscrito próprio (o momento fica guardado primeiro,
    // por isso nunca se perde nada mesmo que o desenho seja abandonado).
    document.getElementById('save-momento-sketch').addEventListener('click', async () => {
      const note = document.getElementById('momento-note').value.trim();
      const occ = await this.recordOccurrence({ eventName: 'Momento', category: 'momento', priority: 'important', source: 'momento', note, type: 'neutral' });
      dlgMomento.close();
      this.renderHistory();
      SketchPad.open(this.match.id, {
        onClose: async () => {
          occ.meta = { ...(occ.meta || {}), hasSketch: true };
          await AppState.updateOccurrence(occ);
          this.renderHistory();
        },
      });
    });

    // BANCO
    const dlgBanco = document.getElementById('dlg-banco');
    let bancoChoice = null;
    document.getElementById('btn-banco').addEventListener('click', () => {
      bancoChoice = null;
      document.getElementById('banco-time').textContent = `Minuto atual: ${AppState.timer.getGameTimeLabel()}`;
      document.getElementById('banco-note').style.display = 'none';
      document.getElementById('banco-actions').style.display = 'none';
      document.getElementById('banco-note').value = '';
      dlgBanco.showModal();
    });
    document.getElementById('banco-options').addEventListener('click', (e) => {
      const opt = e.target.closest('[data-banco]');
      if (!opt) return;
      bancoChoice = opt.dataset.banco;
      document.querySelectorAll('.banco-opt').forEach((b) => b.classList.toggle('selected', b === opt));
      document.getElementById('banco-note').style.display = 'block';
      document.getElementById('banco-actions').style.display = 'flex';
    });
    document.getElementById('cancel-banco').addEventListener('click', () => dlgBanco.close());
    document.getElementById('save-banco').addEventListener('click', async () => {
      if (!bancoChoice) return;
      const note = document.getElementById('banco-note').value.trim();
      await this.recordOccurrence({ eventName: bancoChoice, category: 'banco', priority: 'important', source: 'banco', note, type: 'neutral' });
      dlgBanco.close();
      this.renderHistory();
      toast(`🚨 Banco: ${bancoChoice}`);
    });

    // NOTA
    const dlgNota = document.getElementById('dlg-nota');
    document.getElementById('btn-nota').addEventListener('click', () => {
      document.getElementById('nota-time').textContent = `Minuto atual: ${AppState.timer.getGameTimeLabel()}`;
      document.getElementById('nota-text').value = '';
      dlgNota.showModal();
    });
    document.getElementById('cancel-nota').addEventListener('click', () => dlgNota.close());
    document.getElementById('save-nota').addEventListener('click', async () => {
      const text = document.getElementById('nota-text').value.trim();
      if (!text) { dlgNota.close(); return; }
      await this.recordOccurrence({ eventName: 'Nota', category: 'nota', priority: 'complementary', source: 'nota', note: text, type: 'neutral' });
      dlgNota.close();
      this.renderHistory();
      toast('📝 Nota guardada');
    });

    // NOVO EVENTO (durante o jogo)
    const dlgNewEvt = document.getElementById('dlg-new-event-live');
    document.getElementById('btn-new-event').addEventListener('click', () => dlgNewEvt.showModal());
    document.getElementById('cancel-new-event-live').addEventListener('click', () => dlgNewEvt.close());
    document.getElementById('form-new-event-live').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const libEvent = {
        id: Utils.uid('evt'), name: fd.get('name').trim(), category: fd.get('category'),
        priority: fd.get('priority'), type: 'neutral', description: '', icon: '', color: '',
        active: true, isDefault: false, position: 999,
      };
      await DB.put(DB.STORES.library, libEvent);
      const planEvent = { id: Utils.uid('pe'), libraryId: libEvent.id, name: libEvent.name, category: libEvent.category, priority: libEvent.priority, type: 'neutral' };
      this.match.observationPlan.push(planEvent);
      await AppState.persistMatch();
      dlgNewEvt.close();
      e.target.reset();
      this.renderButtons();
      toast('Evento adicionado ao painel');
    });

    // Mapa de Perdas & Recuperações
    const dlgTmap = document.getElementById('dlg-transitions-map');
    document.getElementById('tmap-close').addEventListener('click', () => dlgTmap.close());
    document.getElementById('tmap-close2').addEventListener('click', () => dlgTmap.close());

    // Padrões do jogo (leitura derivada)
    const dlgPat = document.getElementById('dlg-patterns');
    document.getElementById('pat-close').addEventListener('click', () => dlgPat.close());
    document.getElementById('pat-close2').addEventListener('click', () => dlgPat.close());

    // MAIS (correção de minuto, compensação, cartões, substituições, modo gestão)
    const dlgMore = document.getElementById('dlg-more');
    document.getElementById('btn-more').addEventListener('click', () => dlgMore.showModal());
    document.getElementById('cancel-more').addEventListener('click', () => dlgMore.close());
    document.getElementById('more-correct-time').addEventListener('click', () => {
      const val = prompt('Corrigir minuto (segundos a adicionar/subtrair, ex: -30 ou 45):', '0');
      const delta = parseInt(val, 10);
      if (!isNaN(delta)) { AppState.timer.correctOffset(delta); this.onTick(AppState.timer.getState()); }
      dlgMore.close();
    });
    document.getElementById('more-stoppage').addEventListener('click', () => {
      const val = prompt('Minutos de compensação a adicionar:', '1');
      const mins = parseInt(val, 10);
      if (!isNaN(mins)) { AppState.timer.addStoppage(mins * 60); this.onTick(AppState.timer.getState()); }
      dlgMore.close();
    });
    document.getElementById('more-card').addEventListener('click', async () => {
      dlgMore.close();
      const result = await PlayerPicker.open({
        title: 'Cartão — escolher jogador',
        groups: this.pickerGroups(),
        multi: false,
      });
      if (!result || result.players.length === 0) return;
      const player = result.players[0];
      const isOwnCard = this.ownPlayers.some((p) => p.id === player.id);
      const color = confirm('Cartão vermelho? OK = vermelho, Cancelar = amarelo') ? 'red' : 'yellow';
      const parts = AppState.timer.getGameTimeParts();
      this.match.cards.push({ id: Utils.uid('card'), playerId: player.id, player: player.name, color, period: parts.period, minute: parts.minute });
      await this.recordOccurrence({
        eventName: `Cartão ${color === 'red' ? 'Vermelho' : 'Amarelo'} (${player.shortName || player.name})`,
        category: 'individual', priority: 'important', source: 'cartao', type: 'negative', playerIds: [player.id],
        team: isOwnCard ? 'own' : 'opponent',
      });
      await AppState.persistMatch();
      this.renderHistory();
      this.renderStatsIfOpen();
      toast('Cartão registado');
    });
    document.getElementById('more-sub').addEventListener('click', async () => {
      dlgMore.close();
      // "Sai" mostra apenas quem está atualmente EM CAMPO nas duas equipas (evita
      // erros como tirar do banco alguém que nunca entrou, ou tirar quem já saiu).
      const ownOnField = LineupState.annotatedRoster(this.match, 'own', this.ownPlayers).filter((p) => p._onField);
      const oppOnField = LineupState.annotatedRoster(this.match, 'opponent', this.opponentPlayers).filter((p) => p._onField);
      const sideResult = await PlayerPicker.open({
        title: 'Substituição — jogador que sai',
        groups: [
          { label: this.match.team, players: ownOnField },
          { label: this.match.opponent, players: oppOnField },
        ],
        multi: false,
      });
      if (!sideResult || sideResult.players.length === 0) return;
      const outPlayer = sideResult.players[0];
      const isOwn = this.ownPlayers.some((p) => p.id === outPlayer.id);
      const side = isOwn ? 'own' : 'opponent';
      // "Entra" mostra apenas quem está no banco E ainda não foi substituído:
      // um jogador que já saiu não pode voltar a entrar.
      const sideState = LineupState.compute(this.match, side);
      const benchPool = LineupState.annotatedRoster(this.match, side, isOwn ? this.ownPlayers : this.opponentPlayers)
        .filter((p) => !p._onField && !sideState.subbedOffIds.has(p.id));
      if (benchPool.length === 0) {
        alert('Não há jogadores disponíveis no banco desta equipa (os que já saíram não podem voltar a entrar).');
        return;
      }
      const inResult = await PlayerPicker.open({
        title: `Substituição — quem entra por ${outPlayer.shortName || outPlayer.name}`,
        groups: [{ label: isOwn ? this.match.team : this.match.opponent, players: benchPool }],
        multi: false,
      });
      if (!inResult || inResult.players.length === 0) return;
      await this.commitSubstitution(side, outPlayer, inResult.players[0]);
    });
    document.getElementById('more-tactic').addEventListener('click', () => {
      dlgMore.close();
      this.openTacticChange();
    });
    document.getElementById('more-pair').addEventListener('click', () => {
      dlgMore.close();
      window.location.hash = `#/pair/${this.match.id}`;
    });
    document.getElementById('more-mode-manage').addEventListener('click', () => {
      dlgMore.close();
      window.location.hash = '#/library';
    });
    // Sair do painel sem terminar o jogo: o cronómetro continua a contar pelo
    // relógio real e o ecrã inicial mostra "Continuar jogo" para voltar.
    document.getElementById('more-home').addEventListener('click', async () => {
      dlgMore.close();
      // Cancela um toque no placar ainda a decorrer (debounce), para não somar
      // um golo depois de já termos saído do painel.
      Object.values(this._scoreTapTimers || {}).forEach((t) => t && clearTimeout(t));
      await AppState.persistMatch();
      this.publishMatchState();
      window.location.hash = '#/dashboard';
    });

    // Histórico completo
    document.getElementById('btn-open-history').addEventListener('click', () => this.openFullHistory());
    document.getElementById('cancel-history-full').addEventListener('click', () => document.getElementById('dlg-history-full').close());

    // Estatísticas
    document.getElementById('btn-stats').addEventListener('click', () => StatsPanel.open(this));

    // Notas manuscritas (Apple Pencil / stylus / dedo)
    document.getElementById('btn-sketch').addEventListener('click', () => SketchPad.open(this.match.id));
    document.getElementById('btn-bench-msg').addEventListener('click', () => { this._benchUnread = 0; this.updateBenchBadge(); BenchMessaging.open(this); });
    this.updateBenchBadge();

    // Indicador discreto do estado da sincronização, junto aos botões do topo.
    ConnectionBadge.mount(document.querySelector('.live-topbar-actions'));

    // Mensagens que chegam do banco (analista <- treinador). Registado uma só
    // vez — o handler usa o singleton LiveScreen, não o render atual.
    if (!LiveScreen._benchInbox) {
      LiveScreen._benchInbox = SyncCore.onMessage((env) => {
        if (env.entityType === 'message' && env.payload && env.payload.sender === 'coach') {
          LiveScreen._onBenchMessage(env.payload);
        } else if (env.entityType === 'sub_intent' && env.payload) {
          LiveScreen._onSubIntent(env.payload);
        }
      });
    }

    // Rede de segurança: grava o estado no momento exato em que o iPad é
    // bloqueado ou a app vai para segundo plano — é quando o Safari pode ser
    // terminado sem aviso. Registado uma só vez para não acumular listeners.
    if (!LiveScreen._bgGuard) {
      LiveScreen._bgGuard = () => {
        if (AppState.currentMatch && AppState.timer) AppState.persistMatch();
      };
      document.addEventListener('visibilitychange', LiveScreen._bgGuard);
      window.addEventListener('pagehide', LiveScreen._bgGuard);
    }

    // Proposta de substituição que chegou enquanto o analista estava noutro ecrã.
    if (LiveScreen._stashedSubIntent) {
      const s = LiveScreen._stashedSubIntent;
      LiveScreen._stashedSubIntent = null;
      setTimeout(() => this._onSubIntent(s), 60);
    }
  },

  /** "Aponta" um jogador no ecrã do banco (spotlight partilhado). */
  spotlightPlayer(playerId) {
    const p = this.findPlayerById(playerId);
    if (!SyncCore.session) { toast('Liga primeiro o dispositivo do banco (⋮ → Ligar dispositivo).'); return; }
    SyncCore.publish('spotlight', 'set', { playerId, name: p ? p.name : '', at: Date.now() });
    toast(`👉 A apontar no banco: ${p ? (p.shortName || p.name) : 'jogador'}`);
  },

  _onBenchMessage(msg) {
    // O envelope recebido já foi persistido pelo SyncCore (_apply guarda os
    // 'message'). Aqui é só alertar o analista sem o tirar da grelha de eventos.
    this._benchUnread = (this._benchUnread || 0) + 1;
    this.updateBenchBadge();
    Utils.vibrate(25);
    toast(`📥 Banco: ${msg.text || 'nova mensagem'}`);
    if (BenchMessaging._dlg && BenchMessaging._dlg.open) BenchMessaging.renderInbox(this);
  },

  /**
   * Regista uma substituição (fonte única: só o analista grava). Chamado tanto
   * pelo fluxo manual (⋮ → Registar substituição) como pela confirmação de uma
   * proposta vinda do banco.
   */
  async commitSubstitution(side, outPlayer, inPlayer) {
    const parts = AppState.timer ? AppState.timer.getGameTimeParts()
      : { period: this.match.currentPeriod || '1T', minute: 0 };
    this.match.substitutions.push({
      id: Utils.uid('sub'), side, outId: outPlayer.id, inId: inPlayer.id,
      out: outPlayer.name, in: inPlayer.name, period: parts.period, minute: parts.minute,
    });
    await this.recordOccurrence({
      eventName: `Substituição: ${outPlayer.shortName || outPlayer.name} → ${inPlayer.shortName || inPlayer.name}`,
      category: 'individual', priority: 'complementary', source: 'substituicao', type: 'neutral',
      playerIds: [outPlayer.id, inPlayer.id],
    });
    await AppState.persistMatch();
    this.publishMatchState();
    this.renderHistory();
    this.renderOnzeStrip();
    toast('Substituição registada');
  },

  /**
   * Mudança de sistema a meio do jogo (ex.: passar a 3-5-2 aos 60'). Fica como
   * registo próprio (`source: 'tatica'`): aparece no histórico, no pós-jogo e no
   * resumo do jogo, e dá contexto aos números de cada parte. Não mexe no onze —
   * quem está em campo continua a vir das substituições.
   */
  openTacticChange() {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.id = 'dlg-tactic';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head"><h3>♟ Mudança tática</h3><button type="button" class="icon-btn" data-close title="Fechar">✕</button></div>
        <p class="field-label">De quem</p>
        <div class="stats-team-pick">
          <button type="button" class="btn btn-lg result-btn selected" data-tside="own">${Utils.escapeHtml(this.match.team)}</button>
          <button type="button" class="btn btn-lg result-btn" data-tside="opponent">${Utils.escapeHtml(this.match.opponent)}</button>
        </div>
        <label class="field"><span>Sistema</span>
          <select id="tactic-formation">
            ${FORMATION_PRESETS.map((f) => `<option value="${f.id}">${Utils.escapeHtml(f.name)}</option>`).join('')}
            <option value="outro">Outro / não definido</option>
          </select>
        </label>
        <label class="field"><span>Nota</span><input id="tactic-note" placeholder="Opcional — ex: passou a losango no meio"></label>
        <div class="dialog-actions">
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="button" class="btn btn-primary" id="tactic-save">Registar</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);

    let side = 'own';
    dlg.querySelectorAll('[data-tside]').forEach((b) => b.addEventListener('click', () => {
      side = b.dataset.tside;
      dlg.querySelectorAll('[data-tside]').forEach((x) => x.classList.toggle('selected', x === b));
    }));
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    dlg.addEventListener('cancel', () => dlg.remove());
    dlg.querySelector('#tactic-save').addEventListener('click', async () => {
      const sel = dlg.querySelector('#tactic-formation');
      const name = sel.value === 'outro' ? '' : sel.options[sel.selectedIndex].textContent;
      const note = dlg.querySelector('#tactic-note').value.trim();
      const who = side === 'own' ? this.match.team : this.match.opponent;
      await this.recordOccurrence({
        eventName: `Mudança tática (${who})${name ? ': ' + name : ''}`,
        category: side === 'own' ? 'nossa_equipa' : 'adversario',
        team: side,
        priority: 'important',
        source: 'tatica',
        type: 'neutral',
        note,
        meta: { formationId: sel.value === 'outro' ? null : sel.value, formationName: name || null },
      });
      close();
      this.renderHistory();
      toast('Mudança tática registada');
    });
    dlg.showModal();
  },

  /** Proposta de substituição vinda do banco: mostra um cartão para confirmar/ignorar. */
  _onSubIntent(p) {
    if (!p || !p.id) return;
    if (p.status && p.status !== 'propose') return;           // ecos do próprio done/rejected
    if (p.at && Date.now() - p.at > 3 * 60 * 1000) return;    // proposta velha
    const card = document.getElementById('sub-intent-card');
    if (!card) {
      // O analista não está no painel LIVE: guarda a proposta e avisa; será
      // mostrada assim que o painel abrir.
      LiveScreen._stashedSubIntent = p;
      toast('📥 O banco propôs uma substituição — abre o painel do jogo para confirmar');
      return;
    }
    const outP = this.findPlayerById(p.outId);
    const inP = this.findPlayerById(p.inId);
    const label = (pl, fallback) => pl ? `${pl.number ? '#' + pl.number + ' ' : ''}${Utils.escapeHtml(pl.shortName || pl.name)}` : Utils.escapeHtml(fallback || '?');
    card.innerHTML = `
      <div class="sub-intent-body">
        <span class="sub-intent-tag">📥 O banco propõe</span>
        <span class="sub-intent-move">Sai <strong>${label(outP, p.outName)}</strong> · Entra <strong>${label(inP, p.inName)}</strong></span>
      </div>
      <div class="sub-intent-actions">
        <button class="btn btn-small" data-si="ignore">Ignorar</button>
        <button class="btn btn-primary btn-small" data-si="confirm">Confirmar e registar</button>
      </div>`;
    card.hidden = false;
    Utils.vibrate(30);
    toast('📥 Proposta de substituição do banco');
    card.querySelector('[data-si="ignore"]').onclick = () => this._resolveSubIntent(p, 'rejected');
    card.querySelector('[data-si="confirm"]').onclick = () => this._resolveSubIntent(p, 'done');
  },

  async _resolveSubIntent(p, status) {
    const card = document.getElementById('sub-intent-card');
    if (card) card.hidden = true;
    if (status === 'done') {
      const side = 'own'; // o banco só propõe sobre a nossa equipa
      const st = LineupState.compute(this.match, side);
      const outP = this.ownPlayers.find((x) => x.id === p.outId);
      const inP = this.ownPlayers.find((x) => x.id === p.inId);
      if (!outP || !inP || !st.onFieldIds.has(p.outId) || st.subbedOffIds.has(p.inId) || st.onFieldIds.has(p.inId)) {
        toast('Já não dá para fazer esta troca (o jogo mudou).');
        SyncCore.publish('sub_intent', 'resolve', { ...p, status: 'rejected' });
        return;
      }
      await this.commitSubstitution(side, outP, inP);
    }
    SyncCore.publish('sub_intent', 'resolve', { ...p, status });
  },

  updateBenchBadge() {
    const btn = document.getElementById('btn-bench-msg');
    if (!btn) return;
    let b = btn.querySelector('.quick-badge');
    const n = this._benchUnread || 0;
    if (n > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'quick-badge'; btn.appendChild(b); }
      b.textContent = n > 9 ? '9+' : String(n);
    } else if (b) {
      b.remove();
    }
  },

  /** Se o painel de estatísticas estiver aberto, atualiza os números (chamado após golos/cartões). */
  renderStatsIfOpen() {
    if (StatsPanel._dlg && StatsPanel._dlg.open) StatsPanel.renderMain();
  },

  bindScoreTaps() {
    const scoreEl = document.getElementById('live-score');
    const teamVal = scoreEl.querySelector('[data-team="team"]');
    const oppVal = scoreEl.querySelector('[data-team="opponent"]');
    // Um toque = golo (+1) e abre o detalhe. Dois toques rápidos = corrigir (−1)
    // e apagar o último golo dessa equipa.
    //
    // O evento `dblclick` do browser chega DEPOIS de dois `click`, por isso não
    // dá para o usar aqui: atrasamos o "+1" ~260ms e, se entretanto chegar um
    // segundo toque, tratamos tudo como correção (sem nunca ter somado o golo
    // fantasma). Sem isto, tocar duas vezes fazia +1, +1 e depois −1.
    this._scoreTapTimers = { team: null, opponent: null };
    const onScoreTap = (key, side) => {
      const timers = this._scoreTapTimers;
      if (timers[key]) {
        clearTimeout(timers[key]);
        timers[key] = null;
        if (this.match.score[key] > 0) {
          this.match.score[key]--;
          this._removeLastGoal(side).then(() => { this.renderHistory(); this.renderButtons(); });
          this.afterScoreChange(side, true);
          toast('Golo corrigido (−1)');
        }
        return;
      }
      timers[key] = setTimeout(() => {
        timers[key] = null;
        // Saímos do painel durante a espera: descarta este toque (não há golo
        // meio-aplicado nem diálogo por cima do ecrã seguinte).
        if (!document.getElementById('live-score')) return;
        this.match.score[key]++;
        this.afterScoreChange(side);
      }, 260);
    };
    teamVal.addEventListener('click', () => onScoreTap('team', 'own'));
    oppVal.addEventListener('click', () => onScoreTap('opponent', 'opponent'));
  },

  /** Remove o registo de golo mais recente de uma equipa (usado ao corrigir o placar). */
  async _removeLastGoal(side) {
    const last = [...this.occurrences]
      .filter((o) => o.source === 'golo' && o.team === side)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!last) return;
    await AppState.deleteOccurrence(last.id);
    this.occurrences = this.occurrences.filter((o) => o.id !== last.id);
    SyncCore.publish('occurrence', 'delete', { id: last.id });
  },

  /** @param {'own'|'opponent'} side - a favor de quem contou o golo. */
  /** Envia o estado do jogo (resultado, período, cronómetro) para os outros dispositivos. */
  publishMatchState() {
    if (!this.match) return;
    // Vai sem o teamSnapshot (fotos) — senão o envelope é pesado e pode não
    // chegar ao banco, deixando o cronómetro e as substituições por atualizar.
    SyncCore.publish('match', 'upsert', SyncCore.lightMatch(this.match));
  },

  async afterScoreChange(side, isCorrection = false) {
    document.querySelector('#live-score [data-team="team"]').textContent = this.match.score.team;
    document.querySelector('#live-score [data-team="opponent"]').textContent = this.match.score.opponent;
    if (!isCorrection) {
      const occ = await this.recordOccurrence({
        eventName: `Golo (${this.match.score.team}-${this.match.score.opponent})`,
        category: side === 'own' ? 'nossa_equipa' : 'adversario',
        team: side,
        priority: 'critical', source: 'golo', type: side === 'own' ? 'positive' : 'negative',
        meta: { ownGoal: false, scorerId: null, assistId: null, moment: false },
      });
      this.renderHistory();
      this.openGoalDetail(occ, side);
    }
    await AppState.persistMatch();
    this.publishMatchState();
    this.renderStatsIfOpen();
    Utils.vibrate(30);
  },

  /**
   * Detalhe do golo: tipo (normal/autogolo), marcador, assistência e ⭐ momento.
   * Tudo opcional — o golo já está registado e o placar já mudou.
   *
   * No autogolo, o golo conta para a equipa que beneficiou (o placar já reflete
   * isso), mas o jogador identificado é da equipa que o marcou contra si. Por
   * isso NÃO é contabilizado como golo do jogador nas estatísticas individuais.
   */
  openGoalDetail(occ, side) {
    // O golo é gravado de imediato; o detalhe é opcional. Se entretanto saímos
    // do painel LIVE (a gravação é assíncrona), não abrimos o diálogo por cima
    // do ecrã seguinte — fica acessível pelo histórico.
    if (!document.getElementById('live-score')) return;
    const benefitingTeam = side === 'own' ? this.match.team : this.match.opponent;
    const scoringSide = occ.meta.ownGoal ? (side === 'own' ? 'opponent' : 'own') : side;
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.id = 'dlg-goal-detail';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>⚽ Golo — ${Utils.escapeHtml(benefitingTeam)}</h3>
          <button type="button" class="icon-btn" id="goal-close" title="Fechar sem detalhar">✕</button>
        </div>
        <p class="muted">${String(occ.minute).padStart(2, '0')}:${String(occ.second).padStart(2, '0')} · o golo já está registado. Detalhar é opcional — podes fechar e voltar a este golo pelo histórico.</p>
        <p class="field-label">Tipo</p>
        <div class="stats-team-pick">
          <button class="btn result-btn selected" data-goal-type="normal">Golo normal</button>
          <button class="btn result-btn" data-goal-type="own">Autogolo</button>
        </div>
        <div id="goal-people">
          <p class="field-label" id="goal-scorer-label">Marcador</p>
          <div id="pg-scorer"></div>
          <div id="goal-assist-wrap">
            <p class="field-label">Assistência <span class="muted">(deixa em "n/d" se não houve)</span></p>
            <div id="pg-assist"></div>
          </div>
        </div>
        <label class="field checkbox-field" style="margin-top:12px"><input type="checkbox" id="goal-moment"><span>⭐ Marcar como Momento importante</span></label>
        <label class="field"><span>Nota</span><input id="goal-note" placeholder="Opcional"></label>
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" id="goal-done">Concluir</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();

    let isOwnGoal = false;
    let scorerId = null, assistId = null;

    // Fechar sem detalhar mantém o golo tal como foi registado no primeiro
    // toque — o analista nunca fica preso a preencher nada durante o jogo.
    const closeOnly = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#goal-close').addEventListener('click', closeOnly);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeOnly(); });

    const rosterFor = (s) => LineupState.annotatedRoster(this.match, s, s === 'own' ? this.ownPlayers : this.opponentPlayers);

    // Marcador e assistência lado a lado, sem abrir seletor. Num autogolo o
    // marcador é da outra equipa e a assistência desaparece — as grelhas são
    // redesenhadas quando o tipo de golo muda.
    const paintPeople = () => {
      const scorerSide = isOwnGoal ? (side === 'own' ? 'opponent' : 'own') : side;
      PlayerGrid.render(dlg, { id: 'pg-scorer', players: rosterFor(scorerSide), selectedId: scorerId }, (id) => {
        scorerId = id;
        if (id && assistId === id) { assistId = null; }
        paintAssist();
      });
      paintAssist();
    };
    // A assistência é sempre da MESMA equipa do golo e nunca o próprio marcador.
    const paintAssist = () => PlayerGrid.render(dlg, {
      id: 'pg-assist', players: rosterFor(side), selectedId: assistId, exclude: [scorerId].filter(Boolean),
    }, (id) => { assistId = id; });

    dlg.querySelectorAll('[data-goal-type]').forEach((b) => b.addEventListener('click', () => {
      dlg.querySelectorAll('[data-goal-type]').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      isOwnGoal = b.dataset.goalType === 'own';
      // Num autogolo não há assistência e o jogador pertence à outra equipa.
      dlg.querySelector('#goal-assist-wrap').style.display = isOwnGoal ? 'none' : '';
      dlg.querySelector('#goal-scorer-label').textContent = isOwnGoal
        ? `Autogolo de (jogador d${side === 'own' ? 'o ' + this.match.opponent : 'a ' + this.match.team})`
        : 'Marcador';
      scorerId = null; assistId = null;
      paintPeople();
    }));

    paintPeople();

    dlg.querySelector('#goal-done').addEventListener('click', async () => {
      occ.meta.ownGoal = isOwnGoal;
      occ.meta.scorerId = scorerId;
      occ.meta.assistId = isOwnGoal ? null : assistId;
      occ.meta.moment = dlg.querySelector('#goal-moment').checked;
      occ.note = dlg.querySelector('#goal-note').value.trim();
      occ.playerIds = [scorerId, occ.meta.assistId].filter(Boolean);
      const who = scorerId ? (this.findPlayerById(scorerId)?.shortName || '') : '';
      occ.eventName = isOwnGoal
        ? `Autogolo${who ? ' (' + who + ')' : ''} (${this.match.score.team}-${this.match.score.opponent})`
        : `Golo${who ? ' ' + who : ''} (${this.match.score.team}-${this.match.score.opponent})`;
      await AppState.updateOccurrence(occ);
      dlg.close(); dlg.remove();
      this.renderHistory();
      this.renderStatsIfOpen();
      toast(occ.meta.moment ? '⭐ Golo guardado como momento' : 'Golo atualizado');
    });
  },

  openTeamPanel(side) {
    const team = side === 'own' ? this.ownTeam : this.opponentTeam;
    const players = side === 'own' ? this.ownPlayers : this.opponentPlayers;
    const lineup = this.match.teams?.[side];
    const overlay = document.getElementById('team-panel-overlay');
    const title = document.getElementById('team-panel-title');
    const body = document.getElementById('team-panel-body');

    title.textContent = team ? team.name : (side === 'own' ? this.match.team : this.match.opponent);

    if (!team || !lineup || !lineup.positions || lineup.positions.length === 0) {
      body.innerHTML = '<p class="muted" style="padding:20px">Onze inicial ainda não foi definido para esta equipa.</p>';
    } else {
      // Calcula as posições ATUAIS (já com substituições aplicadas) a partir da
      // fonte única de verdade — nunca das posições estáticas do onze inicial.
      const state = LineupState.compute(this.match, side);
      const bench = players.filter((p) => state.benchIds.has(p.id));
      const subbedOff = players.filter((p) => state.subbedOffIds.has(p.id));
      body.innerHTML = `
        <div class="pitch pitch-readonly">
          <div class="pitch-markings">
            <div class="pitch-line-half"></div><div class="pitch-circle"></div>
            <div class="pitch-box pitch-box-top"></div><div class="pitch-box pitch-box-bottom"></div>
          </div>
          ${state.positions.map((pos) => {
            const player = players.find((p) => p.id === pos.playerId);
            if (!player) return `<div class="pitch-slot" style="left:${pos.x}%; top:${100 - pos.y}%"><span class="slot-token empty static"><span class="slot-token-role">${pos.role}</span></span></div>`;
            const subIn = state.statusByPlayerId.get(player.id) === 'sub_in';
            return `<div class="pitch-slot" style="left:${pos.x}%; top:${100 - pos.y}%">
              <button class="slot-token filled static ${subIn ? 'is-sub-in' : ''}" data-open-player="${player.id}">
                ${playerAvatar(player, 'sm')}
                <span class="slot-token-name">${Utils.escapeHtml(player.shortName || player.name)}${player.captain ? ' 🎖️' : ''}</span>
                ${player.number ? `<span class="slot-token-num">${player.number}</span>` : ''}
                ${subIn ? '<span class="slot-token-sub-badge" title="Entrou">↑</span>' : ''}
              </button>
            </div>`;
          }).join('')}
        </div>
        ${bench.length ? `
        <div class="team-panel-bench">
          <h3>Suplentes</h3>
          <div class="bench-list">
            ${bench.map((p) => `<div class="bench-chip" data-open-player="${p.id}">${playerAvatar(p, 'sm')}<span>${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.shortName || p.name)}</span></div>`).join('')}
          </div>
        </div>` : ''}
        ${subbedOff.length ? `
        <div class="team-panel-bench">
          <h3>Saíram</h3>
          <div class="bench-list">
            ${subbedOff.map((p) => `<div class="bench-chip bench-chip-out" data-open-player="${p.id}">${playerAvatar(p, 'sm')}<span>${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.shortName || p.name)} ↓</span></div>`).join('')}
          </div>
        </div>` : ''}
      `;
      body.querySelectorAll('[data-open-player]').forEach((el) => {
        el.addEventListener('click', () => { window.location.hash = `#/player/${this.match.id}/${el.dataset.openPlayer}`; });
      });
    }

    overlay.hidden = false;
    overlay.style.display = 'flex';
  },

  closeTeamPanel() {
    const overlay = document.getElementById('team-panel-overlay');
    overlay.hidden = true;
    overlay.style.display = 'none';
  },

  openFullHistory() {
    const dlg = document.getElementById('dlg-history-full');
    const filtersEl = document.getElementById('history-filters');
    const cats = [{ id: 'all', name: 'Todas' }, ...window.AnalistaLiveData.CATEGORIES, { id: 'momento', name: 'Momentos' }, { id: 'nota', name: 'Notas' }];
    filtersEl.innerHTML = `
      <select id="hf-category">${cats.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
      <select id="hf-priority">
        <option value="all">Todas prioridades</option>
        <option value="critical">🔴 Crítico</option>
        <option value="important">🟡 Importante</option>
        <option value="complementary">🟢 Complementar</option>
      </select>
      <select id="hf-period">
        <option value="all">Todo o jogo</option>
        <option value="1T">1ª Parte</option>
        <option value="2T">2ª Parte</option>
      </select>
    `;
    const renderList = () => {
      const cat = document.getElementById('hf-category').value;
      const prio = document.getElementById('hf-priority').value;
      const per = document.getElementById('hf-period').value;
      const list = this.occurrences
        .filter((o) => cat === 'all' || o.category === cat)
        .filter((o) => prio === 'all' || o.priority === prio)
        .filter((o) => per === 'all' || o.period === per)
        .sort((a, b) => b.timestamp - a.timestamp);
      document.getElementById('history-full-list').innerHTML = list.length
        ? list.map((o) => {
            const players = (o.playerIds || []).map((id) => this.findPlayerById(id)).filter(Boolean);
            return `
          <div class="history-full-row">
            <span class="history-time">${String(o.minute).padStart(2, '0')}:${String(o.second).padStart(2, '0')}</span>
            <span class="history-full-cat">${o.categoryLabel || o.category}</span>
            <span class="history-full-name">${Utils.escapeHtml(o.eventName)}</span>
            ${players.length ? `<span class="history-players">${players.map((p) => `<span class="history-player-chip">${Utils.escapeHtml(p.shortName || p.name)}</span>`).join('')}</span>` : ''}
            ${o.note ? `<span class="history-full-note">"${Utils.escapeHtml(o.note)}"</span>` : ''}
            <button class="btn btn-tiny" data-edit-occ="${o.id}">Editar</button>
          </div>`;
          }).join('')
        : '<p class="muted">Sem registos para este filtro.</p>';

      document.getElementById('history-full-list').querySelectorAll('[data-edit-occ]').forEach((btn) => {
        btn.addEventListener('click', () => this.openEditOccurrence(btn.dataset.editOcc));
      });
    };
    filtersEl.addEventListener('change', renderList);
    renderList();
    this._refreshFullHistory = renderList; // permite atualizar a lista depois de editar/apagar
    dlg.showModal();
  },

  openEditOccurrence(occId) {
    const occ = this.occurrences.find((o) => o.id === occId);
    if (!occ) return;
    const dlg = document.getElementById('dlg-edit-occurrence');
    const form = document.getElementById('form-edit-occurrence');
    form.id.value = occ.id;
    form.minute.value = occ.minute;
    form.second.value = occ.second;
    form.period.value = occ.period;
    form.eventName.value = occ.eventName;
    form.priority.value = occ.priority;
    form.note.value = occ.note || '';
    dlg.showModal();

    document.getElementById('edit-occ-players').onclick = async () => {
      await this.tagPlayersOnOccurrence(occ);
      toast('Jogadores atualizados');
    };
    document.getElementById('delete-occurrence').onclick = async () => {
      // Apagar um golo, uma substituição ou um cartão mexe no jogo — diz-se o quê.
      const effect = MatchEffects.describe(occ);
      if (!confirm(`Apagar definitivamente este registo?${effect ? '\n\n' + effect : ''}`)) return;
      dlg.close();
      await this.deleteOccurrenceWithEffects(occ);
      if (this._refreshFullHistory) this._refreshFullHistory();
      toast('Registo apagado');
    };
    document.getElementById('cancel-edit-occurrence').onclick = () => dlg.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      occ.minute = Number(form.minute.value) || 0;
      occ.second = Number(form.second.value) || 0;
      occ.period = form.period.value;
      occ.eventName = form.eventName.value.trim();
      occ.priority = form.priority.value;
      occ.note = form.note.value.trim();
      await AppState.updateOccurrence(occ);
      dlg.close();
      this.renderButtons();
      this.renderHistory();
      if (this._refreshFullHistory) this._refreshFullHistory();
      toast('Registo atualizado');
    };
  },
};

window.LiveScreen = LiveScreen;
