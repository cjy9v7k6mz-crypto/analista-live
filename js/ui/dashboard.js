/**
 * dashboard.js — Ecrã inicial.
 */

const DashboardScreen = {
  async render(root) {
    const matches = await DB.getAll(DB.STORES.matches);
    matches.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const last = matches[0];
    const inProgress = matches.find((m) => m.status === 'in_progress');

    root.innerHTML = `
      <div class="screen dashboard">
        <header class="app-header">
          <div class="app-brand">
            <span class="app-brand-mark">AL</span>
            <div>
              <h1>Analista Live</h1>
              <p class="app-sub">${window.AppState.settings?.teamName || 'Ferramenta de observação em direto'}</p>
            </div>
          </div>
          <button class="icon-btn" data-nav="#/settings" title="Definições" aria-label="Definições">⚙️</button>
        </header>

        ${inProgress ? `
        <div class="banner banner-warning">
          <div>
            <strong>Jogo em curso:</strong> ${Utils.escapeHtml(inProgress.team)} vs ${Utils.escapeHtml(inProgress.opponent)}
          </div>
          <button class="btn btn-primary" data-nav="#/live/${inProgress.id}">Continuar jogo</button>
        </div>` : ''}

        <div class="dash-grid">
          <button class="dash-tile dash-tile-primary" data-nav="#/new-game">
            <span class="dash-tile-icon">＋</span>
            <span class="dash-tile-label">Novo Jogo</span>
          </button>
          <button class="dash-tile" data-nav="#/games">
            <span class="dash-tile-icon">📋</span>
            <span class="dash-tile-label">Jogos Anteriores</span>
            <span class="dash-tile-count">${matches.length}</span>
          </button>
          <button class="dash-tile" data-nav="#/library">
            <span class="dash-tile-icon">🗂️</span>
            <span class="dash-tile-label">Biblioteca de Eventos</span>
          </button>
          <button class="dash-tile dash-tile-coach" data-nav="#/coach">
            <span class="dash-tile-icon">📲</span>
            <span class="dash-tile-label">Modo Banco</span>
          </button>
          <button class="dash-tile dash-tile-scouting" data-nav="#/scouting">
            <span class="dash-tile-icon">🎯</span>
            <span class="dash-tile-label">Scouting</span>
          </button>
          <button class="dash-tile" data-nav="#/teams">
            <span class="dash-tile-icon">👥</span>
            <span class="dash-tile-label">Equipas &amp; Plantéis</span>
          </button>
          <button class="dash-tile" data-nav="#/squad-stats">
            <span class="dash-tile-icon">📈</span>
            <span class="dash-tile-label">Estatísticas do Plantel</span>
          </button>
          <button class="dash-tile" data-nav="#/games">
            <span class="dash-tile-icon">📄</span>
            <span class="dash-tile-label">Exportações &amp; Backup</span>
          </button>
          <button class="dash-tile" data-nav="#/settings">
            <span class="dash-tile-icon">⚙️</span>
            <span class="dash-tile-label">Definições</span>
          </button>
        </div>

        ${last ? `
        <section class="last-match-card">
          <h2 class="section-title">Último Jogo</h2>
          <div class="last-match-row" data-nav="${lastMatchLink(last)}">
            <div>
              <strong>${Utils.escapeHtml(last.team)} ${last.score?.team ?? 0} - ${last.score?.opponent ?? 0} ${Utils.escapeHtml(last.opponent)}</strong>
              <p class="muted">${Utils.formatDate(last.date)} · ${Utils.escapeHtml(last.competition || '')}</p>
            </div>
            <span class="status-pill status-${last.status}">${statusLabel(last.status)}</span>
          </div>
        </section>` : `
        <div class="empty-state">
          <p>Ainda não existem jogos registados.</p>
          <p class="muted">Toca em "Novo Jogo" para preparar a tua primeira observação.</p>
        </div>`}
      </div>
    `;
  },
};

function statusLabel(status) {
  return { in_progress: 'Em curso', finished: 'Terminado', draft: 'Por iniciar' }[status] || status;
}

function lastMatchLink(m) {
  if (m.status === 'in_progress') return `#/live/${m.id}`;
  if (m.status === 'finished') return `#/postgame/${m.id}`;
  if (m.observationPlan && m.observationPlan.length > 0 && !m.lineupConfirmed) return `#/lineup/${m.id}`;
  return `#/plan/${m.id}`;
}

window.DashboardScreen = DashboardScreen;
