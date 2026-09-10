/**
 * gamesList.js — Histórico de jogos.
 */

const GamesListScreen = {
  async render(root) {
    const matches = await DB.getAll(DB.STORES.matches);
    matches.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    root.innerHTML = `
      <div class="screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Jogos</h1>
          <button class="btn btn-primary" data-nav="#/new-game">＋ Novo</button>
        </header>

        <div class="backup-panel">
          <button class="btn" id="btn-full-backup">⬇ Backup completo (JSON)</button>
          <label class="btn btn-file">
            ⬆ Restaurar backup (JSON)
            <input type="file" id="file-restore" accept="application/json" hidden>
          </label>
        </div>

        <div class="games-list">
          ${matches.length ? matches.map((m) => gameRow(m)).join('') : '<p class="muted">Ainda não existem jogos.</p>'}
        </div>
      </div>
    `;

    document.getElementById('btn-full-backup').addEventListener('click', async () => {
      await ExportManager.exportFullBackup();
      toast('Backup completo exportado');
    });
    document.getElementById('file-restore').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Isto vai substituir todos os dados atuais pelos dados do ficheiro. Continuar?')) return;
      await ExportManager.importFullBackup(file);
      toast('Dados restaurados');
      this.render(root);
    });

    document.querySelectorAll('.game-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-del-game]')) return; // o ✕ tem o seu próprio handler
        const id = row.dataset.id;
        const status = row.dataset.status;
        const m = matches.find((x) => x.id === id);
        if (status === 'in_progress') window.location.hash = `#/live/${id}`;
        else if (status === 'finished') window.location.hash = `#/postgame/${id}`;
        else if (m && m.observationPlan && m.observationPlan.length > 0 && !m.lineupConfirmed) window.location.hash = `#/lineup/${id}`;
        else window.location.hash = `#/plan/${id}`;
      });
    });

    document.querySelectorAll('[data-del-game]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.delGame;
        const m = matches.find((x) => x.id === id);
        if (!confirm(`Apagar o jogo ${m ? m.team + ' vs ' + m.opponent : ''} e todos os seus registos? Esta ação não pode ser desfeita.`)) return;
        await deleteMatchCascade(id);
        toast('Jogo apagado');
        this.render(root);
      });
    });

  },
};

/** Apaga um jogo e tudo o que lhe pertence (eventos, desenhos, sessões, mensagens). */
async function deleteMatchCascade(id) {
  for (const o of await DB.getAllByIndex(DB.STORES.occurrences, 'matchId', id)) await DB.delete(DB.STORES.occurrences, o.id);
  for (const d of await DB.getAllByIndex(DB.STORES.drawings, 'matchId', id)) await DB.delete(DB.STORES.drawings, d.id);
  for (const s of await DB.getAllByIndex(DB.STORES.sessions, 'matchId', id)) await DB.delete(DB.STORES.sessions, s.id);
  for (const msg of await DB.getAllByIndex(DB.STORES.messages, 'matchId', id)) await DB.delete(DB.STORES.messages, msg.id);
  await DB.delete(DB.STORES.matches, id);
  if (AppState.currentMatch && AppState.currentMatch.id === id) {
    AppState.currentMatch = null;
    if (AppState.timer) { AppState.timer.destroy(); AppState.timer = null; }
    if (window.LiveScreen && LiveScreen.match && LiveScreen.match.id === id) LiveScreen.match = null;
  }
}

function gameRow(m) {
  return `
    <div class="game-row" data-id="${m.id}" data-status="${m.status}">
      <div class="game-row-main">
        <strong>${Utils.escapeHtml(m.team)} ${m.score?.team ?? 0} - ${m.score?.opponent ?? 0} ${Utils.escapeHtml(m.opponent)}</strong>
        <span class="muted">${Utils.formatDate(m.date)} · ${Utils.escapeHtml(m.competition || '—')}</span>
      </div>
      <span class="status-pill status-${m.status}">${{ in_progress: 'Em curso', finished: 'Terminado', draft: 'Por iniciar' }[m.status] || m.status}</span>
      <button class="btn btn-tiny btn-danger" data-del-game="${m.id}" title="Apagar jogo" aria-label="Apagar jogo">✕</button>
    </div>
  `;
}

window.GamesListScreen = GamesListScreen;
