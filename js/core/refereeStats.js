/**
 * refereeStats.js — A ficha do árbitro, calculada a partir dos jogos.
 *
 * Não se escreve um número: as faltas, os cartões e os penáltis já são
 * registados jogo a jogo com equipa e minuto. Basta o jogo saber quem apitou.
 *
 * DUAS HONESTIDADES QUE VÃO NOS DADOS, não só no texto do ecrã:
 *
 *  1. `confidence` diz quando não há amostra para conclusão nenhuma. Com dois
 *     jogos, uma média é um acidente — e mostrada com cara de verdade é pior do
 *     que não mostrar nada.
 *  2. `bias: 'so-os-nossos-jogos'` fica sempre no resultado. Isto descreve como
 *     ele NOS apitou, não como ele arbitra: só vemos os jogos em que estivemos,
 *     e é uma amostra enviesada por natureza.
 *
 * A leitura que dá sentido aos números é a comparação com os OUTROS árbitros que
 * já nos apitaram (`compare`): "5 amarelos" não diz nada; "45% mais cartões do
 * que a média dos que já nos apitaram" diz.
 */

const RefereeStats = {
  /** Abaixo de 3 jogos não se conclui nada; a partir de 6 já se arrisca uma leitura. */
  MIN_GAMES: 3,
  GOOD_GAMES: 6,

  TRAITS: [
    { key: 'whistle', label: 'Apito', options: [['muito', 'Apita muito'], ['deixa', 'Deixa jogar']] },
    { key: 'card', label: 'Cartão', options: [['cedo', 'Cartão à primeira'], ['avisa', 'Avisa primeiro']] },
    { key: 'protest', label: 'Reclamação', options: [['tolera', 'Tolera reclamação'], ['nao', 'Não tolera']] },
    { key: 'stoppage', label: 'Desconto', options: [['curto', 'Desconto curto'], ['generoso', 'Desconto generoso']] },
  ],

  /** Jogos terminados que este árbitro apitou. */
  gamesOf(refereeId, entries) {
    return (entries || []).filter((e) => e && e.match
      && e.match.status === 'finished'
      && e.match.referee && e.match.referee.refereeId === refereeId);
  },

  confidence(games) {
    if (games < this.MIN_GAMES) return { level: 'insuficiente', text: `${games} ${games === 1 ? 'jogo' : 'jogos'} - é cedo para conclusões.` };
    if (games < this.GOOD_GAMES) return { level: 'indicativo', text: `${games} jogos - dá uma indicação, não uma certeza.` };
    return { level: 'razoavel', text: `${games} jogos - já se pode ler com alguma confiança.` };
  },

  /**
   * @param {string} refereeId
   * @param {Array<{match, occurrences}>} entries - jogos da NOSSA equipa
   * @param {string} ownTeamId
   */
  compute(refereeId, entries, ownTeamId) {
    const jogos = this.gamesOf(refereeId, entries);
    const out = {
      games: jogos.length, wins: 0, draws: 0, losses: 0,
      foulsUs: 0, foulsThem: 0, yellowsUs: 0, yellowsThem: 0, redsUs: 0, redsThem: 0,
      pensUs: 0, pensThem: 0, firstCardMinutes: [], stoppage: [],
      matches: [], bias: 'so-os-nossos-jogos',
    };

    jogos.forEach(({ match, occurrences }) => {
      const lado = SeasonTrends.sideOf(match, ownTeamId) || 'own';
      const nos = lado === 'own' ? 'own' : 'opp';
      const eles = nos === 'own' ? 'opp' : 'own';
      const st = MatchStats.compute(match, occurrences || []);

      out.foulsUs += st[nos].foulsCommitted;
      out.foulsThem += st[eles].foulsCommitted;
      out.yellowsUs += st[nos].yellowCards;
      out.yellowsThem += st[eles].yellowCards;
      out.redsUs += st[nos].redCards;
      out.redsThem += st[eles].redCards;
      // Penáltis: a favor de quem os vai bater.
      out.pensUs += st[nos].penalties;
      out.pensThem += st[eles].penalties;

      const nossos = lado === 'own' ? (match.score?.team ?? 0) : (match.score?.opponent ?? 0);
      const deles = lado === 'own' ? (match.score?.opponent ?? 0) : (match.score?.team ?? 0);
      if (nossos > deles) out.wins++; else if (nossos === deles) out.draws++; else out.losses++;

      // Minuto do primeiro cartão do jogo, seja de quem for.
      const minutos = (match.cards || []).map((c) => c.minute).filter((m) => Number.isFinite(m));
      const porFalta = (occurrences || [])
        .filter((o) => o.source === 'falta' && (o.meta?.consequences || []).some((c) => c === 'yellow' || c === 'red'))
        .map((o) => o.minute).filter((m) => Number.isFinite(m));
      const primeiro = [...minutos, ...porFalta].sort((a, b) => a - b)[0];
      if (Number.isFinite(primeiro)) out.firstCardMinutes.push(primeiro);

      const desconto = match.stoppage || null;
      if (desconto) {
        const soma = (Number(desconto['1T']) || 0) + (Number(desconto['2T']) || 0);
        if (soma > 0) out.stoppage.push(soma);
      }

      out.matches.push({
        matchId: match.id, date: match.date || '', opponent: lado === 'own' ? match.opponent : match.team,
        score: `${nossos}-${deles}`, yellowsUs: st[nos].yellowCards, yellowsThem: st[eles].yellowCards,
        foulsUs: st[nos].foulsCommitted, foulsThem: st[eles].foulsCommitted,
      });
    });

    out.matches.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return this._derive(out);
  },

  _derive(o) {
    const div = (a, b) => (b ? Number((a / b).toFixed(2)) : null);
    o.cardsUs = o.yellowsUs + o.redsUs;
    o.cardsThem = o.yellowsThem + o.redsThem;
    o.cards = o.cardsUs + o.cardsThem;
    o.fouls = o.foulsUs + o.foulsThem;
    o.cardsPerGame = div(o.cards, o.games);
    o.foulsPerGame = div(o.fouls, o.games);
    // O gatilho do cartão: quantas faltas por cada cartão. Muitas faltas e
    // poucos cartões = deixa jogar; o contrário = gatilho fácil.
    o.foulsPerCard = o.cards ? div(o.fouls, o.cards) : null;
    // Equilíbrio: a percentagem das faltas que foi assinalada contra nós.
    o.foulShareUs = o.fouls ? Math.round((o.foulsUs / o.fouls) * 100) : null;
    o.cardShareUs = o.cards ? Math.round((o.cardsUs / o.cards) * 100) : null;
    o.firstCardAvg = o.firstCardMinutes.length
      ? Math.round(o.firstCardMinutes.reduce((a, b) => a + b, 0) / o.firstCardMinutes.length) : null;
    o.stoppageAvg = o.stoppage.length
      ? Number((o.stoppage.reduce((a, b) => a + b, 0) / o.stoppage.length).toFixed(1)) : null;
    o.confidence = this.confidence(o.games);
    return o;
  },

  /** A média de TODOS os árbitros que já nos apitaram — a régua da comparação. */
  average(entries, ownTeamId) {
    const ids = [...new Set((entries || [])
      .filter((e) => e.match && e.match.status === 'finished' && e.match.referee?.refereeId)
      .map((e) => e.match.referee.refereeId))];
    const fichas = ids.map((id) => this.compute(id, entries, ownTeamId));
    const total = fichas.reduce((t, f) => {
      t.games += f.games; t.cards += f.cards; t.fouls += f.fouls;
      return t;
    }, { games: 0, cards: 0, fouls: 0 });
    return {
      referees: ids.length,
      games: total.games,
      cardsPerGame: total.games ? Number((total.cards / total.games).toFixed(2)) : null,
      foulsPerGame: total.games ? Number((total.fouls / total.games).toFixed(2)) : null,
    };
  },

  /**
   * Comparação com a régua. Devolve null quando não há régua que sirva — com um
   * árbitro só, comparar com "a média" é comparar com ele próprio.
   */
  compare(ficha, media) {
    if (!ficha || !media || media.referees < 2 || !media.cardsPerGame || !ficha.cardsPerGame) return null;
    const pct = Math.round(((ficha.cardsPerGame - media.cardsPerGame) / media.cardsPerGame) * 100);
    return {
      cardsPct: pct,
      text: pct === 0 ? 'mostra tantos cartões como a média dos que já nos apitaram'
        : `mostra ${Math.abs(pct)}% ${pct > 0 ? 'mais' : 'menos'} cartões do que a média dos que já nos apitaram`,
      basis: `${media.referees} árbitros · ${media.games} jogos`,
    };
  },

  /** Frases curtas para o briefing. Só o que os dados aguentam. */
  briefingLines(ficha, media) {
    const linhas = [];
    if (!ficha || !ficha.games) return ['Primeiro jogo com este árbitro - não há histórico.'];
    linhas.push(ficha.confidence.text);
    if (ficha.foulShareUs != null && ficha.games >= this.MIN_GAMES && (ficha.foulShareUs >= 60 || ficha.foulShareUs <= 40)) {
      linhas.push(`Assinalou ${ficha.foulShareUs}% das faltas contra nós (${ficha.foulsUs} de ${ficha.fouls}).`);
    }
    if (ficha.firstCardAvg != null) linhas.push(`Primeiro cartão do jogo, em média, ao minuto ${ficha.firstCardAvg}.`);
    if (ficha.foulsPerCard != null) linhas.push(`Mostra cartão a cada ${ficha.foulsPerCard} faltas assinaladas.`);
    const c = this.compare(ficha, media);
    if (c) linhas.push(`Comparado com os outros, ${c.text} (${c.basis}).`);
    if (ficha.stoppageAvg != null) linhas.push(`Desconto médio registado: ${ficha.stoppageAvg} min por jogo.`);
    linhas.push('Atenção: isto é como ele nos apitou, não como ele arbitra em geral: só entram os nossos jogos.');
    return linhas;
  },
};

window.RefereeStats = RefereeStats;
