/**
 * teams.js — Lista de Equipas: a nossa equipa (identidade fixa) + equipas
 * adversárias criadas ao longo do tempo, cada uma com o seu plantel.
 */

const TeamsScreen = {
  /** Avisa sozinho quando duas fichas parecem a mesma equipa. */
  renderDupes() {
    const box = document.getElementById('teams-dupes');
    if (!box) return;
    const pares = TeamMerge.duplicates(this.teams);
    if (!pares.length) { box.innerHTML = ''; return; }
    box.innerHTML = pares.map((p, i) => `
      <div class="teams-dupe">
        <span>🔗 <strong>${Utils.escapeHtml(p.a.name)}</strong> e <strong>${Utils.escapeHtml(p.b.name)}</strong> parecem a mesma equipa (${Utils.escapeHtml(p.reason)}).</span>
        <button type="button" class="btn btn-small btn-primary" data-dupe="${i}">Juntar</button>
      </div>`).join('');
    box.querySelectorAll('[data-dupe]').forEach((b) => b.addEventListener('click', () => {
      const p = pares[Number(b.dataset.dupe)];
      // A que fica por omissão é a que tem mais coisas dentro — o ecrã deixa trocar.
      this.openMerge({ keepId: p.a.id, dropId: p.b.id });
    }));
  },

  /**
   * Juntar duas fichas. Mostra sempre o que vai mudar antes de mudar, e deixa
   * trocar qual delas fica — o nome oficial não é necessariamente o que tu
   * queres manter.
   */
  openMerge(pre = {}) {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    const opcoes = (sel) => this.teams.map((t) =>
      `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${Utils.escapeHtml(t.name)}${t.isOwnTeam ? ' (nós)' : ''}</option>`).join('');
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head"><h3>🔗 Juntar equipas</h3><button type="button" class="icon-btn" data-close>✕</button></div>
        <p class="muted">Duas fichas da mesma equipa acontecem: o calendário escreve "GD Selho" e tu tinhas criado "Selho" na pré-época. Juntar não perde nada — o plantel, os jogos e o dossiê passam para a ficha que fica.</p>
        <label class="field"><span>Fica esta</span><select id="tm-keep">${opcoes(pre.keepId)}</select></label>
        <label class="field"><span>Desaparece esta</span><select id="tm-drop">${opcoes(pre.dropId)}</select></label>
        <div class="tm-plan" id="tm-plan"></div>
        <div class="dialog-actions">
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="button" class="btn btn-primary" id="tm-go" disabled>Juntar</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const fechar = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', fechar));
    dlg.addEventListener('cancel', () => dlg.remove());

    const pintar = async () => {
      const keepId = dlg.querySelector('#tm-keep').value;
      const dropId = dlg.querySelector('#tm-drop').value;
      const caixa = dlg.querySelector('#tm-plan');
      const botao = dlg.querySelector('#tm-go');
      if (keepId === dropId) {
        caixa.innerHTML = '<p class="muted">Escolhe duas equipas diferentes.</p>';
        botao.disabled = true;
        return;
      }
      const p = await TeamMerge.plan(keepId, dropId);
      caixa.innerHTML = `<p>${Utils.escapeHtml(TeamMerge.describe(p)).replace(/\n\n/g, '<br><br>')}</p>`;
      botao.disabled = false;
    };
    dlg.querySelector('#tm-keep').addEventListener('change', pintar);
    dlg.querySelector('#tm-drop').addEventListener('change', pintar);
    pintar();

    dlg.querySelector('#tm-go').addEventListener('click', async (e) => {
      // O botão é guardado AGORA: depois do primeiro `await`, `e.currentTarget`
      // é null (o navegador limpa-o no fim do despacho do evento) e mexer-lhe
      // atira um erro que mata o handler a meio, sem nada acontecer no ecrã.
      const botao = e.currentTarget;
      const keepId = dlg.querySelector('#tm-keep').value;
      const dropId = dlg.querySelector('#tm-drop').value;
      const p = await TeamMerge.plan(keepId, dropId);
      if (!p || !confirm(`Juntar as duas fichas?\n\n${TeamMerge.describe(p)}`)) return;
      botao.disabled = true;
      try {
        await TeamMerge.run(keepId, dropId);
        fechar();
        toast('Equipas juntas');
        this.render(document.getElementById('app-root'));
      } catch (err) {
        botao.disabled = false;
        CrashGuard.record('fundir equipas', err && err.message, err && err.stack, 'TeamMerge.run', false);
        alert('Não foi possível juntar: ' + err.message);
      }
    });
    dlg.showModal();
  },

  async render(root) {
    const teams = await AppState.getAllTeams();
    const own = teams.find((t) => t.isOwnTeam);
    const opponents = teams.filter((t) => !t.isOwnTeam).sort((a, b) => a.name.localeCompare(b.name));

    root.innerHTML = `
      <div class="screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Equipas</h1>
          <span class="teams-head-actions">
            <button class="btn btn-small" id="btn-merge-teams">🔗 Juntar</button>
            <button class="btn btn-primary" id="btn-new-team">＋ Nova</button>
          </span>
        </header>

        <div id="teams-dupes"></div>

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

    this.teams = teams;
    this.renderDupes();
    document.getElementById('btn-merge-teams').addEventListener('click', () => this.openMerge());

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
