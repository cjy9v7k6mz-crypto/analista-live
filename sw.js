/**
 * sw.js — Service Worker. Cache do "app shell" para funcionamento 100% offline
 * depois da primeira visita. Estratégia: cache-first com atualização em segundo
 * plano (stale-while-revalidate) para os ficheiros da aplicação.
 */

const CACHE_VERSION = 'analista-live-v36';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/vendor/pdf-lib.min.js',
  './js/data/defaultLibrary.js',
  './js/data/formationPresets.js',
  './js/data/competitions.js',
  './js/data/scoutingModel.js',
  './js/core/utils.js',
  './js/core/crashGuard.js',
  './js/core/db.js',
  './js/core/imageUtils.js',
  './js/core/timer.js',
  './js/core/state.js',
  './js/core/migrations.js',
  './js/core/lineupState.js',
  './js/core/pitch.js',
  './js/core/matchStats.js',
  './js/core/playerStats.js',
  './js/core/matchEffects.js',
  './js/core/dataSafety.js',
  './js/core/seasonTrends.js',
  './js/core/playerReport.js',
  './js/core/squadLoad.js',
  './js/core/standings.js',
  './js/core/teamLink.js',
  './js/core/adjustmentEffect.js',
  './js/core/liveAlerts.js',
  './js/core/scoutingFeedback.js',
  './js/core/videoSync.js',
  './js/sync/syncCore.js',
  './js/sync/transportLocal.js',
  './js/sync/transportSupabase.js',
  './js/ui/syncUI.js',
  './js/ui/coachDashboard.js',
  './js/export/exportManager.js',
  './js/export/pdfReport.js',
  './js/export/pdfScouting.js',
  './js/export/pdfPlayer.js',
  './js/export/pdfBriefing.js',
  './js/export/matchCard.js',
  './js/ui/dashboard.js',
  './js/ui/newGame.js',
  './js/ui/planBuilder.js',
  './js/ui/playerPicker.js',
  './js/ui/playerGrid.js',
  './js/ui/lineupBuilder.js',
  './js/ui/statsPanel.js',
  './js/ui/sketchPad.js',
  './js/ui/live.js',
  './js/ui/halftime.js',
  './js/ui/postgame.js',
  './js/ui/gamesList.js',
  './js/ui/library.js',
  './js/ui/teams.js',
  './js/ui/teamProfile.js',
  './js/ui/trendChart.js',
  './js/ui/squadStats.js',
  './js/ui/competition.js',
  './js/ui/scouting.js',
  './js/ui/scoutingHub.js',
  './js/ui/rosterImport.js',
  './js/ui/playerDetail.js',
  './js/ui/settings.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// O "esqueleto" sem o qual a app não abre offline. Se um destes falhar, a
// instalação TEM de falhar — é preferível manter a versão anterior em cache do
// que instalar uma versão partida.
const CORE = ['./', './index.html', './css/style.css', './js/app.js'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Um a um, e não addAll: com addAll, um único ficheiro em falta na lista
    // abortava a instalação inteira e a app ficava sem offline, sem aviso.
    const falhados = [];
    await Promise.all(ASSETS.map((url) =>
      cache.add(url).catch(() => { falhados.push(url); })));
    if (falhados.length) console.warn('SW: ficheiros não cacheados', falhados);
    const coreFalhado = falhados.filter((f) => CORE.includes(f));
    if (coreFalhado.length) throw new Error('SW: esqueleto em falta: ' + coreFalhado.join(', '));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // não intercetar escritas (não há chamadas de rede na app, mas por segurança)

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline: usa o cache

      // Cache-first para velocidade; atualiza em segundo plano.
      return cached || networkFetch;
    })
  );
});
