/**
 * trendChart.js — Gráfico de linha (uma série) e sparkline, em SVG simples.
 *
 * Regras de visualização seguidas: uma série por gráfico (nunca dois eixos);
 * linha de 2px; marcadores de 8px com anel da cor do fundo; grelha em linha
 * fina; valor escrito só no último ponto (o resto vive no tooltip e na tabela);
 * texto sempre com as cores de texto, nunca com a cor da série. Um valor `null`
 * interrompe a linha — é uma ausência (ex.: jogo em que não jogou), não um zero.
 *
 * As cores vêm de tokens CSS (--chart-series, --chart-deemph, --chart-grid,
 * --chart-axis, --chart-surface), validados contra o fundo de cada tema.
 */

const TrendChart = {
  _resizeBound: false,

  /**
   * Marcação de um gráfico por desenhar. `points`: [{label, sub, value}] por ordem.
   * O desenho acontece em draw()/drawAll(), com a largura real do contentor.
   */
  html({ title, points, unit = '', height = 110, caption = '' }) {
    const data = Utils.escapeHtml(JSON.stringify({ title, points, unit, height }));
    return `
      <figure class="trend-figure" data-trend-chart="${data}">
        <figcaption class="trend-title">${Utils.escapeHtml(title)}</figcaption>
        <div class="trend-plot"></div>
        ${caption ? `<p class="trend-caption">${Utils.escapeHtml(caption)}</p>` : ''}
      </figure>`;
  },

  /** Desenha todos os gráficos dentro de `root`. Redesenha sozinho ao rodar o iPad. */
  drawAll(root = document) {
    root.querySelectorAll('[data-trend-chart]').forEach((el) => this.draw(el));
    if (!this._resizeBound) {
      this._resizeBound = true;
      let timer = null;
      // Um único ouvinte global: só redesenha o que estiver no ecrã nesse momento.
      window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.drawAll(document), 150);
      });
    }
  },

  draw(el) {
    let cfg;
    try { cfg = JSON.parse(el.dataset.trendChart); } catch (e) { return; }
    const plot = el.querySelector('.trend-plot');
    if (!plot) return;
    // Largura real do contentor. Abaixo de 120px as margens deixariam o gráfico
    // com medidas negativas — diz-se isso em vez de desenhar mal; o redesenho
    // ao mudar o tamanho do ecrã trata de o desenhar quando houver espaço.
    const width = Math.floor(plot.clientWidth);
    if (width < 120) {
      plot.innerHTML = '<p class="trend-empty">Sem espaço para desenhar o gráfico.</p>';
      return;
    }

    const pts = cfg.points || [];
    const unit = cfg.unit || '';
    const fmt = (v) => `${SeasonTrends.formatNumber(v)}${unit}`;
    const values = pts.map((p) => p.value).filter((v) => v != null);
    if (!values.length) {
      plot.innerHTML = '<p class="trend-empty">Sem registos nesta métrica.</p>';
      return;
    }

    const H = cfg.height || 110;
    const pad = { l: 30, r: 26, t: 14, b: 22 };
    const plotW = width - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const yMax = SeasonTrends.niceMax(Math.max(...values));
    const x = (i) => pad.l + (pts.length > 1 ? (i * plotW) / (pts.length - 1) : plotW / 2);
    const y = (v) => pad.t + plotH - (v / yMax) * plotH;

    // Segmentos contínuos entre ausências.
    const segments = [];
    let cur = [];
    pts.forEach((p, i) => {
      if (p.value == null) { if (cur.length) segments.push(cur); cur = []; } else cur.push(i);
    });
    if (cur.length) segments.push(cur);
    const pathD = segments.filter((s) => s.length > 1)
      .map((s) => s.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(pts[i].value).toFixed(1)}`).join(' '))
      .join(' ');
    const lastIdx = [...pts.keys()].reverse().find((i) => pts[i].value != null);

    // Marcadores: todos com poucos jogos; com muitos, só os pontos isolados e o último.
    const marked = new Set();
    segments.forEach((s) => { if (s.length === 1 || pts.length <= 12) s.forEach((i) => marked.add(i)); });
    marked.add(lastIdx);
    const dots = [...marked].map((i) =>
      `<circle class="tc-dot" cx="${x(i).toFixed(1)}" cy="${y(pts[i].value).toFixed(1)}" r="4"></circle>`).join('');

    const lx = Math.min(width - 12, Math.max(pad.l + 10, x(lastIdx)));
    const ly = Math.max(10, y(pts[lastIdx].value) - 9);
    const endLabel = `<text class="tc-endlabel" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${Utils.escapeHtml(fmt(pts[lastIdx].value))}</text>`;

    const xLab = (i, anchor) =>
      `<text class="tc-tick" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${Utils.escapeHtml(pts[i].label || '')}</text>`;
    const xLabels = pts.length === 1 ? xLab(0, 'middle') : xLab(0, 'start') + xLab(pts.length - 1, 'end');

    const aria = `${cfg.title}: ${pts.map((p) => `${p.label} ${p.value == null ? 'não jogou' : fmt(p.value)}`).join('; ')}`;
    plot.innerHTML = `
      <svg class="tc-svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" tabindex="0" aria-label="${Utils.escapeHtml(aria)}">
        <line class="tc-grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y(yMax)}" y2="${y(yMax)}"></line>
        <line class="tc-axis" x1="${pad.l}" x2="${width - pad.r}" y1="${y(0)}" y2="${y(0)}"></line>
        <text class="tc-tick" x="${pad.l - 6}" y="${y(yMax) + 3}" text-anchor="end">${yMax}</text>
        <text class="tc-tick" x="${pad.l - 6}" y="${y(0) + 3}" text-anchor="end">0</text>
        ${xLabels}
        <path class="tc-line" d="${pathD}"></path>
        <line class="tc-cross" x1="0" x2="0" y1="${pad.t}" y2="${y(0)}" visibility="hidden"></line>
        ${dots}
        ${endLabel}
        <circle class="tc-hover-dot" r="4" visibility="hidden"></circle>
        <rect class="tc-hit" x="${pad.l - 12}" y="0" width="${plotW + 24}" height="${H}" fill="transparent"></rect>
      </svg>
      <div class="trend-tooltip" hidden><strong class="tt-value"></strong><span class="tt-label"></span><span class="tt-sub"></span></div>`;

    // ---- Camada de interação: linha vertical que salta para o jogo mais próximo ----
    const svg = plot.querySelector('svg');
    const cross = svg.querySelector('.tc-cross');
    const hoverDot = svg.querySelector('.tc-hover-dot');
    const tip = plot.querySelector('.trend-tooltip');
    let active = null;

    const show = (i) => {
      active = i;
      const p = pts[i];
      const cx = x(i);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      if (p.value != null) {
        hoverDot.setAttribute('cx', cx);
        hoverDot.setAttribute('cy', y(p.value));
        hoverDot.setAttribute('visibility', 'visible');
      } else {
        hoverDot.setAttribute('visibility', 'hidden');
      }
      // Textos vindos dos dados (nomes de adversários): sempre por textContent.
      tip.querySelector('.tt-value').textContent = p.value == null ? 'Não jogou' : fmt(p.value);
      tip.querySelector('.tt-label').textContent = p.label || '';
      tip.querySelector('.tt-sub').textContent = p.sub || '';
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(width - tw / 2 - 2, Math.max(tw / 2 + 2, cx))}px`;
      tip.style.top = `${(p.value != null ? y(p.value) : y(0)) - 10}px`;
    };
    const hide = () => {
      active = null;
      cross.setAttribute('visibility', 'hidden');
      hoverDot.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    const nearest = (clientX) => {
      if (pts.length === 1) return 0;
      const px = clientX - svg.getBoundingClientRect().left;
      return Math.max(0, Math.min(pts.length - 1, Math.round(((px - pad.l) / plotW) * (pts.length - 1))));
    };

    svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
    svg.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
    // No iPad o dedo "sai" ao levantar — aí o valor fica visível até ao próximo toque.
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('focus', () => show(active ?? lastIdx));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const base = active ?? lastIdx;
      show(Math.max(0, Math.min(pts.length - 1, base + (e.key === 'ArrowRight' ? 1 : -1))));
    });
  },

  /** Sparkline fixa para tabelas: série em tom secundário, último jogo em destaque. */
  sparkline(values, { width = 72, height = 24 } = {}) {
    const vals = values.slice(-10);
    const nums = vals.filter((v) => v != null);
    if (!nums.length) return '<span class="muted">—</span>';
    const max = SeasonTrends.niceMax(Math.max(...nums));
    const p = 4;
    const x = (i) => p + (vals.length > 1 ? (i * (width - 2 * p)) / (vals.length - 1) : (width - 2 * p) / 2);
    const y = (v) => height - p - (v / max) * (height - 2 * p);
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    const last = [...vals.keys()].reverse().find((i) => vals[i] != null);
    const label = `Últimos ${vals.length} jogos: ${vals.map((v) => (v == null ? 'não jogou' : SeasonTrends.formatNumber(v))).join(', ')}`;
    return `<svg class="ss-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${Utils.escapeHtml(label)}"><title>${Utils.escapeHtml(label)}</title><path class="tc-spark-line" d="${d.trim()}"></path><circle class="tc-spark-last" cx="${x(last).toFixed(1)}" cy="${y(vals[last]).toFixed(1)}" r="3.5"></circle></svg>`;
  },
};

window.TrendChart = TrendChart;
