/**
 * newGame.js — Criação de jogo com seleção visual de equipas.
 *
 * MUDANÇA PRINCIPAL desta fase: a nossa equipa e o adversário deixam de ser
 * texto livre e passam a ser ENTIDADES reais da base de dados, referenciadas
 * por `teamId`. O nome continua a ser guardado (match.team / match.opponent)
 * para compatibilidade com todos os ecrãs já existentes, mas a fonte de
 * verdade é o id.
 *
 * Fluxo: escolher equipas (cards) -> confirmar -> [plano anterior] -> plano.
 */

const NewGameScreen = {
  teams: [],
  ownTeamId: null,
  opponentTeamId: null,
  step: 'select', // 'select' | 'confirm'
  pickerFor: null, // 'own' | 'opponent' quando o seletor está aberto
  search: '',
  draft: null,

  async render(root) {
    this.teams = await AppState.getAllTeams();
    const own = this.teams.find((t) => t.isOwnTeam);
    this.ownTeamId = own ? own.id : null;
    this.opponentTeamId = null;
    this.step = 'select';
    // Limpa estado de uma visita anterior (o ecrã é um singleton reutilizado).
    this.draft = null;
    this.search = '';
    this.pickerFor = null;

    root.innerHTML = `
      <div class="screen newgame-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Novo Jogo</h1>
          <span></span>
        </header>
        <div id="newgame-body"></div>
      </div>

      <dialog id="dlg-team-picker" class="dialog dialog-wide">
        <div class="dialog-card">
          <div class="stats-head">
            <h3 id="team-picker-title">Selecionar Equipa</h3>
            <button type="button" class="icon-btn" id="tp-close">✕</button>
          </div>
          <input type="search" id="tp-search" placeholder="Pesquisar equipa...">
          <div id="tp-grid" class="team-pick-grid"></div>
          <button class="btn btn-dashed btn-block" id="tp-create">＋ Criar nova equipa</button>
        </div>
      </dialog>

      <dialog id="dlg-create-team" class="dialog">
        <form id="form-create-team" class="dialog-card">
          <h3>Nova Equipa</h3>
          <label class="field"><span>Nome</span><input name="name" required autofocus placeholder="Ex: Pevidém SC"></label>
          <label class="field"><span>Abreviatura</span><input name="abbreviation" maxlength="4" placeholder="Ex: PEV"></label>
          <div class="field-row">
            <label class="field"><span>Cor principal</span><input type="color" name="colorPrimary" value="#e5555c"></label>
            <label class="field"><span>Cor secundária</span><input type="color" name="colorSecondary" value="#12161f"></label>
          </div>
          <p class="muted">Podes adicionar logótipo e plantel depois, em Equipas.</p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="ct-cancel">Cancelar</button>
            <button type="submit" class="btn btn-primary">Criar e selecionar</button>
          </div>
        </form>
      </dialog>
    `;

    await this.renderStep();
    this.bindGlobal();
  },

  async renderStep() {
    if (this.step === 'confirm') return this.renderConfirm();
    return this.renderSelect();
  },

  teamById(id) { return this.teams.find((t) => t.id === id) || null; },

  async playerCount(teamId) {
    if (!teamId) return 0;
    return (await AppState.getTeamPlayers(teamId)).length;
  },

  async renderSelect() {
    const body = document.getElementById('newgame-body');
    const own = this.teamById(this.ownTeamId);
    const opp = this.teamById(this.opponentTeamId);
    const ownPlayers = await this.playerCount(this.ownTeamId);
    const oppPlayers = await this.playerCount(this.opponentTeamId);

    // Contexto do adversário: perfil e último jogo (sem obrigar a sair do fluxo)
    let oppContext = '';
    if (opp) {
      const matches = (await DB.getAll(DB.STORES.matches))
        .filter((m) => m.teams?.opponent?.teamId === opp.id || m.opponent === opp.name)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const last = matches[0];
      const hasProfile = !!(opp.profile && Object.values(opp.profile).some((v) => v && String(v).trim()));
      if (last || hasProfile) {
        oppContext = `
          <div class="ng-context">
            ${hasProfile ? '<span class="ng-context-badge">📋 Perfil de scouting disponível</span>' : ''}
            ${last ? `<span class="ng-context-badge">🕓 Último jogo: ${Utils.formatDate(last.date)} · ${last.score?.team ?? 0}-${last.score?.opponent ?? 0}</span>` : ''}
            <button class="btn btn-tiny" data-nav="#/team/${opp.id}">Ver perfil</button>
          </div>`;
      }
    }

    body.innerHTML = `
      <p class="screen-subtitle">Escolhe as duas equipas. Os plantéis são carregados automaticamente.</p>

      <div class="ng-teams">
        ${this.teamSlotHTML('own', 'A NOSSA EQUIPA', own, ownPlayers)}
        <div class="ng-vs">VS</div>
        ${this.teamSlotHTML('opponent', 'ADVERSÁRIO', opp, oppPlayers)}
      </div>
      ${oppContext}

      <div class="form-card ng-details">
        <div class="field-row">
          <label class="field"><span>Competição</span><input id="ng-competition" placeholder="Ex: Divisão de Honra"></label>
          <label class="field"><span>Casa / Fora</span>
            <select id="ng-venue"><option value="home">Casa</option><option value="away">Fora</option></select>
          </label>
        </div>
        <div class="field-row">
          <label class="field"><span>Data</span><input type="date" id="ng-date" value="${Utils.todayISO()}"></label>
          <label class="field"><span>Hora</span><input type="time" id="ng-time"></label>
        </div>
        <label class="field"><span>Observador</span><input id="ng-observer" value="${Utils.escapeHtml(AppState.settings?.analystName || '')}"></label>
        <label class="field"><span>Notas pré-jogo</span><textarea id="ng-notes" rows="2" placeholder="Ideias, alertas táticos..."></textarea></label>
      </div>

      <p class="ng-error" id="ng-error" hidden></p>
      <button class="btn btn-primary btn-block btn-lg" id="ng-continue">Continuar →</button>
    `;

    body.querySelectorAll('[data-pick-team]').forEach((el) => {
      el.addEventListener('click', () => this.openTeamPicker(el.dataset.pickTeam));
    });
    document.getElementById('ng-continue').addEventListener('click', () => this.goConfirm());
  },

  teamSlotHTML(side, label, team, playerCount) {
    if (!team) {
      return `
        <button class="ng-team-slot is-empty" data-pick-team="${side}">
          <span class="ng-slot-label">${label}</span>
          <span class="ng-slot-plus">＋</span>
          <span class="ng-slot-hint">Selecionar equipa</span>
        </button>`;
    }
    return `
      <button class="ng-team-slot" data-pick-team="${side}" style="--team-color:${team.colorPrimary || '#5b93f0'}">
        <span class="ng-slot-label">${label}</span>
        ${teamBadge(team)}
        <strong class="ng-slot-name">${Utils.escapeHtml(team.name)}</strong>
        <span class="ng-slot-hint">${playerCount} jogador${playerCount === 1 ? '' : 'es'} · tocar para mudar</span>
      </button>`;
  },

  // ---------- Seletor visual de equipas ----------
  openTeamPicker(side) {
    this.pickerFor = side;
    this.search = '';
    const dlg = document.getElementById('dlg-team-picker');
    document.getElementById('team-picker-title').textContent = side === 'own' ? 'A Nossa Equipa' : 'Adversário';
    document.getElementById('tp-search').value = '';
    this.renderPickerGrid();
    dlg.showModal();
  },

  renderPickerGrid() {
    const grid = document.getElementById('tp-grid');
    const term = this.search.toLowerCase();
    // Impede escolher a mesma equipa dos dois lados (validação pedida).
    const blockedId = this.pickerFor === 'own' ? this.opponentTeamId : this.ownTeamId;
    const list = this.teams
      .filter((t) => !term || t.name.toLowerCase().includes(term) || (t.abbreviation || '').toLowerCase().includes(term))
      .sort((a, b) => (b.isOwnTeam ? 1 : 0) - (a.isOwnTeam ? 1 : 0) || a.name.localeCompare(b.name));

    grid.innerHTML = list.length ? list.map((t) => {
      const blocked = t.id === blockedId;
      return `
        <button class="team-pick-card ${blocked ? 'is-blocked' : ''}" data-team="${t.id}" ${blocked ? 'disabled title="Já está selecionada do outro lado"' : ''}>
          ${teamBadge(t)}
          <strong>${Utils.escapeHtml(t.name)}</strong>
          <span class="muted">${t.abbreviation ? Utils.escapeHtml(t.abbreviation) : (t.isOwnTeam ? 'A nossa equipa' : '')}</span>
        </button>`;
    }).join('') : '<p class="muted">Nenhuma equipa encontrada.</p>';

    grid.querySelectorAll('[data-team]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (this.pickerFor === 'own') this.ownTeamId = btn.dataset.team;
        else this.opponentTeamId = btn.dataset.team;
        document.getElementById('dlg-team-picker').close();
        await this.renderStep();
      });
    });
  },

  bindGlobal() {
    const dlgPicker = document.getElementById('dlg-team-picker');
    const dlgCreate = document.getElementById('dlg-create-team');

    document.getElementById('tp-close').addEventListener('click', () => dlgPicker.close());
    document.getElementById('tp-search').addEventListener('input', (e) => {
      this.search = e.target.value;
      this.renderPickerGrid();
    });
    document.getElementById('tp-create').addEventListener('click', () => {
      dlgPicker.close();
      dlgCreate.showModal();
    });
    document.getElementById('ct-cancel').addEventListener('click', () => {
      dlgCreate.close();
      dlgPicker.showModal();
    });

    // Criar equipa sem sair do fluxo: cria, guarda e seleciona automaticamente.
    document.getElementById('form-create-team').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const team = {
        id: Utils.uid('team'),
        name: fd.get('name').trim(),
        abbreviation: (fd.get('abbreviation') || '').trim().toUpperCase(),
        logo: null,
        colorPrimary: fd.get('colorPrimary'),
        colorSecondary: fd.get('colorSecondary'),
        isOwnTeam: false,
        createdAt: Date.now(),
      };
      await DB.put(DB.STORES.teams, team);
      this.teams.push(team);
      if (this.pickerFor === 'own') this.ownTeamId = team.id; else this.opponentTeamId = team.id;
      dlgCreate.close();
      e.target.reset();
      await this.renderStep();
      toast('Equipa criada e selecionada');
    });
  },

  // ---------- Confirmação ----------
  showError(msg) {
    const el = document.getElementById('ng-error');
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.hidden = false;
    el.scrollIntoView({ block: 'nearest' });
  },

  goConfirm() {
    if (!this.ownTeamId) return this.showError('Escolhe a nossa equipa para continuar.');
    if (!this.opponentTeamId) return this.showError('Escolhe a equipa adversária para continuar.');
    if (this.ownTeamId === this.opponentTeamId) return this.showError('A nossa equipa e o adversário não podem ser a mesma equipa.');

    this.draft = {
      competition: document.getElementById('ng-competition').value.trim(),
      venue: document.getElementById('ng-venue').value,
      date: document.getElementById('ng-date').value || Utils.todayISO(),
      time: document.getElementById('ng-time').value || '',
      observer: document.getElementById('ng-observer').value.trim(),
      preNotes: document.getElementById('ng-notes').value.trim(),
    };
    this.step = 'confirm';
    this.renderStep();
  },

  async renderConfirm() {
    const body = document.getElementById('newgame-body');
    const own = this.teamById(this.ownTeamId);
    const opp = this.teamById(this.opponentTeamId);
    const ownPlayers = await AppState.getTeamPlayers(this.ownTeamId);
    const oppPlayers = await AppState.getTeamPlayers(this.opponentTeamId);
    const d = this.draft;

    body.innerHTML = `
      <h2 class="section-title center">Confirmar Jogo</h2>
      <div class="confirm-card">
        <div class="confirm-teams">
          <div class="confirm-team">
            ${teamBadge(own)}
            <strong>${Utils.escapeHtml(own.name)}</strong>
            <span class="muted">${ownPlayers.length} jogadores</span>
          </div>
          <span class="confirm-vs">VS</span>
          <div class="confirm-team">
            ${teamBadge(opp)}
            <strong>${Utils.escapeHtml(opp.name)}</strong>
            <span class="muted">${oppPlayers.length} jogadores</span>
          </div>
        </div>
        <table class="confirm-table">
          <tr><td class="muted">Competição</td><td>${Utils.escapeHtml(d.competition || '—')}</td></tr>
          <tr><td class="muted">Casa / Fora</td><td>${d.venue === 'home' ? 'Casa' : 'Fora'}</td></tr>
          <tr><td class="muted">Data</td><td>${Utils.formatDate(d.date)}${d.time ? ' · ' + d.time : ''}</td></tr>
          <tr><td class="muted">Observador</td><td>${Utils.escapeHtml(d.observer || '—')}</td></tr>
          <tr><td class="muted">Plano de observação</td><td>Por definir (passo seguinte)</td></tr>
          <tr><td class="muted">Onze inicial</td><td>Por definir</td></tr>
        </table>
        ${(ownPlayers.length === 0 || oppPlayers.length === 0) ? `
          <p class="ng-warning">⚠️ ${Utils.escapeHtml(ownPlayers.length === 0 ? own.name : opp.name)} ainda não tem jogadores no plantel. Podes continuar e adicioná-los depois, mas não poderás definir o onze inicial dessa equipa.</p>
        ` : ''}
      </div>
      <div class="halftime-actions">
        <button class="btn" id="ng-back">← Editar</button>
        <button class="btn btn-primary btn-lg" id="ng-create">Continuar →</button>
      </div>
    `;

    document.getElementById('ng-back').addEventListener('click', () => { this.step = 'select'; this.renderStep(); });
    document.getElementById('ng-create').addEventListener('click', () => this.createMatch(own, opp, ownPlayers, oppPlayers));
  },

  /**
   * Snapshot da equipa no momento do jogo. Preserva o histórico: se o plantel
   * ou o logótipo mudarem daqui a três meses, este jogo continua a mostrar o
   * que era verdade no dia. O teamId original é mantido para poder ligar ao
   * perfil atual quando isso for útil.
   */
  buildSnapshot(team, players) {
    return {
      teamId: team.id,
      name: team.name,
      abbreviation: team.abbreviation || '',
      logo: team.logo || null,
      colorPrimary: team.colorPrimary || null,
      colorSecondary: team.colorSecondary || null,
      players: players.map((p) => ({
        id: p.id, name: p.name, shortName: p.shortName, number: p.number,
        position: p.position, secondaryPosition: p.secondaryPosition || '',
        dominantFoot: p.dominantFoot || '', captain: !!p.captain, photo: p.photo || null,
      })),
      capturedAt: Date.now(),
    };
  },

  async createMatch(own, opp, ownPlayers, oppPlayers) {
    const d = this.draft;
    const match = {
      id: Utils.uid('match'),
      team: own.name,          // nome mantido para compatibilidade com os ecrãs existentes
      opponent: opp.name,
      competition: d.competition,
      venue: d.venue,
      date: d.date,
      time: d.time,
      observer: d.observer,
      preNotes: d.preNotes,
      status: 'draft',
      score: { team: 0, opponent: 0 },
      currentPeriod: PERIODS.NOT_STARTED,
      observationPlan: [],
      focusEventIds: [],
      notes: [], interventions: [], moments: [], substitutions: [], cards: [], lineup: [],
      teams: {
        own: { teamId: own.id, formationId: null, positions: [], starterIds: [], subIds: [], pitchOrientationV2: true },
        opponent: { teamId: opp.id, formationId: null, positions: [], starterIds: [], subIds: [], pitchOrientationV2: true },
      },
      teamSnapshot: {
        own: this.buildSnapshot(own, ownPlayers),
        opponent: this.buildSnapshot(opp, oppPlayers),
      },
      lineupConfirmed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await DB.put(DB.STORES.matches, match);

    this.opponentTeamId = null;
    this.step = 'select';

    const previous = await this.findPreviousPlan(opp.id, match.id);
    if (previous) {
      this.offerPreviousPlan(match, previous);
    } else {
      window.location.hash = `#/plan/${match.id}`;
    }
  },

  /** Procura o jogo mais recente contra o mesmo adversário que tenha plano definido. */
  async findPreviousPlan(opponentTeamId, excludeMatchId) {
    const all = await DB.getAll(DB.STORES.matches);
    const candidates = all
      .filter((m) => m.id !== excludeMatchId)
      .filter((m) => m.teams?.opponent?.teamId === opponentTeamId)
      .filter((m) => Array.isArray(m.observationPlan) && m.observationPlan.length > 0)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    return candidates[0] || null;
  },

  async offerPreviousPlan(match, previous) {
    const occ = await AppState.getOccurrences(previous.id);
    const focos = previous.observationPlan.filter((e) => e.isFocus);
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.id = 'dlg-previous-plan';
    dlg.innerHTML = `
      <div class="dialog-card">
        <h3>Foi encontrado um plano anterior</h3>
        <p class="muted">Contra ${Utils.escapeHtml(previous.opponent)} · ${Utils.formatDate(previous.date)} · resultado ${previous.score?.team ?? 0}-${previous.score?.opponent ?? 0}</p>
        <table class="confirm-table">
          <tr><td class="muted">Eventos no plano</td><td>${previous.observationPlan.length}</td></tr>
          <tr><td class="muted">Focos definidos</td><td>${focos.length}</td></tr>
          <tr><td class="muted">Registos nesse jogo</td><td>${occ.length}</td></tr>
        </table>
        ${focos.length ? `<p class="muted">Principais focos: ${focos.slice(0, 6).map((f) => Utils.escapeHtml(f.name)).join(' · ')}</p>` : ''}
        <div class="dialog-actions">
          <button type="button" class="btn" id="pp-scratch">Começar do zero</button>
          <button type="button" class="btn btn-primary" id="pp-reuse">Utilizar plano anterior</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.showModal();

    document.getElementById('pp-scratch').addEventListener('click', () => {
      dlg.close(); dlg.remove();
      window.location.hash = `#/plan/${match.id}`;
    });
    document.getElementById('pp-reuse').addEventListener('click', async () => {
      // CÓPIA independente — o jogo anterior nunca é alterado.
      match.observationPlan = previous.observationPlan.map((e) => ({ ...e, id: Utils.uid('pe') }));
      match.updatedAt = Date.now();
      await DB.put(DB.STORES.matches, match);
      dlg.close(); dlg.remove();
      toast('Plano anterior copiado');
      window.location.hash = `#/plan/${match.id}`;
    });
  },
};

window.NewGameScreen = NewGameScreen;
