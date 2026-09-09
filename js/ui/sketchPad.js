/**
 * sketchPad.js — Notas manuscritas (Apple Pencil / stylus / dedo / rato).
 *
 * DECISÕES TÉCNICAS (verificadas contra as capacidades reais do Safari/iPadOS):
 *  - Usa Pointer Events: `pointerType` distingue 'pen' (Apple Pencil) de 'touch'
 *    e 'mouse'; `pressure` dá a força do traço quando disponível.
 *  - `getCoalescedEvents()` NÃO é suportado no Safari, por isso não é possível
 *    recolher os pontos intermédios de alta frequência. Compensamos suavizando
 *    a curva (quadráticas entre pontos médios), o que dá um traço fluido mesmo
 *    com menor densidade de amostras.
 *  - `touch-action: none` no canvas impede o scroll involuntário ao desenhar.
 *  - Os traços são guardados em VETOR com coordenadas normalizadas (0–1), não
 *    como imagem: ficam leves, redesenham nítidos em qualquer tamanho de ecrã
 *    e permitem undo/redo fiável.
 *
 * Limitações conhecidas (documentadas ao utilizador nas Definições):
 *  - O Safari não entrega Pencil e dedo em simultâneo.
 *  - Gestos próprios do Pencil (duplo toque do Pencil 2, hover) não estão
 *    acessíveis a uma PWA.
 *  - Se o "Scribble" estiver ativo (Definições > Apple Pencil), o iPadOS pode
 *    consumir alguns eventos; recomendamos desligá-lo para escrita fluida.
 */

