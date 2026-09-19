/**
 * playerStats.js — Estatísticas de jogador, calculadas SEMPRE a partir das
 * ocorrências (nunca guardadas). Serve dois sítios:
 *   - a ficha do jogador num jogo (PlayerDetailScreen)
 *   - o hub de estatísticas do plantel (SquadStatsScreen), somando vários jogos
 *
 * Princípio (o mesmo do resto da app): não inventar nem duplicar. Um golo
 * marcado pelo placar (source 'golo', meta.scorerId) e um golo detalhado num
 * remate (source 'remate', result 'goal') são fluxos distintos — nunca ocorrem
 * os dois para o mesmo golo — por isso somam-se sem risco de contar a dobrar.
 */

const PlayerStats = {
  /** Colunas mostradas no hub (ordem = ordem na tabela). `p90` = candidato a "por 90 min". */
  COLUMNS: [
    { key: 'apps', label: 'J', title: 'Jogos', p90: false },
    { key: 'minutes', label: 'Min', title: 'Minutos (aprox.)', p90: false },
    { key: 'goals', label: 'G', title: 'Golos', p90: true },
    { key: 'assists', label: 'A', title: 'Assistências', p90: true },
    { key: 'chancesCreated', label: 'GOC', title: 'Grandes oportunidades criadas (passe que deu remate)', p90: true },
    { key: 'shots', label: 'Rem', title: 'Remates', p90: true },
    { key: 'shotsOnTarget', label: 'REmq', title: 'Remates enquadrados', p90: true },
    { key: 'saves', label: 'Def', title: 'Defesas (GR)', p90: true },
    { key: 'corners', label: 'Cnt', title: 'Cantos batidos', p90: false },
    { key: 'foulsCommitted', label: 'FC', title: 'Faltas cometidas', p90: true },
    { key: 'foulsSuffered', label: 'FS', title: 'Faltas sofridas', p90: true },
    { key: 'recuperacoes', label: 'Rec', title: 'Recuperações de bola', p90: true },
    { key: 'perdas', label: 'Prd', title: 'Perdas de bola', p90: true },
    { key: 'yellow', label: '🟨', title: 'Amarelos', p90: false },
    { key: 'red', label: '🟥', title: 'Vermelhos', p90: false },
    { key: 'positives', label: '＋', title: 'Ações positivas', p90: true },
    { key: 'negatives', label: '－', title: 'Ações negativas', p90: true },
    { key: 'moments', label: '⭐', title: 'Momentos', p90: false },
    { key: 'events', label: 'Ações', title: 'Total de registos associados', p90: true },
  ],

  _emptyMatchStats() {
    return {
      goals: 0, assists: 0, chancesCreated: 0, shots: 0, shotsOnTarget: 0, saves: 0, corners: 0,
      foulsCommitted: 0, foulsSuffered: 0, recuperacoes: 0, perdas: 0, yellow: 0, red: 0,
      positives: 0, negatives: 0, moments: 0, interventions: 0, events: 0,
    };
  },

  /**
   * Estatísticas de UM jogo para um jogador, a partir das ocorrências desse jogo.
   * Não inclui `apps`/`minutes` (esses dependem do onze/substituições — ver aggregate()).
   */
  forMatch(playerId, occurrences) {
    const s = this._emptyMatchStats();
    for (const o of occurrences) {
      const tagged = (o.playerIds || []).includes(playerId);
      if (o.source === 'golo') {
        if (o.meta && o.meta.scorerId === playerId) s.goals++;
        if (o.meta && o.meta.assistId === playerId) s.assists++;
        continue;
      }
      if (!tagged && !(o.source === 'falta' && o.meta && (o.meta.committedById === playerId || o.meta.sufferedById === playerId))
                  && !(o.source === 'defesa' && o.meta && o.meta.keeperId === playerId)) {
        continue;
      }
      s.events++;
      // Perda/recuperação são espelho: o +/- depende de QUAL jogador é —
      // tratado no switch, não pelo eventType global do evento.
      if (o.source !== 'perda' && o.source !== 'recuperacao') {
        if (o.eventType === 'positive') s.positives++;
        else if (o.eventType === 'negative') s.negatives++;
      }

      switch (o.source) {
        case 'remate':
          // Um remate pode ter dois jogadores tagged — quem rematou e quem fez
          // o passe. O passe não conta como remate de quem passou.
          if (MatchStats.passerOf(o) === playerId) {
            s.chancesCreated++;
            if (MatchStats.shotAssistOf(o) === playerId) s.assists++;
            break;
          }
          s.shots++;
          if (o.meta && (o.meta.result === 'goal' || o.meta.result === 'save')) s.shotsOnTarget++;
          if (o.meta && o.meta.result === 'goal') s.goals++;
          break;
        case 'perda':
          if (o.meta && o.meta.ownPlayerId === playerId) { s.perdas++; s.negatives++; }
          if (o.meta && o.meta.oppPlayerId === playerId) { s.recuperacoes++; s.positives++; }
          break;
        case 'recuperacao':
          if (o.meta && o.meta.ownPlayerId === playerId) { s.recuperacoes++; s.positives++; }
          if (o.meta && o.meta.oppPlayerId === playerId) { s.perdas++; s.negatives++; }
          break;
        case 'defesa':
          s.saves++;
          break;
        case 'canto':
          s.corners++;
          break;
        case 'falta':
          if (o.meta && o.meta.committedById === playerId) {
            s.foulsCommitted++;
            const c = (o.meta.consequences || []);
            if (c.includes('yellow')) s.yellow++;
            if (c.includes('red')) s.red++;
          }
          if (o.meta && o.meta.sufferedById === playerId) s.foulsSuffered++;
          break;
        case 'cartao':
          if (/vermelho/i.test(o.eventName || '')) s.red++; else s.yellow++;
          break;
        case 'momento':
          s.moments++;
          break;
        case 'banco':
          s.interventions++;
          break;
        default:
          break;
      }
    }
    return s;
  },

  /** Em que lado joga este jogador neste jogo (pelo teamId), ou null. */
  sideOf(match, playerId, playerTeamId) {
    if (playerTeamId && match.teams) {
      if (match.teams.own && match.teams.own.teamId === playerTeamId) return 'own';
      if (match.teams.opponent && match.teams.opponent.teamId === playerTeamId) return 'opponent';
    }
    for (const side of ['own', 'opponent']) {
      const t = match.teams && match.teams[side];
      if (!t) continue;
      if ((t.starterIds || []).includes(playerId)) return side;
      if ((t.subIds || []).includes(playerId)) return side;
      if ((t.positions || []).some((p) => p.playerId === playerId)) return side;
    }
    if ((match.substitutions || []).some((s) => s.inId === playerId || s.outId === playerId)) {
      const sub = (match.substitutions || []).find((s) => s.inId === playerId || s.outId === playerId);
      return sub.side || 'own';
    }
    return null;
  },

  /** Minuto em que o jogo (efetivamente) acabou, para calcular minutos jogados. */
  matchEndMinute(match, occurrences) {
    const snap = match.timerSnapshot;
    let est = 0;
    if (snap) {
      // Minutos já decorridos ANTES do período atual + os que já correram nele.
      const before = { '1T': 0, HT: 45, '2T': 45, ET1: 90, ET2: 105, FT: 45 }[snap.period] ?? 0;
      est = before + Math.floor((snap.periodElapsedMs || 0) / 60000);
    }
    const lastOcc = (occurrences || []).reduce((mx, o) => Math.max(mx, o.minute || 0), 0);
    // Um jogo terminado dá pelo menos 90'; nunca mais de 130' (prolongamento longo).
    const floor = match.status === 'finished' ? 90 : 0;
    return Math.min(130, Math.max(est, lastOcc, floor, 1));
  },

  /**
   * Presença e minutos (aprox.) de um jogador num jogo.
   * @returns {{played:boolean, status:'starter'|'sub'|null, minutes:number}}
   */
  appearance(match, playerId, playerTeamId, occurrences) {
    const side = this.sideOf(match, playerId, playerTeamId);
    if (!side) return { played: false, status: null, minutes: 0 };
    const lineup = (match.teams && match.teams[side]) || {};
    const started = (lineup.starterIds || []).includes(playerId)
      || (lineup.positions || []).some((p) => p.playerId === playerId);
    const subIn = (match.substitutions || []).find((s) => s.inId === playerId && (s.side || 'own') === side);
    if (!started && !subIn) return { played: false, status: null, minutes: 0 };

    const endMin = this.matchEndMinute(match, occurrences);
    let inMin = started ? 0 : (subIn.minute || 0);
    let outMin = endMin;
    const subOut = (match.substitutions || []).find((s) => s.outId === playerId && (s.side || 'own') === side);
    if (subOut) outMin = Math.min(outMin, subOut.minute || endMin);
    // Expulsão: sai no minuto do vermelho.
    const red = (match.cards || []).find((c) => c.playerId === playerId && c.color === 'red');
    if (red && typeof red.minute === 'number') outMin = Math.min(outMin, red.minute);
    const redOcc = (occurrences || []).find((o) => o.source === 'cartao' && (o.playerIds || []).includes(playerId) && /vermelho/i.test(o.eventName || ''));
    if (redOcc && typeof redOcc.minute === 'number') outMin = Math.min(outMin, redOcc.minute);

    return { played: true, status: started ? 'starter' : 'sub', minutes: Math.max(0, Math.round(outMin - inMin)) };
  },

  /**
   * Soma as estatísticas de um jogador em vários jogos.
   * @param {string} playerId
   * @param {string} playerTeamId
   * @param {Array<{match:object, occurrences:Array}>} entries
   * @returns {object} — colunas de COLUMNS + `perMatch` (detalhe por jogo)
   */
  aggregate(playerId, playerTeamId, entries) {
    const total = Object.assign(this._emptyMatchStats(), { apps: 0, minutes: 0, starts: 0 });
    const perMatch = [];
    for (const { match, occurrences } of entries) {
      const app = this.appearance(match, playerId, playerTeamId, occurrences);
      const ms = this.forMatch(playerId, occurrences);
      if (app.played) {
        total.apps++;
        if (app.status === 'starter') total.starts++;
        total.minutes += app.minutes;
      }
      // Um registo pode existir mesmo sem o jogador ter "entrado" formalmente
      // (jogos antigos sem onze). Contamos sempre as ações associadas.
      for (const k of Object.keys(ms)) total[k] += ms[k];
      if (app.played || ms.events || ms.goals) {
        perMatch.push({
          matchId: match.id, date: match.date, opponent: match.opponent, team: match.team,
          status: app.status, minutes: app.minutes, ...ms,
        });
      }
    }
    perMatch.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    total.perMatch = perMatch;
    return total;
  },

  /** Valor "por 90 minutos" (só faz sentido com minutos suficientes). */
  per90(value, minutes) {
    if (!minutes || minutes < 45) return null;
    return Math.round((value / minutes) * 90 * 10) / 10;
  },
};

window.PlayerStats = PlayerStats;
