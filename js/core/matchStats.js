/**
 * matchStats.js — Estatísticas derivadas do jogo.
 *
 * PRINCÍPIO CENTRAL (pedido explicitamente): nunca duplicar dados nem inventar
 * estatísticas. Este módulo NÃO guarda números — calcula-os sempre a partir de:
 *   - match.score (golos, fonte única — quer venha do toque rápido no placar
 *     quer de um remate detalhado marcado como "Golo")
 *   - occurrences (remates, cantos, faltas, cartões, e os contadores rápidos
 *     de fora-de-jogo/ataque perigoso/livre/penálti)
 *
 * Isto significa: registar um remate como "Golo" nunca cria um segundo registo
 * de golo — o placar é que é a fonte da verdade, e o módulo de remates
 * incrementa-o diretamente (ver live.js). As estatísticas aqui limitam-se a
 * CONTAR o que já foi registado, nunca a estimar ou inferir.
 */

const MatchStats = {
  STAT_KEYS: [
    { key: 'goals', label: 'Golos' },
    { key: 'ownGoals', label: 'Autogolos' },
    { key: 'assists', label: 'Assistências' },
    { key: 'chancesCreated', label: 'Grandes Oport. Criadas' },
    { key: 'shots', label: 'Remates' },
    { key: 'shotsOnTarget', label: 'Enquadrados' },
    { key: 'shotsOffTarget', label: 'Não Enquadrados' },
    { key: 'saves', label: 'Defesas do GR' },
    { key: 'corners', label: 'Cantos' },
    { key: 'foulsCommitted', label: 'Faltas Cometidas' },
    { key: 'foulsSuffered', label: 'Faltas Sofridas' },
    { key: 'offside', label: 'Fora de Jogo' },
    { key: 'yellowCards', label: 'Amarelos' },
    { key: 'redCards', label: 'Vermelhos' },
    { key: 'dangerousAttacks', label: 'Ataques Perigosos' },
    { key: 'freeKicks', label: 'Livres' },
    { key: 'penalties', label: 'Penáltis' },
  ],
  QUICK_KEYS: ['offside', 'dangerousAttacks', 'freeKicks', 'penalties'],

  SHOT_RESULTS: [
    { key: 'goal', label: 'Golo' },
    { key: 'save', label: 'Defesa' },
    { key: 'blocked', label: 'Bloqueado' },
    { key: 'wide', label: 'Fora' },
    { key: 'post', label: 'Poste/Trave' },
    { key: 'other', label: 'Outro' },
  ],
  GOAL_ZONES: [
    ['TL', 'TC', 'TR'],
    ['ML', 'MC', 'MR'],
    ['BL', 'BC', 'BR'],
  ],
  FOUL_CONSEQUENCES: [
    { key: 'freeKick', label: 'Livre' },
    { key: 'penalty', label: 'Penálti' },
    { key: 'yellow', label: '🟨 Amarelo' },
    { key: 'red', label: '🟥 Vermelho' },
  ],
  SAVE_TYPES: [
    { key: 'easy', label: 'Defesa fácil' },
    { key: 'medium', label: 'Defesa média' },
    { key: 'hard', label: 'Defesa difícil' },
    { key: 'great', label: 'Grande defesa' },
    { key: 'feet', label: 'Com os pés' },
    { key: 'dive', label: 'Em mergulho' },
    { key: 'aerial', label: 'Aérea' },
    { key: 'one_v_one', label: 'Saída / 1x1' },
  ],
  FOUL_TYPES: [
    { key: 'tactical', label: 'Tática' },
    { key: 'normal', label: 'Normal' },
    { key: 'reckless', label: 'Entrada' },
    { key: 'charge', label: 'Carga' },
    { key: 'handball', label: 'Mão' },
    { key: 'other', label: 'Outro' },
  ],
  CORNER_RESULTS: [
    { key: 'opportunity', label: 'Oportunidade' },
    { key: 'shot', label: 'Remate' },
    { key: 'goal', label: 'Golo' },
    { key: 'cleared', label: 'Afastado' },
    { key: 'second_ball', label: '2ª Bola' },
    { key: 'lost', label: 'Perdido' },
  ],

  /**
   * Quem fez o passe que deu o remate ("grande oportunidade criada"), ou null.
   *
   * Compatibilidade: antes só se registava a assistência, e apenas nos golos —
   * essa assistência É o passe que criou a oportunidade, por isso continua a
   * contar nos jogos antigos.
   */
  passerOf(occ) {
    if (!occ || occ.source !== 'remate') return null;
    return occ.meta?.passerId || (occ.meta?.result === 'goal' ? (occ.meta?.assistId || null) : null);
  },

  /** Quem assistiu um remate marcado "Golo" (o passador desse remate), ou null. */
  shotAssistOf(occ) {
    if (!occ || occ.source !== 'remate' || occ.meta?.result !== 'goal') return null;
    return occ.meta?.assistId || occ.meta?.passerId || null;
  },

  empty() {
    const o = {};
    this.STAT_KEYS.forEach((k) => { o[k.key] = 0; });
    return o;
  },

  compute(match, occurrences) {
    const own = this.empty();
    const opp = this.empty();
    own.goals = match.score?.team || 0;
    opp.goals = match.score?.opponent || 0;

    occurrences.forEach((o) => {
      const t = o.team === 'own' ? own : (o.team === 'opponent' ? opp : null);
      if (!t) return;
      const other = t === own ? opp : own;

      if (o.source === 'remate') {
        t.shots++;
        const r = o.meta?.result;
        if (r === 'goal' || r === 'save') t.shotsOnTarget++;
        else if (r === 'wide' || r === 'post') t.shotsOffTarget++;
        // O passe que deu o remate conta como grande oportunidade criada.
        if (this.passerOf(o)) t.chancesCreated++;
        // Um remate marcado "Golo" pode ter assistência própria (não passa
        // pelo fluxo do placar) — conta-se aqui tal como a do golo por placar.
        if (this.shotAssistOf(o)) t.assists++;
      } else if (o.source === 'canto') {
        t.corners++;
      } else if (o.source === 'falta') {
        t.foulsCommitted++;
        other.foulsSuffered++;
        // As consequências vivem no MESMO evento — nunca se cria um segundo
        // registo de cartão ou de livre, para não duplicar contagens.
        const c = o.meta?.consequences || [];
        if (c.includes('freeKick')) other.freeKicks++;
        if (c.includes('penalty')) other.penalties++;
        if (c.includes('yellow')) t.yellowCards++;
        if (c.includes('red')) t.redCards++;
      } else if (o.source === 'cartao') {
        if (/vermelho/i.test(o.eventName)) t.redCards++; else t.yellowCards++;
      } else if (o.source === 'golo') {
        // O placar é a fonte de verdade dos golos; aqui só contamos os detalhes.
        if (o.meta?.ownGoal) t.ownGoals++;
        if (o.meta?.assistId) t.assists++;
      } else if (o.source === 'defesa') {
        t.saves++;
      } else if (o.source === 'stat_quick' && o.meta?.statKey && t[o.meta.statKey] !== undefined) {
        t[o.meta.statKey]++;
      }
    });

    return { own, opp };
  },

  shotsList(occurrences) {
    return occurrences.filter((o) => o.source === 'remate');
  },

  /**
   * "Momentum" de uma janela de tempo — quem tem estado por cima, calculado só
   * a partir do que foi registado (sem inventar). Devolve pontuações brutas por
   * equipa; a UI transforma em percentagem/barra. Não guarda nada.
   *
   * Pesos: golo 6 · remate enquadrado 4 · remate 2 · canto 1 · ataque perigoso 1
   *        · falta sofrida 0.5 (bola parada perto). Bola parada defensiva não conta.
   */
  momentum(occurrences, fromMinute = 0, toMinute = Infinity) {
    const w = { own: 0, opp: 0 };
    const add = (team, n) => { if (team === 'own') w.own += n; else if (team === 'opponent') w.opp += n; };
    occurrences.forEach((o) => {
      if (o.minute < fromMinute || o.minute > toMinute) return;
      if (o.source === 'golo') add(o.team, 6);
      else if (o.source === 'remate') {
        const r = o.meta?.result;
        add(o.team, (r === 'goal' || r === 'save') ? 4 : 2);
      } else if (o.source === 'canto') add(o.team, 1);
      else if (o.source === 'stat_quick' && o.meta?.statKey === 'dangerousAttacks') add(o.team, 1);
      else if (o.source === 'falta') add(o.team === 'own' ? 'opponent' : 'own', 0.5);
    });
    const total = w.own + w.opp;
    return {
      own: w.own, opp: w.opp,
      ownPct: total ? Math.round((w.own / total) * 100) : 50,
      oppPct: total ? Math.round((w.opp / total) * 100) : 50,
      total,
    };
  },

  foulsList(occurrences) {
    return occurrences.filter((o) => o.source === 'falta');
  },

  // ---------- Perdas & Recuperações (transições de posse) ----------
  transitionsList(occurrences) {
    return occurrences.filter((o) => o.source === 'perda' || o.source === 'recuperacao');
  },

  /**
   * Terço do campo de uma coordenada y (0 = baliza adversária / topo, 1 = nossa
   * baliza / fundo), do ponto de vista da NOSSA equipa (ataca para cima):
   *   y < 1/3  -> terço ofensivo   ·   1/3..2/3 -> meio-campo   ·   y > 2/3 -> terço defensivo
   */
  thirdOf(y) {
    if (y == null) return null;
    if (y < 1 / 3) return 'att';
    if (y > 2 / 3) return 'def';
    return 'mid';
  },

  /** Contagem por terço (def/mid/att) de perdas ou recuperações. */
  transitionsByThird(occurrences, kind) {
    const out = { def: 0, mid: 0, att: 0, total: 0 };
    this.transitionsList(occurrences)
      .filter((o) => !kind || o.source === kind)
      .forEach((o) => {
        const t = this.thirdOf(o.meta?.location?.y);
        if (t) { out[t]++; out.total++; }
      });
    out.defPct = out.total ? Math.round((out.def / out.total) * 100) : 0;
    out.midPct = out.total ? Math.round((out.mid / out.total) * 100) : 0;
    out.attPct = out.total ? Math.round((out.att / out.total) * 100) : 0;
    return out;
  },

  /**
   * Mapa de perdas e recuperações — pitch com pontos (🔴 perda · 🟢 recuperação)
   * + leitura por terços. Usado no LIVE, no pós-jogo e no ecrã do banco.
   * @param {'all'|'perda'|'recuperacao'} filter
   * @param {'all'|'1T'|'2T'|'last'} period
   */
  renderTransitionsMapHTML(occurrences, ownName, oppName, filter = 'all', period = 'all', nowMin = 999) {
    let list = this.transitionsList(occurrences)
      .filter((o) => filter === 'all' || o.source === filter)
      .filter((o) => {
        if (period === '1T') return o.period === '1T';
        if (period === '2T') return o.period === '2T';
        if (period === 'last') return (o.minute || 0) >= nowMin - 10;
        return true;
      });
    const withCoords = list.filter((o) => o.meta?.location);
    const markers = withCoords.map((o) => {
      const xy = o.meta.location;
      const cls = o.source === 'perda' ? 'is-loss' : 'is-recover';
      return `<span class="tmap-dot ${cls}" style="left:${xy.x * 100}%; top:${xy.y * 100}%" title="${o.minute}' — ${o.source === 'perda' ? 'perda' : 'recuperação'}"></span>`;
    }).join('');

    const perda = this.transitionsByThird(list.filter((o) => o.source === 'perda'), 'perda');
    const rec = this.transitionsByThird(list.filter((o) => o.source === 'recuperacao'), 'recuperacao');
    const bar = (label, t, cls) => `
      <div class="tmap-third-row">
        <span class="tmap-third-label">${label}</span>
        <span class="tmap-third-cells">
          <span class="${cls}">Def ${t.defPct}%</span>
          <span class="${cls}">Meio ${t.midPct}%</span>
          <span class="${cls}">Of. ${t.attPct}%</span>
        </span>
        <span class="tmap-third-total">${t.total}</span>
      </div>`;

    return `
      <div class="transitions-map">
        ${Pitch.mapHTML(markers)}
        <div class="map-legend">
          <span><span class="tmap-dot is-loss"></span> Perda</span>
          <span><span class="tmap-dot is-recover"></span> Recuperação</span>
          <span class="muted">${Utils.escapeHtml(ownName)} ataca ↑</span>
        </div>
        <div class="tmap-thirds">
          ${bar('🔴 Perdas', perda, 'is-loss')}
          ${bar('🟢 Recuper.', rec, 'is-recover')}
        </div>
      </div>`;
  },

  // ---------- Leitura de vários jogos ----------

  /**
   * Resumo da época de uma equipa: vitórias, empates, derrotas, golos e forma.
   * Só jogos terminados. Não há pontos, porque a atribuição varia de prova para
   * prova e não se inventa aqui.
   */
  seasonSummary(teamId, entries) {
    const out = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, form: [] };
    entries
      .filter((e) => e.match && e.match.status === 'finished')
      .sort((a, b) => String(a.match.date || '').localeCompare(String(b.match.date || '')))
      .forEach(({ match }) => {
        const side = match.teams?.own?.teamId === teamId ? 'own'
          : (match.teams?.opponent?.teamId === teamId ? 'opponent' : null);
        if (!side) return;
        const gf = side === 'own' ? (match.score?.team || 0) : (match.score?.opponent || 0);
        const ga = side === 'own' ? (match.score?.opponent || 0) : (match.score?.team || 0);
        out.played++;
        out.goalsFor += gf;
        out.goalsAgainst += ga;
        const r = gf > ga ? 'V' : (gf < ga ? 'D' : 'E');
        if (r === 'V') out.wins++; else if (r === 'D') out.losses++; else out.draws++;
        out.form.push({ result: r, date: match.date, opponent: side === 'own' ? match.opponent : match.team, score: `${gf}-${ga}` });
      });
    return out;
  },

  /**
   * Eventos do plano que se repetem de jogo para jogo — "isto é de um jogo ou é
   * nosso?". Agrupa pelo evento da biblioteca (`libraryId`); os eventos criados
   * à mão num jogo não têm biblioteca, por isso caem no nome em minúsculas.
   * Só jogos terminados.
   */
  recurringPlanEvents(entries, { minMatches = 2 } = {}) {
    const byKey = new Map();
    entries.forEach(({ match, occurrences }) => {
      if (!match || match.status !== 'finished') return;
      const counts = {};
      (occurrences || []).forEach((o) => { if (o.planEventId) counts[o.planEventId] = (counts[o.planEventId] || 0) + 1; });
      (match.observationPlan || []).forEach((e) => {
        const key = e.libraryId || `nome:${String(e.name || '').toLowerCase()}`;
        const rec = byKey.get(key) || { key, name: e.name, type: e.type || 'neutral', category: e.category, planned: 0, happened: 0, total: 0, lastDate: null };
        rec.planned++;
        const n = counts[e.id] || 0;
        if (n) {
          rec.happened++;
          rec.total += n;
          if (!rec.lastDate || String(match.date) > String(rec.lastDate)) rec.lastDate = match.date;
        }
        byKey.set(key, rec);
      });
    });
    return [...byKey.values()]
      .filter((r) => r.happened >= minMatches)
      .sort((a, b) => b.happened - a.happened || b.total - a.total);
  },

  /**
   * Resumo do jogo em texto simples, para colar no WhatsApp ou no email do staff.
   * Só entra o que foi registado; secções sem dados não aparecem.
   */
  matchSummaryText(match, occurrences) {
    const st = this.compute(match, occurrences);
    const lines = [];
    const head = [`${match.team} ${match.score?.team ?? 0} - ${match.score?.opponent ?? 0} ${match.opponent}`];
    if (match.competition) head.push(match.competition);
    if (match.date) head.push(Utils.formatDate(match.date));
    lines.push(head.join(' · '));

    const pair = (label, key) => (st.own[key] || st.opp[key] ? `${label} ${st.own[key]}-${st.opp[key]}` : null);
    const numbers = [
      pair('Remates', 'shots'),
      pair('Enquadrados', 'shotsOnTarget'),
      pair('Cantos', 'corners'),
      pair('Faltas', 'foulsCommitted'),
      pair('Oport. criadas', 'chancesCreated'),
    ].filter(Boolean);
    if (numbers.length) lines.push(numbers.join(' · '));

    const pc = this.periodComparison(match, occurrences);
    if (pc.comparable && pc.highlights.length) {
      lines.push('Entre as partes: ' + pc.highlights
        .map((h) => `${h.label} ${h.from} → ${h.to}${h.side === 'opp' ? ' (adversário)' : ''}`)
        .join(' · '));
    }

    const chains = this.setPieceChains(occurrences);
    const sp = [];
    if (chains.own.corners.total) sp.push(`cantos ${chains.own.corners.withShot}/${chains.own.corners.total} com remate`);
    const speed = this.transitionSpeed(occurrences);
    if (speed.recoveries) sp.push(`recuperações com remate em ${this.CHAIN_WINDOW.transition}s: ${speed.converted}/${speed.recoveries}`);
    const costly = this.costlyLosses(occurrences, match);
    if (costly.total) sp.push(`${costly.total} ${costly.total === 1 ? 'perda que custou golo' : 'perdas que custaram golo'}`);
    if (sp.length) lines.push('Padrões: ' + sp.join(' · '));

    const tactics = occurrences.filter((o) => o.source === 'tatica').sort((a, b) => a.timestamp - b.timestamp);
    if (tactics.length) {
      lines.push('Mudanças táticas: ' + tactics
        .map((t) => `${t.minute}' ${t.meta?.formationName || 'sistema alterado'}${t.team === 'opponent' ? ' (adversário)' : ''}`)
        .join(' · '));
    }

    const moments = occurrences.filter((o) => o.source === 'momento').sort((a, b) => a.timestamp - b.timestamp);
    if (moments.length) {
      lines.push('Momentos:');
      moments.slice(0, 8).forEach((m) => lines.push(`· ${String(m.minute).padStart(2, '0')}' ${(m.note || '').trim() || 'momento marcado'}`));
      if (moments.length > 8) lines.push(`· (+${moments.length - 8})`);
    }
    return lines.join('\n');
  },

  // ---------- 1ª parte vs 2ª parte ----------

  /** Partes comparáveis. O prolongamento junta as suas duas metades. */
  PERIOD_GROUPS: [
    { key: '1T', label: '1ª Parte', periods: ['1T'] },
    { key: '2T', label: '2ª Parte', periods: ['2T'] },
    { key: 'ET', label: 'Prolong.', periods: ['ET1', 'ET2'] },
  ],

  /** Linhas da comparação, por ordem. `ownOnly`: só existe do nosso ponto de vista. */
  PERIOD_ROWS: [
    { key: 'goals', label: 'Golos' },
    { key: 'shots', label: 'Remates' },
    { key: 'shotsOnTarget', label: 'Enquadrados' },
    { key: 'chancesCreated', label: 'Grandes oport. criadas' },
    { key: 'corners', label: 'Cantos' },
    { key: 'dangerousAttacks', label: 'Ataques Perigosos' },
    { key: 'freeKicks', label: 'Livres' },
    { key: 'penalties', label: 'Penáltis' },
    { key: 'foulsCommitted', label: 'Faltas Cometidas' },
    { key: 'offside', label: 'Fora de Jogo' },
    { key: 'saves', label: 'Defesas do GR' },
    { key: 'yellowCards', label: 'Amarelos' },
    { key: 'redCards', label: 'Vermelhos' },
    { key: 'perdas', label: 'Perdas de bola', ownOnly: true },
    { key: 'recuperacoes', label: 'Recuperações', ownOnly: true },
  ],

  /** Diferença mínima (em valor absoluto) para uma linha ser destacada. */
  PERIOD_HIGHLIGHT_MIN_DELTA: 3,

  /** Golos de uma equipa numa lista de ocorrências: golo pelo placar + remate marcado "Golo". */
  _goalsFrom(list, team) {
    return list.filter((o) => o.team === team
      && (o.source === 'golo' || (o.source === 'remate' && o.meta?.result === 'goal'))).length;
  },

  /**
   * Números de cada parte, lado a lado.
   *
   * O resultado final vem do placar (fonte única); por parte o placar não diz
   * nada, por isso os golos de cada parte contam-se pelos registos de golo — e
   * se a soma não bater com o resultado isso fica dito (goalsCheck), não
   * escondido. Registos feitos fora do tempo de jogo (ex.: intervalo) não entram.
   */
  periodComparison(match, occurrences) {
    const groups = this.PERIOD_GROUPS.map((g) => {
      const subset = occurrences.filter((o) => g.periods.includes(o.period));
      const st = this.compute({ score: { team: 0, opponent: 0 } }, subset);
      st.own.goals = this._goalsFrom(subset, 'own');
      st.opp.goals = this._goalsFrom(subset, 'opponent');
      st.own.perdas = subset.filter((o) => o.source === 'perda').length;
      st.own.recuperacoes = subset.filter((o) => o.source === 'recuperacao').length;
      return { key: g.key, label: g.label, count: subset.length, own: st.own, opp: st.opp };
    });
    const [first, second, extra] = groups;
    const inPlay = new Set(this.PERIOD_GROUPS.flatMap((g) => g.periods));

    const highlights = [];
    if (first.count && second.count) {
      this.PERIOD_ROWS.forEach((row) => {
        (row.ownOnly ? ['own'] : ['own', 'opp']).forEach((side) => {
          const from = first[side][row.key] || 0;
          const to = second[side][row.key] || 0;
          if (Math.abs(to - from) >= this.PERIOD_HIGHLIGHT_MIN_DELTA) {
            highlights.push({ side, key: row.key, label: row.label, from, to, delta: to - from });
          }
        });
      });
      highlights.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    }

    const recorded = (side) => groups.reduce((n, g) => n + g[side].goals, 0);
    return {
      groups,
      shown: extra.count ? groups : [first, second],
      comparable: first.count > 0 && second.count > 0,
      outsidePlay: occurrences.filter((o) => !inPlay.has(o.period)).length,
      goalsCheck: {
        own: { recorded: recorded('own'), score: match.score?.team || 0 },
        opp: { recorded: recorded('opp'), score: match.score?.opponent || 0 },
      },
      highlights: highlights.slice(0, 4),
    };
  },

  /** Notas em texto simples — servem o ecrã e o PDF, por isso sem símbolos fora do WinAnsi. */
  periodNotes(pc, match) {
    const notes = ['As partes não duram o mesmo (descontos): os números são totais, não médias por minuto.'];
    [['own', match.team], ['opp', match.opponent]].forEach(([side, name]) => {
      const g = pc.goalsCheck[side];
      if (g.recorded !== g.score) {
        notes.push(`${name}: os golos por parte contam-se pelos registos de golo (${g.recorded}), que não batem com o resultado (${g.score}).`);
      }
    });
    if (pc.outsidePlay) {
      const one = pc.outsidePlay === 1;
      notes.push(`${pc.outsidePlay} ${one ? 'registo feito' : 'registos feitos'} fora do tempo de jogo (ex.: intervalo) não ${one ? 'entra' : 'entram'} na comparação.`);
    }
    return notes;
  },

  renderPeriodComparisonHTML(match, occurrences) {
    const pc = this.periodComparison(match, occurrences);
    if (!pc.comparable) {
      return '<p class="muted">A comparação aparece quando houver registos das duas partes.</p>';
    }
    const cols = pc.shown;
    const first = pc.groups[0];
    const ownName = Utils.escapeHtml(match.team);
    const oppName = Utils.escapeHtml(match.opponent);
    const rows = this.PERIOD_ROWS.filter((r) => cols.some((g) => g.own[r.key] || (!r.ownOnly && g.opp[r.key])));

    // Seta neutra de propósito: mais perdas não é "subir" no bom sentido.
    const cell = (g, side, key) => {
      const v = g[side][key] || 0;
      let delta = '';
      if (g.key === '2T') {
        const d = v - (first[side][key] || 0);
        if (d) delta = `<span class="pc-delta">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`;
      }
      return `<td class="pc-val">${v}${delta}</td>`;
    };

    return `
      <div class="period-compare">
        ${pc.highlights.length ? `
          <ul class="pc-highlights">
            ${pc.highlights.map((h) => `<li><strong>${h.side === 'own' ? ownName : oppName}</strong> · ${h.label}: ${h.from} → ${h.to} na 2ª parte</li>`).join('')}
          </ul>` : `<p class="muted pat-intro">Sem diferenças de ${this.PERIOD_HIGHLIGHT_MIN_DELTA} ou mais entre as partes.</p>`}
        <div class="pc-wrap">
          <table class="pc-table">
            <thead>
              <tr><th></th><th colspan="${cols.length}" class="pc-team">${ownName}</th><th colspan="${cols.length}" class="pc-team">${oppName}</th></tr>
              <tr><th></th>${cols.map((g) => `<th>${g.label}</th>`).join('')}${cols.map((g) => `<th>${g.label}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td class="pc-label">${r.label}</td>
                  ${cols.map((g) => cell(g, 'own', r.key)).join('')}
                  ${r.ownOnly ? cols.map(() => '<td class="pc-val muted">—</td>').join('') : cols.map((g) => cell(g, 'opp', r.key)).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${this.periodNotes(pc, match).map((n) => `<p class="muted pat-note">${Utils.escapeHtml(n)}</p>`).join('')}
      </div>`;
  },

  // ---------- Padrões (leitura derivada — não pede nenhum registo novo) ----------
  //
  // Tudo o que está abaixo é calculado a partir de ocorrências que já existem.
  // Não há aqui nenhum dado novo a pedir ao analista: só se lê melhor o que ele
  // já registou. Se um número não puder ser sustentado pelos registos, não é
  // mostrado (devolve-se `total: 0`) — nunca se estima.

  /** Janelas de tempo (segundos) usadas para ligar acontecimentos em cadeia. */
  CHAIN_WINDOW: { transition: 30, costlyLoss: 20 },

  /** Mediana de uma lista JÁ ordenada; com um número par de valores é a média dos dois do meio. */
  _median(sorted) {
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  },

  /** Segundos entre duas ocorrências, usando o relógio de jogo (minuto+segundo). */
  _gapSeconds(a, b) {
    const secs = (o) => (o.minute || 0) * 60 + (o.second || 0);
    return secs(b) - secs(a);
  },

  /**
   * Eficácia de bolas paradas, usando as ligações que já gravamos no remate
   * (`meta.fromCornerId` / `meta.fromFoulId`). Um canto/livre só conta como
   * "com remate" se existir mesmo um remate ligado — não se infere pelo
   * resultado escrito no canto.
   *
   * CUIDADO COM O DENOMINADOR: um canto é sempre uma bola parada ofensiva, por
   * isso a eficácia sobre o total de cantos é justa. Um LIVRE não — a maioria
   * são recomeços a meio-campo onde rematar nunca foi opção, e metê-los no
   * denominador faria a eficácia parecer péssima sem razão. Por isso a eficácia
   * dos livres é calculada só sobre os que estavam em zona de remate (pela
   * localização já registada na falta) mais os que, de facto, deram remate —
   * se deu remate, era rematável, venha de onde vier. Os livres fora dessa zona
   * e os que não têm localização são contados à parte, nunca diluídos na conta.
   */
  setPieceChains(occurrences) {
    const shots = this.shotsList(occurrences);
    const linked = (key, id) => shots.filter((s) => s.meta && s.meta[key] === id);
    /** @param {(occ)=>boolean|null} inShootingZone - null = todas contam (cantos). */
    const build = (list, key, inShootingZone = null) => {
      const rows = list.map((o) => {
        const ss = linked(key, o.id);
        return { occ: o, shots: ss, goals: ss.filter((s) => s.meta?.result === 'goal').length };
      });
      // Base da eficácia: só as jogadas em que rematar era mesmo uma opção.
      const base = inShootingZone
        ? rows.filter((r) => inShootingZone(r.occ) || r.shots.length)
        : rows;
      const baseWithShot = base.filter((r) => r.shots.length).length;
      const baseSet = new Set(base);
      return {
        total: rows.length,
        withShot: rows.filter((r) => r.shots.length).length,
        goals: rows.reduce((n, r) => n + r.goals, 0),
        // `base*` = o subconjunto sobre o qual a % faz sentido.
        base: base.length,
        baseWithShot,
        baseGoals: base.reduce((n, r) => n + r.goals, 0),
        shotPct: base.length ? Math.round((baseWithShot / base.length) * 100) : 0,
        // Fora da zona = tem localização e não conta. Os sem localização ficam
        // só em `noLocation` — total = base + outOfZone + noLocation.
        //
        // Sem regra de zona (cantos), TODAS as jogadas entram na base: não há
        // exclusões, e portanto não há "sem localização". Antes contavam-se na
        // mesma os cantos sem coordenadas, e a identidade acima deixava de ser
        // verdade (um canto podia aparecer na base E em noLocation).
        outOfZone: rows.filter((r) => !baseSet.has(r) && r.occ.meta?.location?.y != null).length,
        noLocation: inShootingZone ? rows.filter((r) => r.occ.meta?.location?.y == null && !r.shots.length).length : 0,
        rows,
      };
    };
    // Zona de remate de um livre, do ponto de vista de quem o vai bater:
    // para nós é o terço ofensivo (y baixo); para o adversário, o nosso terço
    // defensivo (y alto) — é o mesmo sítio do campo visto do outro lado.
    const zoneFor = (side) => (o) => this.thirdOf(o.meta?.location?.y) === (side === 'own' ? 'att' : 'def');
    const corners = occurrences.filter((o) => o.source === 'canto');
    const fouls = this.foulsList(occurrences)
      .filter((o) => (o.meta?.consequences || []).includes('freeKick'));
    return {
      own: {
        corners: build(corners.filter((o) => o.team === 'own'), 'fromCornerId'),
        // Falta cometida PELO adversário -> o livre é nosso.
        freeKicks: build(fouls.filter((o) => o.team === 'opponent'), 'fromFoulId', zoneFor('own')),
      },
      opponent: {
        corners: build(corners.filter((o) => o.team === 'opponent'), 'fromCornerId'),
        freeKicks: build(fouls.filter((o) => o.team === 'own'), 'fromFoulId', zoneFor('opponent')),
      },
    };
  },

  /**
   * Velocidade de transição ofensiva: de cada recuperação nossa até ao primeiro
   * remate nosso dentro da janela. Só conta pares dentro do mesmo período —
   * um remate no 2T não pode "resultar" de uma recuperação do 1T.
   */
  transitionSpeed(occurrences) {
    const recs = this.transitionsList(occurrences)
      .filter((o) => o.source === 'recuperacao')
      .sort((a, b) => a.timestamp - b.timestamp);
    const shots = this.shotsList(occurrences).filter((s) => s.team === 'own');
    const win = this.CHAIN_WINDOW.transition;
    const pairs = [];
    recs.forEach((r) => {
      const hit = shots
        .filter((s) => s.period === r.period)
        .map((s) => ({ s, gap: this._gapSeconds(r, s) }))
        .filter((x) => x.gap >= 0 && x.gap <= win)
        .sort((a, b) => a.gap - b.gap)[0];
      if (hit) pairs.push({ rec: r, shot: hit.s, seconds: hit.gap, goal: hit.s.meta?.result === 'goal' });
    });
    const secs = pairs.map((p) => p.seconds).sort((a, b) => a - b);
    return {
      recoveries: recs.length,
      converted: pairs.length,
      pct: recs.length ? Math.round((pairs.length / recs.length) * 100) : 0,
      goals: pairs.filter((p) => p.goal).length,
      medianSeconds: this._median(secs),
      pairs,
    };
  },

  /**
   * Perdas que custaram caro: perda nossa seguida de golo sofrido dentro da
   * janela. Serve para isolar o erro que pesou no resultado, não para culpar —
   * por isso guarda-se também o jogador, só quando ele foi mesmo registado.
   */
  costlyLosses(occurrences, match) {
    const losses = this.transitionsList(occurrences).filter((o) => o.source === 'perda');
    const win = this.CHAIN_WINDOW.costlyLoss;
    // Golos sofridos: pelo placar (source 'golo', team 'opponent') ou por um
    // remate do adversário marcado como golo. São fluxos distintos (ver compute).
    const conceded = occurrences.filter((o) =>
      (o.source === 'golo' && o.team === 'opponent' && !o.meta?.ownGoal)
      || (o.source === 'remate' && o.team === 'opponent' && o.meta?.result === 'goal'));
    const out = [];
    losses.forEach((l) => {
      const g = conceded
        .filter((c) => c.period === l.period)
        .map((c) => ({ c, gap: this._gapSeconds(l, c) }))
        .filter((x) => x.gap >= 0 && x.gap <= win)
        .sort((a, b) => a.gap - b.gap)[0];
      if (g) out.push({ loss: l, goal: g.c, seconds: g.gap, playerId: l.meta?.ownPlayerId || null });
    });
    return { total: out.length, items: out };
  },

  /**
   * Onde cada jogador perde a bola. Só entram perdas com jogador identificado —
   * as anónimas ficam de fora em vez de serem atribuídas a alguém.
   */
  lossZonesByPlayer(occurrences) {
    const byPlayer = new Map();
    this.transitionsList(occurrences)
      .filter((o) => o.source === 'perda' && o.meta?.ownPlayerId)
      .forEach((o) => {
        const id = o.meta.ownPlayerId;
        if (!byPlayer.has(id)) byPlayer.set(id, { playerId: id, def: 0, mid: 0, att: 0, total: 0 });
        const row = byPlayer.get(id);
        const t = this.thirdOf(o.meta?.location?.y);
        if (t) row[t]++;
        row.total++;
      });
    return [...byPlayer.values()].sort((a, b) => b.total - a.total);
  },

  /**
   * Fecho do ciclo do scouting: o plano de observação guarda `scoutingRef` nos
   * eventos importados do dossiê do adversário, mas até aqui ninguém lia esse
   * campo. Isto responde à pergunta que fica no fim: "o que eu previ no
   * scouting chegou a acontecer?".
   *
   * Não julga o scouting — um item que não se viu tanto pode ser um erro de
   * análise como um problema que a equipa resolveu bem. Só separa o que foi
   * observado do que não foi.
   */
  scoutingCheck(match, occurrences) {
    const plan = (match.observationPlan || []).filter((e) => e && e.scoutingRef);
    if (!plan.length) return { total: 0, confirmed: [], unseen: [] };
    const counts = {};
    occurrences.forEach((o) => {
      if (o.planEventId) counts[o.planEventId] = (counts[o.planEventId] || 0) + 1;
    });
    const lists = window.SCOUTING_LISTS || [];
    const rows = plan.map((e) => ({
      event: e,
      count: counts[e.id] || 0,
      list: lists.find((l) => l.id === e.scoutingRef.list) || null,
    }));
    return {
      total: rows.length,
      confirmed: rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count),
      unseen: rows.filter((r) => r.count === 0),
    };
  },

  /**
   * O scouting a aprender com os jogos: para cada item do dossiê, em quantos
   * jogos terminados contra este adversário esteve no plano de observação e em
   * quantos chegou mesmo a acontecer. Calculado sempre a partir dos jogos — não
   * se grava no dossiê, para nunca ficar desatualizado nem duplicado.
   *
   * Só jogos terminados: um plano de um jogo por jogar diria "não se viu" sem
   * ter havido jogo. O mesmo item importado duas vezes no mesmo plano conta um
   * só jogo.
   *
   * @param {Array<{match, occurrences}>} entries — jogos contra a equipa
   * @returns {Map<string, {tracked: number, confirmed: number, occurrences: number, lastConfirmedDate: string|null}>}
   */
  scoutingTrackRecord(entries) {
    const out = new Map();
    entries.forEach(({ match, occurrences }) => {
      if (!match || match.status !== 'finished') return;
      const sc = this.scoutingCheck(match, occurrences || []);
      const perItem = new Map();
      [...sc.confirmed, ...sc.unseen].forEach((r) => {
        const id = r.event.scoutingRef && r.event.scoutingRef.itemId;
        if (id) perItem.set(id, (perItem.get(id) || 0) + r.count);
      });
      perItem.forEach((count, id) => {
        const rec = out.get(id) || { tracked: 0, confirmed: 0, occurrences: 0, lastConfirmedDate: null };
        rec.tracked++;
        if (count > 0) {
          rec.confirmed++;
          rec.occurrences += count;
          if (match.date && (!rec.lastConfirmedDate || match.date > rec.lastConfirmedDate)) rec.lastConfirmedDate = match.date;
        }
        out.set(id, rec);
      });
    });
    return out;
  },

  /**
   * Histórico direto contra um adversário, do NOSSO ponto de vista.
   *
   * O dossiê diz o que eles fazem; isto diz como correu quando os enfrentámos.
   * Serve o briefing: antes de jogar outra vez, ver o que aconteceu das últimas
   * vezes — resultado e quantas das previsões do scouting se confirmaram.
   *
   * @param {string} opponentTeamId
   * @param {Array<{match, occurrences}>} entries
   */
  headToHead(opponentTeamId, entries) {
    const rows = (entries || [])
      .filter((e) => e && e.match && e.match.status === 'finished')
      .map(({ match, occurrences }) => {
        // Podemos ter sido a equipa "own" ou a "opponent" no registo do jogo.
        const somosOwn = match.teams?.opponent?.teamId === opponentTeamId;
        const nossos = somosOwn ? (match.score?.team ?? 0) : (match.score?.opponent ?? 0);
        const deles = somosOwn ? (match.score?.opponent ?? 0) : (match.score?.team ?? 0);
        const sc = this.scoutingCheck(match, occurrences || []);
        return {
          matchId: match.id,
          date: match.date || '',
          competition: match.competition || '',
          ourGoals: nossos, theirGoals: deles,
          result: nossos > deles ? 'V' : (nossos === deles ? 'E' : 'D'),
          confirmed: sc.confirmed.length, tracked: sc.total,
        };
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const totals = rows.reduce((t, r) => {
      t.played++;
      if (r.result === 'V') t.wins++; else if (r.result === 'E') t.draws++; else t.losses++;
      t.goalsFor += r.ourGoals; t.goalsAgainst += r.theirGoals;
      return t;
    }, { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 });

    return { rows, totals };
  },

  /** Frase curta do histórico de um item ('' se nunca esteve num plano de jogo terminado). */
  trackRecordLabel(rec) {
    if (!rec || !rec.tracked) return '';
    const jogos = (n) => `${n} ${n === 1 ? 'jogo' : 'jogos'}`;
    // Neutro de propósito: não se ter visto tanto pode ser leitura errada como mérito da equipa.
    if (rec.confirmed) return `Confirmado em ${rec.confirmed} de ${jogos(rec.tracked)}`;
    return `Observado em ${jogos(rec.tracked)}, nunca confirmado`;
  },

  /** Bloco do fecho do ciclo do scouting (intervalo e pós-jogo). */
  renderScoutingCheckHTML(match, occurrences) {
    const sc = this.scoutingCheck(match, occurrences);
    if (!sc.total) {
      return `<p class="muted">Este plano não tem eventos importados do scouting. No construtor do plano, o botão “🎯 Importar do Scouting” traz os pontos fracos, ameaças e gatilhos do adversário — e depois aparece aqui se aconteceram.</p>`;
    }
    const row = (r) => `
      <div class="sck-row ${r.count ? 'is-seen' : 'is-unseen'}">
        <span class="sck-badge">${r.list ? r.list.icon : '🎯'}</span>
        <span class="sck-name">${Utils.escapeHtml(r.event.name)}</span>
        ${r.event.isFocus ? '<span class="sc-badge">⭐</span>' : ''}
        <strong class="sck-count">${r.count ? r.count + '×' : '—'}</strong>
      </div>`;
    return `
      <div class="scouting-check">
        <p class="muted pat-intro">${sc.confirmed.length} de ${sc.total} ${sc.total === 1 ? 'previsão' : 'previsões'} do scouting ${sc.confirmed.length === 1 ? 'confirmou-se' : 'confirmaram-se'} em campo.</p>
        ${sc.confirmed.length ? `<h4 class="sck-head">✅ Confirmado</h4>${sc.confirmed.map(row).join('')}` : ''}
        ${sc.unseen.length ? `<h4 class="sck-head">👁 Não se viu</h4>${sc.unseen.map(row).join('')}
          <p class="muted pat-note">Não ter acontecido pode significar que a leitura estava errada — ou que a equipa o anulou bem. O registo não distingue as duas coisas.</p>` : ''}
      </div>`;
  },

  /**
   * Bloco único de "padrões" — usado no LIVE (diálogo) e no pós-jogo. Recebe uma
   * função `nameOf(playerId)` para não depender de nenhum ecrã em concreto.
   */
  renderPatternsHTML(occurrences, match, nameOf = () => null) {
    const chains = this.setPieceChains(occurrences);
    const speed = this.transitionSpeed(occurrences);
    const costly = this.costlyLosses(occurrences, match);
    const zones = this.lossZonesByPlayer(occurrences);
    const ownName = Utils.escapeHtml(match.team);
    const oppName = Utils.escapeHtml(match.opponent);

    // Cantos: a % é sobre o total (todo o canto é uma bola parada ofensiva).
    const cornerRow = (c) => `
      <div class="pat-row">
        <span class="pat-row-label">⛳ Cantos</span>
        <span class="pat-row-val">${c.total}</span>
        <span class="pat-row-val">${c.withShot}</span>
        <span class="pat-row-val">${c.goals}</span>
        <span class="pat-row-pct">${c.total ? c.shotPct + '%' : '—'}</span>
      </div>`;

    // Livres: a % é só sobre os que estavam em zona de remate — os recomeços
    // a meio-campo aparecem à parte, para não fingirem ser oportunidades falhadas.
    const fkRow = (c) => `
      <div class="pat-row">
        <span class="pat-row-label" title="Livres em zona de remate (ou que deram remate)">🎯 Livres <span class="pat-row-sub">zona rem.</span></span>
        <span class="pat-row-val">${c.base}</span>
        <span class="pat-row-val">${c.baseWithShot}</span>
        <span class="pat-row-val">${c.baseGoals}</span>
        <span class="pat-row-pct">${c.base ? c.shotPct + '%' : '—'}</span>
      </div>
      ${c.total ? `<p class="pat-block-note">${c.total} ${c.total === 1 ? 'livre' : 'livres'} no total${c.outOfZone ? ` · ${c.outOfZone} fora da zona de remate` : ''}${c.noLocation ? ` · ${c.noLocation} sem localização` : ''}</p>` : ''}`;

    const chainBlock = (title, side) => `
      <div class="pat-block">
        <h4>${title}</h4>
        <div class="pat-row pat-row-head">
          <span class="pat-row-label"></span>
          <span class="pat-row-val" title="Jogadas contadas na eficácia">Tot.</span>
          <span class="pat-row-val" title="Com remate ligado">Rem.</span>
          <span class="pat-row-val" title="Golos">Gol.</span>
          <span class="pat-row-pct" title="% que resultou em remate">Efic.</span>
        </div>
        ${cornerRow(side.corners)}
        ${fkRow(side.freeKicks)}
      </div>`;

    const hasChains = chains.own.corners.total || chains.own.freeKicks.total
      || chains.opponent.corners.total || chains.opponent.freeKicks.total;

    return `
      <div class="patterns">
        <p class="muted pat-intro">Tudo aqui é lido dos registos que já fizeste — não há nada de novo a registar.</p>

        ${hasChains ? `
        <h3 class="section-title">🔗 Bolas paradas</h3>
        <div class="pat-grid">
          ${chainBlock(ownName, chains.own)}
          ${chainBlock(oppName, chains.opponent)}
        </div>
        <p class="muted pat-note">Um canto/livre só conta como “com remate” se tiver mesmo um remate ligado (o botão 🎯 no detalhe). Nos livres, a eficácia é só sobre os que estavam em zona de remate — um recomeço a meio-campo não é uma oportunidade falhada.</p>
        ` : `<p class="muted">Sem cantos ou livres ligados a remates ainda. Usa o botão 🎯 no detalhe do canto/falta para os ligares.</p>`}

        <h3 class="section-title">⚡ Transição ofensiva</h3>
        ${speed.recoveries ? `
          <div class="pat-cards">
            <div class="pat-card"><strong>${speed.converted}/${speed.recoveries}</strong><span>recuperações com remate em ${this.CHAIN_WINDOW.transition}s</span></div>
            <div class="pat-card"><strong>${speed.pct}%</strong><span>taxa de conversão</span></div>
            <div class="pat-card"><strong>${speed.medianSeconds != null ? speed.medianSeconds + 's' : '—'}</strong><span>tempo mediano até rematar</span></div>
            <div class="pat-card ${speed.goals ? 'is-good' : ''}"><strong>${speed.goals}</strong><span>golos nascidos de recuperação</span></div>
          </div>
        ` : '<p class="muted">Ainda não há recuperações registadas.</p>'}

        <h3 class="section-title">🩸 Perdas que custaram caro</h3>
        ${costly.total ? `
          <div class="pat-list">
            ${costly.items.map((it) => {
              const who = it.playerId ? nameOf(it.playerId) : null;
              return `<div class="pat-list-row">
                <span class="history-time">${String(it.loss.minute).padStart(2, '0')}'</span>
                <span>Perda${who ? ` de <strong>${Utils.escapeHtml(who)}</strong>` : ''} → golo sofrido <strong>${it.seconds}s</strong> depois</span>
              </div>`;
            }).join('')}
          </div>
        ` : `<p class="muted">Nenhuma perda seguida de golo sofrido em ${this.CHAIN_WINDOW.costlyLoss}s. Boa notícia.</p>`}

        <h3 class="section-title">📍 Onde se perde a bola</h3>
        ${zones.length ? `
          <div class="pat-row pat-row-head">
            <span class="pat-row-label">Jogador</span>
            <span class="pat-row-val" title="Terço defensivo">Def</span>
            <span class="pat-row-val" title="Meio-campo">Meio</span>
            <span class="pat-row-val" title="Terço ofensivo">Of.</span>
            <span class="pat-row-pct">Total</span>
          </div>
          ${zones.map((z) => `
            <div class="pat-row">
              <span class="pat-row-label">${Utils.escapeHtml(nameOf(z.playerId) || '—')}</span>
              <span class="pat-row-val">${z.def}</span>
              <span class="pat-row-val">${z.mid}</span>
              <span class="pat-row-val">${z.att}</span>
              <span class="pat-row-pct">${z.total}</span>
            </div>`).join('')}
          <p class="muted pat-note">Só entram perdas com jogador identificado.</p>
        ` : '<p class="muted">Ainda não há perdas com jogador identificado.</p>'}
      </div>`;
  },

  /**
   * Padrões em versão curta — linhas de uma linha, legíveis de pé em 2-3
   * segundos. Mesmos números do bloco completo (`renderPatternsHTML`), sem
   * tabelas: na coluna do banco não há largura para uma grelha.
   *
   * Só devolve linhas que têm dados — nada de "0 de 0" a ocupar espaço.
   * @returns {Array<{icon,label,value,detail,tone}>}
   */
  patternHighlights(occurrences, match, nameOf = () => null) {
    const chains = this.setPieceChains(occurrences);
    const speed = this.transitionSpeed(occurrences);
    const costly = this.costlyLosses(occurrences, match);
    const thirds = this.transitionsByThird(occurrences, 'perda');
    const rows = [];

    const setPiece = (side, sideLabel) => {
      const c = chains[side];
      if (c.corners.total) {
        rows.push({
          icon: '⛳', label: `Cantos ${sideLabel}`,
          value: `${c.corners.withShot}/${c.corners.total}`,
          detail: c.corners.goals ? `${c.corners.shotPct}% com remate · ${c.corners.goals} golo${c.corners.goals === 1 ? '' : 's'}` : `${c.corners.shotPct}% com remate`,
          tone: side === 'own' ? (c.corners.shotPct >= 40 ? 'good' : null) : (c.corners.shotPct >= 40 ? 'bad' : null),
        });
      }
      if (c.freeKicks.base) {
        rows.push({
          icon: '🎯', label: `Livres ${sideLabel}`,
          value: `${c.freeKicks.baseWithShot}/${c.freeKicks.base}`,
          detail: `em zona de remate · ${c.freeKicks.shotPct}% com remate`,
          tone: null,
        });
      }
    };
    setPiece('own', 'a favor');
    setPiece('opponent', 'contra');

    if (speed.recoveries) {
      rows.push({
        icon: '⚡', label: 'Recuperações com remate',
        value: `${speed.converted}/${speed.recoveries}`,
        detail: speed.medianSeconds != null
          ? `${speed.pct}% · ${speed.medianSeconds}s até rematar`
          : `${speed.pct}%`,
        tone: speed.pct >= 25 ? 'good' : null,
      });
    }
    if (costly.total) {
      const who = costly.items.map((it) => it.playerId && nameOf(it.playerId)).filter(Boolean);
      rows.push({
        icon: '🩸', label: 'Perdas que deram golo',
        value: String(costly.total),
        detail: who.length ? who.slice(0, 3).join(', ') : `em ${this.CHAIN_WINDOW.costlyLoss}s`,
        tone: 'bad',
      });
    }
    if (thirds.total) {
      const worst = [['def', 'terço defensivo'], ['mid', 'meio-campo'], ['att', 'terço ofensivo']]
        .sort((a, b) => thirds[b[0]] - thirds[a[0]])[0];
      rows.push({
        icon: '📍', label: 'Onde se perde mais',
        value: `${thirds[worst[0]]}/${thirds.total}`,
        detail: `${worst[1]} · ${thirds[worst[0] + 'Pct']}% das perdas`,
        tone: worst[0] === 'def' ? 'bad' : null,
      });
    }
    return rows;
  },

  /** Bloco curto dos padrões (ecrã do banco). Vazio -> diz o que falta registar. */
  renderPatternDigestHTML(occurrences, match, nameOf = () => null) {
    const rows = this.patternHighlights(occurrences, match, nameOf);
    if (!rows.length) {
      return '<p class="muted pat-digest-empty">Os padrões aparecem aqui à medida que o analista registar cantos, livres, perdas e recuperações.</p>';
    }
    return `<div class="pat-digest">${rows.map((r) => `
      <div class="pat-digest-row ${r.tone ? 'is-' + r.tone : ''}">
        <span class="pat-digest-icon">${r.icon}</span>
        <span class="pat-digest-label">${Utils.escapeHtml(r.label)}<small>${Utils.escapeHtml(r.detail || '')}</small></span>
        <strong class="pat-digest-val">${Utils.escapeHtml(r.value)}</strong>
      </div>`).join('')}</div>`;
  },

  /**
   * Gera o HTML do mapa de remates ou faltas (reutilizado no LIVE e no pós-jogo,
   * para não duplicar a mesma lógica de desenho em dois sítios).
   */
  renderMapHTML(mode, occurrences, ownName, oppName, filter = 'all') {
    const list = (mode === 'shots' ? this.shotsList(occurrences) : this.foulsList(occurrences))
      .filter((o) => filter === 'all' || o.team === filter);
    const withCoords = list.filter((o) => (mode === 'shots' ? o.meta?.origin : o.meta?.location));

    const markers = withCoords.map((o) => {
      const xy = mode === 'shots' ? o.meta.origin : o.meta.location;
      const cls = o.team === 'own' ? 'map-marker-own' : 'map-marker-opp';
      let symbol = '●';
      let extra = '';
      if (mode === 'shots') {
        const r = o.meta.result;
        if (r === 'goal') { symbol = '★'; extra = 'is-goal'; }
        else if (r === 'save') { symbol = '◆'; }
        else if (r === 'wide' || r === 'post') { symbol = '✕'; }
        else if (r === 'blocked') { symbol = '■'; }
      }
      return `<span class="map-marker ${cls} ${extra}" style="left:${xy.x * 100}%; top:${xy.y * 100}%" title="${o.minute}'">${symbol}</span>`;
    }).join('');

    return `
      <div class="stats-map-wrap">
        <h4>${mode === 'shots' ? 'Mapa de Remates' : 'Mapa de Faltas'} <span class="muted">(${withCoords.length}/${list.length} com localização)</span></h4>
        ${Pitch.mapHTML(markers)}
        <div class="map-legend">
          <span><span class="map-marker map-marker-own">●</span> ${Utils.escapeHtml(ownName)} <span class="muted">(ataca ↑)</span></span>
          <span><span class="map-marker map-marker-opp">●</span> ${Utils.escapeHtml(oppName)} <span class="muted">(ataca ↓)</span></span>
          ${mode === 'shots' ? '<span>★ Golo · ◆ Defendido · ✕ Fora/Poste · ■ Bloqueado</span>' : ''}
        </div>
      </div>
    `;
  },
};

window.MatchStats = MatchStats;
