/**
 * pdfBriefing.js — BRIEFING DE JOGO (antes do jogo), para dar ao treinador.
 *
 * Junta numa folha o que já está preparado: os focos do plano de observação, o
 * perfil e o dossiê do adversário, e — o que dá valor a isto — o histórico de
 * cada item ("confirmado em 3 de 4 jogos"), para se decidir o que observar com
 * base no que já se viu. Reutiliza o motor de layout do pdfReport.js.
 *
 * Texto pequeno em SMALL_INK (#5f6573, 5,84:1 sobre branco); o cinzento do
 * motor fica em 4,29:1, abaixo do exigido a texto.
 */

const PDFBriefing = {
  SMALL_INK: [0x5f / 255, 0x65 / 255, 0x73 / 255],

  /** @param {{match, planEvents, ownTeam, opponentTeam, ownPlayers, opponentPlayers, trackRecord}} ctx */
  async generate(ctx) {
    const bytes = await this.build(ctx);
    const opp = String(ctx.match.opponent || 'jogo').replace(/\s+/g, '-');
    const filename = `briefing_${opp}_${ctx.match.date || new Date().toISOString().slice(0, 10)}.pdf`;
    await saveOrShareBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
    return filename;
  },

  /** Monta o PDF e devolve os bytes (separado de generate para poder ser verificado). */
  async build(ctx) {
    const R = PDFReport;
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    const m = ctx.match;
    doc.setTitle(`Briefing — ${m.team} vs ${m.opponent}`);
    doc.setCreator('Analista Live');

    const S = {
      doc, rgb,
      font: await doc.embedFont(StandardFonts.Helvetica),
      fontBold: await doc.embedFont(StandardFonts.HelveticaBold),
      page: null, y: 0, pageNum: 0,
      W: 595.28, H: 841.89, margin: 48,
      ctx: { match: m }, config: {},
      headerText: `BRIEFING · ${m.team} vs ${m.opponent}`,
      mutedColor: this.SMALL_INK,
    };
    const note = (msg) => { R.text(S, msg, { size: 9, color: this.SMALL_INK }); S.y -= 4; };

    this.drawHeader(S, R, ctx);

    // ---- 1. Focos do jogo ----
    R.h1(S, '1. Focos do jogo');
    const plan = ctx.planEvents || [];
    const focos = plan.filter((e) => e.isFocus);
    if (!plan.length) {
      note('O plano de observação ainda está vazio.');
    } else {
      const list = focos.length ? focos : plan.slice(0, 8);
      if (!focos.length) note('Nenhum evento marcado como foco — mostram-se os primeiros do plano.');
      R.table(S, ['Foco', 'Categoria', 'Prioridade', 'Histórico'], list.map((e) => [
        e.name,
        Utils.categoryLabel(e.category),
        (Utils.PRIORITY_META[e.priority] || {}).label || '-',
        this.trackLabel(ctx, e),
      ]), [0.40, 0.20, 0.18, 0.22]);
      if (focos.length && plan.length > focos.length) {
        note(`+ ${plan.length - focos.length} ${plan.length - focos.length === 1 ? 'evento' : 'eventos'} no plano além dos focos.`);
      }
      note('Histórico: jogos em que aconteceu / jogos terminados em que esteve no plano.');
    }

    // ---- 2. Perfil do adversário ----
    // ---- 2. Histórico direto ----
    R.h1(S, '2. Como correram os jogos anteriores');
    const h2h = MatchStats.headToHead(ctx.opponentTeam ? ctx.opponentTeam.id : null, ctx.history || []);
    if (!h2h.rows.length) {
      note('Primeiro jogo registado contra este adversário.');
    } else {
      const t = h2h.totals;
      R.text(S, `${t.played} ${t.played === 1 ? 'jogo' : 'jogos'}: ${t.wins}V ${t.draws}E ${t.losses}D · golos ${t.goalsFor}-${t.goalsAgainst}`, { size: 11 });
      S.y -= 6;
      R.table(S, ['Data', 'Resultado', 'Competição', 'Previsões confirmadas'], h2h.rows.map((r) => [
        r.date ? Utils.formatDate(r.date) : '-',
        `${r.result} ${r.ourGoals}-${r.theirGoals}`,
        r.competition || '-',
        r.tracked ? `${r.confirmed} de ${r.tracked}` : '-',
      ]), [90, 90, 160, 160]);
      note('"Previsões confirmadas" = itens do dossiê que estavam no plano desse jogo e chegaram mesmo a acontecer.');
    }

    R.h1(S, '3. Perfil do adversário');
    const profile = (ctx.opponentTeam && ctx.opponentTeam.profile) || {};
    const quick = QUICK_PROFILE.map((q) => [q.label, profile[q.key]]).filter((r) => r[1] && String(r[1]).trim());
    if (!quick.length) note('Sem perfil preenchido no scouting desta equipa.');
    else R.table(S, ['Campo', 'Valor'], quick, [0.35, 0.65]);

    // ---- 3. O que o dossiê diz ----
    R.h1(S, '4. O que o dossiê diz');
    const sc = (ctx.opponentTeam && ctx.opponentTeam.scouting) || {};
    const rows = [];
    SCOUTING_LISTS.forEach((list) => {
      (sc[list.id] || []).slice(0, 6).forEach((it) => {
        rows.push([list.title, it.title, this.trackLabelForItem(ctx, it.id)]);
      });
    });
    if (!rows.length) note('Sem pontos fortes, fracos, ameaças, oportunidades ou gatilhos registados.');
    else R.table(S, ['Tipo', 'Item', 'Histórico'], rows, [0.24, 0.54, 0.22]);

    // ---- 4. Jogadores-chave ----
    R.h1(S, '5. Jogadores-chave do adversário');
    const keyPlayers = sc.keyPlayers || [];
    if (!keyPlayers.length) {
      note('Sem jogadores-chave definidos.');
    } else {
      keyPlayers.forEach((k) => {
        const p = (ctx.opponentPlayers || []).find((x) => x.id === k.playerId);
        if (!p) return;
        R.text(S, `${p.number ? '#' + p.number + ' ' : ''}${p.name}${p.position ? ' - ' + p.position : ''}`, { bold: true, size: 11 });
        const filled = KEY_PLAYER_FIELDS.filter((f) => k[f.key] && String(k[f.key]).trim()).slice(0, 3);
        if (filled.length) R.table(S, ['Aspeto', 'Nota'], filled.map((f) => [f.label, k[f.key]]), [0.3, 0.7]);
        else note('Sem notas.');
      });
    }

    // ---- 5. Onze previsto ----
    const positions = (m.teams?.own?.positions || []).filter((pos) => pos.playerId);
    if (positions.length) {
      R.h1(S, '6. Onze previsto');
      const byId = new Map((ctx.ownPlayers || []).map((p) => [p.id, p]));
      R.table(S, ['Nº', 'Jogador', 'Posição'], positions.map((pos) => {
        const p = byId.get(pos.playerId);
        return [p && p.number ? String(p.number) : '-', p ? p.name : '(jogador removido do plantel)', (p && p.position) || pos.role || '-'];
      }), [0.1, 0.6, 0.3]);
    }

    this.stampFooters(S, R);
    return doc.save();
  },

  /** Histórico de um evento do plano que veio do scouting. */
  trackLabel(ctx, planEvent) {
    if (!planEvent.scoutingRef) return '-';
    return this.trackLabelForItem(ctx, planEvent.scoutingRef.itemId);
  },

  trackLabelForItem(ctx, itemId) {
    const rec = ctx.trackRecord && ctx.trackRecord.get(itemId);
    if (!rec || !rec.tracked) return '-';
    return `${rec.confirmed}/${rec.tracked} ${rec.tracked === 1 ? 'jogo' : 'jogos'}`;
  },

  drawHeader(S, R, ctx) {
    const page = S.doc.addPage([S.W, S.H]);
    S.page = page;
    S.pageNum++;
    const m = ctx.match;
    const BAND = 116;
    page.drawRectangle({ x: 0, y: S.H - BAND, width: S.W, height: BAND, color: S.rgb(0.06, 0.09, 0.14) });

    const kicker = 'ANALISTA LIVE · BRIEFING DE JOGO';
    const kw = S.font.widthOfTextAtSize(kicker, 8);
    page.drawText(kicker, { x: S.W - S.margin - kw, y: S.H - 26, size: 8, font: S.font, color: S.rgb(0.45, 0.58, 0.85) });

    const title = R.wrap(`${m.team}  vs  ${m.opponent}`, S.fontBold, 20, S.W - S.margin * 2)[0];
    page.drawText(title, { x: S.margin, y: S.H - 58, size: 20, font: S.fontBold, color: S.rgb(1, 1, 1) });

    const meta = [m.date ? Utils.formatDate(m.date) : '', m.competition, m.venue === 'home' ? 'Casa' : (m.venue === 'away' ? 'Fora' : '')].filter(Boolean).join(' · ');
    if (meta) page.drawText(R.sanitize(meta), { x: S.margin, y: S.H - 80, size: 10, font: S.font, color: S.rgb(0.78, 0.82, 0.88) });

    const byline = ctx.ownTeam && ctx.ownTeam.name ? `Preparado por ${ctx.ownTeam.name}` : '';
    if (byline) page.drawText(R.sanitize(byline), { x: S.margin, y: S.H - 98, size: 9, font: S.font, color: S.rgb(0.66, 0.72, 0.82) });

    S.y = S.H - BAND - 20;
  },

  stampFooters(S, R) {
    const pages = S.doc.getPages();
    const gen = R.sanitize(`Briefing · Analista Live · gerado em ${new Date().toLocaleDateString('pt-PT')}`);
    pages.forEach((pg, i) => {
      const label = `${i + 1} / ${pages.length}`;
      const lw = S.font.widthOfTextAtSize(label, 8);
      pg.drawText(label, { x: S.W - S.margin - lw, y: 30, size: 8, font: S.font, color: S.rgb(...this.SMALL_INK) });
      pg.drawText(gen, { x: S.margin, y: 30, size: 8, font: S.font, color: S.rgb(...this.SMALL_INK) });
    });
  },
};

window.PDFBriefing = PDFBriefing;
