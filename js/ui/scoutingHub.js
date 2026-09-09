/**
 * scoutingHub.js — Página principal do Scouting.
 *
 * Base de conhecimento dos adversários: mostra todos os clubes com dossier,
 * independentemente de existir ou não um jogo criado contra eles. Um clube
 * pode ser criado aqui e só mais tarde ser usado num jogo.
 */

const ScoutingHubScreen = {
  teams: [],
  matchesByTeam: {},
  search: '',
  sort: 'recent', // recent | alpha | favorites | analysed

  SORTS: [
    { id: 'recent', label: 'Mais recentes' },
    { id: 'alpha', label: 'A-Z' },
    { id: 'favorites', label: 'Favoritos' },
    { id: 'analysed', label: 'Mais analisados' },
  ],

  async render(root) {
    await this.load();
    root.innerHTML = `
      <div class="screen scouting-hub">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>🎯 Scouting</h1>
          <button class="btn btn-primary" id="sh-add">＋ Adicionar Clube</button>
        </header>
        <p class="screen-subtitle">Dossiers permanentes dos adversários. Existem independentemente dos jogos.</p>

        <div class="sh-toolbar">
          <input type="search" id="sh-search" class="sc-search" placeholder="Pesquisar por nome ou abreviatura..." value="${Utils.escapeHtml(this.search)}">
          <div class="sh-sorts">
            ${this.SORTS.map((s) => `<button class="cat-tab ${this.sort === s.id ? 'active' : ''}" data-sort="${s.id}">${s.label}</button>`).join('')}
          </div>
        </div>

        <div id="sh-grid" class="sh-grid"></div>
      </div>

      <dialog id="dlg-sh-new" class="dialog">
        <form id="form-sh-new" class="dialog-card">
          <h3>Novo Clube no Scouting</h3>
          <div class="sh-logo-row">
            <div class="team-badge team-badge-placeholder" id="sh-logo-preview" style="background:#e5555c">?</div>
            <label class="btn btn-small btn-file">Carregar logo<input type="file" id="sh-logo-input" accept="image/png,image/jpeg,image/webp" hidden></label>
          </div>
          <label class="field"><span>Nome</span><input name="name" required autofocus placeholder="Ex: Pevidém SC"></label>
          <label class="field"><span>Abreviatura</span><input name="abbreviation" maxlength="4" placeholder="PEV"></label>
          <div class="field-row">
            <label class="field"><span>Cor principal</span><input type="color" name="colorPrimary" value="#e5555c"></label>
            <label class="field"><span>Cor secundária</span><input type="color" name="colorSecondary" value="#12161f"></label>
          </div>
          <label class="field"><span>Notas iniciais</span><textarea name="notes" rows="3" placeholder="Primeiras impressões, contexto..."></textarea></label>
          <div class="dialog-actions">
            <button type="button" class="btn" id="sh-cancel">Cancelar</button>
            <button type="submit" class="btn btn-primary">Criar dossier</button>
          </div>
        </form>
      </dialog>
    `;

    this.renderGrid();
    this.bind();
  },

  async load() {
    const all = await AppState.getAllTeams();
    this.teams = all.filter((t) => !t.isOwnTeam);
    const matches = await DB.getAll(DB.STORES.matches);
    this.matchesByTeam = {};
    matches.forEach((m) => {
      const id = m.teams?.opponent?.teamId;
      if (id) (this.matchesByTeam[id] = this.matchesByTeam[id] || []).push(m);
    });
  },

  /** Quantas secções do dossier já têm conteúdo — dá a noção de "o que falta". */
  completeness(team) {
    const p = team.profile || {};
    const sc = team.scouting || {};
    const checks = [
      SCOUTING_SECTIONS.some((s) => s.fields.some((f) => p[f.key] && String(p[f.key]).trim())),
      (sc.strengths || []).length > 0,
      (sc.weaknesses || []).length > 0,
      (sc.threats || []).length > 0,
      (sc.opportunities || []).length > 0,
      (sc.triggers || []).length > 0,
      (sc.keyPlayers || []).length > 0,
      (sc.setPieces || []).length > 0,
      (sc.notes || []).length > 0,
    ];
    return { done: checks.filter(Boolean).length, total: checks.length };
  },

  renderGrid() {
    const grid = document.getElementById('sh-grid');
    const term = this.search.toLowerCase();
    let list = this.teams.filter((t) =>
      !term || t.name.toLowerCase().includes(term) || (t.abbreviation || '').toLowerCase().includes(term));

    const analysed = (t) => (this.matchesByTeam[t.id] || []).length;
    if (this.sort === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (this.sort === 'favorites') list.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.name.localeCompare(b.name));
    else if (this.sort === 'analysed') list.sort((a, b) => analysed(b) - analysed(a) || a.name.localeCompare(b.name));
    else list.sort((a, b) => (b.scoutingUpdatedAt || 0) - (a.scoutingUpdatedAt || 0));

    if (!list.length) {
      grid.innerHTML = `<div class="empty-state">
        <p>${this.teams.length ? 'Nenhum clube encontrado nesta pesquisa.' : 'Ainda não tens clubes no scouting.'}</p>
        <p class="muted">Cria um dossier com "＋ Adicionar Clube" — não precisas de ter um jogo criado.</p>
      </div>`;
      return;
    }

    grid.innerHTML = list.map((t) => {
      const games = analysed(t);
      const c = this.completeness(t);
      return `
        <div class="sh-card" data-open="${t.id}">
          <button class="sh-fav ${t.favorite ? 'is-fav' : ''}" data-fav="${t.id}" title="Marcar como favorito">${t.favorite ? '⭐' : '☆'}</button>
          <div class="sh-card-logo">${teamBadge(t)}</div>
          <strong class="sh-card-name">${Utils.escapeHtml(t.name)}</strong>
          ${t.abbreviation ? `<span class="sc-badge">${Utils.escapeHtml(t.abbreviation)}</span>` : ''}
          <div class="sh-card-meta">
            <span class="muted">${games} jogo${games === 1 ? '' : 's'} analisado${games === 1 ? '' : 's'}</span>
            <span class="muted">Atualizado: ${t.scoutingUpdatedAt ? Utils.formatDate(t.scoutingUpdatedAt) : '—'}</span>
          </div>
          <div class="sh-progress" title="${c.done} de ${c.total} secções preenchidas">
            <div class="sh-progress-bar" style="width:${(c.done / c.total) * 100}%"></div>
          </div>
          <span class="sh-progress-label ${c.done === c.total ? 'is-complete' : ''}">${c.done === c.total ? '✓ Dossier completo' : `${c.done}/${c.total} secções`}</span>
        </div>`;
    }).join('');

    grid.querySelectorAll('.sh-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-fav]')) return;
        window.location.hash = `#/scouting/${card.dataset.open}`;
      });
    });
    grid.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const team = this.teams.find((t) => t.id === b.dataset.fav);
      team.favorite = !team.favorite;
      await DB.put(DB.STORES.teams, team);
      this.renderGrid();
    }));
  },

  bind() {
    document.getElementById('sh-search').addEventListener('input', (e) => {
      this.search = e.target.value;
      this.renderGrid();
    });
    document.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      this.sort = b.dataset.sort;
      document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('active', x === b));
      this.renderGrid();
    }));

    const dlg = document.getElementById('dlg-sh-new');
    let logo = null;
    document.getElementById('sh-add').addEventListener('click', () => { logo = null; dlg.showModal(); });
    document.getElementById('sh-cancel').addEventListener('click', () => dlg.close());
    document.getElementById('sh-logo-input').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      logo = await ImageUtils.processTeamLogo(f);
      document.getElementById('sh-logo-preview').outerHTML = `<img class="team-badge" id="sh-logo-preview" src="${logo}" alt="">`;
    });
    document.getElementById('form-sh-new').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const notes = (fd.get('notes') || '').trim();
      const team = {
        id: Utils.uid('team'),
        name: fd.get('name').trim(),
        abbreviation: (fd.get('abbreviation') || '').trim().toUpperCase(),
        logo,
        colorPrimary: fd.get('colorPrimary'),
        colorSecondary: fd.get('colorSecondary'),
        isOwnTeam: false,
        favorite: false,
        profile: {},
        scouting: {
          strengths: [], weaknesses: [], threats: [], opportunities: [],
          triggers: [], keyPlayers: [], checklist: null, setPieces: [],
          notes: notes ? [{ id: Utils.uid('note'), text: notes, tags: [], playerId: null, timeRef: '', createdAt: Date.now() }] : [],
        },
        scoutingUpdatedAt: Date.now(),
        scoutingHistory: [],
        createdAt: Date.now(),
      };
      await DB.put(DB.STORES.teams, team);
      dlg.close();
      e.target.reset();
      window.location.hash = `#/scouting/${team.id}`;
    });
  },
};

window.ScoutingHubScreen = ScoutingHubScreen;
