/**
 * teams.js — Lista de Equipas: a nossa equipa (identidade fixa) + equipas
 * adversárias criadas ao longo do tempo, cada uma com o seu plantel.
 */

const TeamsScreen = {
  async render(root) {
    const teams = await AppState.getAllTeams();
    const own = teams.find((t) => t.isOwnTeam);
    const opponents = teams.filter((t) => !t.isOwnTeam).sort((a, b) => a.name.localeCompare(b.name));

    root.innerHTML = `
      <div class="screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Equipas</h1>
          <button class="btn btn-primary" id="btn-new-team">＋ Nova Equipa Adversária</button>
        </header>

        <h2 class="section-title">A Nossa Equipa</h2>
        <div class="team-card-row" data-nav="#/team/${own.id}">
          ${teamBadge(own)}
          <div class="team-card-info">
            <strong>${Utils.escapeHtml(own.name)}</strong>
            <span class="muted">Plantel próprio · toca para editar</span>
          </div>
          <span class="chevron">›</span>
        </div>

        <h2 class="section-title">Adversários</h2>
        <div id="opponent-teams-list" class="team-list">
          ${opponents.length ? opponents.map((t) => `
            <div class="team-card-row" data-nav="#/team/${t.id}">
              ${teamBadge(t)}
              <div class="team-card-info">
                <strong>${Utils.escapeHtml(t.name)}</strong>
                <span class="muted">${t.abbreviation ? Utils.escapeHtml(t.abbreviation) : 'toca para gerir plantel'}</span>
              </div>
              <span class="chevron">›</span>
            </div>
          `).join('') : '<p class="muted">Ainda não criaste nenhuma equipa adversária.</p>'}
        </div>
      </div>

      <dialog id="dlg-new-team" class="dialog">
        <form id="form-new-team" class="dialog-card">
          <h3>Nova Equipa Adversária</h3>
          <label class="field"><span>Nome</span><input name="name" required autofocus></label>
          <label class="field"><span>Abreviatura</span><input name="abbreviation" maxlength="4" placeholder="Ex: FCP"></label>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-new-team">Cancelar</button>
            <button type="submit" class="btn btn-primary">Criar</button>
          </div>
        </form>
      </dialog>
    `;

    const dlg = document.getElementById('dlg-new-team');
    document.getElementById('btn-new-team').addEventListener('click', () => dlg.showModal());
    document.getElementById('cancel-new-team').addEventListener('click', () => dlg.close());
    document.getElementById('form-new-team').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const team = {
        id: Utils.uid('team'),
        name: fd.get('name').trim(),
        abbreviation: fd.get('abbreviation').trim().toUpperCase(),
        logo: null,
        colorPrimary: '#e5555c',
        colorSecondary: '#12161f',
        isOwnTeam: false,
        createdAt: Date.now(),
      };
      await DB.put(DB.STORES.teams, team);
      window.location.hash = `#/team/${team.id}`;
    });
  },
};

function teamBadge(team) {
  if (team.logo) {
    return `<img class="team-badge" src="${team.logo}" alt="${Utils.escapeHtml(team.name)}">`;
  }
  const initials = ImageUtils.initials(team.abbreviation || team.name);
  return `<span class="team-badge team-badge-placeholder" style="background:${team.colorPrimary || '#5b93f0'}">${initials}</span>`;
}

window.TeamsScreen = TeamsScreen;
window.teamBadge = teamBadge;
