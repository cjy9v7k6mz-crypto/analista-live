/**
 * lineupBuilder.js — Onze Inicial: escolher formação, colocar jogadores no
 * campo (com posições arrastáveis), gerir banco de suplentes, para as duas
 * equipas. Passo entre o Plano de Observação e o Painel LIVE.
 */

const LineupBuilderScreen = {
  match: null,
  activeSide: 'own', // 'own' | 'opponent'
  builder: null,      // { own: {...}, opponent: {...} } — estado de trabalho

  async render(root, params) {
    this.match = await DB.get(DB.STORES.matches, params.matchId);
    if (!this.match) { window.location.hash = '#/dashboard'; return; }

    // As equipas vêm SEMPRE do teamId guardado no jogo — nunca da "equipa própria"
    // global nem do nome — para que jogos antigos abram com as equipas corretas
    // e nunca se misturem jogadores entre plantéis.
    const ownTeam = this.match.teams?.own?.teamId
      ? await DB.get(DB.STORES.teams, this.match.teams.own.teamId)
      : await AppState.getOwnTeam();
    let opponentTeam = this.match.teams?.opponent?.teamId
      ? await DB.get(DB.STORES.teams, this.match.teams.opponent.teamId)
      : await AppState.findTeamByName(this.match.opponent);

    this.builder = {
      own: await this._buildSideState('own', ownTeam),
      opponent: opponentTeam ? await this._buildSideState('opponent', opponentTeam) : null,
    };

    root.innerHTML = `
      <div class="screen lineup-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/plan/${this.match.id}" aria-label="Voltar">←</button>
          <h1>Onze Inicial</h1>
          <button class="btn btn-primary" id="btn-goto-live">Iniciar Jogo →</button>
        </header>

        <nav class="cat-tabs lineup-tabs">
          <button class="cat-tab ${this.activeSide === 'own' ? 'active' : ''}" data-side="own">${Utils.escapeHtml(ownTeam.name)}</button>
          <button class="cat-tab ${this.activeSide === 'opponent' ? 'active' : ''}" data-side="opponent">${Utils.escapeHtml(this.match.opponent)}</button>
        </nav>

        <div id="lineup-side-content"></div>
      </div>

      <dialog id="dlg-link-opponent" class="dialog">
        <div class="dialog-card">
          <h3>Associar Equipa Adversária</h3>
          <p class="muted">Este jogo ainda não tem uma equipa/plantel associado a "${Utils.escapeHtml(this.match.opponent)}".</p>
          <div id="existing-teams-list" class="choose-plan-list"></div>
          <button class="btn btn-primary btn-block" id="btn-create-opponent-team">＋ Criar equipa "${Utils.escapeHtml(this.match.opponent)}"</button>
          <div class="dialog-actions"><button type="button" class="btn" id="cancel-link-opponent">Fechar</button></div>
        </div>
      </dialog>

      <dialog id="dlg-quick-add-player" class="dialog">
        <form id="form-quick-add-player" class="dialog-card">
          <h3>Adicionar Jogador Rápido</h3>
          <label class="field"><span>Nome</span><input name="name" required autofocus></label>
          <div class="field-row">
            <label class="field"><span>Número</span><input name="number" type="number" min="1" max="99"></label>
            <label class="field"><span>Posição</span>
              <select name="position">
                <option value="GR">GR</option><option value="DC">DC</option><option value="DD">DD</option>
                <option value="DE">DE</option><option value="MDC">MDC</option><option value="MC">MC</option>
                <option value="MCO">MCO</option><option value="ED">ED</option><option value="EE">EE</option>
                <option value="PL">PL</option>
              </select>
            </label>
          </div>
          <p class="muted">Podes adicionar foto mais tarde em Equipas.</p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-quick-add-player">Cancelar</button>
            <button type="submit" class="btn btn-primary">Adicionar ao plantel</button>
          </div>
        </form>
      </dialog>
    `;

    this.renderSide();
    this.bindGlobalEvents();
  },

  async _buildSideState(side, team) {
    const existing = this.match.teams?.[side];
    const players = await AppState.getTeamPlayers(team.id);
    const formationId = existing?.formationId || 'f-433';
    const preset = getFormationPreset(formationId);
    let slots;
    if (existing?.positions?.length === preset.slots.length) {
      slots = existing.positions;
    } else {
      slots = preset.slots.map((s) => ({ ...s, playerId: null }));
    }
    return { team, players, formationId, slots };
  },

  renderSide() {
    const container = document.getElementById('lineup-side-content');
    const state = this.builder[this.activeSide];

    if (!state) {
      container.innerHTML = `
        <div class="plan-quickstart">
          <p class="muted">Associa uma equipa adversária para definires o onze inicial.</p>
          <button class="btn btn-primary" id="btn-open-link-opponent">Associar Equipa</button>
        </div>`;
      document.getElementById('btn-open-link-opponent').addEventListener('click', () => this.openLinkOpponentDialog());
      return;
    }

    const assignedIds = new Set(state.slots.map((s) => s.playerId).filter(Boolean));
    const bench = state.players.filter((p) => !assignedIds.has(p.id));

    container.innerHTML = `
      <div class="lineup-layout">
        <div class="lineup-pitch-col">
          <div class="lineup-controls">
            <select id="formation-select">
              ${FORMATION_PRESETS.map((f) => `<option value="${f.id}" ${f.id === state.formationId ? 'selected' : ''}>${f.name}</option>`).join('')}
            </select>
            <button class="btn btn-small" id="btn-save-formation">Guardar Formação</button>
          </div>
          <div class="pitch" id="pitch">
            <div class="pitch-markings">
              <div class="pitch-line-half"></div>
              <div class="pitch-circle"></div>
              <div class="pitch-box pitch-box-top"></div>
              <div class="pitch-box pitch-box-bottom"></div>
            </div>
            ${state.slots.map((s, idx) => this.slotTemplate(s, idx, state)).join('')}
          </div>
          <p class="muted lineup-hint">Toca num lugar para escolher o jogador · arrasta para ajustar a posição tática.</p>
        </div>

        <div class="lineup-bench-col">
          <div class="lineup-bench-head">
            <h3>Suplentes / Plantel (${bench.length})</h3>
            <button class="btn btn-tiny" id="btn-quick-add-player">＋ Jogador</button>
          </div>
          <div class="bench-list" id="bench-list">
            ${bench.length ? bench.map((p) => `
              <div class="bench-chip">
                ${playerAvatar(p, 'sm')}
                <span>${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.shortName || p.name)}</span>
              </div>
            `).join('') : (state.players.length === 0
              ? '<p class="muted">Este plantel ainda não tem jogadores.</p>'
              : '<p class="muted">Todos os jogadores do plantel estão em campo.</p>')}
          </div>
        </div>
      </div>
    `;

    this.bindSideEvents();
  },

  slotTemplate(slot, idx, state) {
    const player = state.players.find((p) => p.id === slot.playerId);
    return `
      <div class="pitch-slot" data-idx="${idx}" style="left:${slot.x}%; top:${100 - slot.y}%">
        ${player ? `
          <button class="slot-token filled" data-idx="${idx}">
            ${playerAvatar(player, 'sm')}
            <span class="slot-token-name">${Utils.escapeHtml(player.shortName || player.name)}</span>
            ${player.number ? `<span class="slot-token-num">${player.number}</span>` : ''}
          </button>
        ` : `
          <button class="slot-token empty" data-idx="${idx}">
            <span class="slot-token-role">${slot.role}</span>
          </button>
        `}
      </div>
    `;
  },

  bindSideEvents() {
    const state = this.builder[this.activeSide];
    const pitch = document.getElementById('pitch');

    document.getElementById('formation-select').addEventListener('change', (e) => {
      const preset = getFormationPreset(e.target.value);
      state.formationId = preset.id;
      state.slots = preset.slots.map((s) => ({ ...s, playerId: null }));
      this.renderSide();
    });

    document.getElementById('btn-save-formation').addEventListener('click', async () => {
      const name = prompt('Nome para esta formação (para reutilizar noutros jogos):', getFormationPreset(state.formationId).name + ' habitual');
      if (!name) return;
      const formation = {
        id: Utils.uid('formation'),
        teamId: state.team.id,
        name: name.trim(),
        baseFormationId: state.formationId,
        slots: state.slots.map(({ x, y, role }) => ({ x, y, role })),
        pitchOrientationV2: true, // já na convenção correta — não deve ser invertida pela migração
        createdAt: Date.now(),
      };
      await DB.put(DB.STORES.formations, formation);
      toast('Formação guardada');
    });

    document.getElementById('btn-quick-add-player').addEventListener('click', () => {
      document.getElementById('dlg-quick-add-player').showModal();
    });

    // Tap num lugar do campo → abrir seletor de jogador para esse lugar
    pitch.querySelectorAll('.slot-token').forEach((btn) => {
      this._attachSlotInteraction(btn, pitch, state);
    });
  },

  _attachSlotInteraction(btn, pitch, state) {
    const idx = Number(btn.dataset.idx);
    const wrapper = btn.closest('.pitch-slot');
    let startX, startY, startLeft, startTop, dragging = false;

    const onPointerDown = (e) => {
      btn.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
      startLeft = state.slots[idx].x; startTop = state.slots[idx].y;
      dragging = false;
    };
    const onPointerMove = (e) => {
      if (startX === undefined) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) dragging = true;
      if (dragging) {
        const rect = pitch.getBoundingClientRect();
        let newX = startLeft + (dx / rect.width) * 100;
        let newY = startTop - (dy / rect.height) * 100;
        newX = Math.max(3, Math.min(97, newX));
        newY = Math.max(3, Math.min(97, newY));
        state.slots[idx].x = newX;
        state.slots[idx].y = newY;
        wrapper.style.left = newX + '%';
        wrapper.style.top = (100 - newY) + '%';
      }
    };
    const onPointerUp = async (e) => {
      btn.releasePointerCapture(e.pointerId);
      if (!dragging) {
        await this.openSlotPicker(idx, state);
      }
      startX = undefined;
      dragging = false;
    };

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointerup', onPointerUp);
  },

  async openSlotPicker(idx, state) {
    const assignedIds = new Set(state.slots.map((s) => s.playerId).filter(Boolean));
    const currentPlayerId = state.slots[idx].playerId;
    const available = state.players.filter((p) => !assignedIds.has(p.id) || p.id === currentPlayerId);

    const result = await PlayerPicker.open({
      title: `Lugar: ${state.slots[idx].role}`,
      groups: [{ label: state.team.name, players: available }],
      multi: false,
    });
    if (!result) return; // cancelado
    if (result.players.length === 0) {
      state.slots[idx].playerId = null; // "Desconhecido" = liberta o lugar
    } else {
      state.slots[idx].playerId = result.players[0].id;
    }
    this.renderSide();
  },

  openLinkOpponentDialog() {
    document.getElementById('dlg-link-opponent')?.showModal();
  },

  bindGlobalEvents() {
    document.querySelectorAll('.lineup-tabs [data-side]').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.activeSide = tab.dataset.side;
        document.querySelectorAll('.lineup-tabs .cat-tab').forEach((t) => t.classList.toggle('active', t === tab));
        this.renderSide();
      });
    });

    // Associar equipa adversária (se ainda não existir)
    const dlgLink = document.getElementById('dlg-link-opponent');
    (async () => {
      const otherTeams = (await DB.getAll(DB.STORES.teams)).filter((t) => !t.isOwnTeam);
      document.getElementById('existing-teams-list').innerHTML = otherTeams.length
        ? otherTeams.map((t) => `<button class="choose-plan-item" data-link-team="${t.id}"><strong>${Utils.escapeHtml(t.name)}</strong></button>`).join('')
        : '<p class="muted">Ainda não existem outras equipas guardadas.</p>';
      document.getElementById('existing-teams-list').onclick = async (e) => {
        const b = e.target.closest('[data-link-team]');
        if (!b) return;
        const team = otherTeams.find((t) => t.id === b.dataset.linkTeam);
        this.match.teams.opponent.teamId = team.id;
        await DB.put(DB.STORES.matches, this.match);
        dlgLink.close();
        this.builder.opponent = await this._buildSideState('opponent', team);
        this.renderSide();
      };
    })();

    document.getElementById('btn-create-opponent-team').addEventListener('click', async () => {
      const team = {
        id: Utils.uid('team'), name: this.match.opponent, abbreviation: '', logo: null,
        colorPrimary: '#e5555c', colorSecondary: '#12161f', isOwnTeam: false, createdAt: Date.now(),
      };
      await DB.put(DB.STORES.teams, team);
      this.match.teams = this.match.teams || {};
      this.match.teams.opponent = { teamId: team.id, formationId: null, positions: [], starterIds: [], subIds: [], pitchOrientationV2: true };
      await DB.put(DB.STORES.matches, this.match);
      dlgLink.close();
      this.builder.opponent = await this._buildSideState('opponent', team);
      this.renderSide();
    });
    document.getElementById('cancel-link-opponent').addEventListener('click', () => dlgLink.close());

    // Adicionar jogador rápido ao plantel ativo
    const dlgQuick = document.getElementById('dlg-quick-add-player');
    document.getElementById('cancel-quick-add-player').addEventListener('click', () => dlgQuick.close());
    document.getElementById('form-quick-add-player').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const state = this.builder[this.activeSide];
      const player = {
        id: Utils.uid('player'), teamId: state.team.id,
        name: fd.get('name').trim(),
        shortName: fd.get('name').trim().split(' ').slice(-1)[0],
        number: Number(fd.get('number')) || null,
        position: fd.get('position'), starter: false, status: 'unused', photo: null, active: true,
      };
      await DB.put(DB.STORES.players, player);
      state.players.push(player);
      dlgQuick.close();
      e.target.reset();
      this.renderSide();
      toast('Jogador adicionado ao plantel');
    });

    // Iniciar jogo — nunca bloqueia: o onze inicial é uma ajuda opcional, não um
    // requisito. Se a equipa adversária não foi associada, o jogo arranca à mesma
    // (o painel de equipa no LIVE mostra "onze ainda não definido" nesse caso).
    document.getElementById('btn-goto-live').addEventListener('click', async () => {
      this.match.teams = {
        own: this._sideToMatchData('own'),
        opponent: this.builder.opponent ? this._sideToMatchData('opponent') : (this.match.teams?.opponent || { teamId: null, formationId: null, positions: [], starterIds: [], subIds: [], pitchOrientationV2: true }),
      };
      this.match.lineupConfirmed = true;
      this.match.status = 'in_progress';
      this.match.updatedAt = Date.now();
      await DB.put(DB.STORES.matches, this.match);
      window.location.hash = `#/live/${this.match.id}`;
    });
  },

  _sideToMatchData(side) {
    const state = this.builder[side];
    const starterIds = state.slots.map((s) => s.playerId).filter(Boolean);
    const subIds = state.players.filter((p) => !starterIds.includes(p.id)).map((p) => p.id);
    return {
      teamId: state.team.id,
      formationId: state.formationId,
      positions: state.slots.map((s) => ({ x: s.x, y: s.y, role: s.role, playerId: s.playerId })),
      starterIds,
      subIds,
      pitchOrientationV2: true, // já na convenção correta — não deve ser invertido pela migração
    };
  },
};

window.LineupBuilderScreen = LineupBuilderScreen;
