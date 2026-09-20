/**
 * generator.js — Fábrica de jogos falsos, para os testes de fumo.
 *
 * Porque existe: os testes escritos à mão só verificam os casos de que alguém
 * se lembrou. Este gerador produz jogos inteiros ao acaso — com golos,
 * autogolos, cartões, expulsões, substituições, cantos, livres, perdas e
 * recuperações — e as invariantes correm sobre todos eles. É assim que se
 * apanham os casos em que ninguém pensou.
 *
 * REGRA DE OURO: o gerador escreve os dados pelas MESMAS regras que a app usa
 * (o placar sobe por ocorrência de golo, os cartões passam pelo
 * MatchEffects.syncFoulCards). Se o gerador inventasse dados impossíveis, as
 * invariantes falhariam por culpa do teste e não do código.
 *
 * O acaso é semeado (mulberry32): a mesma semente dá sempre o mesmo jogo, por
 * isso uma falha é sempre reproduzível — basta o número da semente.
 */

const MatchGen = {
  /** Gerador determinístico. Mesma semente, mesma sequência. */
  rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  players(teamId, prefix, n = 16) {
    return [...Array(n)].map((_, i) => ({
      id: `${prefix}${i + 1}`, teamId, name: `${prefix.toUpperCase()} Jogador ${i + 1}`,
      shortName: `${prefix.toUpperCase()}${i + 1}`, number: i + 1, position: 'MC', photo: null,
    }));
  },

  /**
   * Um jogo completo e coerente.
   * @returns {{match, occurrences, ownPlayers, opponentPlayers}}
   */
  match(seed, { events = 120, date = '2026-01-10' } = {}) {
    const r = this.rng(seed);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const chance = (p) => r() < p;

    const ownPlayers = this.players('t1', 'p');
    const opponentPlayers = this.players('t2', 'r');
    const starters = ownPlayers.slice(0, 11).map((p) => p.id);
    const oppStarters = opponentPlayers.slice(0, 11).map((p) => p.id);

    const match = {
      id: `gen${seed}`, date, team: 'Nós', opponent: 'Eles', competition: 'Liga',
      status: 'finished', currentPeriod: 'FT', score: { team: 0, opponent: 0 },
      cards: [], substitutions: [],
      teams: {
        own: { teamId: 't1', starterIds: starters, subIds: ownPlayers.slice(11).map((p) => p.id),
          positions: starters.map((id, i) => ({ playerId: id, x: 10 + ((i * 7) % 80), y: 10 + ((i * 8) % 80), role: 'MC' })) },
        opponent: { teamId: 't2', starterIds: oppStarters, subIds: [],
          positions: oppStarters.map((id, i) => ({ playerId: id, x: 10 + ((i * 7) % 80), y: 10 + ((i * 8) % 80), role: 'MC' })) },
      },
      observationPlan: [
        { id: 'pe1', name: 'Cantos ao 2º poste', category: 'adversario', priority: 'critical', type: 'negative', isFocus: true, scoutingRef: { list: 'weaknesses', itemId: 'w1' } },
        { id: 'pe2', name: 'Saída curta pressionada', category: 'adversario', priority: 'important', type: 'neutral', isFocus: false, scoutingRef: { list: 'triggers', itemId: 'g1' } },
      ],
      createdAt: 1, updatedAt: 1,
    };

    const occurrences = [];
    const t0 = 1700000000000;
    let n = 0;
    const add = (o) => {
      n++;
      const minute = o.minute != null ? o.minute : Math.floor(r() * 90);
      const period = minute > 45 ? '2T' : '1T';
      const occ = Object.assign({
        id: `o${seed}_${n}`, matchId: match.id, timestamp: t0 + minute * 60000 + Math.floor(r() * 60000),
        period, minute, second: Math.floor(r() * 60), category: 'nossa_equipa', eventName: 'Evento',
        eventType: 'neutral', priority: 'important', note: '', planEventId: null, playerIds: [],
        team: 'own', meta: null, source: 'event', createdAt: t0,
      }, o, { period, minute });
      occurrences.push(occ);
      // O placar é consequência do registo, tal como na app.
      const key = MatchEffects.scoreKeyOf(occ);
      if (key) match.score[key]++;
      return occ;
    };

    const side = () => (chance(0.55) ? 'own' : 'opponent');
    const playerOf = (s) => pick(s === 'own' ? ownPlayers : opponentPlayers);
    const xy = () => ({ x: Number(r().toFixed(3)), y: Number(r().toFixed(3)) });

    for (let i = 0; i < events; i++) {
      const s = side();
      const cat = s === 'own' ? 'nossa_equipa' : 'adversario';
      const dice = r();

      if (dice < 0.28) {
        // Remate, por vezes ligado a um canto/livre anterior e por vezes golo.
        const resultado = pick(['goal', 'save', 'blocked', 'wide', 'post', 'other', null]);
        const anterior = occurrences.filter((o) => (o.source === 'canto' || o.source === 'falta') && o.team === s).slice(-1)[0];
        const passador = chance(0.6) ? playerOf(s).id : null;
        add({
          source: 'remate', eventName: 'Remate', team: s, category: cat,
          playerIds: [playerOf(s).id, passador].filter(Boolean),
          meta: {
            origin: chance(0.85) ? xy() : null, result: resultado,
            goalZone: resultado === 'goal' ? 'TC' : null,
            passerId: passador, assistId: resultado === 'goal' ? passador : null,
            ...(anterior && chance(0.3) ? (anterior.source === 'canto' ? { fromCornerId: anterior.id } : { fromFoulId: anterior.id }) : {}),
          },
        });
      } else if (dice < 0.38) {
        add({ source: 'canto', eventName: 'Canto', team: s, category: cat, meta: { side: pick(['left', 'right']), result: pick(['shot', 'goal', 'cleared', null]) } });
      } else if (dice < 0.5) {
        // Falta: as consequências (livre, cartão) vivem no MESMO evento.
        const quem = playerOf(s);
        const consequences = [];
        if (chance(0.5)) consequences.push('freeKick');
        if (chance(0.15)) consequences.push('yellow');
        if (chance(0.03)) consequences.push('red');
        if (chance(0.04)) consequences.push('penalty');
        const falta = add({
          source: 'falta', eventName: 'Falta', team: s, category: cat,
          playerIds: [quem.id], meta: { location: chance(0.8) ? xy() : null, type: pick(['tactical', 'careless', null]), consequences, committedById: quem.id, sufferedById: playerOf(s === 'own' ? 'opponent' : 'own').id },
        });
        MatchEffects.syncFoulCards(match, falta, quem.name);
      } else if (dice < 0.58) {
        add({ source: 'perda', eventName: 'Perda de bola', team: 'own', category: 'nossa_equipa', eventType: 'negative',
          playerIds: [playerOf('own').id], meta: { location: chance(0.9) ? xy() : null, ownPlayerId: playerOf('own').id, oppPlayerId: playerOf('opponent').id } });
      } else if (dice < 0.66) {
        add({ source: 'recuperacao', eventName: 'Recuperação', team: 'own', category: 'nossa_equipa', eventType: 'positive',
          playerIds: [playerOf('own').id], meta: { location: chance(0.9) ? xy() : null, ownPlayerId: playerOf('own').id } });
      } else if (dice < 0.72) {
        // Golo pelo placar (fluxo distinto do remate marcado "Golo").
        const marcador = playerOf(s);
        add({ source: 'golo', eventName: 'Golo', team: s, category: cat, priority: 'critical',
          playerIds: [marcador.id], meta: { ownGoal: chance(0.08), scorerId: marcador.id, assistId: chance(0.5) ? playerOf(s).id : null, moment: chance(0.3) } });
      } else if (dice < 0.78) {
        add({ source: 'defesa', eventName: 'Defesa', team: s, category: cat, playerIds: [playerOf(s).id], meta: { saveType: pick(['catch', 'parry', null]), keeperId: playerOf(s).id, shotId: null } });
      } else if (dice < 0.84) {
        add({ source: 'stat_quick', eventName: 'Fora de jogo', team: s, category: cat, meta: { statKey: pick(['offside', 'dangerousAttacks', 'freeKicks', 'penalties']) } });
      } else if (dice < 0.9) {
        add({ source: 'event', eventName: 'Cantos ao 2º poste', team: 'opponent', category: 'adversario', planEventId: 'pe1', priority: 'critical', eventType: 'negative' });
      } else if (dice < 0.94) {
        add({ source: 'momento', eventName: 'Momento', team: s, category: cat, note: chance(0.5) ? 'nota do momento' : '' });
      } else if (dice < 0.97) {
        add({ source: 'nota', eventName: 'Nota', team: null, category: 'geral', note: 'observação livre' });
      } else {
        add({ source: 'tatica', eventName: 'Mudança tática', team: 'own', category: 'nossa_equipa', meta: { kind: pick(['formation', 'pressing', null]), detail: '4-4-2' } });
      }
    }

    // Substituições (a seguir aos eventos, para os minutos fazerem sentido).
    const usados = new Set();
    for (let i = 0; i < 3 && chance(0.85); i++) {
      const sai = starters.find((id) => !usados.has(id));
      const entra = match.teams.own.subIds[i];
      if (!sai || !entra) break;
      usados.add(sai); usados.add(entra);
      const minute = 45 + Math.floor(r() * 45);
      match.substitutions.push({ id: `sub${seed}_${i}`, side: 'own', outId: sai, inId: entra,
        out: sai, in: entra, period: '2T', minute });
      add({ source: 'substituicao', eventName: 'Substituição', team: 'own', category: 'individual',
        minute, playerIds: [sai, entra] });
    }

    occurrences.sort((a, b) => a.timestamp - b.timestamp);
    return { match, occurrences, ownPlayers, opponentPlayers };
  },

  /** Uma época inteira, para os testes de escala. */
  season(seeds, opts = {}) {
    return seeds.map((s, i) => {
      const dia = String((i % 28) + 1).padStart(2, '0');
      const mes = String((i % 12) + 1).padStart(2, '0');
      return this.match(s, { ...opts, date: `2026-${mes}-${dia}` });
    });
  },
};

window.MatchGen = MatchGen;
