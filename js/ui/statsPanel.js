/**
 * statsPanel.js — Painel de Estatísticas do LIVE.
 *
 * Camada rápida de registo estatístico, sobre a MESMA base de dados dos
 * eventos (occurrences) — nunca um sistema paralelo. Remates/cantos/faltas
 * ficam automaticamente no histórico, na exportação CSV/JSON e são editáveis
 * pelo mecanismo já existente.
 *
 * Fluxo: 1 toque regista (equipa) → o resto é opcional e pode ser preenchido
 * a seguir, sem bloquear o analista.
 */

const StatsPanel = {
  live: null, // referência ao LiveScreen (match, occurrences, players, timer...)
  _dlg: null,
  _mapMode: null, // 'shots' | 'fouls' | null

  _ensureDialog() {
    if (this._dlg) return this._dlg;
    const dlg = document.createElement('dialog');
    dlg.id = 'dlg-stats-panel';
    dlg.className = 'dialog dialog-wide';
    document.body.appendChild(dlg);
    this._dlg = dlg;
    dlg.addEventListener('cancel', () => this.close());
    // "✕" nos ecrãs de detalhe (remate/canto/falta/defesa) volta à tabela de
    // estatísticas sem fechar o painel — o registo rápido já foi guardado.
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-detail-back]')) this.renderMain();
    });
    return dlg;
  },

  open(live) {
    this.live = live;
    this._mapMode = null;
    const dlg = this._ensureDialog();
    this.renderMain();
    dlg.showModal();
  },

  close() {
    if (this._dlg?.open) this._dlg.close();
  },

  refreshLiveViews() {
    this.live.renderHistory();
    this.live.renderButtons();
  },

  // ---------- Ecrã principal: tabela comparativa + ações ----------
  renderMain() {
    const { match, occurrences } = this.live;
    const stats = MatchStats.compute(match, occurrences);

    this._dlg.innerHTML = `
      <div class="dialog-card stats-card">
        <div class="stats-head">
          <h3>📊 Estatísticas</h3>
          <button type="button" class="icon-btn" id="stats-close">✕</button>
        </div>
        <div class="stats-teams-head">
          <span>${Utils.escapeHtml(match.team)}</span>
          <span class="muted">vs</span>
          <span>${Utils.escapeHtml(match.opponent)}</span>
        </div>
        <table class="stats-table">
          ${MatchStats.STAT_KEYS.map((k) => this.statRow(k, stats)).join('')}
        </table>
        <div class="stats-actions">
          <button class="btn btn-primary" id="stats-add-shot">⚽ Remate</button>
          <button class="btn" id="stats-add-corner">🚩 Canto</button>
          <button class="btn" id="stats-add-foul">🟨 Falta</button>
          <button class="btn" id="stats-add-save">🧤 Defesa</button>
          <button class="btn btn-small" id="stats-map-shots">Mapa de Remates</button>
          <button class="btn btn-small" id="stats-map-fouls">Mapa de Faltas</button>
        </div>
        <div id="stats-map-area"></div>
      </div>
    `;

    this.bindMainEvents();
  },

  statRow(k, stats) {
    const isQuick = MatchStats.QUICK_KEYS.includes(k.key);
    return `
      <tr class="stats-row ${isQuick ? 'stats-row-quick' : ''}" data-key="${k.key}">
        <td class="stats-cell-val">
          ${isQuick ? `<button class="stats-adj" data-adj="own" data-key="${k.key}">−</button>` : ''}
          <span class="stats-num">${stats.own[k.key]}</span>
          ${isQuick ? `<button class="stats-adj" data-adj="own" data-key="${k.key}" data-plus="1">＋</button>` : ''}
        </td>
        <td class="stats-cell-label">${k.label}</td>
        <td class="stats-cell-val">
          ${isQuick ? `<button class="stats-adj" data-adj="opponent" data-key="${k.key}">−</button>` : ''}
          <span class="stats-num">${stats.opp[k.key]}</span>
          ${isQuick ? `<button class="stats-adj" data-adj="opponent" data-key="${k.key}" data-plus="1">＋</button>` : ''}
        </td>
      </tr>
    `;
  },

  bindMainEvents() {
    this._dlg.querySelector('#stats-close').addEventListener('click', () => this.close());

    this._dlg.querySelectorAll('.stats-adj').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const side = btn.dataset.adj;
        const key = btn.dataset.key;
        if (btn.dataset.plus) {
          await this.quickIncrement(side, key);
        } else {
          await this.quickDecrement(side, key);
        }
        this.renderMain();
        this.refreshLiveViews();
      });
    });

    this._dlg.querySelector('#stats-add-shot').addEventListener('click', () => this.openShotFlow());
    this._dlg.querySelector('#stats-add-corner').addEventListener('click', () => this.openCornerFlow());
    this._dlg.querySelector('#stats-add-foul').addEventListener('click', () => this.openFoulFlow());
    this._dlg.querySelector('#stats-add-save').addEventListener('click', () => this.openSaveFlow());
    this._dlg.querySelector('#stats-map-shots').addEventListener('click', () => this.renderMap('shots'));
    this._dlg.querySelector('#stats-map-fouls').addEventListener('click', () => this.renderMap('fouls'));
  },

  async quickIncrement(side, key) {
    const teamName = side === 'own' ? this.live.match.team : this.live.match.opponent;
    const label = MatchStats.STAT_KEYS.find((k) => k.key === key)?.label || key;
    await this.live.recordOccurrence({
      eventName: `${label} (${teamName})`,
      category: side === 'own' ? 'nossa_equipa' : 'adversario',
      team: side, priority: 'complementary', source: 'stat_quick', type: 'neutral',
      meta: { statKey: key },
    });
  },

  /** Remove o registo de "+1 rápido" mais recente deste tipo/equipa (evita contagens negativas). */
  async quickDecrement(side, key) {
    const match = this.live.occurrences
      .filter((o) => o.source === 'stat_quick' && o.team === side && o.meta?.statKey === key)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!match) return;
    await AppState.deleteOccurrence(match.id);
    this.live.occurrences = this.live.occurrences.filter((o) => o.id !== match.id);
  },

  // ---------- Remate ----------
  openShotFlow() {
    this._dlg.innerHTML = `
      <div class="dialog-card">
        <h3>⚽ Remate — de quem?</h3>
        <div class="stats-team-pick">
          <button class="btn btn-lg" id="shot-team-own">${Utils.escapeHtml(this.live.match.team)}</button>
          <button class="btn btn-lg" id="shot-team-opp">${Utils.escapeHtml(this.live.match.opponent)}</button>
        </div>
        <div class="dialog-actions"><button type="button" class="btn" id="shot-cancel">Cancelar</button></div>
      </div>
    `;
    this._dlg.querySelector('#shot-cancel').addEventListener('click', () => this.renderMain());
    this._dlg.querySelector('#shot-team-own').addEventListener('click', () => this.registerShotQuick('own'));
    this._dlg.querySelector('#shot-team-opp').addEventListener('click', () => this.registerShotQuick('opponent'));
  },

  async registerShotQuick(side) {
    const occ = await this.live.recordOccurrence({
      eventName: 'Remate',
      category: side === 'own' ? 'nossa_equipa' : 'adversario',
      team: side, priority: 'important', source: 'remate', type: 'neutral',
      meta: { origin: null, result: null, goalZone: null },
    });
    toast('⚽ Remate registado');
    this.refreshLiveViews();
    this.openShotDetail(occ);
  },

  openShotDetail(occ) {
    const side = occ.team;
    this._dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>Detalhar Remate <span class="muted">(opcional — já registado)</span></h3>
          <button type="button" class="icon-btn" data-detail-back title="Voltar">✕</button>
        </div>
        <p class="muted">${String(occ.minute).padStart(2, '0')}' · ${side === 'own' ? Utils.escapeHtml(this.live.match.team) : Utils.escapeHtml(this.live.match.opponent)}</p>
        <p class="field-label">Jogador</p>
        <button class="btn btn-small" id="shot-pick-player">＋ Escolher jogador</button>
        <span id="shot-player-chosen" class="muted"></span>
        <p class="field-label">Origem do remate (toca no campo)</p>
        ${this.miniPitchHTML('shot-origin-pitch', 'shot-origin-dot', side)}
        <p class="field-label">Resultado</p>
        <div class="result-grid" id="shot-result-grid">
          ${MatchStats.SHOT_RESULTS.map((r) => `<button type="button" class="btn result-btn" data-result="${r.key}">${r.label}</button>`).join('')}
        </div>
        <div id="shot-goal-zone-wrap" hidden>
          <p class="field-label">Zona da baliza (onde a bola foi)</p>
          ${this.goalGraphicHTML('shot-goal-zone')}
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" id="shot-done">Concluir</button>
        </div>
      </div>
    `;

    let chosenPlayerId = null;
    this._dlg.querySelector('#shot-pick-player').addEventListener('click', async () => {
      const groups = side === 'own'
        ? [{ label: this.live.match.team, players: LineupState.annotatedRoster(this.live.match, 'own', this.live.ownPlayers) }]
        : [{ label: this.live.match.opponent, players: LineupState.annotatedRoster(this.live.match, 'opponent', this.live.opponentPlayers) }];
      const result = await PlayerPicker.open({ title: 'Remate — jogador', groups, multi: false });
      if (result && result.players.length) {
        chosenPlayerId = result.players[0].id;
        this._dlg.querySelector('#shot-player-chosen').textContent = result.players[0].shortName || result.players[0].name;
      }
    });

    this.bindMiniPitch('#shot-origin-pitch', '#shot-origin-dot', (xy) => { occ.meta.origin = xy; });

    let chosenZone = null;
    this._dlg.querySelectorAll('.result-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._dlg.querySelectorAll('.result-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        occ.meta.result = btn.dataset.result;
        this._dlg.querySelector('#shot-goal-zone-wrap').hidden = !(occ.meta.result === 'goal' || occ.meta.result === 'save');
      });
    });
    this._dlg.querySelectorAll('.goal-zone-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._dlg.querySelectorAll('.goal-zone-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        chosenZone = btn.dataset.zone;
      });
    });

    this._dlg.querySelector('#shot-done').addEventListener('click', async () => {
      if (chosenPlayerId) occ.playerIds = [chosenPlayerId];
      if (chosenZone) occ.meta.goalZone = chosenZone;
      if (occ.meta.result === 'goal') {
        // Fonte única do placar — um remate marcado "Golo" incrementa o resultado
        // diretamente; nunca cria um segundo registo de golo (ver matchStats.js).
        if (side === 'own') this.live.match.score.team++; else this.live.match.score.opponent++;
        document.querySelector('#live-score [data-team="team"]').textContent = this.live.match.score.team;
        document.querySelector('#live-score [data-team="opponent"]').textContent = this.live.match.score.opponent;
      }
      await AppState.updateOccurrence(occ);
      await AppState.persistMatch();
      if (occ.meta.result === 'goal') this.live.publishMatchState();
      this.refreshLiveViews();
      toast('Remate atualizado');
      this.renderMain();
    });
  },

  // ---------- Canto ----------
  openCornerFlow() {
    this._dlg.innerHTML = `
      <div class="dialog-card">
        <h3>🚩 Canto — de quem?</h3>
        <div class="stats-team-pick">
          <button class="btn btn-lg" id="corner-team-own">${Utils.escapeHtml(this.live.match.team)}</button>
          <button class="btn btn-lg" id="corner-team-opp">${Utils.escapeHtml(this.live.match.opponent)}</button>
        </div>
        <div class="dialog-actions"><button type="button" class="btn" id="corner-cancel">Cancelar</button></div>
      </div>
    `;
    this._dlg.querySelector('#corner-cancel').addEventListener('click', () => this.renderMain());
    this._dlg.querySelector('#corner-team-own').addEventListener('click', () => this.registerCornerQuick('own'));
    this._dlg.querySelector('#corner-team-opp').addEventListener('click', () => this.registerCornerQuick('opponent'));
  },

  async registerCornerQuick(side) {
    const occ = await this.live.recordOccurrence({
      eventName: 'Canto',
      category: side === 'own' ? 'nossa_equipa' : 'adversario',
      team: side, priority: 'complementary', source: 'canto', type: 'neutral',
      meta: { side: null, result: null },
    });
    toast('🚩 Canto registado');
    this.refreshLiveViews();
    this.openCornerDetail(occ);
  },

  openCornerDetail(occ) {
    const side = occ.team;
    this._dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>Detalhar Canto <span class="muted">(opcional — já registado)</span></h3>
          <button type="button" class="icon-btn" data-detail-back title="Voltar">✕</button>
        </div>
        <p class="field-label">Lado</p>
        <div class="stats-team-pick">
          <button class="btn result-btn" data-side="left">Esquerdo</button>
          <button class="btn result-btn" data-side="right">Direito</button>
        </div>
        <p class="field-label">Batedor</p>
        <button class="btn btn-small" id="corner-pick-player">＋ Escolher jogador</button>
        <span id="corner-player-chosen" class="muted"></span>
        <p class="field-label">Resultado</p>
        <div class="result-grid">
          ${MatchStats.CORNER_RESULTS.map((r) => `<button type="button" class="btn result-btn" data-result="${r.key}">${r.label}</button>`).join('')}
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" id="corner-done">Concluir</button>
        </div>
      </div>
    `;
    this._dlg.querySelectorAll('[data-side]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._dlg.querySelectorAll('[data-side]').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        occ.meta.side = btn.dataset.side;
      });
    });
    let chosenPlayerId = null;
    this._dlg.querySelector('#corner-pick-player').addEventListener('click', async () => {
      const groups = side === 'own'
        ? [{ label: this.live.match.team, players: LineupState.annotatedRoster(this.live.match, 'own', this.live.ownPlayers) }]
        : [{ label: this.live.match.opponent, players: LineupState.annotatedRoster(this.live.match, 'opponent', this.live.opponentPlayers) }];
      const result = await PlayerPicker.open({ title: 'Canto — batedor', groups, multi: false });
      if (result && result.players.length) {
        chosenPlayerId = result.players[0].id;
        this._dlg.querySelector('#corner-player-chosen').textContent = result.players[0].shortName || result.players[0].name;
      }
    });
    this._dlg.querySelectorAll('[data-result]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._dlg.querySelectorAll('[data-result]').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        occ.meta.result = btn.dataset.result;
      });
    });
    this._dlg.querySelector('#corner-done').addEventListener('click', async () => {
      if (chosenPlayerId) occ.playerIds = [chosenPlayerId];
      await AppState.updateOccurrence(occ);
      this.refreshLiveViews();
      toast('Canto atualizado');
      this.renderMain();
    });
  },

  // ---------- Falta ----------
  openFoulFlow() {
    this._dlg.innerHTML = `
      <div class="dialog-card">
        <h3>🟨 Falta — quem cometeu?</h3>
        <div class="stats-team-pick">
          <button class="btn btn-lg" id="foul-team-own">${Utils.escapeHtml(this.live.match.team)}</button>
          <button class="btn btn-lg" id="foul-team-opp">${Utils.escapeHtml(this.live.match.opponent)}</button>
        </div>
        <div class="dialog-actions"><button type="button" class="btn" id="foul-cancel">Cancelar</button></div>
      </div>
    `;
    this._dlg.querySelector('#foul-cancel').addEventListener('click', () => this.renderMain());
    this._dlg.querySelector('#foul-team-own').addEventListener('click', () => this.registerFoulQuick('own'));
    this._dlg.querySelector('#foul-team-opp').addEventListener('click', () => this.registerFoulQuick('opponent'));
  },

  async registerFoulQuick(side) {
    const occ = await this.live.recordOccurrence({
      eventName: 'Falta',
      category: side === 'own' ? 'nossa_equipa' : 'adversario',
      team: side, priority: 'complementary', source: 'falta', type: 'negative',
      meta: { location: null, type: null, committedById: null, sufferedById: null },
    });
    toast('🟨 Falta registada');
    this.refreshLiveViews();
    this.openFoulDetail(occ);
  },

  openFoulDetail(occ) {
    const side = occ.team;
    const otherSide = side === 'own' ? 'opponent' : 'own';
    this._dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>Detalhar Falta <span class="muted">(opcional — já registada)</span></h3>
          <button type="button" class="icon-btn" data-detail-back title="Voltar">✕</button>
        </div>
        <p class="field-label">Localização da falta (toca no campo)</p>
        ${this.miniPitchHTML('foul-loc-pitch', 'foul-loc-dot', side)}
        <p class="field-label">Tipo</p>
        <div class="result-grid">
          ${MatchStats.FOUL_TYPES.map((t) => `<button type="button" class="btn result-btn" data-type="${t.key}">${t.label}</button>`).join('')}
        </div>
        <p class="field-label">Consequência <span class="muted">(pode ser mais do que uma)</span></p>
        <div class="result-grid" id="foul-conseq">
          ${MatchStats.FOUL_CONSEQUENCES.map((c) => `<button type="button" class="btn result-btn" data-conseq="${c.key}">${c.label}</button>`).join('')}
        </div>
        <p class="field-label">Quem cometeu</p>
        <button class="btn btn-small" id="foul-pick-committed">＋ Escolher jogador</button>
        <span id="foul-committed-chosen" class="muted"></span>
        <p class="field-label">Quem sofreu</p>
        <button class="btn btn-small" id="foul-pick-suffered">＋ Escolher jogador</button>
        <span id="foul-suffered-chosen" class="muted"></span>
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" id="foul-done">Concluir</button>
        </div>
      </div>
    `;
    this.bindMiniPitch('#foul-loc-pitch', '#foul-loc-dot', (xy) => { occ.meta.location = xy; });
    this._dlg.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._dlg.querySelectorAll('[data-type]').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        occ.meta.type = btn.dataset.type;
      });
    });
    let committedId = null;
    let sufferedId = null;
    this._dlg.querySelector('#foul-pick-committed').addEventListener('click', async () => {
      const groups = side === 'own'
        ? [{ label: this.live.match.team, players: LineupState.annotatedRoster(this.live.match, 'own', this.live.ownPlayers) }]
        : [{ label: this.live.match.opponent, players: LineupState.annotatedRoster(this.live.match, 'opponent', this.live.opponentPlayers) }];
      const result = await PlayerPicker.open({ title: 'Quem cometeu a falta', groups, multi: false });
      if (result && result.players.length) {
        committedId = result.players[0].id;
        this._dlg.querySelector('#foul-committed-chosen').textContent = result.players[0].shortName || result.players[0].name;
      }
    });
    this._dlg.querySelector('#foul-pick-suffered').addEventListener('click', async () => {
      const groups = otherSide === 'own'
        ? [{ label: this.live.match.team, players: LineupState.annotatedRoster(this.live.match, 'own', this.live.ownPlayers) }]
        : [{ label: this.live.match.opponent, players: LineupState.annotatedRoster(this.live.match, 'opponent', this.live.opponentPlayers) }];
      const result = await PlayerPicker.open({ title: 'Quem sofreu a falta', groups, multi: false });
      if (result && result.players.length) {
        sufferedId = result.players[0].id;
        this._dlg.querySelector('#foul-suffered-chosen').textContent = result.players[0].shortName || result.players[0].name;
      }
    });
    // Consequências são multi-seleção: uma falta pode dar livre + amarelo.
    const conseq = new Set();
    this._dlg.querySelectorAll('[data-conseq]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.conseq;
        if (conseq.has(k)) { conseq.delete(k); btn.classList.remove('selected'); }
        else { conseq.add(k); btn.classList.add('selected'); }
      });
    });

    this._dlg.querySelector('#foul-done').addEventListener('click', async () => {
      occ.meta.consequences = [...conseq];
      const ids = [];
      if (committedId) { occ.meta.committedById = committedId; ids.push(committedId); }
      if (sufferedId) { occ.meta.sufferedById = sufferedId; ids.push(sufferedId); }
      occ.playerIds = ids;
      // Se houve cartão, fica registado no mesmo evento (nunca um segundo
      // registo) e também na lista de cartões do jogo, para o relatório.
      if (committedId && (conseq.has('yellow') || conseq.has('red'))) {
        const p = this.live.findPlayerById(committedId);
        const parts = { period: occ.period, minute: occ.minute };
        this.live.match.cards.push({
          id: Utils.uid('card'), playerId: committedId, player: p ? p.name : '',
          color: conseq.has('red') ? 'red' : 'yellow', fromFoulId: occ.id, ...parts,
        });
        await AppState.persistMatch();
      }
      await AppState.updateOccurrence(occ);
      this.refreshLiveViews();
      toast('Falta atualizada');
      this.renderMain();
    });
  },

  // ---------- Defesa do guarda-redes ----------
  openSaveFlow() {
    this._dlg.innerHTML = `
      <div class="dialog-card">
        <h3>🧤 Defesa — de que guarda-redes?</h3>
        <div class="stats-team-pick">
          <button class="btn btn-lg" id="save-team-own">${Utils.escapeHtml(this.live.match.team)}</button>
          <button class="btn btn-lg" id="save-team-opp">${Utils.escapeHtml(this.live.match.opponent)}</button>
        </div>
        <div class="dialog-actions"><button type="button" class="btn" id="save-cancel">Cancelar</button></div>
      </div>`;
    this._dlg.querySelector('#save-cancel').addEventListener('click', () => this.renderMain());
    this._dlg.querySelector('#save-team-own').addEventListener('click', () => this.registerSaveQuick('own'));
    this._dlg.querySelector('#save-team-opp').addEventListener('click', () => this.registerSaveQuick('opponent'));
  },

  async registerSaveQuick(side) {
    const occ = await this.live.recordOccurrence({
      eventName: 'Defesa',
      category: side === 'own' ? 'nossa_equipa' : 'adversario',
      team: side, priority: 'important', source: 'defesa', type: side === 'own' ? 'positive' : 'neutral',
      meta: { saveType: null, keeperId: null, shotId: null, moment: false },
    });
    toast('🧤 Defesa registada');
    this.refreshLiveViews();
    this.openSaveDetail(occ);
  },

  openSaveDetail(occ) {
    const side = occ.team;
    // O remate correspondente é do adversário do guarda-redes.
    const shooterSide = side === 'own' ? 'opponent' : 'own';
    // Remates recentes já enquadrados e ainda sem defesa associada.
    const recentShots = this.live.occurrences
      .filter((o) => o.source === 'remate' && o.team === shooterSide && !o.meta?.saveId)
      .sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);

    this._dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>Detalhar Defesa <span class="muted">(opcional — já registada)</span></h3>
          <button type="button" class="icon-btn" data-detail-back title="Voltar">✕</button>
        </div>
        <p class="muted">${String(occ.minute).padStart(2, '0')}' · ${side === 'own' ? Utils.escapeHtml(this.live.match.team) : Utils.escapeHtml(this.live.match.opponent)}</p>
        <p class="field-label">Guarda-redes</p>
        <button class="btn btn-small" id="save-pick-gk">＋ Escolher jogador</button>
        <span id="save-gk-name" class="muted"></span>
        <p class="field-label">Tipo de defesa</p>
        <div class="result-grid">
          ${MatchStats.SAVE_TYPES.map((t) => `<button type="button" class="btn result-btn" data-savetype="${t.key}">${t.label}</button>`).join('')}
        </div>
        ${recentShots.length ? `
          <p class="field-label">Ligar ao remate <span class="muted">(evita registar o remate duas vezes)</span></p>
          <div class="result-grid" id="save-shot-link">
            ${recentShots.map((sh) => `<button type="button" class="btn result-btn" data-shot="${sh.id}">${String(sh.minute).padStart(2, '0')}' ${Utils.escapeHtml(this.live.findPlayerById((sh.playerIds || [])[0])?.shortName || 'remate')}</button>`).join('')}
          </div>` : `
          <p class="muted sc-hint">Não há remates recentes do adversário por associar. Se registares o remate a seguir, marca-o como "Defesa" para ficarem ligados.</p>`}
        <label class="field checkbox-field"><input type="checkbox" id="save-moment"><span>⭐ Marcar como Momento</span></label>
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" id="save-done">Concluir</button>
        </div>
      </div>`;

    let keeperId = null, saveType = null, shotId = null;
    this._dlg.querySelector('#save-pick-gk').addEventListener('click', async () => {
      const groups = [{
        label: side === 'own' ? this.live.match.team : this.live.match.opponent,
        players: LineupState.annotatedRoster(this.live.match, side, side === 'own' ? this.live.ownPlayers : this.live.opponentPlayers),
      }];
      const r = await PlayerPicker.open({ title: 'Guarda-redes', groups, multi: false });
      if (r && r.players.length) { keeperId = r.players[0].id; this._dlg.querySelector('#save-gk-name').textContent = r.players[0].shortName || r.players[0].name; }
    });
    this._dlg.querySelectorAll('[data-savetype]').forEach((b) => b.addEventListener('click', () => {
      this._dlg.querySelectorAll('[data-savetype]').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      saveType = b.dataset.savetype;
    }));
    this._dlg.querySelectorAll('[data-shot]').forEach((b) => b.addEventListener('click', () => {
      this._dlg.querySelectorAll('[data-shot]').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      shotId = b.dataset.shot;
    }));

    this._dlg.querySelector('#save-done').addEventListener('click', async () => {
      occ.meta.keeperId = keeperId;
      occ.meta.saveType = saveType;
      occ.meta.shotId = shotId;
      occ.meta.moment = this._dlg.querySelector('#save-moment').checked;
      occ.playerIds = keeperId ? [keeperId] : [];
      const label = MatchStats.SAVE_TYPES.find((t) => t.key === saveType)?.label;
      if (label) occ.eventName = label;
      await AppState.updateOccurrence(occ);

      // Liga os dois eventos nos dois sentidos, sem duplicar o remate.
      if (shotId) {
        const shot = this.live.occurrences.find((o) => o.id === shotId);
        if (shot) {
          shot.meta = shot.meta || {};
          shot.meta.saveId = occ.id;
          if (!shot.meta.result) shot.meta.result = 'save';
          await AppState.updateOccurrence(shot);
        }
      }
      this.refreshLiveViews();
      toast('Defesa atualizada');
      this.renderMain();
    });
  },

  // ---------- Utilitário: mini-campo tocável (coordenadas normalizadas 0–1) ----------

  /**
   * Campo de futebol tocável, com marcações reais e uma seta a indicar o sentido
   * de ataque da equipa em questão.
   *
   * Convenção (a mesma do Onze Inicial): a nossa equipa ataca para CIMA, o
   * adversário ataca para BAIXO. Assim o analista sabe sempre onde é o "campo
   * de ataque" ao marcar a origem de um remate ou o local de uma falta.
   */
  miniPitchHTML(id, dotId, side) {
    const attacksUp = side === 'own';
    const teamName = side === 'own' ? this.live.match.team : this.live.match.opponent;
    // Usa o MESMO campo do resto da aplicação (js/core/pitch.js).
    return `
      <div class="mini-pitch-block">
        <div class="mini-pitch" id="${id}">
          ${Pitch.svg()}
          <div class="mini-pitch-dot" id="${dotId}" hidden></div>
        </div>
        <div class="mini-pitch-legend ${attacksUp ? 'is-up' : 'is-down'}">
          <span class="mp-arrow">${attacksUp ? '↑' : '↓'}</span>
          <span>Ataque de <strong>${Utils.escapeHtml(teamName)}</strong></span>
        </div>
      </div>
    `;
  },

  /** Baliza vista de frente, com 9 zonas tocáveis (3×3) sobre a rede. */
  goalGraphicHTML(id) {
    const labels = {
      TL: 'Sup. esquerdo', TC: 'Sup. centro', TR: 'Sup. direito',
      ML: 'Meio esquerdo', MC: 'Meio centro', MR: 'Meio direito',
      BL: 'Inf. esquerdo', BC: 'Inf. centro', BR: 'Inf. direito',
    };
    return `
      <div class="goal-graphic" id="${id}">
        <div class="goal-frame"></div>
        <div class="goal-net">
          ${MatchStats.GOAL_ZONES.flat().map((z) => `
            <button type="button" class="goal-zone-btn" data-zone="${z}" title="${labels[z]}" aria-label="${labels[z]}"></button>
          `).join('')}
        </div>
        <div class="goal-ground"></div>
      </div>
      <p class="goal-hint">Vista de frente — toca na zona por onde a bola passou</p>
    `;
  },

  bindMiniPitch(pitchSel, dotSel, onPick) {
    const pitch = this._dlg.querySelector(pitchSel);
    const dot = this._dlg.querySelector(dotSel);
    pitch.addEventListener('click', (e) => {
      const rect = pitch.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      dot.style.left = (x * 100) + '%';
      dot.style.top = (y * 100) + '%';
      dot.hidden = false;
      onPick({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) });
    });
  },

  // ---------- Mapas (remates / faltas) ----------
  renderMap(mode) {
    this._mapMode = mode;
    const area = this._dlg.querySelector('#stats-map-area');
    if (!area) return;
    area.innerHTML = MatchStats.renderMapHTML(mode, this.live.occurrences, this.live.match.team, this.live.match.opponent);
  },
};

window.StatsPanel = StatsPanel;
