/**
 * halftime.js — Resumo de intervalo, baseado exclusivamente nos dados registados.
 */

const HalftimeScreen = {
  async render(root, params) {
    const match = await DB.get(DB.STORES.matches, params.matchId);
    if (!match) { window.location.hash = '#/dashboard'; return; }
    const occurrences = await AppState.getOccurrences(match.id);

    const counts = {}; // planEventId -> count
    occurrences.forEach((o) => { if (o.planEventId) counts[o.planEventId] = (counts[o.planEventId] || 0) + 1; });

    const eventsWithCounts = (match.observationPlan || [])
      .map((e) => ({ ...e, count: counts[e.id] || 0 }))
      .filter((e) => e.count > 0);

    const problems = eventsWithCounts.filter((e) => e.type === 'negative').sort((a, b) => b.count - a.count).slice(0, 6);
    const positives = eventsWithCounts.filter((e) => e.type === 'positive').sort((a, b) => b.count - a.count).slice(0, 6);
    const trending = eventsWithCounts.filter((e) => Utils.getTrendLevel(e.count, AppState.settings.trendConfig).showBadge).sort((a, b) => b.count - a.count);
    const bench = occurrences.filter((o) => o.source === 'banco');
    const moments = occurrences.filter((o) => o.source === 'momento');

    root.innerHTML = `
      <div class="screen halftime-screen">
        <header class="screen-header">
          <span class="halftime-badge">INTERVALO</span>
          <h1>${Utils.escapeHtml(match.team)} ${match.score.team} - ${match.score.opponent} ${Utils.escapeHtml(match.opponent)}</h1>
          <span></span>
        </header>

        <div class="halftime-grid">
          <section class="ht-card ht-card-problems">
            <h2>🔴 Principais Problemas</h2>
            ${listOrEmpty(problems, (e) => `<div class="ht-row"><span>${Utils.escapeHtml(e.name)}</span><strong>${e.count}×</strong></div>`)}
          </section>

          <section class="ht-card ht-card-positives">
            <h2>🟢 Principais Pontos Positivos</h2>
            ${listOrEmpty(positives, (e) => `<div class="ht-row"><span>${Utils.escapeHtml(e.name)}</span><strong>${e.count}×</strong></div>`)}
          </section>

          <section class="ht-card ht-card-trends">
            <h2>⚠️ Tendências</h2>
            ${listOrEmpty(trending, (e) => `<div class="ht-row"><span>${Utils.escapeHtml(e.name)}</span><strong>${e.count}× · ${Utils.getTrendLevel(e.count, AppState.settings.trendConfig).label}</strong></div>`)}
          </section>

          <section class="ht-card ht-card-bench">
            <h2>🚨 Banco</h2>
            ${listOrEmpty(bench, (o) => `<div class="ht-row"><span>${String(o.minute).padStart(2, '0')}' — ${Utils.escapeHtml(o.eventName)}</span>${o.note ? `<span class="muted">"${Utils.escapeHtml(o.note)}"</span>` : ''}</div>`)}
          </section>

          <section class="ht-card ht-card-moments">
            <h2>⭐ Momentos</h2>
            ${listOrEmpty(moments, (o) => `<div class="ht-row"><span>${String(o.minute).padStart(2, '0')}'</span>${o.note ? `<span class="muted">"${Utils.escapeHtml(o.note)}"</span>` : '<span class="muted">sem nota</span>'}</div>`)}
          </section>
        </div>

        <div class="halftime-actions">
          <button class="btn" id="btn-back-live">← Voltar ao painel</button>
          <button class="btn btn-primary btn-lg" id="btn-start-2nd">Iniciar 2ª Parte →</button>
        </div>
      </div>
    `;

    document.getElementById('btn-back-live').addEventListener('click', () => { window.location.hash = `#/live/${match.id}`; });
    document.getElementById('btn-start-2nd').addEventListener('click', async () => {
      match.currentPeriod = PERIODS.SECOND_HALF;
      match.updatedAt = Date.now();
      await DB.put(DB.STORES.matches, match);
      // Sinaliza ao LiveScreen para arrancar já a 2ª parte assim que o ecrã carregar
      // (evita condições de corrida com o timing do hashchange/render).
      AppState.pendingPeriodStart = PERIODS.SECOND_HALF;
      window.location.hash = `#/live/${match.id}`;
    });
  },
};

function listOrEmpty(arr, renderFn) {
  if (!arr || arr.length === 0) return '<p class="muted">Sem registos.</p>';
  return arr.map(renderFn).join('');
}

window.HalftimeScreen = HalftimeScreen;
