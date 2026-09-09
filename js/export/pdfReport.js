/**
 * pdfReport.js — Gerador de relatório PDF profissional (100% client-side/offline).
 *
 * Usa pdf-lib (js/vendor/pdf-lib.min.js), incluída localmente no projeto para
 * que a geração funcione sem internet, como o resto da aplicação.
 *
 * Estrutura: motor de layout simples (cursor vertical + quebra de página
 * automática) por cima do pdf-lib, para produzir algo com aspeto de relatório
 * de análise e não de "tabela exportada".
 *
 * REGRA: nunca inventa dados. Uma secção sem dados mostra "Sem dados
 * registados." em vez de números estimados.
 */

const PDFReport = {
  // Paleta discreta, coerente com a identidade da app (impressa em fundo branco)
  COLORS: {
    ink: [0.10, 0.12, 0.16],
    muted: [0.45, 0.48, 0.55],
    line: [0.85, 0.87, 0.90],
    accent: [0.22, 0.45, 0.80],
    red: [0.80, 0.25, 0.28],
    green: [0.15, 0.60, 0.42],
    pitch: [0.09, 0.22, 0.14],
  },

  SECTIONS: [
    { key: 'cover', label: 'Capa' },
    { key: 'identification', label: 'Identificação e Resultado' },
    { key: 'lineups', label: 'Onze Inicial (as duas equipas)' },
    { key: 'substitutions', label: 'Substituições' },
    { key: 'stats', label: 'Estatísticas Gerais' },
    { key: 'goals', label: 'Golos (marcador/assistência)' },
    { key: 'shots', label: 'Remates (lista)' },
    { key: 'keepers', label: 'Guarda-redes (defesas)' },
    { key: 'shotMap', label: 'Mapa de Remates' },
    { key: 'corners', label: 'Cantos' },
    { key: 'fouls', label: 'Faltas' },
    { key: 'foulMap', label: 'Mapa de Faltas' },
    { key: 'cards', label: 'Cartões' },
    { key: 'events', label: 'Eventos Registados' },
    { key: 'individual', label: 'Estatísticas Individuais' },
    { key: 'moments', label: 'Momentos Importantes' },
    { key: 'interventions', label: 'Intervenções ao Banco' },
    { key: 'notes', label: 'Notas do Analista' },
    { key: 'sketches', label: 'Notas Manuscritas (desenhos)' },
    { key: 'scouting', label: 'Scouting do Adversário' },
    { key: 'finalNotes', label: 'Observações Finais' },
  ],

  /**
   * @param {object} ctx - { match, occurrences, ownTeam, opponentTeam, ownPlayers, opponentPlayers }
   * @param {object} config - { sections: {key:bool}, title, subtitle, finalNotes }
   */
  async generate(ctx, config) {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle(config.title || `Relatório — ${ctx.match.team} vs ${ctx.match.opponent}`);
    doc.setCreator('Analista Live');

    const S = {
      doc,
      rgb,
      font: await doc.embedFont(StandardFonts.Helvetica),
      fontBold: await doc.embedFont(StandardFonts.HelveticaBold),
      page: null,
      y: 0,
      pageNum: 0,
      W: 595.28, // A4
      H: 841.89,
      margin: 48,
      ctx,
      config,
    };

    if (config.sections.cover) this.drawCover(S);
    this.newPage(S);

    const has = (k) => config.sections[k];
    if (has('identification')) this.sectionIdentification(S);
    if (has('lineups')) this.sectionLineups(S);
    if (has('substitutions')) this.sectionSubstitutions(S);
    if (has('stats')) this.sectionStats(S);
    if (has('goals')) this.sectionGoals(S);
    if (has('shots')) this.sectionShots(S);
    if (has('keepers')) this.sectionKeepers(S);
    if (has('shotMap')) this.sectionMap(S, 'shots');
    if (has('corners')) this.sectionCorners(S);
    if (has('fouls')) this.sectionFouls(S);
    if (has('foulMap')) this.sectionMap(S, 'fouls');
    if (has('cards')) this.sectionCards(S);
    if (has('events')) this.sectionEvents(S);
    if (has('individual')) this.sectionIndividual(S);
    if (has('moments')) this.sectionMoments(S);
    if (has('interventions')) this.sectionInterventions(S);
    if (has('notes')) this.sectionNotes(S);
    if (has('sketches')) this.sectionSketches(S);
    if (has('scouting')) this.sectionScouting(S);
    if (has('finalNotes')) this.sectionFinalNotes(S);

    this.stampFooters(S);

    const bytes = await doc.save();
    const filename = `relatorio_${(ctx.match.opponent || 'jogo').replace(/\s+/g, '-')}_${ctx.match.date}.pdf`;
    await saveOrShareBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
    return filename;
  },

  // ---------- Motor de layout ----------
  newPage(S) {
    S.page = S.doc.addPage([S.W, S.H]);
    S.pageNum++;
    S.y = S.H - S.margin;
    // Cabeçalho corrente. Usa `S.headerText` quando fornecido (ex: Scouting
    // Report, que não tem jogo associado) e cai no resultado do jogo caso
    // contrário — assim o mesmo motor de layout serve os dois relatórios.
    const m = S.ctx.match;
    const header = S.headerText || (m ? `${m.team}  ${m.score.team} - ${m.score.opponent}  ${m.opponent}` : '');
    if (header) {
      S.page.drawText(this.sanitize(header), {
        x: S.margin, y: S.H - 28, size: 8, font: S.font, color: S.rgb(...this.COLORS.muted),
      });
    }
    S.page.drawLine({
      start: { x: S.margin, y: S.H - 36 }, end: { x: S.W - S.margin, y: S.H - 36 },
      thickness: 0.5, color: S.rgb(...this.COLORS.line),
    });
    S.y = S.H - 56;
  },

  ensure(S, needed) {
    if (S.y - needed < S.margin + 24) this.newPage(S);
  },

  /** @param {number} [minSpace] - espaço mínimo necessário para o bloco que se segue,
   * para evitar títulos órfãos no fim da página (quebra antes de escrever o título). */
  h1(S, text, minSpace = 0) {
    this.ensure(S, 44 + minSpace);
    S.y -= 10;
    S.page.drawText(this.sanitize(text), { x: S.margin, y: S.y, size: 14, font: S.fontBold, color: S.rgb(...this.COLORS.ink) });
    S.y -= 6;
    S.page.drawLine({
      start: { x: S.margin, y: S.y }, end: { x: S.margin + 42, y: S.y },
      thickness: 2, color: S.rgb(...this.COLORS.accent),
    });
    S.y -= 16;
  },

  text(S, str, opts = {}) {
    const size = opts.size || 10;
    const font = opts.bold ? S.fontBold : S.font;
    const color = opts.color || this.COLORS.ink;
    const maxW = S.W - S.margin * 2;
    const lines = this.wrap(String(str), font, size, maxW);
    lines.forEach((ln) => {
      this.ensure(S, size + 6);
      S.page.drawText(ln, { x: opts.x || S.margin, y: S.y, size, font, color: S.rgb(...color) });
      S.y -= size + 4;
    });
  },

  wrap(str, font, size, maxW) {
    const safe = this.sanitize(str);
    const words = safe.split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach((w) => {
      const test = cur ? cur + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) {
        lines.push(cur); cur = w;
      } else cur = test;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  },

  /** As fontes standard do pdf-lib usam WinAnsi; remove o que não for representável (ex: emojis). */
  sanitize(s) {
    return String(s == null ? '' : s).replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  },

  empty(S, msg = 'Sem dados registados.') {
    this.text(S, msg, { color: this.COLORS.muted, size: 9 });
    S.y -= 4;
  },

  /** Tabela simples com colunas de larguras proporcionais. */
  table(S, headers, rows, widths) {
    const totalW = S.W - S.margin * 2;
    const cols = widths.map((w) => w * totalW);
    this.ensure(S, 26);
    let x = S.margin;
    headers.forEach((h, i) => {
      S.page.drawText(this.sanitize(h), { x: x + 2, y: S.y, size: 8.5, font: S.fontBold, color: S.rgb(...this.COLORS.muted) });
      x += cols[i];
    });
    S.y -= 6;
    S.page.drawLine({ start: { x: S.margin, y: S.y }, end: { x: S.W - S.margin, y: S.y }, thickness: 0.5, color: S.rgb(...this.COLORS.line) });
    S.y -= 12;

    rows.forEach((r) => {
      this.ensure(S, 18);
      let cx = S.margin;
      r.forEach((cell, i) => {
        const size = 9;
        const maxChars = this.wrap(String(cell), S.font, size, cols[i] - 6)[0];
        S.page.drawText(maxChars, { x: cx + 2, y: S.y, size, font: S.font, color: S.rgb(...this.COLORS.ink) });
        cx += cols[i];
      });
      S.y -= 8;
      S.page.drawLine({ start: { x: S.margin, y: S.y }, end: { x: S.W - S.margin, y: S.y }, thickness: 0.3, color: S.rgb(...this.COLORS.line) });
      S.y -= 8;
    });
    S.y -= 6;
  },

  // ---------- Capa ----------
  drawCover(S) {
    const page = S.doc.addPage([S.W, S.H]);
    S.pageNum++;
    const m = S.ctx.match;
    const cx = S.W / 2;

    page.drawRectangle({ x: 0, y: S.H - 260, width: S.W, height: 260, color: S.rgb(0.06, 0.09, 0.14) });

    const title = this.sanitize(S.config.title || 'Relatório de Observação');
    const tw = S.fontBold.widthOfTextAtSize(title, 22);
    page.drawText(title, { x: cx - tw / 2, y: S.H - 120, size: 22, font: S.fontBold, color: S.rgb(1, 1, 1) });

    if (S.config.subtitle) {
      const sub = this.sanitize(S.config.subtitle);
      const sw = S.font.widthOfTextAtSize(sub, 11);
      page.drawText(sub, { x: cx - sw / 2, y: S.H - 144, size: 11, font: S.font, color: S.rgb(0.72, 0.76, 0.84) });
    }

    const brand = 'ANALISTA LIVE';
    const bw = S.font.widthOfTextAtSize(brand, 9);
    page.drawText(brand, { x: cx - bw / 2, y: S.H - 60, size: 9, font: S.font, color: S.rgb(0.45, 0.58, 0.85) });

    // Resultado em destaque
    const score = `${m.score.team}  -  ${m.score.opponent}`;
    const scw = S.fontBold.widthOfTextAtSize(score, 46);
    page.drawText(score, { x: cx - scw / 2, y: S.H - 400, size: 46, font: S.fontBold, color: S.rgb(...this.COLORS.ink) });

    const teams = this.sanitize(`${m.team}          ${m.opponent}`);
    const tew = S.fontBold.widthOfTextAtSize(teams, 13);
    page.drawText(teams, { x: cx - tew / 2, y: S.H - 430, size: 13, font: S.fontBold, color: S.rgb(...this.COLORS.muted) });

    const meta = this.sanitize([
      Utils.formatDate(m.date),
      m.competition,
      m.venue === 'home' ? 'Casa' : 'Fora',
      m.observer ? `Observador: ${m.observer}` : '',
    ].filter(Boolean).join('   |   '));
    const mw = S.font.widthOfTextAtSize(meta, 10);
    page.drawText(meta, { x: cx - mw / 2, y: S.H - 470, size: 10, font: S.font, color: S.rgb(...this.COLORS.muted) });

    page.drawLine({ start: { x: S.margin, y: 90 }, end: { x: S.W - S.margin, y: 90 }, thickness: 0.5, color: S.rgb(...this.COLORS.line) });
    const gen = this.sanitize(`Gerado em ${new Date().toLocaleDateString('pt-PT')}`);
    page.drawText(gen, { x: S.margin, y: 74, size: 8, font: S.font, color: S.rgb(...this.COLORS.muted) });
  },

  // ---------- Secções ----------
  sectionIdentification(S) {
    const m = S.ctx.match;
    this.h1(S, '1. Identificação');
    this.table(S, ['Campo', 'Valor'], [
      ['Equipa', m.team],
      ['Adversário', m.opponent],
      ['Resultado', `${m.score.team} - ${m.score.opponent}`],
      ['Competição', m.competition || '-'],
      ['Data', Utils.formatDate(m.date)],
      ['Local', m.venue === 'home' ? 'Casa' : 'Fora'],
      ['Observador', m.observer || '-'],
    ], [0.3, 0.7]);
    if (m.preNotes) {
      this.text(S, 'Notas pré-jogo:', { bold: true, size: 9 });
      this.text(S, m.preNotes, { size: 9, color: this.COLORS.muted });
    }
  },

  sectionLineups(S) {
    this.h1(S, '2. Onze Inicial', 360);
    ['own', 'opponent'].forEach((side) => {
      const teamName = side === 'own' ? S.ctx.match.team : S.ctx.match.opponent;
      const players = side === 'own' ? S.ctx.ownPlayers : S.ctx.opponentPlayers;
      const lineup = S.ctx.match.teams?.[side];
      // Garante que o nome da equipa não fica órfão no fim da página, separado do seu campo.
      this.ensure(S, lineup?.positions?.length ? 360 : 40);
      this.text(S, teamName, { bold: true, size: 11 });
      if (!lineup || !lineup.positions || lineup.positions.length === 0) {
        this.empty(S, 'Onze inicial não definido para esta equipa.');
        return;
      }
      const formation = getFormationPreset(lineup.formationId)?.name || '';
      if (formation) this.text(S, `Formação: ${formation}`, { size: 9, color: this.COLORS.muted });
      // Esta secção mostra o onze INICIAL — usa as posições originais, não o
      // estado atual pós-substituições (essas aparecem na secção Substituições).
      this.drawPitch(S, lineup.positions, players);
      const rows = lineup.positions.map((pos) => {
        const p = players.find((pl) => pl.id === pos.playerId);
        return [pos.role, p ? (p.number || '-') : '-', p ? p.name : '(por definir)'];
      });
      this.table(S, ['Posição', 'Nº', 'Jogador'], rows, [0.2, 0.12, 0.68]);
    });
  },

  /** Desenha um campo com os jogadores posicionados (usa as coordenadas do onze). */
  drawPitch(S, positions, players) {
    const w = 200, h = 300;
    this.ensure(S, h + 20);
    const x0 = S.margin, y0 = S.y - h;
    S.page.drawRectangle({ x: x0, y: y0, width: w, height: h, color: S.rgb(...this.COLORS.pitch) });
    S.page.drawLine({ start: { x: x0, y: y0 + h / 2 }, end: { x: x0 + w, y: y0 + h / 2 }, thickness: 0.6, color: S.rgb(1, 1, 1), opacity: 0.4 });
    S.page.drawCircle({ x: x0 + w / 2, y: y0 + h / 2, size: 26, borderColor: S.rgb(1, 1, 1), borderWidth: 0.6, opacity: 0 , borderOpacity: 0.4 });

    positions.forEach((pos) => {
      const px = x0 + (pos.x / 100) * w;
      const py = y0 + (pos.y / 100) * h;
      const p = players.find((pl) => pl.id === pos.playerId);
      S.page.drawCircle({ x: px, y: py, size: 9, color: S.rgb(1, 1, 1), opacity: p ? 1 : 0.35 });
      const label = p ? String(p.number || '') : '';
      if (label) {
        const lw = S.fontBold.widthOfTextAtSize(label, 7);
        S.page.drawText(label, { x: px - lw / 2, y: py - 2.5, size: 7, font: S.fontBold, color: S.rgb(...this.COLORS.ink) });
      }
      const nm = this.sanitize(p ? (p.shortName || p.name) : pos.role).slice(0, 10);
      const nw = S.font.widthOfTextAtSize(nm, 5.5);
      S.page.drawText(nm, { x: px - nw / 2, y: py - 15, size: 5.5, font: S.font, color: S.rgb(1, 1, 1) });
    });
    S.y = y0 - 14;
  },

  sectionSubstitutions(S) {
    this.h1(S, '3. Substituições');
    const subs = S.ctx.match.substitutions || [];
    if (!subs.length) return this.empty(S);
    const rows = subs.map((s) => [
      `${s.minute}'`,
      s.side === 'own' ? S.ctx.match.team : S.ctx.match.opponent,
      s.out, s.in,
    ]);
    this.table(S, ['Min', 'Equipa', 'Sai', 'Entra'], rows, [0.1, 0.28, 0.31, 0.31]);
  },

  sectionStats(S) {
    this.h1(S, '4. Estatísticas Gerais');
    const st = MatchStats.compute(S.ctx.match, S.ctx.occurrences);
    const rows = MatchStats.STAT_KEYS.map((k) => [String(st.own[k.key]), k.label, String(st.opp[k.key])]);
    this.text(S, `${S.ctx.match.team}   vs   ${S.ctx.match.opponent}`, { size: 9, color: this.COLORS.muted });
    this.table(S, [S.ctx.match.team, '', S.ctx.match.opponent], rows, [0.25, 0.5, 0.25]);
  },

  sectionShots(S) {
    this.h1(S, '5. Remates');
    const shots = MatchStats.shotsList(S.ctx.occurrences);
    if (!shots.length) return this.empty(S);
    const rows = shots.sort((a, b) => a.timestamp - b.timestamp).map((o) => [
      `${o.minute}'`,
      o.team === 'own' ? S.ctx.match.team : S.ctx.match.opponent,
      this.playerNames(S, o.playerIds) || '-',
      MatchStats.SHOT_RESULTS.find((r) => r.key === o.meta?.result)?.label || '-',
      o.meta?.goalZone || '-',
    ]);
    this.table(S, ['Min', 'Equipa', 'Jogador', 'Resultado', 'Zona'], rows, [0.09, 0.24, 0.28, 0.24, 0.15]);
  },

  sectionCorners(S) {
    this.h1(S, '7. Cantos');
    const list = S.ctx.occurrences.filter((o) => o.source === 'canto');
    if (!list.length) return this.empty(S);
    const rows = list.sort((a, b) => a.timestamp - b.timestamp).map((o) => [
      `${o.minute}'`,
      o.team === 'own' ? S.ctx.match.team : S.ctx.match.opponent,
      o.meta?.side === 'left' ? 'Esquerdo' : (o.meta?.side === 'right' ? 'Direito' : '-'),
      this.playerNames(S, o.playerIds) || '-',
      MatchStats.CORNER_RESULTS.find((r) => r.key === o.meta?.result)?.label || '-',
    ]);
    this.table(S, ['Min', 'Equipa', 'Lado', 'Batedor', 'Resultado'], rows, [0.09, 0.24, 0.17, 0.26, 0.24]);
  },

  sectionFouls(S) {
    this.h1(S, '8. Faltas');
    const list = MatchStats.foulsList(S.ctx.occurrences);
    if (!list.length) return this.empty(S);
    const rows = list.sort((a, b) => a.timestamp - b.timestamp).map((o) => [
      `${o.minute}'`,
      o.team === 'own' ? S.ctx.match.team : S.ctx.match.opponent,
      this.playerName(S, o.meta?.committedById) || '-',
      this.playerName(S, o.meta?.sufferedById) || '-',
      // Consequências do MESMO evento (livre, penálti, cartões) — sem duplicar registos.
      ((o.meta?.consequences || []).map((c) => (MatchStats.FOUL_CONSEQUENCES.find((x) => x.key === c) || {}).label || c)
        .join(' + ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim()) || 'Nenhuma',
    ]);
    this.table(S, ['Min', 'Equipa', 'Cometeu', 'Sofreu', 'Consequência'], rows, [0.08, 0.2, 0.22, 0.22, 0.28]);
  },

  sectionMap(S, mode) {
    this.h1(S, mode === 'shots' ? '6. Mapa de Remates' : '9. Mapa de Faltas', 420);
    const list = mode === 'shots' ? MatchStats.shotsList(S.ctx.occurrences) : MatchStats.foulsList(S.ctx.occurrences);
    const withCoords = list.filter((o) => (mode === 'shots' ? o.meta?.origin : o.meta?.location));
    if (!withCoords.length) return this.empty(S, 'Sem localizações registadas.');

    // Campo desenhado pelo módulo partilhado — igual ao do ecrã, proporção real.
    const width = 250;
    const rect = Pitch.drawPDF(S, S.margin, S.y, width);

    withCoords.forEach((o) => {
      const xy = mode === 'shots' ? o.meta.origin : o.meta.location;
      const pt = Pitch.toPDF(rect, xy);
      const col = o.team === 'own' ? this.COLORS.accent : this.COLORS.red;
      const isGoal = mode === 'shots' && o.meta.result === 'goal';
      S.page.drawCircle({ x: pt.x, y: pt.y, size: isGoal ? 5 : 3.4, color: S.rgb(...col) });
      if (isGoal) S.page.drawCircle({ x: pt.x, y: pt.y, size: 7.5, borderColor: S.rgb(...col), borderWidth: 0.9, opacity: 0 });
    });

    S.y = rect.y0 - 16;
    this.text(S, `Azul: ${S.ctx.match.team} (ataca para cima)   |   Vermelho: ${S.ctx.match.opponent} (ataca para baixo)` + (mode === 'shots' ? '   |   Círculo maior = golo' : ''), { size: 8, color: this.COLORS.muted });
    this.text(S, `${withCoords.length} de ${list.length} registos com localização.`, { size: 8, color: this.COLORS.muted });
  },

  /** Golos com marcador, assistência, autogolo e momento. */
  sectionGoals(S) {
    this.h1(S, '4b. Golos');
    const goals = S.ctx.occurrences.filter((o) => o.source === 'golo').sort((a, b) => a.timestamp - b.timestamp);
    if (!goals.length) return this.empty(S, 'Sem golos registados.');
    const rows = goals.map((o) => [
      `${o.period} ${String(o.minute).padStart(2, '0')}:${String(o.second).padStart(2, '0')}`,
      o.team === 'own' ? S.ctx.match.team : S.ctx.match.opponent,
      o.meta?.ownGoal ? 'Autogolo' : 'Golo',
      this.playerName(S, o.meta?.scorerId) || '-',
      this.playerName(S, o.meta?.assistId) || '-',
      o.meta?.moment ? 'Momento' : '',
    ]);
    this.table(S, ['Tempo', 'A favor de', 'Tipo', 'Marcador', 'Assistência', ''], rows, [0.16, 0.2, 0.13, 0.2, 0.2, 0.11]);
  },

  /** Defesas por guarda-redes, com cronologia. */
  sectionKeepers(S) {
    this.h1(S, '5b. Guarda-Redes');
    const saves = S.ctx.occurrences.filter((o) => o.source === 'defesa');
    if (!saves.length) return this.empty(S, 'Sem defesas registadas.');

    const byKeeper = {};
    saves.forEach((o) => {
      const id = o.meta?.keeperId || 'sem';
      (byKeeper[id] = byKeeper[id] || []).push(o);
    });
    Object.entries(byKeeper).forEach(([id, list]) => {
      const name = id === 'sem' ? '(guarda-redes não identificado)' : this.playerName(S, id);
      this.text(S, name, { bold: true, size: 10.5 });
      const great = list.filter((o) => o.meta?.saveType === 'great').length;
      const hard = list.filter((o) => o.meta?.saveType === 'hard').length;
      this.table(S, ['Métrica', 'Total'], [
        ['Defesas', String(list.length)],
        ['Grandes defesas', String(great)],
        ['Defesas difíceis', String(hard)],
      ], [0.6, 0.4]);
      this.table(S, ['Tempo', 'Tipo'], list.sort((a, b) => a.timestamp - b.timestamp).map((o) => [
        `${o.period} ${String(o.minute).padStart(2, '0')}'`,
        (MatchStats.SAVE_TYPES.find((t) => t.key === o.meta?.saveType) || {}).label || 'Defesa',
      ]), [0.3, 0.7]);
    });
  },

  sectionCards(S) {
    this.h1(S, '10. Cartões');
    const list = S.ctx.occurrences.filter((o) => o.source === 'cartao');
    if (!list.length) return this.empty(S);
    const rows = list.sort((a, b) => a.timestamp - b.timestamp).map((o) => [
      `${o.minute}'`,
      o.team === 'own' ? S.ctx.match.team : S.ctx.match.opponent,
      this.playerNames(S, o.playerIds) || '-',
      /vermelho/i.test(o.eventName) ? 'Vermelho' : 'Amarelo',
    ]);
    this.table(S, ['Min', 'Equipa', 'Jogador', 'Cartão'], rows, [0.1, 0.3, 0.35, 0.25]);
  },

  sectionEvents(S) {
    this.h1(S, '11. Eventos Registados');
    const list = S.ctx.occurrences.filter((o) => o.source === 'event');
    if (!list.length) return this.empty(S);

    // Resumo por frequência (baseado apenas no que foi registado)
    const counts = {};
    list.forEach((o) => { counts[o.eventName] = (counts[o.eventName] || 0) + 1; });
    const summary = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([n, c]) => [n, String(c)]);
    this.text(S, 'Frequência por evento', { bold: true, size: 10 });
    this.table(S, ['Evento', 'Ocorrências'], summary, [0.75, 0.25]);

    this.text(S, 'Cronologia', { bold: true, size: 10 });
    const rows = list.sort((a, b) => a.timestamp - b.timestamp).map((o) => [
      `${o.period} ${String(o.minute).padStart(2, '0')}:${String(o.second).padStart(2, '0')}`,
      o.eventName,
      this.playerNames(S, o.playerIds) || '-',
      o.note || '',
    ]);
    this.table(S, ['Tempo', 'Evento', 'Jogador(es)', 'Nota'], rows, [0.16, 0.32, 0.24, 0.28]);
  },

  sectionIndividual(S) {
    this.h1(S, '12. Estatísticas Individuais');
    const all = [...S.ctx.ownPlayers, ...S.ctx.opponentPlayers];
    const rows = [];
    all.forEach((p) => {
      const evs = S.ctx.occurrences.filter((o) => (o.playerIds || []).includes(p.id));
      if (!evs.length) return; // só jogadores com dados reais
      const shots = evs.filter((e) => e.source === 'remate');
      rows.push([
        `${p.number || '-'} ${p.shortName || p.name}`,
        String(evs.length),
        String(shots.length),
        String(shots.filter((e) => e.meta?.result === 'goal').length),
        String(evs.filter((e) => e.source === 'falta' && e.meta?.committedById === p.id).length),
        String(evs.filter((e) => e.source === 'cartao').length),
      ]);
    });
    if (!rows.length) return this.empty(S, 'Nenhum evento foi associado a jogadores neste jogo.');
    this.table(S, ['Jogador', 'Eventos', 'Remates', 'Golos', 'Faltas', 'Cartões'], rows, [0.34, 0.14, 0.14, 0.12, 0.13, 0.13]);
  },

  sectionMoments(S) {
    this.h1(S, '13. Momentos Importantes');
    const list = S.ctx.occurrences.filter((o) => o.source === 'momento');
    if (!list.length) return this.empty(S);
    const rows = list.sort((a, b) => a.timestamp - b.timestamp).map((o) => [
      `${o.period} ${String(o.minute).padStart(2, '0')}:${String(o.second).padStart(2, '0')}`,
      o.note || '(sem nota)',
    ]);
    this.table(S, ['Tempo', 'Nota'], rows, [0.2, 0.8]);
  },

  sectionInterventions(S) {
    this.h1(S, '14. Intervenções ao Banco');
    const list = S.ctx.occurrences.filter((o) => o.source === 'banco');
    if (!list.length) return this.empty(S);
    const rows = list.sort((a, b) => a.timestamp - b.timestamp).map((o) => [
      `${o.period} ${String(o.minute).padStart(2, '0')}'`, o.eventName, o.note || '',
    ]);
    this.table(S, ['Tempo', 'Tipo', 'Nota'], rows, [0.18, 0.24, 0.58]);
  },

  sectionNotes(S) {
    this.h1(S, '15. Notas do Analista');
    const list = S.ctx.occurrences.filter((o) => o.source === 'nota');
    if (!list.length) return this.empty(S);
    list.sort((a, b) => a.timestamp - b.timestamp).forEach((o) => {
      this.text(S, `${o.period} ${String(o.minute).padStart(2, '0')}'`, { bold: true, size: 9, color: this.COLORS.accent });
      this.text(S, o.note, { size: 9.5 });
      S.y -= 4;
    });
  },

  sectionSketches(S) {
    const pages = (S.ctx.drawings || []).filter((p) => (p.strokes || []).length > 0)
      .sort((a, b) => a.pageIndex - b.pageIndex);
    this.h1(S, '15b. Notas Manuscritas', pages.length ? 300 : 0);
    if (!pages.length) return this.empty(S, 'Sem apontamentos manuscritos.');

    pages.forEach((page) => {
      const w = S.W - S.margin * 2;
      const h = w * 0.62;
      this.ensure(S, h + 30);
      const x0 = S.margin, y0 = S.y - h;
      S.page.drawRectangle({ x: x0, y: y0, width: w, height: h, color: S.rgb(0.07, 0.09, 0.12) });

      // Redesenha os traços vetoriais diretamente no PDF (nítidos, sem rasterizar).
      page.strokes.forEach((s) => {
        if (s.eraser) return; // a borracha só faz sentido no canvas interativo
        const col = this.hexToRgb(s.color || '#eef1f6');
        const pts = s.points || [];
        // Suavização idêntica à do canvas: curva quadrática entre pontos médios,
        // para o traço no PDF não sair angular.
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const cur = pts[i];
          // drawSvgPath usa o sistema SVG (origem no canto superior esquerdo da
          // página, Y a crescer para BAIXO), ao contrário do resto do pdf-lib.
          // Convertemos aqui para esse sistema.
          const px = (pt) => x0 + pt.x * w;
          const py = (pt) => S.H - (y0 + (1 - pt.y) * h);
          const startPt = i === 1
            ? { x: px(prev), y: py(prev) }
            : { x: (px(pts[i - 2]) + px(prev)) / 2, y: (py(pts[i - 2]) + py(prev)) / 2 };
          const endPt = { x: (px(prev) + px(cur)) / 2, y: (py(prev) + py(cur)) / 2 };
          const ctrl = { x: px(prev), y: py(prev) };
          const thickness = Math.max(0.5, s.width * (0.6 + cur.p) * 0.5);
          S.page.drawSvgPath(
            `M ${startPt.x} ${startPt.y} Q ${ctrl.x} ${ctrl.y} ${endPt.x} ${endPt.y}`,
            { borderColor: S.rgb(...col), borderWidth: thickness, x: 0, y: S.H }
          );
        }
      });
      S.y = y0 - 12;
      this.text(S, `Página ${page.pageIndex + 1} - ${page.strokes.length} traços`, { size: 8, color: this.COLORS.muted });
      S.y -= 6;
    });
  },

  hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  },

  /**
   * Scouting permanente do adversário (perfil da equipa, não deste jogo).
   * Fica claramente identificado como tal para não se confundir com o que foi
   * observado no encontro.
   */
  sectionScouting(S) {
    const team = S.ctx.opponentTeam;
    const sc = team?.scouting;
    const profile = team?.profile || {};
    this.h1(S, '15c. Scouting do Adversário');
    if (!team) return this.empty(S, 'Sem equipa adversária associada.');
    this.text(S, `Perfil permanente de ${team.name} — informação recolhida pelo analista, independente deste jogo.`, { size: 9, color: this.COLORS.muted });

    // Campos preenchidos do modelo de jogo
    let any = false;
    SCOUTING_SECTIONS.forEach((sec) => {
      const filled = sec.fields.filter((f) => profile[f.key] && String(profile[f.key]).trim());
      if (!filled.length) return;
      any = true;
      this.text(S, sec.title, { bold: true, size: 10.5 });
      this.table(S, ['Campo', 'Observação'], filled.map((f) => [f.label, profile[f.key]]), [0.32, 0.68]);
    });

    // Listas
    if (sc) {
      SCOUTING_LISTS.forEach((list) => {
        const items = sc[list.id] || [];
        if (!items.length) return;
        any = true;
        this.text(S, list.title, { bold: true, size: 10.5 });
        this.table(S, ['Título', 'Descrição', 'Prioridade'], items.map((it) => [
          it.title,
          it.description || '',
          (SCOUTING_PRIORITIES.find((p) => p.key === it.priority)?.label || '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim() || '-',
        ]), [0.32, 0.48, 0.2]);
      });

      // Jogadores-chave
      const kp = sc.keyPlayers || [];
      if (kp.length) {
        any = true;
        this.text(S, 'Jogadores-Chave', { bold: true, size: 10.5 });
        kp.forEach((k) => {
          const p = S.ctx.opponentPlayers.find((x) => x.id === k.playerId);
          if (!p) return;
          this.text(S, `${p.number ? '#' + p.number + ' ' : ''}${p.name}`, { bold: true, size: 10 });
          const filled = KEY_PLAYER_FIELDS.filter((f) => k[f.key] && k[f.key].trim());
          if (filled.length) {
            this.table(S, ['Aspeto', 'Nota'], filled.map((f) => [f.label, k[f.key]]), [0.3, 0.7]);
          } else {
            this.empty(S, 'Sem notas.');
          }
        });
      }

      // Notas permanentes
      const notes = sc.notes || [];
      if (notes.length) {
        any = true;
        this.text(S, 'Notas Permanentes', { bold: true, size: 10.5 });
        notes.forEach((n) => {
          this.text(S, n.text, { size: 9.5 });
          if (n.tags && n.tags.length) this.text(S, n.tags.map((t) => '#' + t).join(' '), { size: 8, color: this.COLORS.muted });
          S.y -= 3;
        });
      }
    }

    if (!any) this.empty(S, 'Sem informação de scouting registada para esta equipa.');
  },

  sectionFinalNotes(S) {
    this.h1(S, '16. Observações Finais');
    if (!S.config.finalNotes) return this.empty(S, 'Sem observações finais.');
    this.text(S, S.config.finalNotes, { size: 10 });
  },

  // ---------- Auxiliares ----------
  playerName(S, id) {
    if (!id) return '';
    const all = [...S.ctx.ownPlayers, ...S.ctx.opponentPlayers];
    const p = all.find((pl) => pl.id === id);
    return p ? `${p.number ? p.number + ' ' : ''}${p.shortName || p.name}` : '';
  },

  playerNames(S, ids) {
    return (ids || []).map((id) => this.playerName(S, id)).filter(Boolean).join(', ');
  },

  /** Numeração de páginas + rodapé, aplicados no fim (quando o total já é conhecido). */
  stampFooters(S) {
    const pages = S.doc.getPages();
    pages.forEach((p, i) => {
      const label = `${i + 1} / ${pages.length}`;
      const lw = S.font.widthOfTextAtSize(label, 8);
      p.drawText(label, { x: S.W - S.margin - lw, y: 30, size: 8, font: S.font, color: S.rgb(...this.COLORS.muted) });
      if (i > 0) {
        p.drawText('Analista Live', { x: S.margin, y: 30, size: 8, font: S.font, color: S.rgb(...this.COLORS.muted) });
      }
    });
  },
};

window.PDFReport = PDFReport;
