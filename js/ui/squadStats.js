/**
 * squadStats.js — Hub de estatísticas do plantel.
 *
 * Junta o que foi registado em TODOS os jogos de uma equipa e mostra uma tabela
 * por jogador, ordenável, com detalhe por jogo. Tudo calculado ao vivo a partir
 * das ocorrências (PlayerStats) — nada é guardado.
 */

const SquadStatsScreen = {
  teamId: null,
  teams: [],
  players: [],
  entries: [],          // [{match, occurrences}] já filtrados para a equipa
  competition: 'all',
  sort: { key: 'goals', dir: 'desc' },

  async render(root, params) {
    this.teams = (await AppState.getAllTeams());
    const withPlayers = [];
    for (const t of this.teams) {
      const n = (await AppState.getTeamPlayers(t.id)).length;
      if (n > 0) withPlayers.push(t.id);
    }
    this.teamsWithPlayers = new Set(withPlayers);

    const own = this.teams.find((t) => t.isOwnTeam);
    this.teamId = params?.teamId
      || (this.teamsWithPlayers.has(this.teamId) ? this.teamId : null)
      || (own && this.teamsWithPlayers.has(own.id) ? own.id : withPlayers[0] || (own && own.id));

    await this.load();

    root.innerHTML = `
      <div class="screen squad-stats-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Estatísticas do Plantel</h1>
          <button class="btn btn-small" id="ss-csv">⬇ CSV</button>
        </header>

        <div class="ss-controls">
          <label class="field">
            <span>Equipa</span>
            <select id="ss-team">
              ${this.teams.filter((t) => this.teamsWithPlayers.has(t.id)).map((t) =>
                `<option value="${t.id}" ${t.id === this.teamId ? 'selected' : ''}>${Utils.escapeHtml(t.name)}${t.isOwnTeam ? ' (nós)' : ''}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Competição</span>
            <select id="ss-comp">
              <option value="all">Todas</option>
              ${this.competitions().map((c) => `<option value="${Utils.escapeHtml(c)}" ${c === this.competition ? 'selected' : ''}>${Utils.escapeHtml(c)}</option>`).join('')}
            </select>
          </label>
          <span class="ss-scope-info muted" id="ss-scope-info"></span>
        </div>

        <div id="ss-body"></div>
      </div>`;

    document.getElementById('ss-team').addEventListener('change', (e) => {
      window.location.hash = `#/squad-stats/${e.target.value}`;
    });
    document.getElementById('ss-comp').addEventListener('change', (e) => {
      this.competition = e.target.value;
      this.renderBody();
    });
    document.getElementById('ss-csv').addEventListener('click', () => this.exportCSV());

    this.renderBody();
  },

  async load() {
    this.players = this.teamId ? await AppState.getTeamPlayers(this.teamId) : [];
    this.players.sort((a, b) => (a.number || 99) - (b.number || 99));
    const matches = (await DB.getAll(DB.STORES.matches))
      .filter((m) => m.teams?.own?.teamId === this.teamId || m.teams?.opponent?.teamId === this.teamId)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    this.entries = [];
    for (const m of matches) {
      this.entries.push({ match: m, occurrences: await AppState.getOccurrences(m.id) });
    }
  },

  competitions() {
    return [...new Set(this.entries.map((e) => (e.match.competition || '').trim()).filter(Boolean))].sort();
  },

  scopedEntries() {
    if (this.competition === 'all') return this.entries;
    return this.entries.filter((e) => (e.match.competition || '').trim() === this.competition);
  },

  computeRows() {
    const entries = this.scopedEntries();
    return this.players.map((p) => {
      const agg = PlayerStats.aggregate(p.id, this.teamId, entries);
      return { player: p, agg };
    });
  },

  renderBody() {
    const body = document.getElementById('ss-body');
    if (!body) return;
    const entries = this.scopedEntries();
    document.getElementById('ss-scope-info').textContent =
      `${entries.length} jogo${entries.length === 1 ? '' : 's'} · ${this.players.length} jogador${this.players.length === 1 ? '' : 'es'}`;

    if (!this.players.length) {
      body.innerHTML = `<div class="empty-state"><p>Este plantel ainda não tem jogadores.</p>
        <button class="btn" data-nav="#/team/${this.teamId}">Abrir plantel</button></div>`;
      return;
    }
    if (!entries.length) {
      body.innerHTML = '<div class="empty-state"><p>Ainda não há jogos registados para esta equipa (nesta competição).</p></div>';
      return;
    }

    let rows = this.computeRows();
    // Ordenação
    const { key, dir } = this.sort;
    // A coluna de tendência segue a métrica por que se ordena (se fizer sentido jogo a jogo).
    const sparkMeta = SeasonTrends.PLAYER_KEYS.find((k) => k.key === key);
    rows.sort((a, b) => {
      const av = key === 'number' ? (a.player.number || 99) : (a.agg[key] || 0);
      const bv = key === 'number' ? (b.player.number || 99) : (b.agg[key] || 0);
      return dir === 'asc' ? av - bv : bv - av;
    });

    body.innerHTML = `
      ${this.seasonSummaryHTML(entries)}
      ${this.leadersHTML(rows)}
      ${this.teamTrendsHTML(entries)}
      ${this.recurringHTML(entries)}
      <div class="ss-table-wrap">
        <table class="ss-table">
          <thead>
            <tr>
              <th class="ss-col-name ${key === 'number' ? 'is-sorted' : ''}" data-sort="number">Jogador</th>
              ${sparkMeta ? `<th class="ss-col-spark" title="${Utils.escapeHtml(sparkMeta.label)} nos últimos jogos (linha interrompida = não jogou)">Tend.</th>` : ''}
              ${PlayerStats.COLUMNS.map((c) => `<th class="ss-col-stat ${key === c.key ? 'is-sorted dir-' + dir : ''}" data-sort="${c.key}" title="${Utils.escapeHtml(c.title)}">${c.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(({ player, agg }) => `
              <tr class="ss-row" data-player="${player.id}">
                <td class="ss-col-name">
                  <span class="ss-num">${player.number || '–'}</span>
                  <span class="ss-pname">${Utils.escapeHtml(player.shortName || player.name)}</span>
                  ${player.position ? `<span class="ss-pos muted">${Utils.escapeHtml(player.position)}</span>` : ''}
                </td>
                ${sparkMeta ? `<td class="ss-col-spark">${TrendChart.sparkline(SeasonTrends.playerSeries(player.id, this.teamId, entries, key).map((pt) => pt.value))}</td>` : ''}
                ${PlayerStats.COLUMNS.map((c) => {
                  const v = agg[c.key] || 0;
                  return `<td class="ss-col-stat ${v ? '' : 'is-zero'} ${key === c.key ? 'is-sorted' : ''}">${v}</td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted ss-foot">Min = minutos aproximados (a partir do onze e das substituições). Toca numa linha para ver jogo a jogo.</p>`;

    TrendChart.drawAll(body);

    body.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (this.sort.key === k) this.sort.dir = this.sort.dir === 'desc' ? 'asc' : 'desc';
      else this.sort = { key: k, dir: k === 'number' ? 'asc' : 'desc' };
      this.renderBody();
    }));
    body.querySelectorAll('.ss-row').forEach((tr) => tr.addEventListener('click', () => {
      const row = rows.find((r) => r.player.id === tr.dataset.player);
      if (row) this.openPlayerBreakdown(row.player, row.agg);
    }));
  },

  /** Resumo da época: vitórias, empates, derrotas, golos e forma dos últimos jogos. */
  seasonSummaryHTML(entries) {
    const s = MatchStats.seasonSummary(this.teamId, entries);
    if (!s.played) return '';
    const form = s.form.slice(-5);
    return `
      <section class="ss-season">
        <div class="ss-season-cards">
          <div class="ss-season-card"><strong>${s.played}</strong><span>jogos</span></div>
          <div class="ss-season-card"><strong>${s.wins}<span class="ss-wdl">V</span> ${s.draws}<span class="ss-wdl">E</span> ${s.losses}<span class="ss-wdl">D</span></strong><span>resultados</span></div>
          <div class="ss-season-card"><strong>${s.goalsFor}<span class="ss-wdl">:</span>${s.goalsAgainst}</strong><span>golos marcados : sofridos</span></div>
          <div class="ss-season-card ss-season-form">
            <strong>${form.map((f) => `<span class="ss-form is-${f.result}" title="${Utils.escapeHtml(`${f.date ? Utils.formatDate(f.date) : ''} vs ${f.opponent || ''} (${f.score})`)}">${f.result}</span>`).join('')}</strong>
            <span>forma ${form.length === s.played ? '' : `(últimos ${form.length})`}</span>
          </div>
        </div>
        <p class="muted ss-season-note">Só jogos terminados. Sem pontos: a atribuição muda de prova para prova.</p>
      </section>`;
  },

  /** Eventos do plano que se repetem de jogo para jogo. */
  recurringHTML(entries) {
    const rows = MatchStats.recurringPlanEvents(entries);
    if (!rows.length) return '';
    const label = (r) => `${r.happened} de ${r.planned} ${r.planned === 1 ? 'jogo' : 'jogos'}`;
    return `
      <section class="ss-recurring">
        <h2 class="section-title">🔁 Repete-se de jogo para jogo <span class="muted">eventos do plano que aconteceram em 2 ou mais jogos</span></h2>
        <div class="ss-rec-list">
          ${rows.slice(0, 12).map((r) => `
            <div class="ss-rec-row type-${r.type}">
              <span class="ss-rec-name">${Utils.escapeHtml(r.name)}</span>
              <span class="ss-rec-games">${label(r)}</span>
              <span class="ss-rec-total">${r.total}×</span>
            </div>`).join('')}
        </div>
        <p class="muted ss-season-note">"3 de 4 jogos" = esteve no plano em 4 jogos e aconteceu em 3. O total é o número de registos.</p>
      </section>`;
  },

  /** Evolução da equipa: um pequeno gráfico por métrica, jogo a jogo, + tabela equivalente. */
  teamTrendsHTML(entries) {
    if (entries.length < 2) {
      return entries.length ? '<p class="muted ss-trend-note">A evolução da equipa aparece a partir de 2 jogos.</p>' : '';
    }
    const series = SeasonTrends.teamSeries(this.teamId, entries);
    const shortDate = (d) => (d ? Utils.formatDate(d).slice(0, 5) : '—');
    const pointsFor = (k) => series.map((row) => ({ label: shortDate(row.date), sub: `vs ${row.opponentName || '—'}`, value: row[k] }));
    return `
      <section class="ss-trends">
        <h2 class="section-title">📈 Evolução da equipa <span class="muted">jogo a jogo, do mais antigo para o mais recente</span></h2>
        <div class="ss-trend-grid">
          ${SeasonTrends.TEAM_KEYS.map((k) => TrendChart.html({ title: k.label, points: pointsFor(k.key), height: 104 })).join('')}
        </div>
        <details class="ss-trend-table">
          <summary>Ver em tabela</summary>
          <div class="ss-table-wrap">
            <table class="ss-table ss-table-plain">
              <thead><tr><th>Jogo</th>${SeasonTrends.TEAM_KEYS.map((k) => `<th>${k.label}</th>`).join('')}</tr></thead>
              <tbody>
                ${series.map((row) => `<tr><td>${row.date ? Utils.formatDate(row.date) : '—'} <span class="muted">${Utils.escapeHtml(row.opponentName || '')}</span></td>${SeasonTrends.TEAM_KEYS.map((k) => `<td>${row[k.key]}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
        </details>
      </section>`;
  },

  leadersHTML(rows) {
    const leader = (key) => {
      const best = [...rows].filter((r) => r.agg[key] > 0).sort((a, b) => b.agg[key] - a.agg[key])[0];
      return best ? { name: best.player.shortName || best.player.name, num: best.player.number, val: best.agg[key] } : null;
    };
    const cards = [
      ['⚽ Melhor marcador', leader('goals')],
      ['🅰️ Mais assistências', leader('assists')],
      ['⏱ Mais minutos', leader('minutes')],
      ['🎯 Mais remates', leader('shots')],
      ['🟨 Mais faltas', leader('foulsCommitted')],
    ].filter(([, v]) => v);
    if (!cards.length) return '';
    return `<div class="ss-leaders">${cards.map(([label, l]) => `
      <div class="ss-leader">
        <span class="ss-leader-label">${label}</span>
        <strong>${l.num ? '#' + l.num + ' ' : ''}${Utils.escapeHtml(l.name)}</strong>
        <span class="ss-leader-val">${l.val}</span>
      </div>`).join('')}</div>`;
  },

  openPlayerBreakdown(player, agg) {
    // Num plantel adversário, o adversário de cada jogo é a nossa equipa.
    const matchById = new Map(this.scopedEntries().map((e) => [e.match.id, e.match]));
    const oppOf = (r) => {
      const m = matchById.get(r.matchId);
      return m && SeasonTrends.sideOf(m, this.teamId) === 'opponent' ? m.team : (r.opponent || '');
    };
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    const cols = ['minutes', 'goals', 'assists', 'shots', 'shotsOnTarget', 'recuperacoes', 'perdas', 'foulsCommitted', 'foulsSuffered', 'yellow', 'red'];
    const colLabel = (k) => PlayerStats.COLUMNS.find((c) => c.key === k)?.label || k;
    const p90line = agg.minutes >= 45 ? `<p class="muted">Por 90 min: ${['goals', 'assists', 'shots'].map((k) => `${colLabel(k)} ${PlayerStats.per90(agg[k], agg.minutes)}`).join(' · ')}</p>` : '';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>${player.number ? '#' + player.number + ' ' : ''}${Utils.escapeHtml(player.name)}</h3>
          <button type="button" class="btn btn-tiny" id="ss-player-pdf" title="Ficha individual para conversas de feedback">📄 Ficha PDF</button>
          <button type="button" class="icon-btn" data-close>✕</button>
        </div>
        <p class="muted">${agg.apps} jogo${agg.apps === 1 ? '' : 's'} (${agg.starts} titular) · ${agg.minutes}′ aprox. · ${agg.goals} golo${agg.goals === 1 ? '' : 's'} · ${agg.assists} assist.</p>
        ${p90line}
        <div class="ss-breakdown-trend">
          <div class="ss-metric-chips" role="group" aria-label="Métrica do gráfico">
            ${SeasonTrends.PLAYER_KEYS.map((k) => `<button type="button" class="btn btn-tiny" data-metric="${k.key}">${k.label}</button>`).join('')}
          </div>
          <div id="ss-player-trend"></div>
          <p class="muted ss-trend-verdict" id="ss-trend-verdict"></p>
        </div>
        <div class="ss-table-wrap">
          <table class="ss-table ss-table-breakdown">
            <thead><tr><th>Jogo</th><th>Estado</th>${cols.map((k) => `<th title="${Utils.escapeHtml(PlayerStats.COLUMNS.find((c) => c.key === k).title)}">${colLabel(k)}</th>`).join('')}</tr></thead>
            <tbody>
              ${agg.perMatch.length ? agg.perMatch.map((r) => `
                <tr data-open-match="${r.matchId}" data-open-player="${player.id}">
                  <td>${Utils.formatDate(r.date)} <span class="muted">${Utils.escapeHtml(oppOf(r))}</span></td>
                  <td>${r.status === 'starter' ? 'Titular' : (r.status === 'sub' ? 'Suplente' : '—')}</td>
                  ${cols.map((k) => `<td class="${r[k] ? '' : 'is-zero'}">${r[k] || 0}</td>`).join('')}
                </tr>`).join('') : `<tr><td colspan="${cols.length + 2}" class="muted">Sem participações registadas.</td></tr>`}
            </tbody>
          </table>
        </div>
        <p class="muted">Toca numa linha para abrir a ficha desse jogo.</p>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-close]').addEventListener('click', () => { dlg.close(); dlg.remove(); });
    // Esc fechava sem remover — o diálogo ficava morto no DOM a cada abertura.
    dlg.addEventListener('cancel', () => { dlg.remove(); });

    // Evolução jogo a jogo, na métrica escolhida (começa na coluna ordenada, se servir).
    const entries = this.scopedEntries();
    let metric = SeasonTrends.PLAYER_KEYS.some((k) => k.key === this.sort.key) ? this.sort.key : 'minutes';
    const paintTrend = () => {
      const meta = SeasonTrends.PLAYER_KEYS.find((k) => k.key === metric);
      const series = SeasonTrends.playerSeries(player.id, this.teamId, entries, metric);
      const holder = dlg.querySelector('#ss-player-trend');
      holder.innerHTML = TrendChart.html({
        title: `${meta.label} por jogo`,
        points: series.map((pt) => ({ label: pt.date ? Utils.formatDate(pt.date).slice(0, 5) : '—', sub: `vs ${pt.opponentName || '—'}`, value: pt.value })),
        unit: meta.unit || '',
        height: 150,
        caption: 'Linha interrompida = jogo em que não jogou.',
      });
      TrendChart.drawAll(holder);
      dlg.querySelectorAll('[data-metric]').forEach((b) => b.classList.toggle('active', b.dataset.metric === metric));
      const cmp = SeasonTrends.recentVsBefore(series);
      const f = (n) => `${SeasonTrends.formatNumber(n)}${meta.unit || ''}`;
      // Seta neutra: mais perdas ou mais faltas não é "subir" no bom sentido.
      dlg.querySelector('#ss-trend-verdict').textContent = cmp
        ? `Últimos ${cmp.recentN} jogos em que jogou: média ${f(cmp.recentAvg)} por jogo · nos ${cmp.beforeN} anteriores: ${f(cmp.beforeAvg)} (${cmp.delta > 0 ? '▲' : (cmp.delta < 0 ? '▼' : '=')} ${f(Math.abs(cmp.delta))})`
        : `A comparação com os jogos anteriores aparece a partir de ${SeasonTrends.MIN_PLAYED_FOR_TREND} jogos em que jogou.`;
    };
    dlg.querySelectorAll('[data-metric]').forEach((b) => b.addEventListener('click', () => { metric = b.dataset.metric; paintTrend(); }));
    paintTrend();

    // Ficha individual: os mesmos jogos em âmbito (respeita o filtro de competição)
    // e a métrica que estiver escolhida no gráfico.
    dlg.querySelector('#ss-player-pdf').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const team = this.teams.find((t) => t.id === this.teamId) || null;
        const scopeLabel = `${this.competition === 'all' ? 'Todas as competições' : this.competition} · ${entries.length} ${entries.length === 1 ? 'jogo' : 'jogos'}`;
        await PDFPlayer.generate({ player, teamId: this.teamId, team, entries, metricKey: metric, scopeLabel });
      } catch (err) {
        console.error('Ficha PDF falhou:', err);
        alert('Não foi possível gerar a ficha: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    });
    dlg.querySelectorAll('[data-open-match]').forEach((tr) => tr.addEventListener('click', () => {
      dlg.close(); dlg.remove();
      window.location.hash = `#/player/${tr.dataset.openMatch}/${tr.dataset.openPlayer}`;
    }));
  },

  exportCSV() {
    const rows = this.computeRows();
    const header = ['Numero', 'Jogador', 'Posicao', ...PlayerStats.COLUMNS.map((c) => c.title)];
    const lines = rows.map(({ player, agg }) => [
      player.number ?? '', player.name, player.position || '',
      ...PlayerStats.COLUMNS.map((c) => agg[c.key] || 0),
    ]);
    const csv = [header, ...lines].map((r) => r.map((v) => {
      const s = String(v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\n');
    const team = this.teams.find((t) => t.id === this.teamId);
    const fname = `estatisticas_${(team ? team.name : 'plantel').replace(/\s+/g, '-')}.csv`;
    downloadFile(fname, '﻿' + csv, 'text/csv;charset=utf-8');
    toast('Estatísticas exportadas');
  },
};

window.SquadStatsScreen = SquadStatsScreen;
