/**
 * standings.js — A classificação, calculada. Nunca guardada.
 *
 * O mesmo princípio de toda a app: escrevem-se os RESULTADOS, e tudo o resto é
 * consequência. Não há um número na tabela que alguém tenha de manter à mão,
 * logo não há tabela que possa ficar errada.
 *
 * DESEMPATES — é aqui que uma classificação se estraga em silêncio. A ordem é
 * configurável por prova porque varia entre associações. O `headToHead` é o
 * confronto direto no sentido regulamentar: quando há um grupo de equipas
 * empatadas, constrói-se uma mini-classificação só com os jogos ENTRE ELAS e
 * compara-se aí. Comparar duas a duas dentro de um empate a três daria
 * resultados incoerentes (A>B, B>C, C>A).
 */

const Standings = {
  DEFAULT_TIEBREAKERS: ['points', 'headToHead', 'goalDiff', 'goalsFor'],

  TIEBREAKER_LABELS: {
    points: 'Pontos',
    headToHead: 'Confronto direto',
    goalDiff: 'Diferença de golos',
    goalsFor: 'Golos marcados',
    goalsAgainst: 'Golos sofridos (menos)',
    wins: 'Vitórias',
  },

  /** Um jogo só conta quando tem os dois resultados preenchidos. */
  isPlayed(f) {
    return f && Number.isFinite(f.homeGoals) && Number.isFinite(f.awayGoals);
  },

  emptyRow(team) {
    return {
      team, played: 0, wins: 0, draws: 0, losses: 0,
      goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0,
      home: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 },
      away: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 },
      form: [],       // 'V' | 'E' | 'D', do mais antigo para o mais recente
      streak: null,   // {type:'V'|'E'|'D', n}
    };
  },

  /**
   * @param {object} comp - { teams, fixtures, pointsPerWin, pointsPerDraw, tiebreakers }
   * @param {object} [opts] - { upToRound } para ver a tabela como estava numa jornada
   * @returns {Array} linhas ordenadas, já com `position`
   */
  compute(comp, { upToRound = null } = {}) {
    const win = comp?.pointsPerWin ?? 3;
    const drawPts = comp?.pointsPerDraw ?? 1;
    const rows = new Map();
    (comp?.teams || []).forEach((t) => rows.set(t, this.emptyRow(t)));

    const jogos = (comp?.fixtures || [])
      .filter((f) => this.isPlayed(f))
      .filter((f) => upToRound == null || (f.round || 0) <= upToRound)
      // A forma tem de seguir a ordem real dos jogos, não a ordem do array.
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.round || 0) - (b.round || 0));

    jogos.forEach((f) => {
      const casa = rows.get(f.home) || this.emptyRow(f.home);
      const fora = rows.get(f.away) || this.emptyRow(f.away);
      rows.set(f.home, casa); rows.set(f.away, fora);

      const gc = f.homeGoals, gf = f.awayGoals;
      const aplicar = (r, marcados, sofridos, onde) => {
        const res = marcados > sofridos ? 'V' : (marcados === sofridos ? 'E' : 'D');
        const pts = res === 'V' ? win : (res === 'E' ? drawPts : 0);
        r.played++; r.goalsFor += marcados; r.goalsAgainst += sofridos; r.points += pts;
        if (res === 'V') r.wins++; else if (res === 'E') r.draws++; else r.losses++;
        const lado = r[onde];
        lado.played++; lado.goalsFor += marcados; lado.goalsAgainst += sofridos; lado.points += pts;
        if (res === 'V') lado.wins++; else if (res === 'E') lado.draws++; else lado.losses++;
        r.form.push(res);
      };
      aplicar(casa, gc, gf, 'home');
      aplicar(fora, gf, gc, 'away');
    });

    const lista = [...rows.values()];
    lista.forEach((r) => {
      r.goalDiff = r.goalsFor - r.goalsAgainst;
      r.streak = this.streakOf(r.form);
      r.ppg = r.played ? Number((r.points / r.played).toFixed(2)) : 0;
    });

    const ordem = comp?.tiebreakers || this.DEFAULT_TIEBREAKERS;
    lista.sort((a, b) => this.compare(a, b, ordem, jogos));
    lista.forEach((r, i) => { r.position = i + 1; });
    return lista;
  },

  /** Sequência atual (do fim da forma para trás). */
  streakOf(form) {
    if (!form.length) return null;
    const tipo = form[form.length - 1];
    let n = 0;
    for (let i = form.length - 1; i >= 0 && form[i] === tipo; i--) n++;
    return { type: tipo, n };
  },

  compare(a, b, ordem, jogos) {
    for (const criterio of ordem) {
      const d = this.criterion(criterio, a, b, jogos);
      if (d !== 0) return d;
    }
    // Sem mais critérios: ordem alfabética, para a tabela não saltitar entre
    // repintagens (uma ordenação instável parece um erro aos olhos de quem lê).
    return String(a.team).localeCompare(String(b.team), 'pt');
  },

  criterion(nome, a, b, jogos) {
    if (nome === 'points') return b.points - a.points;
    if (nome === 'goalDiff') return b.goalDiff - a.goalDiff;
    if (nome === 'goalsFor') return b.goalsFor - a.goalsFor;
    if (nome === 'goalsAgainst') return a.goalsAgainst - b.goalsAgainst;
    if (nome === 'wins') return b.wins - a.wins;
    if (nome === 'headToHead') return this.headToHeadCompare(a.team, b.team, jogos);
    return 0;
  },

  /**
   * Confronto direto entre duas equipas: pontos nos jogos entre ambas e, se
   * persistir, diferença de golos nesses jogos. Se ainda não se defrontaram,
   * devolve 0 e o critério seguinte decide.
   */
  headToHeadCompare(x, y, jogos) {
    const entre = (jogos || []).filter((f) =>
      (f.home === x && f.away === y) || (f.home === y && f.away === x));
    if (!entre.length) return 0;
    let ptsX = 0, ptsY = 0, gX = 0, gY = 0;
    entre.forEach((f) => {
      const [dono, visita] = [f.home, f.away];
      const [gd, gv] = [f.homeGoals, f.awayGoals];
      const marcou = (eq) => (eq === dono ? gd : gv);
      gX += marcou(x); gY += marcou(y);
      if (gd === gv) { ptsX += 1; ptsY += 1; }
      else if ((gd > gv ? dono : visita) === x) ptsX += 3; else ptsY += 3;
    });
    if (ptsX !== ptsY) return ptsY - ptsX;
    // Empate em pontos no confronto direto: decide quem marcou mais nesses jogos.
    return gY - gX;
  },

  /**
   * Duas designações são a mesma equipa? Compara só letras e dígitos, sem
   * acentos: "Desp. S. Cosme", "Desp S Cosme" e "desp.s.cosme" são a mesma.
   *
   * Vive aqui, e não em cada ecrã, porque é usada em três sítios (ligar equipas
   * da prova às da app, ligar o nosso jogo ao calendário, e não duplicar a
   * nossa equipa). Três cópias desta regra seriam três maneiras de divergir.
   */
  sameTeam(a, b) {
    const n = (s) => String(s || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const x = n(a), y = n(b);
    return !!x && !!y && x === y;
  },

  // ---------- Leituras ----------

  /** Jornadas existentes, por ordem. */
  rounds(comp) {
    return [...new Set((comp?.fixtures || []).map((f) => f.round))].sort((a, b) => a - b);
  },

  fixturesOf(comp, round) {
    return (comp?.fixtures || [])
      .filter((f) => f.round === round)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.home).localeCompare(String(b.home), 'pt'));
  },

  /** Jornada a apresentar por omissão: a primeira com jogos por preencher. */
  currentRound(comp) {
    const rondas = this.rounds(comp);
    const porJogar = rondas.find((r) => this.fixturesOf(comp, r).some((f) => !this.isPlayed(f)));
    return porJogar ?? (rondas[rondas.length - 1] ?? 1);
  },

  /** Próximos jogos de uma equipa (por jogar), do mais próximo para a frente. */
  nextFixtures(comp, team, n = 5) {
    return (comp?.fixtures || [])
      .filter((f) => (f.home === team || f.away === team) && !this.isPlayed(f))
      .sort((a, b) => (a.round || 0) - (b.round || 0))
      .slice(0, n);
  },

  /** Quantos jogos já têm resultado, para mostrar o progresso da época. */
  progress(comp) {
    const total = (comp?.fixtures || []).length;
    const feitos = (comp?.fixtures || []).filter((f) => this.isPlayed(f)).length;
    return { total, played: feitos, pct: total ? Math.round((feitos / total) * 100) : 0 };
  },

  /**
   * Converte uma prova do ficheiro de sementes num registo gravável.
   * As datas de marcador (ano seguinte ao fim da época) ficam sinalizadas como
   * "por agendar" em vez de irem parar ao fim do calendário.
   */
  fromSeed(seed, { id = null } = {}) {
    const fixtures = (seed.fixtures || []).map((f, i) => {
      const [round, date, time, home, away] = f;
      return {
        id: `f${i + 1}`, round, date, time, home, away,
        homeGoals: null, awayGoals: null, matchId: null,
        tbd: this.looksUnscheduled(date, seed),
      };
    });
    return {
      id: id || seed.id,
      name: seed.name, shortName: seed.shortName || seed.name, season: seed.season,
      type: seed.type || 'league', ourTeamName: seed.ourTeamName || null,
      source: seed.source || null, capturedAt: seed.capturedAt || null,
      teams: [...(seed.teams || [])],
      tiebreakers: [...this.DEFAULT_TIEBREAKERS],
      pointsPerWin: 3, pointsPerDraw: 1,
      fixtures,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
  },

  /**
   * Um jogo cuja data é POSTERIOR ao fim da época está, na prática, por
   * agendar — é o marcador que as associações usam quando ainda não há data.
   * (Caso real: Bairro FC–Cabeceirense da 1ª jornada, datado de 30/06/2027,
   * quando a última jornada é a 23/05/2027.) Regra explicável, em vez de um
   * palpite estatístico.
   */
  looksUnscheduled(date, seed) {
    const jogos = seed.fixtures || [];
    if (!date || jogos.length < 2) return false;
    const ultimaJornada = Math.max(...jogos.map((f) => f[0] || 0));
    const fimDaEpoca = jogos.filter((f) => f[0] === ultimaJornada)
      .map((f) => f[1]).filter(Boolean).sort().pop();
    return !!fimDaEpoca && String(date) > fimDaEpoca;
  },
};

window.Standings = Standings;
