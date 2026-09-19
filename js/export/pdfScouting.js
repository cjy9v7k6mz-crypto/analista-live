/**
 * pdfScouting.js — SCOUTING REPORT (documento sobre o adversário).
 *
 * Distinto do MATCH REPORT (relatório do jogo realizado): este pode ser gerado
 * a qualquer momento, sem existir nenhum jogo criado. Reutiliza o motor de
 * layout do pdfReport.js (cursor vertical, quebra de página, tabelas,
 * cabeçalhos e paginação) para manter a mesma identidade visual.
 */

const PDFScouting = {
  SECTIONS: [
    { key: 'cover', label: 'Capa' },
    { key: 'profile', label: 'Perfil rápido' },
    { key: 'model', label: 'Modelo de jogo' },
    { key: 'offensive', label: 'Organização ofensiva' },
    { key: 'defensive', label: 'Organização defensiva' },
    { key: 'transOff', label: 'Transição ofensiva' },
    { key: 'transDef', label: 'Transição defensiva' },
    { key: 'setPiecesText', label: 'Bolas paradas (notas)' },
    { key: 'setPieceImages', label: 'Bolas paradas (esquemas)' },
    { key: 'keyPlayers', label: 'Jogadores-chave' },
    { key: 'strengths', label: 'Pontos fortes' },
    { key: 'weaknesses', label: 'Pontos fracos' },
    { key: 'threats', label: 'Ameaças' },
    { key: 'opportunities', label: 'Oportunidades' },
    { key: 'triggers', label: 'Gatilhos' },
    { key: 'checklist', label: 'Checklist' },
    { key: 'notes', label: 'Notas' },
    { key: 'history', label: 'Histórico de jogos' },
  ],

  /** @param {object} ctx - { team, players, matches, ownTeam } */
  async generate(ctx, config) {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle(config.title || `Scouting Report — ${ctx.team.name}`);
    doc.setCreator('Analista Live');

    const S = {
      doc, rgb,
      font: await doc.embedFont(StandardFonts.Helvetica),
      fontBold: await doc.embedFont(StandardFonts.HelveticaBold),
      page: null, y: 0, pageNum: 0,
      W: 595.28, H: 841.89, margin: 48,
      ctx, config,
      // Cabeçalho corrente das páginas interiores
      headerText: `SCOUTING · ${ctx.team.name}`,
    };

    const R = PDFReport; // reutiliza o motor de layout já existente
    if (config.sections.cover) await this.drawCover(S, R);
    this.newPage(S, R);

    const has = (k) => config.sections[k];
    let n = 1;
    if (has('profile')) this.sectionProfile(S, R, n++);
    if (has('model')) await this.sectionFields(S, R, n++, 'model');
    if (has('offensive')) await this.sectionFields(S, R, n++, 'offensive');
    if (has('defensive')) await this.sectionFields(S, R, n++, 'defensive');
    if (has('transOff')) await this.sectionFields(S, R, n++, 'transOff');
    if (has('transDef')) await this.sectionFields(S, R, n++, 'transDef');
    if (has('setPiecesText')) await this.sectionFields(S, R, n++, 'setPieces');
    if (has('setPieceImages')) await this.sectionSetPieceImages(S, R, n++);
    if (has('keyPlayers')) await this.sectionKeyPlayers(S, R, n++);
    if (has('strengths')) await this.sectionList(S, R, n++, 'strengths');
    if (has('weaknesses')) await this.sectionList(S, R, n++, 'weaknesses');
    if (has('threats')) await this.sectionList(S, R, n++, 'threats');
    if (has('opportunities')) await this.sectionList(S, R, n++, 'opportunities');
    if (has('triggers')) await this.sectionList(S, R, n++, 'triggers');
    if (has('checklist')) this.sectionChecklist(S, R, n++);
    if (has('notes')) this.sectionNotes(S, R, n++);
    if (has('history')) this.sectionHistory(S, R, n++);

    this.stampFooters(S, R);

    const bytes = await doc.save();
    const filename = `scouting_${ctx.team.name.replace(/\s+/g, '-')}_${new Date().toISOString().slice(0, 10)}.pdf`;
    await saveOrShareBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
    return filename;
  },

  // Delega no motor do PDFReport, que já respeita S.headerText.
  newPage(S, R) { R.newPage(S); },

  async drawCover(S, R) {
    const page = S.doc.addPage([S.W, S.H]);
    S.pageNum++;
    const cx = S.W / 2;
    const team = S.ctx.team;

    // Faixa escura de topo. Tudo o que fica DENTRO dela é desenhado em claro,
    // e o subtítulo desce para a zona branca — senão o nome do clube ficava
    // texto escuro sobre fundo escuro.
    const BANNER = 320;
    page.drawRectangle({ x: 0, y: S.H - BANNER, width: S.W, height: BANNER, color: S.rgb(0.06, 0.09, 0.14) });

    const brand = 'ANALISTA LIVE';
    const bw = S.font.widthOfTextAtSize(brand, 9);
    page.drawText(brand, { x: cx - bw / 2, y: S.H - 48, size: 9, font: S.font, color: S.rgb(0.45, 0.58, 0.85) });

    const kicker = 'SCOUTING REPORT';
    const kw = S.fontBold.widthOfTextAtSize(kicker, 12);
    page.drawText(kicker, { x: cx - kw / 2, y: S.H - 78, size: 12, font: S.fontBold, color: S.rgb(0.72, 0.76, 0.84) });

    // Logótipo do adversário (proporção preservada), dentro da faixa.
    if (team.logo) {
      try {
        const bytes = this._dataUrlToBytes(team.logo);
        const img = team.logo.includes('image/png') ? await S.doc.embedPng(bytes) : await S.doc.embedJpg(bytes);
        const box = 86;
        const scale = Math.min(box / img.width, box / img.height);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x: cx - w / 2, y: S.H - 110 - h, width: w, height: h });
      } catch (e) { /* logótipo inválido — a capa continua sem ele */ }
    }

    const name = R.sanitize(team.name);
    const nw = S.fontBold.widthOfTextAtSize(name, 26);
    page.drawText(name, { x: cx - nw / 2, y: S.H - 240, size: 26, font: S.fontBold, color: S.rgb(1, 1, 1) });

    if (team.abbreviation) {
      const ab = R.sanitize(team.abbreviation);
      const aw = S.font.widthOfTextAtSize(ab, 11);
      page.drawText(ab, { x: cx - aw / 2, y: S.H - 262, size: 11, font: S.font, color: S.rgb(0.66, 0.72, 0.82) });
    }

    if (S.config.subtitle) {
      const sub = R.sanitize(S.config.subtitle);
      const sw = S.font.widthOfTextAtSize(sub, 12);
      page.drawText(sub, { x: cx - sw / 2, y: S.H - BANNER - 46, size: 12, font: S.font, color: S.rgb(...R.COLORS.muted) });
    }

    const meta = R.sanitize(`Atualizado em ${Utils.formatDate(team.scoutingUpdatedAt || Date.now())}`);
    const mw = S.font.widthOfTextAtSize(meta, 10);
    page.drawText(meta, { x: cx - mw / 2, y: 140, size: 10, font: S.font, color: S.rgb(...R.COLORS.muted) });

    if (S.ctx.ownTeam) {
      const by = R.sanitize(`Preparado por ${S.ctx.ownTeam.name}`);
      const byw = S.font.widthOfTextAtSize(by, 9);
      page.drawText(by, { x: cx - byw / 2, y: 122, size: 9, font: S.font, color: S.rgb(...R.COLORS.muted) });
    }
  },

  _dataUrlToBytes(dataUrl) {
    const b64 = dataUrl.split(',')[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  },

  sectionProfile(S, R, n) {
    R.h1(S, `${n}. Perfil`);
    const p = S.ctx.team.profile || {};
    const quick = QUICK_PROFILE.map((q) => [q.label, p[q.key]]).filter((r) => r[1] && String(r[1]).trim());
    const sc = S.ctx.team.scouting || {};
    const topThreat = (sc.threats || [])[0];
    const topOpp = (sc.opportunities || [])[0];
    if (topThreat) quick.push(['Principal ameaça', topThreat.title]);
    if (topOpp) quick.push(['Principal oportunidade', topOpp.title]);
    if (!quick.length) return R.empty(S, 'Sem dados suficientes.');
    R.table(S, ['Campo', 'Valor'], quick, [0.35, 0.65]);
  },

  async sectionFields(S, R, n, sectionId) {
    const sec = SCOUTING_SECTIONS.find((s) => s.id === sectionId);
    R.h1(S, `${n}. ${sec.title}`);
    const p = S.ctx.team.profile || {};
    const rows = sec.fields.filter((f) => p[f.key] && String(p[f.key]).trim()).map((f) => [f.label, p[f.key]]);
    const blocks = (S.ctx.team.scouting?.blocks || {})[sectionId] || [];
    if (!rows.length && !blocks.length) return R.empty(S, 'Sem informação registada nesta secção.');
    if (rows.length) R.table(S, ['Campo', 'Observação'], rows, [0.33, 0.67]);
    // Blocos livres logo a seguir aos campos, pela ordem definida pelo analista.
    await this.renderBlocks(S, R, blocks);
  },

  /** Desenha blocos de texto e imagem mantendo a ordem e a proporção. */
  async renderBlocks(S, R, blocks) {
    for (const b of blocks) {
      if (b.type === 'text') {
        R.text(S, b.text, { size: 9.5 });
        S.y -= 6;
        continue;
      }
      if (!b.image) continue;
      const maxW = S.W - S.margin * 2;
      const maxH = 330;
      let img = null;
      try {
        const src = b.image.full || b.image.thumb;
        const bytes = this._dataUrlToBytes(src);
        img = src.startsWith('data:image/png') ? await S.doc.embedPng(bytes) : await S.doc.embedJpg(bytes);
      } catch (e) { continue; }
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale, h = img.height * scale;
      R.ensure(S, h + 34);
      S.page.drawImage(img, { x: S.margin, y: S.y - h, width: w, height: h });
      S.y -= h + 14; // respiro entre a imagem e a legenda
      if (b.caption) { R.text(S, b.caption, { size: 8.5, color: R.COLORS.muted }); }
      S.y -= 10;
    }
  },

  /**
   * Esquemas táticos. A imagem é o conteúdo — por isso pode ocupar uma área
   * grande da página, mantendo sempre a proporção original (nunca deformar
   * nem cortar).
   */
  async sectionSetPieceImages(S, R, n) {
    R.h1(S, `${n}. Bolas Paradas — Esquemas`);
    const list = S.ctx.team.scouting?.setPieces || [];
    if (!list.length) return R.empty(S, 'Sem esquemas carregados.');

    for (const sp of list) {
      const maxW = S.W - S.margin * 2;
      const maxH = 400;
      let img = null;
      try {
        const src = sp.image.full || sp.image.thumb;
        const bytes = this._dataUrlToBytes(src);
        img = src.startsWith('data:image/png') ? await S.doc.embedPng(bytes) : await S.doc.embedJpg(bytes);
      } catch (e) { continue; }

      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale, h = img.height * scale;

      // Garante que título + imagem + descrição ficam na mesma página
      R.ensure(S, h + 70);
      const cat = this.SET_PIECE_LABEL(sp.category);
      R.text(S, sp.title, { bold: true, size: 11 });
      R.text(S, cat + (sp.priority ? ` · ${(SCOUTING_PRIORITIES.find((x) => x.key === sp.priority) || {}).label || ''}` : ''), { size: 8.5, color: R.COLORS.muted });
      S.y -= 4;
      S.page.drawImage(img, { x: S.margin, y: S.y - h, width: w, height: h });
      S.y -= h + 10;
      if (sp.description) R.text(S, sp.description, { size: 9.5 });
      if (sp.notes) R.text(S, sp.notes, { size: 9, color: R.COLORS.muted });
      S.y -= 10;
    }
  },

  SET_PIECE_LABEL(key) {
    const c = ScoutingScreen.SET_PIECE_CATEGORIES.find((x) => x.key === key);
    return c ? c.label : 'Outro';
  },

  async sectionKeyPlayers(S, R, n) {
    R.h1(S, `${n}. Jogadores-Chave`);
    const kp = S.ctx.team.scouting?.keyPlayers || [];
    if (!kp.length) return R.empty(S, 'Sem jogadores-chave definidos.');
    const pending = [];
    kp.forEach((k) => {
      const p = S.ctx.players.find((x) => x.id === k.playerId);
      if (!p) return;
      R.text(S, `${p.number ? '#' + p.number + ' ' : ''}${p.name}${p.position ? ' — ' + p.position : ''}`, { bold: true, size: 11 });
      const filled = KEY_PLAYER_FIELDS.filter((f) => k[f.key] && k[f.key].trim());
      if (filled.length) R.table(S, ['Aspeto', 'Nota'], filled.map((f) => [f.label, k[f.key]]), [0.3, 0.7]);
      else R.empty(S, 'Sem notas.');
      pending.push(...(k.images || []).map((im) => ({ type: 'image', image: im, caption: im.caption })));
    });
    for (const b of pending) await this.renderBlocks(S, R, [b]);
  },

  async sectionList(S, R, n, listId) {
    const list = SCOUTING_LISTS.find((l) => l.id === listId);
    R.h1(S, `${n}. ${list.title}`);
    const items = S.ctx.team.scouting?.[listId] || [];
    if (!items.length) return R.empty(S);
    // Imagens associadas a itens entram logo a seguir à tabela.
    const withImages = items.filter((it) => it.image);
    // "Confirmado": jogos em que aconteceu / jogos terminados em que estava no plano.
    const tr = S.ctx.trackRecord;
    const hist = (it) => {
      const rec = tr && tr.get(it.id);
      return rec && rec.tracked ? `${rec.confirmed}/${rec.tracked} ${rec.tracked === 1 ? 'jogo' : 'jogos'}` : '-';
    };
    R.table(S, ['Título', 'Descrição', 'Prioridade', 'Confirmado'], items.map((it) => [
      it.title, it.description || '',
      R.sanitize((SCOUTING_PRIORITIES.find((p) => p.key === it.priority) || {}).label || '-').trim() || '-',
      hist(it),
    ]), [0.26, 0.44, 0.15, 0.15]);
    if (tr && items.some((it) => tr.get(it.id)?.tracked)) {
      // Texto pequeno em cinzento que passa os 4,5:1 sobre branco (o "muted" do motor fica em 4,29:1).
      R.text(S, 'Confirmado: jogos em que aconteceu / jogos terminados em que estava no plano de observação.', { size: 8, color: [0x5f / 255, 0x65 / 255, 0x73 / 255] });
      S.y -= 4;
    }
    for (const it of withImages) {
      await this.renderBlocks(S, R, [{ type: 'image', image: it.image, caption: it.caption || it.title }]);
    }
  },

  sectionChecklist(S, R, n) {
    R.h1(S, `${n}. Checklist`);
    const cl = S.ctx.team.scouting?.checklist || [];
    if (!cl.length) return R.empty(S, 'Checklist não iniciada.');
    cl.forEach((g) => {
      R.text(S, g.title, { bold: true, size: 10.5 });
      R.table(S, ['Item', 'Estado'], g.items.map((it) => [it.label, it.checked ? 'Sim' : '-']), [0.75, 0.25]);
    });
  },

  sectionNotes(S, R, n) {
    R.h1(S, `${n}. Notas`);
    const notes = S.ctx.team.scouting?.notes || [];
    if (!notes.length) return R.empty(S);
    notes.forEach((no) => {
      R.text(S, new Date(no.createdAt).toLocaleDateString('pt-PT'), { bold: true, size: 8.5, color: R.COLORS.accent });
      R.text(S, no.text, { size: 9.5 });
      if (no.tags && no.tags.length) R.text(S, no.tags.map((t) => '#' + t).join(' '), { size: 8, color: R.COLORS.muted });
      S.y -= 4;
    });
  },

  sectionHistory(S, R, n) {
    R.h1(S, `${n}. Histórico de Jogos`);
    const ms = S.ctx.matches || [];
    if (!ms.length) return R.empty(S, 'Ainda não existem jogos contra esta equipa.');
    R.table(S, ['Data', 'Jogo', 'Resultado', 'Local'], ms.map((m) => [
      Utils.formatDate(m.date),
      `${m.team} vs ${m.opponent}`,
      `${m.score?.team ?? 0} - ${m.score?.opponent ?? 0}`,
      m.venue === 'home' ? 'Casa' : 'Fora',
    ]), [0.2, 0.44, 0.18, 0.18]);
  },

  stampFooters(S, R) {
    const pages = S.doc.getPages();
    pages.forEach((p, i) => {
      const label = `${i + 1} / ${pages.length}`;
      const lw = S.font.widthOfTextAtSize(label, 8);
      p.drawText(label, { x: S.W - S.margin - lw, y: 30, size: 8, font: S.font, color: S.rgb(...R.COLORS.muted) });
      if (i > 0) p.drawText('Scouting Report · Analista Live', { x: S.margin, y: 30, size: 8, font: S.font, color: S.rgb(...R.COLORS.muted) });
    });
  },
};

window.PDFScouting = PDFScouting;
