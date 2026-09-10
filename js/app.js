/**
 * app.js — Router (hash-based) e arranque da aplicação.
 */

const routes = [
  { pattern: /^#\/dashboard$/, screen: () => window.DashboardScreen },
  { pattern: /^#\/new-game$/, screen: () => window.NewGameScreen },
  { pattern: /^#\/plan\/(.+)$/, screen: () => window.PlanBuilderScreen, params: (m) => ({ matchId: m[1] }) },
  { pattern: /^#\/lineup\/(.+)$/, screen: () => window.LineupBuilderScreen, params: (m) => ({ matchId: m[1] }) },
  { pattern: /^#\/live\/(.+)$/, screen: () => window.LiveScreen, params: (m) => ({ matchId: m[1] }) },
  { pattern: /^#\/halftime\/(.+)$/, screen: () => window.HalftimeScreen, params: (m) => ({ matchId: m[1] }) },
  { pattern: /^#\/postgame\/(.+)$/, screen: () => window.PostgameScreen, params: (m) => ({ matchId: m[1] }) },
  { pattern: /^#\/games$/, screen: () => window.GamesListScreen },
  { pattern: /^#\/library$/, screen: () => window.LibraryScreen },
  { pattern: /^#\/teams$/, screen: () => window.TeamsScreen },
  { pattern: /^#\/team\/(.+)$/, screen: () => window.TeamProfileScreen, params: (m) => ({ teamId: m[1] }) },
  { pattern: /^#\/squad-stats$/, screen: () => window.SquadStatsScreen },
  { pattern: /^#\/squad-stats\/(.+)$/, screen: () => window.SquadStatsScreen, params: (m) => ({ teamId: m[1] }) },
  { pattern: /^#\/scouting$/, screen: () => window.ScoutingHubScreen },
  { pattern: /^#\/scouting\/(.+)$/, screen: () => window.ScoutingScreen, params: (m) => ({ teamId: m[1] }) },
  { pattern: /^#\/player\/(.+)\/(.+)$/, screen: () => window.PlayerDetailScreen, params: (m) => ({ matchId: m[1], playerId: m[2] }) },
  { pattern: /^#\/pair\/(.+)$/, screen: () => window.PairingScreen, params: (m) => ({ matchId: m[1] }) },
  { pattern: /^#\/coach/, screen: () => window.CoachDashboard },
  { pattern: /^#\/settings$/, screen: () => window.SettingsScreen },
];

// Rotas descontinuadas: os ecrãs antigos de "Jogadores" (global, sem equipa) e
// "Notas de Adversários" (store separada) foram substituídos por Equipas/Plantéis
// e pelo Centro de Scouting. Redirecionam para não deixar ligações partidas
// em separadores guardados ou no ecrã principal do iPad.
const LEGACY_REDIRECTS = { '#/players': '#/teams', '#/opponents': '#/teams' };

const root = document.getElementById('app-root');

async function router() {
  const hash = window.location.hash || '#/dashboard';
  if (LEGACY_REDIRECTS[hash]) { window.location.hash = LEGACY_REDIRECTS[hash]; return; }

  // Fecha diálogos soltos ao nível do <body> (detalhe de golo, importar do
  // scouting, etc.) que de outra forma ficariam sobre o novo ecrã ao mudar de
  // rota — por exemplo ao sair do painel LIVE com o detalhe de golo aberto.
  // Os seletores/painéis reutilizáveis (têm id fixo) são só fechados, não removidos.
  const PERSISTENT_DIALOGS = new Set(['dlg-player-picker', 'dlg-stats-panel', 'dlg-sketch', 'dlg-roster-import']);
  document.querySelectorAll('body > dialog').forEach((d) => {
    try { d.close(); } catch (e) { /* ignora */ }
    if (!PERSISTENT_DIALOGS.has(d.id)) d.remove();
  });

  for (const r of routes) {
    const match = hash.match(r.pattern);
    if (match) {
      const params = r.params ? r.params(match) : {};
      // Se saímos do ecrã LIVE para outro sítio que não live/halftime, paramos o timer local
      // (os dados já foram persistidos a cada ação — nunca há perda).
      try {
        await r.screen().render(root, params);
      } catch (err) {
        console.error('Erro ao renderizar ecrã:', err);
        root.innerHTML = `<div class="screen"><p class="muted">Ocorreu um erro a carregar este ecrã. <button class="btn" data-nav="#/dashboard">Voltar ao início</button></p></div>`;
      }
      return;
    }
  }
  window.location.hash = '#/dashboard';
}

// Delegação global de navegação: qualquer elemento com data-nav="#/..."
document.addEventListener('click', (e) => {
  const navEl = e.target.closest('[data-nav]');
  if (navEl) {
    window.location.hash = navEl.dataset.nav;
  }
});

window.addEventListener('hashchange', router);

async function boot() {
  await AppState.loadSettings();
  await AppState.loadLibrary();
  await Migrations.run();
  await SyncCore.init();
  applyTheme();

  // Recuperação: se existir jogo em curso e não estamos já a navegar para ele
  const inProgress = await AppState.findInProgressMatch();
  if (inProgress && !window.location.hash) {
    const cont = confirm(`Encontrámos um jogo em curso: ${inProgress.team} vs ${inProgress.opponent}.\n\nOK = Continuar jogo\nCancelar = Ir para o início`);
    window.location.hash = cont ? `#/live/${inProgress.id}` : '#/dashboard';
  } else if (!window.location.hash) {
    window.location.hash = '#/dashboard';
  }

  // Se havia uma sessão ativa, volta a ligar-se sozinha (o utilizador não tem
  // de repetir o emparelhamento depois de fechar a app).
  try {
    const session = await SyncCore.activeSession();
    if (session) {
      SyncCore.session = session;
      const transport = await SyncTransports.pick();
      await SyncCore.connect(transport);
      await SyncCore.catchUp(0);
    }
  } catch (e) { console.warn('Sync: não foi possível religar', e); }

  await router();

  // Regista o Service Worker (offline)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW falhou:', err));
  }
}

boot();
