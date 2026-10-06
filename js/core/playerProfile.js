/**
 * playerProfile.js — O detalhe fino de um jogador: por jogo, por competição e
 * por tipo de ação.
 *
 * O hub do plantel já somava tudo numa linha por jogador. Isto abre essa linha:
 * de onde vêm os remates e em que acabaram, em que terço se perdem e recuperam
 * bolas, o que as faltas custaram, em que altura do jogo aparecem os golos — e
 * a mesma conta separada por competição, porque 3 golos no campeonato e 3 na
 * taça não dizem a mesma coisa.
 *
 * Tudo CALCULADO a partir das ocorrências, como o resto da app: nada é guardado
 * e nada é inventado. Um campo que nunca foi preenchido durante o jogo aparece
 * como "sem detalhe" em vez de ser adivinhado.
 */

const PlayerProfile = {
  /** Janelas de 15 minutos — a leitura normal de "quando acontecem os golos". */
  WINDOWS: [
    { key: '0-15', label: "0-15'", from: 0, to: 15 },
    { key: '16-30', label: "16-30'", from: 16, to: 30 },
    { key: '31-45', label: "31-45'", from: 31, to: 45 },
    { key: '46-60', label: "46-60'", from: 46, to: 60 },
    { key: '61-75', label: "61-75'", from: 61, to: 75 },
    { key: '76-90', label: "76-90'", from: 76, to: 90 },
    { key: '90+', label: "90'+", from: 91, to: 999 },
  ],

  THIRD_LABELS: { att: 'Terço ofensivo', mid: 'Meio-campo', def: 'Terço defensivo' },

  windowOf(minute) {
    const m = Number(minute) || 0;
    const w = this.WINDOWS.find((x) => m >= x.from && m <= x.to);
    return w ? w.key : '90+';
  },

  /** O jogador rematou (não foi quem fez o passe). */
  isShooter(o, playerId) {
    if (!o || o.source !== 'remate') return false;
    if (!(o.playerIds || []).includes(playerId)) return false;
    return MatchStats.passerOf(o) !== playerId;
  },

  _emptyThirds() { return { def: 0, mid: 0, att: 0, semDetalhe: 0 }; },

  _addThird(acc, y) {
    const t = MatchStats.thirdOf(y);
    if (t) acc[t]++; else acc.semDetalhe++;
    return acc;
  },

  /**
   * Perfil completo de um jogador num conjunto de jogos.
   * @param {string} playerId
   * @param {string} teamId
   * @param {Array<{match, occurrences}>} entries
   */
  compute(playerId, teamId, entries = []) {
    const totals = PlayerStats.aggregate(playerId, teamId, entries);

    const shots = { total: 0, byResult: {}, byThird: this._emptyThirds(), semDetalhe: 0 };
    MatchStats.SHOT_RESULTS.forEach((r) => { shots.byResult[r.key] = 0; });
    const golos = { total: 0, byPeriod: {}, byWindow: {}, deRemate: 0, doPlacar: 0, assistidos: 0 };
    this.WINDOWS.forEach((w) => { golos.byWindow[w.key] = 0; });
    const assistencias = { total: 0, byWindow: {} };
    this.WINDOWS.forEach((w) => { assistencias.byWindow[w.key] = 0; });
    const faltas = {
      cometidas: 0, sofridas: 0,
      consequencias: {}, byThird: this._emptyThirds(), sofridasByThird: this._emptyThirds(),
    };
    MatchStats.FOUL_CONSEQUENCES.forEach((c) => { faltas.consequencias[c.key] = 0; });
    const bola = { perdas: this._emptyThirds(), recuperacoes: this._emptyThirds(), totalPerdas: 0, totalRecuperacoes: 0 };
    const defesas = { total: 0, byType: {} };
    MatchStats.SAVE_TYPES.forEach((t) => { defesas.byType[t.key] = 0; });
    const extras = { cantos: 0, momentos: 0, oportunidadesCriadas: 0, amarelos: 0, vermelhos: 0 };

    for (const { occurrences } of entries) {
      for (const o of occurrences || []) {
        const minuto = o.minute || 0;
        const janela = this.windowOf(minuto);
        const periodo = o.period || '1T';

        if (o.source === 'golo') {
          // Autogolo: o jogador identificado marcou contra — não é golo dele
          // (é a mesma regra das estatísticas individuais).
          if (o.meta && o.meta.scorerId === playerId && !o.meta.ownGoal) {
            golos.total++; golos.doPlacar++;
            golos.byWindow[janela]++;
            golos.byPeriod[periodo] = (golos.byPeriod[periodo] || 0) + 1;
            if (o.meta.assistId) golos.assistidos++;
          }
          if (o.meta && o.meta.assistId === playerId) {
            assistencias.total++; assistencias.byWindow[janela]++;
          }
          continue;
        }

        if (o.source === 'remate') {
          if (this.isShooter(o, playerId)) {
            shots.total++;
            const r = (o.meta && o.meta.result) || null;
            if (r && shots.byResult[r] !== undefined) shots.byResult[r]++;
            else shots.semDetalhe++;
            this._addThird(shots.byThird, o.meta && o.meta.origin && o.meta.origin.y);
            if (r === 'goal') {
              golos.total++; golos.deRemate++;
              golos.byWindow[janela]++;
              golos.byPeriod[periodo] = (golos.byPeriod[periodo] || 0) + 1;
              if (MatchStats.shotAssistOf(o)) golos.assistidos++;
            }
          }
          if (MatchStats.passerOf(o) === playerId) {
            extras.oportunidadesCriadas++;
            if (MatchStats.shotAssistOf(o) === playerId) { assistencias.total++; assistencias.byWindow[janela]++; }
          }
          continue;
        }

        if (o.source === 'falta') {
          const m = o.meta || {};
          if (m.committedById === playerId) {
            faltas.cometidas++;
            this._addThird(faltas.byThird, m.location && m.location.y);
            (m.consequences || []).forEach((c) => { if (faltas.consequencias[c] !== undefined) faltas.consequencias[c]++; });
            if ((m.consequences || []).includes('yellow')) extras.amarelos++;
            if ((m.consequences || []).includes('red')) extras.vermelhos++;
          }
          if (m.sufferedById === playerId) {
            faltas.sofridas++;
            this._addThird(faltas.sofridasByThird, m.location && m.location.y);
          }
          continue;
        }

        if (o.source === 'perda' || o.source === 'recuperacao') {
          const m = o.meta || {};
          const y = m.location && m.location.y;
          // Perda e recuperação são espelho: numa perda, o adversário recuperou.
          const perdeu = (o.source === 'perda' && m.ownPlayerId === playerId) || (o.source === 'recuperacao' && m.oppPlayerId === playerId);
          const recuperou = (o.source === 'recuperacao' && m.ownPlayerId === playerId) || (o.source === 'perda' && m.oppPlayerId === playerId);
          if (perdeu) { bola.totalPerdas++; this._addThird(bola.perdas, y); }
          if (recuperou) { bola.totalRecuperacoes++; this._addThird(bola.recuperacoes, y); }
          continue;
        }

        if (o.source === 'defesa') {
          const m = o.meta || {};
          if (m.keeperId === playerId || (o.playerIds || []).includes(playerId)) {
            defesas.total++;
            if (m.saveType && defesas.byType[m.saveType] !== undefined) defesas.byType[m.saveType]++;
          }
          continue;
        }

        if (!(o.playerIds || []).includes(playerId)) continue;
        if (o.source === 'canto') extras.cantos++;
        else if (o.source === 'momento') extras.momentos++;
        else if (o.source === 'cartao') {
          if (/vermelho/i.test(o.eventName || '')) extras.vermelhos++; else extras.amarelos++;
        }
      }
    }

    return {
      totals,
      shots, golos, assistencias, faltas, bola, defesas, extras,
      porCompeticao: this.byCompetition(playerId, teamId, entries),
      perMatch: totals.perMatch,
    };
  },

  /** O mesmo total, separado por competição (ordenado por jogos). */
  byCompetition(playerId, teamId, entries = []) {
    const grupos = new Map();
    for (const e of entries) {
      const nome = ((e.match && e.match.competition) || '').trim() || 'Sem competição';
      if (!grupos.has(nome)) grupos.set(nome, []);
      grupos.get(nome).push(e);
    }
    return [...grupos.entries()]
      .map(([competicao, lista]) => ({ competicao, jogos: lista.length, agg: PlayerStats.aggregate(playerId, teamId, lista) }))
      .filter((g) => g.agg.apps > 0 || g.agg.events > 0)
      .sort((a, b) => b.agg.apps - a.agg.apps || a.competicao.localeCompare(b.competicao));
  },

  /** Percentagem inteira, ou null quando não há base para a calcular. */
  pct(parte, total) {
    if (!total) return null;
    return Math.round((parte / total) * 100);
  },
};

window.PlayerProfile = PlayerProfile;
