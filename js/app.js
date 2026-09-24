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
  { pattern: /^#\/competicao$/, screen: () => window.CompetitionScreen },
  { pattern: /^#\/arbitros$/, screen: () => window.RefereesScreen },
  { pattern: /^#\/arbitros\/(.+)$/, screen: () => window.RefereesScreen, params: (m) => ({ id: m[1] }) },
  { pattern: /^#\/competicao\/(.+)$/, screen: () => window.CompetitionScreen, params: (m) => ({ id: m[1] }) },
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
        CrashGuard.record('ecrã', err && err.message, err && err.stack, hash, false);
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

/**
 * Ecrã de último recurso. Se o arranque falhar, o utilizador tem de ver o que
 * aconteceu e ter uma saída — em vez de um ecrã branco sem explicação.
 */
function bootFailureScreen(err) {
  const msg = (window.DB && DB.writeErrorText) ? DB.writeErrorText(err) : (err && err.message) || 'Erro desconhecido';
  root.innerHTML = `
    <div class="screen">
      <h1>Não foi possível arrancar</h1>
      <p class="muted">${Utils.escapeHtml(msg)}</p>
      <div class="dialog-actions" style="justify-content:flex-start">
        <button class="btn btn-primary" id="boot-retry">Tentar de novo</button>
        <button class="btn" data-nav="#/settings">Definições</button>
      </div>
      <p class="muted">Se voltar a acontecer, o detalhe fica guardado em Definições → Diagnóstico. Os teus jogos não se perdem por causa disto: estão gravados no dispositivo.</p>
    </div>`;
  document.getElementById('boot-retry')?.addEventListener('click', () => location.reload());
}

async function boot() {
  CrashGuard.install();
  await AppState.loadSettings();
  // Pede ao browser para não limpar os dados quando falta espaço. Só pede
  // sozinho com a app instalada — no Firefox de computador isto abria uma
  // janela de permissão sem contexto. Nas Definições há o botão para pedir.
  if (DataSafety.isStandalone()) DataSafety.requestPersistence();
  await AppState.loadLibrary();
  // As migrações correm em TODOS os arranques (são idempotentes, curam dados
  // antigos). Por isso não podem ser fatais: um único registo estragado — de um
  // backup antigo, por exemplo — deixaria a app sem arrancar para sempre.
  try {
    await Migrations.run();
  } catch (e) {
    CrashGuard.record('migração', e && e.message, e && e.stack, 'Migrations.run', false);
    console.warn('Migrações: falha não fatal', e);
  }
  try {
    await SyncCore.init();
  } catch (e) {
    CrashGuard.record('sincronização', e && e.message, e && e.stack, 'SyncCore.init', false);
    console.warn('Sync: init falhou', e);
  }
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

// O arranque não pode terminar em ecrã branco: o que falhar fica registado e
// o utilizador recebe uma saída.
boot().catch((err) => {
  try { CrashGuard.record('arranque', err && err.message, err && err.stack, 'boot', false); } catch (e) { /* ignora */ }
  console.error('Arranque falhou:', err);
  bootFailureScreen(err);
});
