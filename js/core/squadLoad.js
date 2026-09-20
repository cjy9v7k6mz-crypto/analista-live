/**
 * squadLoad.js — Carga do plantel ao longo da época.
 *
 * O ecrã de estatísticas responde a "quem marcou mais golos". Isto responde a
 * outra pergunta, que é a que decide convocatórias: **quem está a jogar de
 * mais e quem não sai do banco**.
 *
 * Tudo sai de dados que já existem (LineupState + PlayerStats.appearance) —
 * nada de novo para registar. Puro: recebe jogos, devolve números.
 *
 * Nota sobre o que NÃO faz: não julga. Um jogador com 20% dos minutos pode
 * estar a recuperar de uma lesão e um com 95% pode ser simplesmente o melhor.
 * A vista mostra a distribuição; a decisão é de quem treina.
 */

const SquadLoad = {
  /** Jogos terminados desta equipa, do mais antigo para o mais recente. */
  timeline(teamId, entries) {
    return (entries || [])
      .filter((e) => e && e.match && e.match.status === 'finished' && SeasonTrends.sideOf(e.match, teamId))
      .sort((a, b) => String(a.match.date || '').localeCompare(String(b.match.date || '')));
  },

  /**
   * Uma linha por jogador.
   * @returns {Array<{playerId, apps, starts, minutes, possible, sharePct,
   *   last5, prev5, benchStreak, lastPlayedDate, flags:string[]}>}
   */
  rows({ players = [], teamId, entries = [], recent = 5 } = {}) {
    const jogos = this.timeline(teamId, entries);
    const duracoes = jogos.map(({ match, occurrences }) => PlayerStats.matchEndMinute(match, occurrences || []));
    const possible = duracoes.reduce((a, b) => a + b, 0);

    return players.map((p) => {
      const side = (m) => SeasonTrends.sideOf(m, teamId);
      const presencas = jogos.map(({ match, occurrences }) =>
        side(match) ? PlayerStats.appearance(match, p.id, teamId, occurrences || []) : { played: false, status: null, minutes: 0 });

      const minutes = presencas.reduce((a, x) => a + (x.minutes || 0), 0);
      const apps = presencas.filter((x) => x.played).length;
      const starts = presencas.filter((x) => x.status === 'starter').length;

      const somaUltimos = (n, desde = 0) => presencas
        .slice(Math.max(0, presencas.length - n - desde), presencas.length - desde)
        .reduce((a, x) => a + (x.minutes || 0), 0);
      const last5 = somaUltimos(recent);
      const prev5 = somaUltimos(recent, recent);

      // Jogos seguidos, do fim para trás, sem entrar em campo.
      let benchStreak = 0;
      for (let i = presencas.length - 1; i >= 0; i--) {
        if (presencas[i].played) break;
        benchStreak++;
      }
      const ultimoIdx = presencas.map((x) => x.played).lastIndexOf(true);
      const lastPlayedDate = ultimoIdx >= 0 ? (jogos[ultimoIdx].match.date || null) : null;

      const row = {
        playerId: p.id, apps, starts, minutes, possible,
        sharePct: possible ? Math.round((minutes / possible) * 100) : 0,
        last5, prev5, benchStreak, lastPlayedDate, matches: jogos.length,
      };
      row.flags = this.flags(row, recent);
      return row;
    }).sort((a, b) => b.minutes - a.minutes);
  },

  /**
   * Sinais, não veredictos. Limites escolhidos para um plantel de formação,
   * onde o objetivo é dar minutos a todos sem queimar ninguém.
   */
  flags(row, recent = 5) {
    const out = [];
    if (!row.matches) return out;
    if (row.sharePct >= 85 && row.apps >= 3) out.push('sobrecarga');
    if (row.benchStreak >= 3) out.push('sem-minutos');
    if (row.apps === 0) out.push('nunca-jogou');
    // Tendência só faz sentido quando há duas janelas cheias para comparar.
    if (row.matches >= recent * 2) {
      if (row.prev5 > 0 && row.last5 >= row.prev5 * 1.5) out.push('a-subir');
      if (row.prev5 > 0 && row.last5 <= row.prev5 * 0.5) out.push('a-descer');
    }
    return out;
  },

  FLAG_LABELS: {
    sobrecarga: { icon: '🔥', text: 'joga quase tudo' },
    'sem-minutos': { icon: '🪑', text: 'sem entrar há 3+ jogos' },
    'nunca-jogou': { icon: '⚪', text: 'ainda não jogou' },
    'a-subir': { icon: '📈', text: 'a ganhar minutos' },
    'a-descer': { icon: '📉', text: 'a perder minutos' },
  },

  /**
   * Leitura do plantel como um todo: quantos foram usados, e quão repartidos
   * estão os minutos. `concentration` = percentagem dos minutos que ficou nos
   * 11 jogadores mais utilizados (100% = jogam sempre os mesmos onze).
   */
  summary(rows) {
    const usados = rows.filter((r) => r.apps > 0);
    const total = rows.reduce((a, r) => a + r.minutes, 0);
    const top11 = [...rows].sort((a, b) => b.minutes - a.minutes).slice(0, 11)
      .reduce((a, r) => a + r.minutes, 0);
    return {
      used: usados.length,
      unused: rows.length - usados.length,
      totalMinutes: total,
      concentration: total ? Math.round((top11 / total) * 100) : 0,
      overloaded: rows.filter((r) => r.flags.includes('sobrecarga')).length,
      benched: rows.filter((r) => r.flags.includes('sem-minutos')).length,
    };
  },
};

window.SquadLoad = SquadLoad;
