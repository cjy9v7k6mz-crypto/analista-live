/**
 * seasonTrends.js — Evolução ao longo da época (equipa e jogador), jogo a jogo.
 *
 * Puro: recebe as entradas [{match, occurrences}] já ordenadas do jogo mais
 * antigo para o mais recente e devolve séries prontas a desenhar. Não guarda
 * nada — tal como o resto das estatísticas, é sempre calculado.
 *
 * Regra de honestidade: num jogo em que o jogador não jogou, o valor é `null`
 * (a linha fica interrompida), nunca 0 — zero diria "jogou e não fez nada".
 */

const SeasonTrends = {
  /** Métricas de jogador que fazem sentido jogo a jogo. */
  PLAYER_KEYS: [
    { key: 'minutes', label: 'Minutos', unit: "'" },
    { key: 'goals', label: 'Golos' },
    { key: 'assists', label: 'Assistências' },
    { key: 'chancesCreated', label: 'Grandes oport. criadas' },
    { key: 'shots', label: 'Remates' },
    { key: 'recuperacoes', label: 'Recuperações' },
    { key: 'perdas', label: 'Perdas de bola' },
    { key: 'foulsCommitted', label: 'Faltas cometidas' },
  ],

  /** Métricas de equipa (uma por gráfico — nunca duas escalas no mesmo). */
  TEAM_KEYS: [
    { key: 'goalsFor', label: 'Golos marcados' },
    { key: 'goalsAgainst', label: 'Golos sofridos' },
    { key: 'shots', label: 'Remates' },
    { key: 'recuperacoes', label: 'Recuperações' },
    { key: 'perdas', label: 'Perdas de bola' },
  ],

  /** "Últimos N jogos vs anteriores" só aparece com amostra mínima. */
  RECENT_N: 3,
  MIN_PLAYED_FOR_TREND: 5,

  sideOf(match, teamId) {
    if (match?.teams?.own?.teamId === teamId) return 'own';
    if (match?.teams?.opponent?.teamId === teamId) return 'opponent';
    return null;
  },

  /** Uma linha por jogo da equipa, do ponto de vista dessa equipa. */
  teamSeries(teamId, entries) {
    return entries.map(({ match, occurrences }) => {
      const side = this.sideOf(match, teamId);
      if (!side) return null;
      const occ = occurrences || [];
      const st = MatchStats.compute(match, occ);
      const mine = side === 'own' ? st.own : st.opp;
      const nPerda = occ.filter((o) => o.source === 'perda').length;
      const nRec = occ.filter((o) => o.source === 'recuperacao').length;
      return {
        matchId: match.id,
        date: match.date,
        opponentName: side === 'own' ? match.opponent : match.team,
        side,
        goalsFor: side === 'own' ? (match.score?.team || 0) : (match.score?.opponent || 0),
        goalsAgainst: side === 'own' ? (match.score?.opponent || 0) : (match.score?.team || 0),
        shots: mine.shots,
        // As perdas/recuperações registam-se do ponto de vista da nossa equipa;
        // do lado do adversário são o espelho (a nossa perda é a recuperação dele).
        recuperacoes: side === 'own' ? nRec : nPerda,
        perdas: side === 'own' ? nPerda : nRec,
      };
    }).filter(Boolean);
  },

  /** Um ponto por jogo (todos os jogos no âmbito), com `value: null` onde não jogou. */
  playerSeries(playerId, teamId, entries, key) {
    return entries.map(({ match, occurrences }) => {
      const occ = occurrences || [];
      const app = PlayerStats.appearance(match, playerId, teamId, occ);
      const ms = PlayerStats.forMatch(playerId, occ);
      const involved = ms.events > 0 || ms.goals > 0 || ms.assists > 0;
      // Minutos só com presença formal (onze/substituições); nas outras métricas
      // basta participação registada (jogos antigos sem onze definido).
      const played = key === 'minutes' ? app.played : (app.played || involved);
      const side = this.sideOf(match, teamId);
      return {
        matchId: match.id,
        date: match.date,
        opponentName: side === 'opponent' ? match.team : match.opponent,
        played,
        value: played ? (key === 'minutes' ? app.minutes : (ms[key] || 0)) : null,
      };
    });
  },

  /**
   * Média por jogo nos últimos RECENT_N jogos em que jogou vs os anteriores.
   * Os jogos em que não jogou não entram em nenhuma das médias.
   */
  recentVsBefore(series) {
    const played = series.filter((p) => p.value != null);
    if (played.length < this.MIN_PLAYED_FOR_TREND) return null;
    const recent = played.slice(-this.RECENT_N);
    const before = played.slice(0, played.length - this.RECENT_N);
    const avg = (arr) => Math.round((arr.reduce((n, p) => n + p.value, 0) / arr.length) * 10) / 10;
    const recentAvg = avg(recent);
    const beforeAvg = avg(before);
    return {
      recentAvg,
      beforeAvg,
      delta: Math.round((recentAvg - beforeAvg) * 10) / 10,
      recentN: recent.length,
      beforeN: before.length,
    };
  },

  /** Topo "redondo" da escala, para os números do eixo serem limpos. */
  NICE_STEPS: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 90, 100, 120, 150, 200, 250, 300, 400, 500],
  niceMax(max) {
    if (!(max > 0)) return 1;
    return this.NICE_STEPS.find((s) => s >= max) || Math.ceil(max / 100) * 100;
  },

  /** 2.5 -> "2,5" */
  formatNumber(n) {
    return String(n).replace('.', ',');
  },
};

window.SeasonTrends = SeasonTrends;
