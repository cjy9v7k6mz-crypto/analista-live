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
    // Sem isto o banco continuava a contar o +1 que foi retirado.
    SyncCore.publish('occurrence', 'delete', { id: match.id });
  },

  /** Plantel anotado (em campo primeiro) do lado pedido — base das grelhas. */
  rosterFor(side) {
    return side === 'own'
      ? LineupState.annotatedRoster(this.live.match, 'own', this.live.ownPlayers)
      : LineupState.annotatedRoster(this.live.match, 'opponent', this.live.opponentPlayers);
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

  /**
   * @param {object} [extraMeta] - liga este remate a outra ocorrência que o
   * originou (canto, falta) — `fromCornerId` / `fromFoulId`. É sempre um
   * remate a mais, nunca substitui a contagem do canto/falta original.
   */
  async registerShotQuick(side, extraMeta = {}) {
    const occ = await this.live.recordOccurrence({
      eventName: 'Remate',
      category: side === 'own' ? 'nossa_equipa' : 'adversario',
      team: side, priority: 'important', source: 'remate', type: 'neutral',
      meta: { origin: null, result: null, goalZone: null, passerId: null, ...extraMeta },
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
        <p class="field-label">Quem rematou</p>
        <div id="pg-shooter"></div>
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
        <div id="shot-passer-wrap">
          <p class="field-label">Quem passou <span class="muted">(grande oportunidade criada — deixa em "n/d" se não houve passe)</span></p>
          <div id="pg-passer"></div>
          <p class="muted" id="shot-passer-note" hidden>Como o remate foi golo, este passe conta também como assistência.</p>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" id="shot-done">Concluir</button>
        </div>
      </div>
    `;

    let chosenPlayerId = (occ.playerIds || [])[0] || null;
    // Quem passou: é daqui que saem as grandes oportunidades criadas. Nem todo o
    // remate nasce de um passe (jogada individual, ressalto, livre direto), por
    // isso "n/d" resolve e o remate fica sem passador em vez de ter um inventado.
    let chosenPasserId = MatchStats.passerOf(occ);
    const roster = () => this.rosterFor(side);
    // O passador nunca é o próprio rematador — sai da grelha quando um é escolhido.
    const paintPasser = () => PlayerGrid.render(this._dlg, {
      id: 'pg-passer', players: roster(), selectedId: chosenPasserId, exclude: [chosenPlayerId].filter(Boolean),
    }, (id) => { chosenPasserId = id; });
    this._dlg.querySelector('#pg-shooter').outerHTML = PlayerGrid.html({ id: 'pg-shooter', players: roster(), selectedId: chosenPlayerId });
    PlayerGrid.bind(this._dlg, 'pg-shooter', (id) => {
      chosenPlayerId = id;
      if (id && chosenPasserId === id) chosenPasserId = null;
      paintPasser();
    });
    this._dlg.querySelector('#pg-passer').outerHTML = PlayerGrid.html({ id: 'pg-passer', players: roster(), selectedId: chosenPasserId, exclude: [chosenPlayerId].filter(Boolean) });
    PlayerGrid.bind(this._dlg, 'pg-passer', (id) => { chosenPasserId = id; });

    this.bindMiniPitch('#shot-origin-pitch', '#shot-origin-dot', (xy) => { occ.meta.origin = xy; });

    let chosenZone = null;
    this._dlg.querySelectorAll('.result-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        this._dlg.querySelectorAll('.result-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        occ.meta.result = btn.dataset.result;
        this._dlg.querySelector('#shot-goal-zone-wrap').hidden = !(occ.meta.result === 'goal' || occ.meta.result === 'save');
        this._dlg.querySelector('#shot-passer-note').hidden = occ.meta.result !== 'goal';
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
      occ.playerIds = [chosenPlayerId, chosenPasserId].filter(Boolean);
      if (chosenZone) occ.meta.goalZone = chosenZone;
      occ.meta.passerId = chosenPasserId;
      // Num golo, o passe É a assistência: a mesma pessoa, duas leituras.
      occ.meta.assistId = occ.meta.result === 'goal' ? chosenPasserId : null;
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
        <div id="pg-corner"></div>
        <p class="field-label">Resultado</p>
        <div class="result-grid">
          ${MatchStats.CORNER_RESULTS.map((r) => `<button type="button" class="btn result-btn" data-result="${r.key}">${r.label}</button>`).join('')}
        </div>
        <div id="corner-chain-wrap" hidden>
          <button type="button" class="btn btn-small btn-primary" id="corner-chain-shot">🎯 Este canto teve remate — registar</button>
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
    let chosenPlayerId = (occ.playerIds || [])[0] || null;
    this._dlg.querySelector('#pg-corner').outerHTML = PlayerGrid.html({ id: 'pg-corner', players: this.rosterFor(side), selectedId: chosenPlayerId });
    PlayerGrid.bind(this._dlg, 'pg-corner', (id) => { chosenPlayerId = id; });
    this._dlg.querySelectorAll('[data-result]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._dlg.querySelectorAll('[data-result]').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        occ.meta.result = btn.dataset.result;
        // Um canto que termina em remate ou golo passa a contar TAMBÉM como
        // remate — sem isto o resultado ficava só numa etiqueta, sem entrar
        // nas estatísticas de remates/golos.
        this._dlg.querySelector('#corner-chain-wrap').hidden = !(occ.meta.result === 'shot' || occ.meta.result === 'goal');
      });
    });
    this._dlg.querySelector('#corner-chain-shot').addEventListener('click', async () => {
      occ.playerIds = chosenPlayerId ? [chosenPlayerId] : [];
      await AppState.updateOccurrence(occ);
      this.registerShotQuick(side, { fromCornerId: occ.id });
    });
    this._dlg.querySelector('#corner-done').addEventListener('click', async () => {
      occ.playerIds = chosenPlayerId ? [chosenPlayerId] : [];
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
        <p class="field-label">Quem cometeu <span class="muted">${side === 'own' ? Utils.escapeHtml(this.live.match.team) : Utils.escapeHtml(this.live.match.opponent)}</span></p>
        <div id="pg-foul-committed"></div>
        <p class="field-label">Quem sofreu <span class="muted">${otherSide === 'own' ? Utils.escapeHtml(this.live.match.team) : Utils.escapeHtml(this.live.match.opponent)}</span></p>
        <div id="pg-foul-suffered"></div>
        <div id="foul-chain-wrap" hidden>
          <button type="button" class="btn btn-small btn-primary" id="foul-chain-shot">🎯 A falta resultou em remate — registar</button>
        </div>
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
    let committedId = occ.meta?.committedById || null;
    let sufferedId = occ.meta?.sufferedById || null;
    this._dlg.querySelector('#pg-foul-committed').outerHTML = PlayerGrid.html({ id: 'pg-foul-committed', players: this.rosterFor(side), selectedId: committedId });
    PlayerGrid.bind(this._dlg, 'pg-foul-committed', (id) => { committedId = id; });
    this._dlg.querySelector('#pg-foul-suffered').outerHTML = PlayerGrid.html({ id: 'pg-foul-suffered', players: this.rosterFor(otherSide), selectedId: sufferedId });
    PlayerGrid.bind(this._dlg, 'pg-foul-suffered', (id) => { sufferedId = id; });
    // Consequências são multi-seleção: uma falta pode dar livre + amarelo.
    const conseq = new Set();
    this._dlg.querySelectorAll('[data-conseq]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.conseq;
        if (conseq.has(k)) { conseq.delete(k); btn.classList.remove('selected'); }
        else { conseq.add(k); btn.classList.add('selected'); }
        // Um livre direto pode terminar em remate — sem isto ficava só a
        // etiqueta "Livre", sem entrar nas estatísticas de remates/golos.
        this._dlg.querySelector('#foul-chain-wrap').hidden = !conseq.has('freeKick');
      });
    });

    // Partilhado entre "Concluir" e "Registar remate" — grava o que já foi
    // preenchido sem duplicar a lógica de cartões.
    const persistFoul = async () => {
      occ.meta.consequences = [...conseq];
      // Atribuição direta (não condicional): com a grelha, tirar um jogador que
      // já estava escolhido tem de mesmo apagá-lo do registo.
      occ.meta.committedById = committedId;
      occ.meta.sufferedById = sufferedId;
      occ.playerIds = [committedId, sufferedId].filter(Boolean);
      // O cartão fica no mesmo evento e em match.cards (é daí que saem os
      // minutos jogados de um expulso). syncFoulCards é idempotente: reabrir o
      // detalhe e voltar a gravar não duplica, e tirar o cartão retira-o.
      const hadCard = (this.live.match.cards || []).some((c) => c.fromFoulId === occ.id);
      if (hadCard || conseq.has('yellow') || conseq.has('red')) {
        const p = committedId ? this.live.findPlayerById(committedId) : null;
        MatchEffects.syncFoulCards(this.live.match, occ, p ? p.name : '');
        await AppState.persistMatch();
      }
      await AppState.updateOccurrence(occ);
    };

    this._dlg.querySelector('#foul-chain-shot').addEventListener('click', async () => {
      await persistFoul();
      // O livre é batido pela equipa que sofreu a falta.
      this.registerShotQuick(otherSide, { fromFoulId: occ.id });
    });

    this._dlg.querySelector('#foul-done').addEventListener('click', async () => {
      await persistFoul();
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
        <div id="pg-keeper"></div>
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

    let keeperId = occ.meta?.keeperId || (occ.playerIds || [])[0] || null, saveType = null, shotId = null;
    this._dlg.querySelector('#pg-keeper').outerHTML = PlayerGrid.html({ id: 'pg-keeper', players: this.rosterFor(side), selectedId: keeperId });
    PlayerGrid.bind(this._dlg, 'pg-keeper', (id) => { keeperId = id; });
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
