/**
 * postgame.js — Resumo pós-jogo + exportação + momentos para o Once.
 */

const PostgameScreen = {
  async render(root, params) {
    const match = await DB.get(DB.STORES.matches, params.matchId);
    if (!match) { window.location.hash = '#/dashboard'; return; }
    const occurrences = await AppState.getOccurrences(match.id);

    // Jogadores das duas equipas (para resolver nomes na exportação CSV e nas estatísticas)
    const ownTeamId = match.teams?.own?.teamId;
    const opponentTeamId = match.teams?.opponent?.teamId;
    const ownPlayers = ownTeamId ? await AppState.getTeamPlayers(ownTeamId) : [];
    const opponentPlayers = opponentTeamId ? await AppState.getTeamPlayers(opponentTeamId) : [];
    const allPlayers = [...ownPlayers, ...opponentPlayers];
    const gameStats = MatchStats.compute(match, occurrences);

    const counts = {};
    occurrences.forEach((o) => { if (o.planEventId) counts[o.planEventId] = (counts[o.planEventId] || 0) + 1; });
    const eventsWithCounts = (match.observationPlan || []).map((e) => ({ ...e, count: counts[e.id] || 0 })).filter((e) => e.count > 0);
    const problems = eventsWithCounts.filter((e) => e.type === 'negative').sort((a, b) => b.count - a.count).slice(0, 8);
    const positives = eventsWithCounts.filter((e) => e.type === 'positive').sort((a, b) => b.count - a.count).slice(0, 8);
    const bench = occurrences.filter((o) => o.source === 'banco');
    const moments = occurrences.filter((o) => o.source === 'momento');
    const notes = occurrences.filter((o) => o.source === 'nota');
    const momentsForReview = ExportManager.buildMomentsList(occurrences);

    root.innerHTML = `
      <div class="screen postgame-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Resumo do Jogo</h1>
          <span></span>
        </header>

        <div class="pg-result">
          <span>${Utils.escapeHtml(match.team)}</span>
          <strong>${match.score.team} - ${match.score.opponent}</strong>
          <span>${Utils.escapeHtml(match.opponent)}</span>
        </div>
        <p class="muted center">${Utils.formatDate(match.date)} · ${Utils.escapeHtml(match.competition || '')} · ${occurrences.length} registos</p>

        <section class="once-panel">
          <h2>📊 Estatísticas do Jogo</h2>
          <table class="stats-table">
            ${MatchStats.STAT_KEYS.map((k) => `
              <tr class="stats-row">
                <td class="stats-cell-val"><span class="stats-num">${gameStats.own[k.key]}</span></td>
                <td class="stats-cell-label">${k.label}</td>
                <td class="stats-cell-val"><span class="stats-num">${gameStats.opp[k.key]}</span></td>
              </tr>
            `).join('')}
          </table>
        </section>

        <div class="halftime-grid pg-maps-grid">
          <section class="ht-card">${MatchStats.renderMapHTML('shots', occurrences, match.team, match.opponent)}</section>
          <section class="ht-card">${MatchStats.renderMapHTML('fouls', occurrences, match.team, match.opponent)}</section>
        </div>

        <div class="halftime-grid">
          <section class="ht-card ht-card-problems">
            <h2>🔴 Principais Problemas</h2>
            ${listOrEmpty2(problems, (e) => `<div class="ht-row"><span>${Utils.escapeHtml(e.name)}</span><strong>${e.count}×</strong></div>`)}
          </section>
          <section class="ht-card ht-card-positives">
            <h2>🟢 Principais Pontos Positivos</h2>
            ${listOrEmpty2(positives, (e) => `<div class="ht-row"><span>${Utils.escapeHtml(e.name)}</span><strong>${e.count}×</strong></div>`)}
          </section>
          <section class="ht-card ht-card-bench">
            <h2>🚨 Intervenções ao Banco</h2>
            ${listOrEmpty2(bench, (o) => `<div class="ht-row"><span>${o.period} ${String(o.minute).padStart(2, '0')}' — ${Utils.escapeHtml(o.eventName)}</span>${o.note ? `<span class="muted">"${Utils.escapeHtml(o.note)}"</span>` : ''}</div>`)}
          </section>
          <section class="ht-card ht-card-moments">
            <h2>⭐ Momentos</h2>
            ${listOrEmpty2(moments, (o) => `<div class="ht-row"><span>${o.period} ${String(o.minute).padStart(2, '0')}'</span>${o.note ? `<span class="muted">"${Utils.escapeHtml(o.note)}"</span>` : ''}</div>`)}
          </section>
          <section class="ht-card">
            <h2>📝 Notas</h2>
            ${listOrEmpty2(notes, (o) => `<div class="ht-row"><span>${o.period} ${String(o.minute).padStart(2, '0')}'</span><span class="muted">"${Utils.escapeHtml(o.note)}"</span></div>`)}
          </section>
        </div>

        <section class="once-panel">
          <h2>Momentos para Rever <span class="muted">(referência para o Once Sport Analyser Pro)</span></h2>
          <div class="once-moments">
            ${momentsForReview.length ? momentsForReview.map((m) => `<span class="once-chip">${m.label}</span>`).join('') : '<p class="muted">Sem momentos críticos registados.</p>'}
          </div>
          <div class="once-actions">
            <button class="btn" id="btn-copy-moments">📋 Copiar Minutos</button>
            <button class="btn" id="btn-export-moments">Exportar Momentos (CSV)</button>
          </div>
        </section>

        <section class="export-panel">
          <h2>✏️ Notas Manuscritas</h2>
          <div id="sketch-preview-area"><p class="muted">A carregar…</p></div>
          <div class="export-actions">
            <button class="btn" id="btn-open-sketch">Abrir bloco de notas</button>
          </div>
        </section>

        <section class="export-panel">
          <h2>Exportar Dados do Jogo</h2>
          <div class="export-actions">
            <button class="btn btn-primary" id="btn-report-pdf">📄 Gerar Relatório PDF</button>
            <button class="btn" id="btn-export-csv">⬇ Exportar CSV</button>
            <button class="btn" id="btn-export-json">⬇ Backup JSON (jogo)</button>
          </div>
        </section>

        <div class="halftime-actions">
          <button class="btn" data-nav="#/games">Ver Jogos Anteriores</button>
          <button class="btn btn-primary" data-nav="#/dashboard">Voltar ao Início</button>
        </div>
      </div>

      <dialog id="dlg-report-config" class="dialog dialog-wide">
        <div class="dialog-card">
          <h3>📄 Configurar Relatório</h3>
          <label class="field"><span>Título</span><input id="rep-title" value="Relatório de Observação"></label>
          <label class="field"><span>Subtítulo</span><input id="rep-subtitle" placeholder="Ex: Análise tática — Equipa Sub-19"></label>
          <label class="field"><span>Observações finais</span><textarea id="rep-final" rows="3" placeholder="Conclusões do analista (opcional)..."></textarea></label>
          <p class="field-label">Secções a incluir</p>
          <div class="report-sections" id="rep-sections"></div>
          <div class="dialog-actions">
            <button type="button" class="btn" id="rep-cancel">Cancelar</button>
            <button type="button" class="btn" id="rep-save-template">Guardar como modelo</button>
            <button type="button" class="btn btn-primary" id="rep-generate">Gerar PDF</button>
          </div>
        </div>
      </dialog>
    `;

    document.getElementById('btn-copy-moments').addEventListener('click', async () => {
      await ExportManager.copyMomentsToClipboard(momentsForReview);
      toast('Minutos copiados para a área de transferência');
    });

    // ---------- Notas manuscritas ----------
    const renderSketchPreview = async () => {
      const area = document.getElementById('sketch-preview-area');
      const pages = (await DB.getAllByIndex(DB.STORES.drawings, 'matchId', match.id))
        .sort((a, b) => a.pageIndex - b.pageIndex)
        .filter((p) => (p.strokes || []).length > 0);
      if (!pages.length) {
        area.innerHTML = '<p class="muted">Sem apontamentos manuscritos neste jogo.</p>';
        return;
      }
      area.innerHTML = `<div class="sketch-thumbs">${pages.map((p, i) =>
        `<div class="sketch-thumb"><canvas data-page="${i}" width="260" height="170"></canvas><span class="muted">Página ${p.pageIndex + 1} · ${p.strokes.length} traços</span></div>`
      ).join('')}</div>`;
      // Redesenha cada página em miniatura a partir dos traços vetoriais guardados.
      area.querySelectorAll('canvas[data-page]').forEach((cv) => {
        const page = pages[Number(cv.dataset.page)];
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#12161f';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        (page.strokes || []).forEach((s) => {
          if (s.eraser) return; // borracha não é representável numa miniatura simples
          ctx.strokeStyle = s.color || '#eef1f6';
          const pts = s.points || [];
          for (let i = 1; i < pts.length; i++) {
            ctx.beginPath();
            ctx.lineWidth = Math.max(0.5, (s.width * (0.6 + pts[i].p)) * (cv.width / 1000));
            ctx.moveTo(pts[i - 1].x * cv.width, pts[i - 1].y * cv.height);
            ctx.lineTo(pts[i].x * cv.width, pts[i].y * cv.height);
            ctx.stroke();
          }
        });
      });
    };
    renderSketchPreview();
    document.getElementById('btn-open-sketch').addEventListener('click', () => {
      SketchPad.open(match.id, { onClose: renderSketchPreview });
    });
    document.getElementById('btn-export-moments').addEventListener('click', () => {
      ExportManager.exportMomentsCSV(match, momentsForReview);
      toast('Ficheiro de momentos exportado');
    });
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      ExportManager.exportMatchCSV(match, occurrences, allPlayers);
      toast('CSV exportado');
    });
    document.getElementById('btn-export-json').addEventListener('click', () => {
      ExportManager.exportMatchJSON(match, occurrences);
      toast('Backup do jogo exportado');
    });

    // ---------- Relatório PDF ----------
    const dlgReport = document.getElementById('dlg-report-config');
    const savedTemplate = AppState.settings?.reportTemplate || null;

    document.getElementById('rep-sections').innerHTML = PDFReport.SECTIONS.map((s) => {
      const checked = savedTemplate ? (savedTemplate.sections?.[s.key] ? 'checked' : '') : 'checked';
      return `<label class="report-section-item"><input type="checkbox" data-section="${s.key}" ${checked}><span>${s.label}</span></label>`;
    }).join('');
    if (savedTemplate) {
      document.getElementById('rep-title').value = savedTemplate.title || 'Relatório de Observação';
      document.getElementById('rep-subtitle').value = savedTemplate.subtitle || '';
    }

    const readConfig = () => {
      const sections = {};
      document.querySelectorAll('#rep-sections [data-section]').forEach((cb) => { sections[cb.dataset.section] = cb.checked; });
      return {
        sections,
        title: document.getElementById('rep-title').value.trim(),
        subtitle: document.getElementById('rep-subtitle').value.trim(),
        finalNotes: document.getElementById('rep-final').value.trim(),
      };
    };

    document.getElementById('btn-report-pdf').addEventListener('click', () => dlgReport.showModal());
    document.getElementById('rep-cancel').addEventListener('click', () => dlgReport.close());
    document.getElementById('rep-save-template').addEventListener('click', async () => {
      const cfg = readConfig();
      await AppState.saveSettings({ reportTemplate: { sections: cfg.sections, title: cfg.title, subtitle: cfg.subtitle } });
      toast('Modelo de relatório guardado');
    });
    document.getElementById('rep-generate').addEventListener('click', async () => {
      const btn = document.getElementById('rep-generate');
      btn.disabled = true;
      btn.textContent = 'A gerar…';
      try {
        const ownTeam = ownTeamId ? await DB.get(DB.STORES.teams, ownTeamId) : null;
        const opponentTeam = opponentTeamId ? await DB.get(DB.STORES.teams, opponentTeamId) : null;
        const drawings = await DB.getAllByIndex(DB.STORES.drawings, 'matchId', match.id);
        await PDFReport.generate(
          { match, occurrences, ownTeam, opponentTeam, ownPlayers, opponentPlayers, drawings },
          readConfig()
        );
        dlgReport.close();
        toast('Relatório PDF gerado');
      } catch (err) {
        console.error('Erro ao gerar PDF:', err);
        alert('Não foi possível gerar o PDF: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Gerar PDF';
      }
    });
  },
};

function listOrEmpty2(arr, renderFn) {
  if (!arr || arr.length === 0) return '<p class="muted">Sem registos.</p>';
  return arr.map(renderFn).join('');
}

window.PostgameScreen = PostgameScreen;