const SketchPad = {
  matchId: null,
  pages: [],        // [{ id, matchId, pageIndex, strokes: [...], updatedAt }]
  pageIdx: 0,
  redoStack: [],
  tool: { color: '#eef1f6', width: 3, eraser: false },
  inputMode: 'both', // 'pen' | 'touch' | 'both'
  _dlg: null,
  _canvas: null,
  _ctx: null,
  _drawing: false,
  _current: null,
  _onCloseCb: null,

  COLORS: ['#eef1f6', '#5b93f0', '#e5555c', '#3fc98a', '#e3b23c', '#a889f0'],
  WIDTHS: [2, 3, 6, 10],

  async open(matchId, { onClose } = {}) {
    this.matchId = matchId;
    this._onCloseCb = onClose || null;
    this.pages = (await DB.getAllByIndex(DB.STORES.drawings, 'matchId', matchId))
      .sort((a, b) => a.pageIndex - b.pageIndex);
    if (this.pages.length === 0) this.pages = [this.newPage(0)];
    this.pageIdx = 0;
    this.redoStack = [];
    this.inputMode = AppState.settings?.sketchInputMode || 'both';

    this._ensureDialog();
    this.renderChrome();
    this._dlg.showModal();
    // O canvas só tem dimensões reais depois de o dialog estar visível.
    requestAnimationFrame(() => { this.setupCanvas(); this.redraw(); });
  },

  newPage(index) {
    return { id: Utils.uid('draw'), matchId: this.matchId, pageIndex: index, strokes: [], updatedAt: Date.now() };
  },

  get page() { return this.pages[this.pageIdx]; },

  _ensureDialog() {
    if (this._dlg) return this._dlg;
    const dlg = document.createElement('dialog');
    dlg.id = 'dlg-sketch';
    dlg.className = 'dialog dialog-sketch';
    document.body.appendChild(dlg);
    this._dlg = dlg;
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
    return dlg;
  },

  renderChrome() {
    this._dlg.innerHTML = `
      <div class="sketch-card">
        <div class="sketch-toolbar">
          <div class="sketch-tools">
            ${this.COLORS.map((c) => `<button class="sketch-color ${c === this.tool.color && !this.tool.eraser ? 'active' : ''}" data-color="${c}" style="background:${c}" title="Cor"></button>`).join('')}
            <span class="sketch-sep"></span>
            ${this.WIDTHS.map((w) => `<button class="sketch-width ${w === this.tool.width ? 'active' : ''}" data-width="${w}" title="Espessura ${w}"><span style="width:${w + 2}px;height:${w + 2}px"></span></button>`).join('')}
            <span class="sketch-sep"></span>
            <button class="btn btn-tiny ${this.tool.eraser ? 'btn-primary' : ''}" id="sk-eraser" title="Apagar">🩹 Apagar</button>
            <button class="btn btn-tiny" id="sk-undo" title="Desfazer">↶</button>
            <button class="btn btn-tiny" id="sk-redo" title="Refazer">↷</button>
            <button class="btn btn-tiny btn-danger" id="sk-clear" title="Limpar página">Limpar</button>
          </div>
          <div class="sketch-tools">
            <select id="sk-input-mode" title="Que tipo de toque desenha">
              <option value="both" ${this.inputMode === 'both' ? 'selected' : ''}>Pencil + Dedo</option>
              <option value="pen" ${this.inputMode === 'pen' ? 'selected' : ''}>Só Pencil</option>
              <option value="touch" ${this.inputMode === 'touch' ? 'selected' : ''}>Só Dedo</option>
            </select>
            <span class="sketch-pages">
              <button class="btn btn-tiny" id="sk-prev">‹</button>
              <span id="sk-page-label">1 / 1</span>
              <button class="btn btn-tiny" id="sk-next">›</button>
              <button class="btn btn-tiny" id="sk-add-page">＋ Página</button>
            </span>
            <button class="btn btn-tiny" id="sk-export">⬇ PNG</button>
            <button class="btn btn-primary btn-tiny" id="sk-close">Concluir</button>
          </div>
        </div>
        <div class="sketch-canvas-wrap">
          <canvas id="sketch-canvas"></canvas>
        </div>
        <p class="sketch-hint muted" id="sk-hint"></p>
      </div>
    `;
    this.bindChrome();
    this.updatePageLabel();
  },

  bindChrome() {
    const q = (s) => this._dlg.querySelector(s);
    this._dlg.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
      this.tool.color = b.dataset.color; this.tool.eraser = false; this.renderChrome(); this.setupCanvas(); this.redraw();
    }));
    this._dlg.querySelectorAll('[data-width]').forEach((b) => b.addEventListener('click', () => {
      this.tool.width = Number(b.dataset.width); this.renderChrome(); this.setupCanvas(); this.redraw();
    }));
    q('#sk-eraser').addEventListener('click', () => { this.tool.eraser = !this.tool.eraser; this.renderChrome(); this.setupCanvas(); this.redraw(); });
    q('#sk-undo').addEventListener('click', () => this.undo());
    q('#sk-redo').addEventListener('click', () => this.redo());
    q('#sk-clear').addEventListener('click', async () => {
      if (!this.page.strokes.length) return;
      if (!confirm('Limpar tudo o que está escrito nesta página?')) return;
      this.redoStack = [];
      this.page.strokes = [];
      await this.persist();
      this.redraw();
    });
    q('#sk-input-mode').addEventListener('change', async (e) => {
      this.inputMode = e.target.value;
      await AppState.saveSettings({ sketchInputMode: this.inputMode });
      this.updateHint();
    });
    q('#sk-prev').addEventListener('click', () => this.goPage(this.pageIdx - 1));
    q('#sk-next').addEventListener('click', () => this.goPage(this.pageIdx + 1));
    q('#sk-add-page').addEventListener('click', async () => {
      const p = this.newPage(this.pages.length);
      this.pages.push(p);
      await DB.put(DB.STORES.drawings, p);
      this.goPage(this.pages.length - 1);
    });
    q('#sk-export').addEventListener('click', () => this.exportPNG());
    q('#sk-close').addEventListener('click', () => this.close());
    this.updateHint();
  },

  updateHint() {
    const el = this._dlg.querySelector('#sk-hint');
    if (!el) return;
    const modeTxt = {
      both: 'Pencil e dedo desenham.',
      pen: 'Só o Apple Pencil desenha — o dedo fica livre para navegar.',
      touch: 'Só o dedo desenha.',
    }[this.inputMode];
    el.textContent = `${modeTxt} Guardado automaticamente.`;
  },

  updatePageLabel() {
    const el = this._dlg.querySelector('#sk-page-label');
    if (el) el.textContent = `${this.pageIdx + 1} / ${this.pages.length}`;
  },

  goPage(idx) {
    if (idx < 0 || idx >= this.pages.length) return;
    this.pageIdx = idx;
    this.redoStack = [];
    this.updatePageLabel();
    this.redraw();
  },

  setupCanvas() {
    const canvas = this._dlg.querySelector('#sketch-canvas');
    if (!canvas) return;
    this._canvas = canvas;
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth || 800;
    const h = wrap.clientHeight || 500;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    this._ctx = canvas.getContext('2d');
    this._ctx.scale(dpr, dpr);
    this._ctx.lineCap = 'round';
    this._ctx.lineJoin = 'round';
    this._w = w; this._h = h;

    if (!canvas._bound) {
      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      canvas.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('pointercancel', (e) => this.onUp(e));
      canvas.addEventListener('pointerleave', (e) => this.onUp(e));
      canvas._bound = true;
    }
  },

  /** O tipo de ponteiro é aceite conforme o modo escolhido (Pencil / Dedo / Ambos). */
  accepts(e) {
    if (this.inputMode === 'both') return true;
    if (this.inputMode === 'pen') return e.pointerType === 'pen' || e.pointerType === 'mouse';
    return e.pointerType !== 'pen';
  },

  pos(e) {
    const r = this._canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  },

  onDown(e) {
    if (!this.accepts(e)) return;
    e.preventDefault();
    this._canvas.setPointerCapture(e.pointerId);
    this._drawing = true;
    this.redoStack = [];
    const p = this.pos(e);
    // pressure=0 acontece em ratos e em alguns toques; 0.5 é o valor neutro.
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    this._current = {
      color: this.tool.eraser ? null : this.tool.color,
      width: this.tool.width,
      eraser: this.tool.eraser,
      points: [{ ...p, p: pressure }],
    };
  },

  onMove(e) {
    if (!this._drawing || !this._current) return;
    if (!this.accepts(e)) return;
    e.preventDefault();
    const p = this.pos(e);
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    const pts = this._current.points;
    const last = pts[pts.length - 1];
    // ignora micro-movimentos para não inchar os dados
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.001) return;
    pts.push({ ...p, p: pressure });
    this.drawStroke(this._current, true);
  },

  async onUp(e) {
    if (!this._drawing) return;
    this._drawing = false;
    if (this._current && this._current.points.length > 1) {
      this.page.strokes.push(this._current);
      await this.persist();
    } else if (this._current && this._current.points.length === 1) {
      // toque simples = ponto
      this.page.strokes.push(this._current);
      await this.persist();
      this.redraw();
    }
    this._current = null;
  },

  strokeStyleFor(s) {
    return s.eraser ? 'rgba(0,0,0,1)' : s.color;
  },

  /** Desenha um traço com suavização por curvas quadráticas entre pontos médios. */
  drawStroke(s, incremental = false) {
    const ctx = this._ctx;
    const W = this._w, H = this._h;
    const pts = s.points;
    if (!pts.length) return;

    ctx.save();
    ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = this.strokeStyleFor(s);
    ctx.fillStyle = this.strokeStyleFor(s);

    if (pts.length === 1) {
      const r = (s.width * (0.6 + pts[0].p)) / 2;
      ctx.beginPath();
      ctx.arc(pts[0].x * W, pts[0].y * H, Math.max(1, r), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Em modo incremental só desenha o último segmento (mantém o LIVE fluido).
    const start = incremental ? Math.max(1, pts.length - 2) : 1;
    for (let i = start; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const midX = ((prev.x + cur.x) / 2) * W;
      const midY = ((prev.y + cur.y) / 2) * H;
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.6, s.width * (0.6 + cur.p));
      if (i === 1) ctx.moveTo(prev.x * W, prev.y * H);
      else {
        const prev2 = pts[i - 2];
        ctx.moveTo(((prev2.x + prev.x) / 2) * W, ((prev2.y + prev.y) / 2) * H);
      }
      ctx.quadraticCurveTo(prev.x * W, prev.y * H, midX, midY);
      ctx.stroke();
    }
    ctx.restore();
  },

  redraw() {
    if (!this._ctx) return;
    this._ctx.clearRect(0, 0, this._w, this._h);
    (this.page?.strokes || []).forEach((s) => this.drawStroke(s, false));
  },

  async undo() {
    if (!this.page.strokes.length) return;
    this.redoStack.push(this.page.strokes.pop());
    await this.persist();
    this.redraw();
  },

  async redo() {
    if (!this.redoStack.length) return;
    this.page.strokes.push(this.redoStack.pop());
    await this.persist();
    this.redraw();
  },

  /** Persistência imediata — nunca perder apontamentos ao fechar a app. */
  async persist() {
    this.page.updatedAt = Date.now();
    await DB.put(DB.STORES.drawings, this.page);
  },

  exportPNG() {
    // Exporta com fundo sólido (o canvas é transparente) para o PNG ser legível.
    const out = document.createElement('canvas');
    out.width = this._canvas.width;
    out.height = this._canvas.height;
    const octx = out.getContext('2d');
    octx.fillStyle = '#12161f';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(this._canvas, 0, 0);
    out.toBlob((blob) => {
      if (blob) saveOrShareBlob(blob, `notas_pagina${this.pageIdx + 1}.png`);
    }, 'image/png');
  },

  async close() {
    await this.persist();
    if (this._dlg.open) this._dlg.close();
    if (this._onCloseCb) this._onCloseCb();
  },

  /** Nº total de traços guardados num jogo (usado para mostrar indicadores). */
  async countStrokes(matchId) {
    const pages = await DB.getAllByIndex(DB.STORES.drawings, 'matchId', matchId);
    return pages.reduce((n, p) => n + (p.strokes?.length || 0), 0);
  },
};

window.SketchPad = SketchPad;
