/**
 * pdfPlayer.js — FICHA INDIVIDUAL do jogador (PDF), para conversas de feedback.
 *
 * Reutiliza o motor de layout do pdfReport.js (cursor vertical, quebra de página,
 * tabelas, cabeçalho corrente), tal como o Scouting Report. Os dados vêm todos de
 * PlayerReport.buildSheet — nada aqui é calculado de novo nem inventado.
 *
 * Cores validadas sobre papel branco (validate_palette.js): a série usa o azul
 * do motor (#3873cc, 4,67:1). O cinzento "muted" do motor (#737a8c) dá só 4,29:1,
 * abaixo dos 4,5:1 que o texto pequeno exige — esta ficha usa SMALL_INK
 * (#5f6573, 5,84:1), passado ao motor por `S.mutedColor`.
 */

const PDFPlayer = {
  SMALL_INK: [0x5f / 255, 0x65 / 255, 0x73 / 255],

  /** @param {{player, teamId, team, entries, metricKey, scopeLabel}} ctx */
  async generate(ctx) {
    const sheet = PlayerReport.buildSheet({ player: ctx.player, teamId: ctx.teamId, entries: ctx.entries, metricKey: ctx.metricKey });
    const bytes = await this.build(sheet, ctx);
    const name = (sheet.player.shortName || sheet.player.name || 'jogador').replace(/\s+/g, '-');
    const filename = `ficha_${name}_${new Date().toISOString().slice(0, 10)}.pdf`;
    await saveOrShareBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
    return filename;
  },

  /** Monta o PDF e devolve os bytes (separado de generate para poder ser verificado sem transferir). */
  async build(sheet, ctx) {
    const R = PDFReport;
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle(`Ficha individual — ${sheet.player.name}`);
    doc.setCreator('Analista Live');

    const S = {
      doc, rgb,
      font: await doc.embedFont(StandardFonts.Helvetica),
      fontBold: await doc.embedFont(StandardFonts.HelveticaBold),
      page: null, y: 0, pageNum: 0,
      W: 595.28, H: 841.89, margin: 48,
      ctx: { match: null }, config: {},
      headerText: `FICHA INDIVIDUAL · ${sheet.player.name}`,
      mutedColor: this.SMALL_INK,
    };
    const note = (msg) => { R.text(S, msg, { size: 9, color: this.SMALL_INK }); S.y -= 4; };

    await this.drawHeader(S, R, sheet, ctx);

    // ---- Números ----
    R.h1(S, 'Números');
    this.drawKpis(S, R, sheet);
    const t = sheet.totals;
    if (t.minutes >= 45) {
      const f = (k) => SeasonTrends.formatNumber(sheet.per90[k]);
      R.text(S, `Por 90 minutos: golos ${f('goals')} · assistências ${f('assists')} · oport. criadas ${f('chancesCreated')} · remates ${f('shots')} · recuperações ${f('recuperacoes')} · perdas ${f('perdas')}`, { size: 9 });
    } else {
      note('Os valores por 90 minutos aparecem a partir de 45 minutos jogados.');
    }
    if (t.saves) R.text(S, `Defesas (guarda-redes): ${t.saves}`, { size: 9 });
    S.y -= 6;

    // ---- Evolução ----
    const tr = sheet.trend;
    R.h1(S, `Evolução - ${tr.label} por jogo`, 150);
    if (tr.points.length < 2) {
      note('A evolução aparece a partir de 2 jogos.');
    } else {
      this.drawTrend(S, R, tr.points, tr.unit);
      note('Linha interrompida = jogo em que não jogou.');
      const cmp = tr.comparison;
      const f = (n) => `${SeasonTrends.formatNumber(n)}${tr.unit}`;
      if (cmp) {
        const sign = cmp.delta > 0 ? '+' : (cmp.delta < 0 ? '-' : '=');
        R.text(S, `Últimos ${cmp.recentN} jogos em que jogou: média ${f(cmp.recentAvg)} por jogo · nos ${cmp.beforeN} anteriores: ${f(cmp.beforeAvg)} (${sign}${f(Math.abs(cmp.delta))})`, { size: 9 });
      } else {
        note(`A comparação com os jogos anteriores aparece a partir de ${SeasonTrends.MIN_PLAYED_FOR_TREND} jogos em que jogou.`);
      }
    }
    S.y -= 6;

    // ---- Jogo a jogo ----
    R.h1(S, 'Jogo a jogo', 60);
    if (!sheet.rows.length) {
      note('Sem participações registadas neste período.');
    } else {
      const status = (s) => (s === 'starter' ? 'Titular' : (s === 'sub' ? 'Suplente' : '-'));
      R.table(S,
        ['Data', 'Adversário', 'Estado', 'Min', 'G', 'A', 'Rem', 'Rec', 'Prd', 'FC'],
        sheet.rows.map((r) => [
          r.date ? Utils.formatDate(r.date) : '-', r.opponentName || '-', status(r.status),
          String(r.minutes || 0), String(r.goals || 0), String(r.assists || 0), String(r.shots || 0),
          String(r.recuperacoes || 0), String(r.perdas || 0), String(r.foulsCommitted || 0),
        ]),
        [0.12, 0.26, 0.12, 0.07, 0.06, 0.06, 0.08, 0.08, 0.08, 0.07]);
      if (sheet.rowsOmitted) {
        note(`+ ${sheet.rowsOmitted} ${sheet.rowsOmitted === 1 ? 'jogo mais antigo não mostrado' : 'jogos mais antigos não mostrados'} (estão no hub do plantel).`);
      }
    }

    // ---- Vídeo ----
    if (sheet.video.length) {
      R.h1(S, 'Vídeo - onde ver estes momentos', 60);
      R.table(S, ['Jogo', 'Vídeo', 'Clip', 'O quê', 'Momento do jogo'], sheet.video.map((v) => [
        `${v.date ? Utils.formatDate(v.date) : '-'} ${v.opponent || ''}`.trim(),
        v.time, v.window, v.name + (v.note ? ` (${v.note})` : ''), v.gameLabel,
      ]), [0.22, 0.12, 0.18, 0.32, 0.16]);
      if (sheet.videoOmitted) note(`+ ${sheet.videoOmitted} não mostrados.`);
      note('Tempos do vídeo desse jogo, calculados a partir da sincronização feita no pós-jogo.');
    }

    // ---- Momentos e notas ----
    R.h1(S, 'Momentos e notas', 40);
    if (!sheet.highlights.length) {
      note('Sem momentos ou notas associados a este jogador.');
    } else {
      sheet.highlights.forEach((h) => {
        const when = [h.date ? Utils.formatDate(h.date) : '', h.minute != null ? `${h.minute}'` : '', h.opponent ? `vs ${h.opponent}` : ''].filter(Boolean).join(' ');
        R.text(S, `${h.kind} · ${when}`, { size: 9, bold: true });
        R.text(S, h.text, { size: 9 });
        S.y -= 4;
      });
      if (sheet.highlightsOmitted) note(`+ ${sheet.highlightsOmitted} mais antigos não mostrados.`);
    }

    this.stampFooters(S, R);
    return doc.save();
  },

  _photoDataUrl(photo) {
    if (!photo) return null;
    if (typeof photo === 'string') return photo; // formato antigo, se existir
    return photo.full || photo.thumb || null;
  },

  async _embedPhoto(S, dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
    const bytes = PDFScouting._dataUrlToBytes(dataUrl);
    if (dataUrl.startsWith('data:image/png')) return S.doc.embedPng(bytes);
    if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return S.doc.embedJpg(bytes);
    return null; // o pdf-lib só embebe PNG/JPEG — a ficha segue com as iniciais
  },

  async drawHeader(S, R, sheet, ctx) {
    const page = S.doc.addPage([S.W, S.H]);
    S.page = page;
    S.pageNum++;
    const BAND = 132;
    const light = S.rgb(0.78, 0.82, 0.88);
    page.drawRectangle({ x: 0, y: S.H - BAND, width: S.W, height: BAND, color: S.rgb(0.06, 0.09, 0.14) });

    const brand = 'ANALISTA LIVE · FICHA INDIVIDUAL';
    const bw = S.font.widthOfTextAtSize(brand, 8);
    page.drawText(brand, { x: S.W - S.margin - bw, y: S.H - 26, size: 8, font: S.font, color: S.rgb(0.45, 0.58, 0.85) });

    const p = sheet.player;
    const box = 76;
    const bx = S.margin;
    const by = S.H - 36 - box;
    let drewPhoto = false;
    try {
      const img = await this._embedPhoto(S, this._photoDataUrl(p.photo));
      if (img) {
        const sc = Math.min(box / img.width, box / img.height);
        const w = img.width * sc;
        const h = img.height * sc;
        page.drawImage(img, { x: bx + (box - w) / 2, y: by + (box - h) / 2, width: w, height: h });
        drewPhoto = true;
      }
    } catch (e) { /* foto inválida — segue com as iniciais */ }
    if (!drewPhoto) {
      page.drawCircle({ x: bx + box / 2, y: by + box / 2, size: box / 2, color: S.rgb(...R.COLORS.accent) });
      const ini = R.sanitize(ImageUtils.initials(p.name));
      const iw = S.fontBold.widthOfTextAtSize(ini, 24);
      page.drawText(ini, { x: bx + box / 2 - iw / 2, y: by + box / 2 - 8, size: 24, font: S.fontBold, color: S.rgb(1, 1, 1) });
    }

    const tx = bx + box + 18;
    const maxW = S.W - S.margin - tx;
    page.drawText(R.wrap(p.name, S.fontBold, 20, maxW)[0], { x: tx, y: S.H - 62, size: 20, font: S.fontBold, color: S.rgb(1, 1, 1) });
    const foot = { D: 'Pé direito', E: 'Pé esquerdo', A: 'Ambidextro' }[p.dominantFoot] || '';
    const line2 = [p.number ? `#${p.number}` : '', [p.position, p.secondaryPosition].filter(Boolean).join('/'), foot].filter(Boolean).join(' · ');
    if (line2) page.drawText(R.wrap(line2, S.font, 10, maxW)[0], { x: tx, y: S.H - 82, size: 10, font: S.font, color: light });
    const line3 = [ctx.team && ctx.team.name, ctx.scopeLabel].filter(Boolean).join(' · ');
    if (line3) page.drawText(R.wrap(line3, S.font, 10, maxW)[0], { x: tx, y: S.H - 100, size: 10, font: S.font, color: light });

    S.y = S.H - BAND - 20;
  },

  drawKpis(S, R, sheet) {
    const t = sheet.totals;
    const items = [
      [String(t.apps), `jogos (${t.starts} titular)`],
      [`${t.minutes}'`, 'minutos (aprox.)'],
      [String(t.goals), 'golos'],
      [String(t.assists), 'assistências'],
      [String(t.chancesCreated), 'grandes oport. criadas'],
      [String(t.shots), `remates (${t.shotsOnTarget} enquadr.)`],
      [String(t.recuperacoes), 'recuperações'],
      [String(t.perdas), 'perdas de bola'],
      [String(t.foulsCommitted), 'faltas cometidas'],
      [String(t.foulsSuffered), 'faltas sofridas'],
      [`${t.yellow} / ${t.red}`, 'amarelos / vermelhos'],
    ];
    const cols = 5;
    const cellW = (S.W - S.margin * 2) / cols;
    const cellH = 40;
    const gridRows = Math.ceil(items.length / cols);
    R.ensure(S, cellH * gridRows + 10);
    items.forEach(([val, label], i) => {
      const cx = S.margin + (i % cols) * cellW;
      const rowTop = S.y - Math.floor(i / cols) * cellH;
      S.page.drawText(R.sanitize(val), { x: cx + 2, y: rowTop - 16, size: 16, font: S.fontBold, color: S.rgb(...R.COLORS.ink) });
      S.page.drawText(R.wrap(label, S.font, 7.5, cellW - 6)[0], { x: cx + 2, y: rowTop - 29, size: 7.5, font: S.font, color: S.rgb(...this.SMALL_INK) });
    });
    for (let r = 1; r < gridRows; r++) {
      S.page.drawLine({ start: { x: S.margin, y: S.y - cellH * r + 4 }, end: { x: S.W - S.margin, y: S.y - cellH * r + 4 }, thickness: 0.3, color: S.rgb(...R.COLORS.line) });
    }
    S.y -= cellH * gridRows + 6;
  },

  /** Linha de uma série, desenhada com primitivas do pdf-lib; `null` interrompe a linha. */
  drawTrend(S, R, points, unit) {
    const height = 120;
    R.ensure(S, height + 24);
    const left = S.margin + 28;
    const right = S.W - S.margin - 16;
    const top = S.y - 6;
    const bottom = top - height + 18;
    const vals = points.map((q) => q.value).filter((v) => v != null);
    const yMax = SeasonTrends.niceMax(vals.length ? Math.max(...vals) : 0);
    const X = (i) => left + (points.length > 1 ? (i * (right - left)) / (points.length - 1) : (right - left) / 2);
    const Y = (v) => bottom + (v / yMax) * (top - bottom - 10);
    const small = S.rgb(...this.SMALL_INK);
    const accent = S.rgb(...R.COLORS.accent);

    S.page.drawLine({ start: { x: left, y: Y(yMax) }, end: { x: right, y: Y(yMax) }, thickness: 0.5, color: S.rgb(...R.COLORS.line) });
    S.page.drawLine({ start: { x: left, y: Y(0) }, end: { x: right, y: Y(0) }, thickness: 0.8, color: S.rgb(0.70, 0.73, 0.78) });
    const tick = (txt, y) => {
      const w = S.font.widthOfTextAtSize(txt, 8);
      S.page.drawText(txt, { x: left - 6 - w, y: y - 3, size: 8, font: S.font, color: small });
    };
    tick(String(yMax), Y(yMax));
    tick('0', Y(0));

    const dateLabel = (q) => R.sanitize(q.date ? Utils.formatDate(q.date).slice(0, 5) : '-');
    S.page.drawText(dateLabel(points[0]), { x: X(0), y: bottom - 14, size: 8, font: S.font, color: small });
    const lastLabel = dateLabel(points[points.length - 1]);
    S.page.drawText(lastLabel, { x: X(points.length - 1) - S.font.widthOfTextAtSize(lastLabel, 8), y: bottom - 14, size: 8, font: S.font, color: small });

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1].value;
      const b = points[i].value;
      if (a == null || b == null) continue;
      S.page.drawLine({ start: { x: X(i - 1), y: Y(a) }, end: { x: X(i), y: Y(b) }, thickness: 1.6, color: accent });
    }
    points.forEach((q, i) => {
      if (q.value == null) return;
      S.page.drawCircle({ x: X(i), y: Y(q.value), size: 2.8, color: accent, borderColor: S.rgb(1, 1, 1), borderWidth: 1 });
    });
    const lastIdx = [...points.keys()].reverse().find((i) => points[i].value != null);
    if (lastIdx != null) {
      const txt = R.sanitize(`${SeasonTrends.formatNumber(points[lastIdx].value)}${unit}`);
      const w = S.fontBold.widthOfTextAtSize(txt, 9);
      const x = Math.min(right - w, Math.max(left, X(lastIdx) - w / 2));
      S.page.drawText(txt, { x, y: Y(points[lastIdx].value) + 6, size: 9, font: S.fontBold, color: S.rgb(...R.COLORS.ink) });
    }
    S.y = bottom - 26;
  },

  stampFooters(S, R) {
    const pages = S.doc.getPages();
    const gen = R.sanitize(`Ficha individual · Analista Live · gerada em ${new Date().toLocaleDateString('pt-PT')}`);
    pages.forEach((pg, i) => {
      const label = `${i + 1} / ${pages.length}`;
      const lw = S.font.widthOfTextAtSize(label, 8);
      pg.drawText(label, { x: S.W - S.margin - lw, y: 30, size: 8, font: S.font, color: S.rgb(...this.SMALL_INK) });
      pg.drawText(gen, { x: S.margin, y: 30, size: 8, font: S.font, color: S.rgb(...this.SMALL_INK) });
    });
  },
};

window.PDFPlayer = PDFPlayer;
