/**
 * halftime.js — Resumo de intervalo, baseado exclusivamente nos dados registados.
 *
 * O intervalo é o único momento em que ainda dá para mudar o jogo, e com o
 * relógio parado não há pressa nenhuma — por isso mostra-se aqui TUDO o que já
 * está calculado (mapas, padrões, fecho do scouting), e não só as listas de
 * contagens. Nada disto pede um registo novo: é a mesma informação do pós-jogo,
 * entregue a tempo de servir para alguma coisa.
 */

const HalftimeScreen = {
  /** Atalhos para as decisões mais comuns de intervalo. Editáveis à mão. */
  PRESETS: [
    'Subir a linha de pressão', 'Baixar o bloco', 'Fechar o corredor central',
    'Explorar o lado esquerdo', 'Explorar o lado direito', 'Sair a jogar mais curto',
    'Sair em jogo direto', 'Marcação individual ao 10',
  ],

  /**
   * Regista a decisão como ocorrência do jogo (source 'ajuste'), ao minuto 45.
   * Fica no histórico como tudo o resto — e é o que permite medir o antes/depois.
   */
  async saveAdjustment() {
    const campo = document.getElementById('adj-text');
    const texto = (campo.value || '').trim();
    if (!texto) { campo.focus(); return; }
    const occ = {
      id: Utils.uid('occ'), matchId: this.match.id, timestamp: Date.now(),
      period: 'HT', minute: 45, second: 0,
      category: 'nossa_equipa', categoryLabel: Utils.categoryLabel('nossa_equipa'),
      eventName: `Ajuste: ${texto}`, eventType: 'neutral', priority: 'important',
      note: texto, source: 'ajuste', planEventId: null, playerIds: [], team: 'own',
      meta: { atHalftime: true }, createdAt: Date.now(),
    };
    try {
      await DB.putRetry(DB.STORES.occurrences, occ);
    } catch (e) {
      alert(DB.writeErrorText(e));
      return;
    }
    this.occurrences.push(occ);
    SyncCore.publish('occurrence', 'upsert', occ);
    campo.value = '';
    this.renderAdjustments();
    toast('Ajuste registado');
  },

  async removeAdjustment(id) {
    await AppState.deleteOccurrence(id);
    this.occurrences = this.occurrences.filter((o) => o.id !== id);
    SyncCore.publish('occurrence', 'delete', { id });
    this.renderAdjustments();
  },

  renderAdjustments() {
    const box = document.getElementById('adj-list');
    if (!box) return;
    const lista = this.occurrences.filter((o) => o.source === 'ajuste');
    if (!lista.length) { box.innerHTML = ''; return; }
    box.innerHTML = lista.map((o) => `
      <div class="adj-item">
        <span>🔧 ${Utils.escapeHtml(o.note || o.eventName)}</span>
        <button type="button" class="icon-btn" data-adj-del="${o.id}" title="Remover">✕</button>
      </div>`).join('');
    box.querySelectorAll('[data-adj-del]').forEach((b) =>
      b.addEventListener('click', () => this.removeAdjustment(b.dataset.adjDel)));
  },

  async render(root, params) {
    const match = await DB.get(DB.STORES.matches, params.matchId);
    if (!match) { window.location.hash = '#/dashboard'; return; }
    const occurrences = await AppState.getOccurrences(match.id);

    // Jogadores das duas equipas, para resolver nomes nos padrões.
    const ownPlayers = match.teams?.own?.teamId ? await AppState.getTeamPlayers(match.teams.own.teamId) : [];
    const opponentPlayers = match.teams?.opponent?.teamId ? await AppState.getTeamPlayers(match.teams.opponent.teamId) : [];
    const allPlayers = [...ownPlayers, ...opponentPlayers];
    const nameOf = (id) => {
      const p = allPlayers.find((x) => x.id === id);
      return p ? (p.shortName || p.name) : null;
    };
    const stats = MatchStats.compute(match, occurrences);

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

        <section class="ht-card ht-stats-card">
          <h2>📊 Números até aqui</h2>
          <table class="stats-table">
            ${MatchStats.STAT_KEYS
              .filter((k) => stats.own[k.key] || stats.opp[k.key])
              .map((k) => `
                <tr class="stats-row">
                  <td class="stats-cell-val"><span class="stats-num">${stats.own[k.key]}</span></td>
                  <td class="stats-cell-label">${k.label}</td>
                  <td class="stats-cell-val"><span class="stats-num">${stats.opp[k.key]}</span></td>
                </tr>`).join('') || '<tr><td colspan="3" class="muted">Sem números registados ainda.</td></tr>'}
          </table>
          <p class="muted center">${Utils.escapeHtml(match.team)} · ${Utils.escapeHtml(match.opponent)} — só se mostram as linhas com registos.</p>
        </section>

        <section class="ht-card ht-card-adjust">
          <h2>🔧 O que vamos mudar na 2ª parte</h2>
          <p class="muted">Escreve a decisão. Depois do jogo, a app mostra o que mudou a seguir a ela — é a única forma de saber se resultou.</p>
          <div class="adj-presets" id="adj-presets">
            ${this.PRESETS.map((t) => `<button type="button" class="btn btn-small adj-preset">${Utils.escapeHtml(t)}</button>`).join('')}
          </div>
          <div class="adj-input-row">
            <input id="adj-text" placeholder="Ex: subir a linha de pressão" autocomplete="off">
            <button type="button" class="btn btn-primary" id="adj-save">Registar</button>
          </div>
          <div id="adj-list"></div>
        </section>

        <section class="ht-card">
          <h2>🎯 O que o scouting previa</h2>
          ${MatchStats.renderScoutingCheckHTML(match, occurrences)}
        </section>

        <div class="halftime-grid pg-maps-grid">
          <section class="ht-card">${MatchStats.renderTransitionsMapHTML(occurrences, match.team, match.opponent)}</section>
          <section class="ht-card">${MatchStats.renderMapHTML('shots', occurrences, match.team, match.opponent)}</section>
          <section class="ht-card">${MatchStats.renderMapHTML('fouls', occurrences, match.team, match.opponent)}</section>
        </div>

        <section class="ht-card">
          <h2>🔗 Padrões</h2>
          ${MatchStats.renderPatternsHTML(occurrences, match, nameOf)}
        </section>

        <div class="halftime-actions">
          <button class="btn" id="btn-back-live">← Voltar ao painel</button>
          <button class="btn btn-primary btn-lg" id="btn-start-2nd">Iniciar 2ª Parte →</button>
        </div>
      </div>
    `;

    // ---------- Ajustes para a 2ª parte ----------
    this.match = match;
    this.occurrences = occurrences;
    this.renderAdjustments();
    document.querySelectorAll('.adj-preset').forEach((b) => b.addEventListener('click', () => {
      const campo = document.getElementById('adj-text');
      campo.value = b.textContent;
      campo.focus();
    }));
    document.getElementById('adj-save').addEventListener('click', () => this.saveAdjustment());
    document.getElementById('adj-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.saveAdjustment(); }
    });

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
