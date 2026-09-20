/**
 * specs.js — Testes das contas da app. Cada caso usa um jogo inventado com um
 * resultado conhecido à partida. Se uma alteração futura estragar uma conta,
 * é aqui que se vê.
 */

let _n = 0;
/** Ocorrência mínima; sobrepõe só o que interessa ao caso. */
function occ(o = {}) {
  _n++;
  return Object.assign({
    id: 'o' + _n, matchId: 'M', timestamp: _n, period: '1T', minute: 10, second: 0,
    category: 'nossa_equipa', eventName: 'x', eventType: 'neutral', priority: 'important',
    note: '', planEventId: null, playerIds: [], team: 'own', meta: null,
  }, o);
}
function match(o = {}) {
  return Object.assign({
    id: 'M', team: 'Nós', opponent: 'Eles', score: { team: 0, opponent: 0 }, status: 'finished',
    observationPlan: [], substitutions: [], cards: [], teams: { own: {}, opponent: {} },
  }, o);
}
const at = (minute, second = 0, extra = {}) => ({ minute, second, ...extra });

// ---------------------------------------------------------------------------
describe('MatchStats.thirdOf — terços do campo (nós atacamos para cima)', () => {
  it('limites', () => {
    eq(MatchStats.thirdOf(0), 'att');
    eq(MatchStats.thirdOf(0.3), 'att');
    eq(MatchStats.thirdOf(1 / 3), 'mid');
    eq(MatchStats.thirdOf(0.5), 'mid');
    eq(MatchStats.thirdOf(2 / 3), 'mid');
    eq(MatchStats.thirdOf(0.7), 'def');
    eq(MatchStats.thirdOf(null), null);
    eq(MatchStats.thirdOf(undefined), null);
  });
});

describe('MatchStats.compute — estatísticas do jogo', () => {
  it('os golos vêm do placar', () => {
    const s = MatchStats.compute(match({ score: { team: 3, opponent: 1 } }), []);
    eq([s.own.goals, s.opp.goals], [3, 1]);
  });
  it('remates: enquadrados = golo + defesa; não enquadrados = fora + poste; bloqueado não conta em nenhum', () => {
    const list = ['goal', 'save', 'wide', 'post', 'blocked'].map((r) => occ({ source: 'remate', meta: { result: r } }));
    const s = MatchStats.compute(match(), list);
    eq([s.own.shots, s.own.shotsOnTarget, s.own.shotsOffTarget], [5, 2, 2]);
  });
  it('assistências: do golo pelo placar e do remate marcado golo — não de um remate defendido', () => {
    const s = MatchStats.compute(match(), [
      occ({ source: 'remate', meta: { result: 'goal', assistId: 'A' } }),
      occ({ source: 'remate', meta: { result: 'save', assistId: 'A' } }),
      occ({ source: 'golo', meta: { assistId: 'B' } }),
    ]);
    eq(s.own.assists, 2);
  });
  it('autogolo conta na equipa do registo', () => {
    const s = MatchStats.compute(match(), [occ({ source: 'golo', team: 'opponent', meta: { ownGoal: true } })]);
    eq(s.opp.ownGoals, 1);
  });
  it('falta: cometida/sofrida, e consequências no mesmo evento (livre, penálti, amarelo)', () => {
    const s = MatchStats.compute(match(), [occ({ source: 'falta', meta: { consequences: ['freeKick', 'penalty', 'yellow'] } })]);
    eq([s.own.foulsCommitted, s.opp.foulsSuffered, s.opp.freeKicks, s.opp.penalties, s.own.yellowCards], [1, 1, 1, 1, 1]);
  });
  it('registo de cartão: vermelho pelo nome, senão amarelo', () => {
    const s = MatchStats.compute(match(), [
      occ({ source: 'cartao', team: 'opponent', eventName: 'Cartão Vermelho (X)' }),
      occ({ source: 'cartao', team: 'own', eventName: 'Cartão Amarelo (Y)' }),
    ]);
    eq([s.opp.redCards, s.own.yellowCards], [1, 1]);
  });
  it('contadores rápidos só para chaves conhecidas; registos sem equipa ignorados', () => {
    const s = MatchStats.compute(match(), [
      occ({ source: 'stat_quick', meta: { statKey: 'offside' } }),
      occ({ source: 'stat_quick', meta: { statKey: 'inventada' } }),
      occ({ source: 'remate', team: null, meta: { result: 'goal' } }),
    ]);
    eq([s.own.offside, 'inventada' in s.own, s.own.shots], [1, false, 0]);
  });
});

// ---------------------------------------------------------------------------
describe('MatchStats.setPieceChains — bolas paradas', () => {
  it('cantos: eficácia sobre o total, golos pelos remates ligados', () => {
    const c1 = occ({ source: 'canto' }); const c2 = occ({ source: 'canto' }); const c3 = occ({ source: 'canto' });
    const ch = MatchStats.setPieceChains([c1, c2, c3,
      occ({ source: 'remate', meta: { result: 'save', fromCornerId: c1.id } }),
      occ({ source: 'remate', meta: { result: 'goal', fromCornerId: c2.id } })]);
    eq([ch.own.corners.total, ch.own.corners.withShot, ch.own.corners.goals, ch.own.corners.shotPct], [3, 2, 1, 67]);
    eq(ch.opponent.corners.total, 0);
  });
  it('um canto com dois remates conta uma vez como "com remate"', () => {
    const c = occ({ source: 'canto' });
    const ch = MatchStats.setPieceChains([c,
      occ({ source: 'remate', meta: { result: 'save', fromCornerId: c.id } }),
      occ({ source: 'remate', meta: { result: 'goal', fromCornerId: c.id } })]);
    eq([ch.own.corners.withShot, ch.own.corners.goals, ch.own.corners.shotPct], [1, 1, 100]);
  });
  it('livres: a eficácia só conta os que estavam em zona de remate (ou deram remate)', () => {
    const fk = (y, extra = {}) => occ({ source: 'falta', team: 'opponent', meta: { consequences: ['freeKick'], location: y == null ? null : { x: 0.5, y }, ...extra } });
    const f1 = fk(0.15);   // zona de remate, sem remate
    const f2 = fk(0.5);    // meio-campo, sem remate -> fora da zona
    const f3 = fk(null);   // sem localização
    const f4 = fk(0.5);    // meio-campo, mas deu remate -> entra na base
    const semLivre = occ({ source: 'falta', team: 'opponent', meta: { consequences: [] } });
    const fks = MatchStats.setPieceChains([f1, f2, f3, f4, semLivre,
      occ({ source: 'remate', meta: { result: 'wide', fromFoulId: f4.id } })]).own.freeKicks;
    eq({ total: fks.total, base: fks.base, outOfZone: fks.outOfZone, noLocation: fks.noLocation, baseWithShot: fks.baseWithShot, shotPct: fks.shotPct },
      { total: 4, base: 2, outOfZone: 1, noLocation: 1, baseWithShot: 1, shotPct: 50 });
    eq(fks.base + fks.outOfZone + fks.noLocation, fks.total, 'as três parcelas somam o total');
  });
  it('livres do adversário: a zona dele é junto à NOSSA baliza', () => {
    const fk = (y) => occ({ source: 'falta', team: 'own', meta: { consequences: ['freeKick'], location: { x: 0.5, y } } });
    const ch = MatchStats.setPieceChains([fk(0.85), fk(0.2)]);
    eq([ch.opponent.freeKicks.base, ch.opponent.freeKicks.outOfZone, ch.own.freeKicks.total], [1, 1, 0]);
  });
});

describe('MatchStats.transitionSpeed — recuperação até remate', () => {
  const rec = (m, s = 0, p = '1T') => occ({ source: 'recuperacao', period: p, ...at(m, s) });
  const shot = (m, s = 0, extra = {}) => occ({ source: 'remate', ...at(m, s), meta: { result: 'wide' }, ...extra });
  it('30s ainda conta; 31s já não', () => {
    eq(MatchStats.transitionSpeed([rec(10), shot(10, 30)]).converted, 1);
    eq(MatchStats.transitionSpeed([rec(20), shot(20, 31)]).converted, 0);
  });
  it('não liga partes diferentes, remates do adversário, nem remates anteriores', () => {
    eq(MatchStats.transitionSpeed([rec(45, 0, '1T'), shot(45, 5, { period: '2T' })]).converted, 0);
    eq(MatchStats.transitionSpeed([rec(30), shot(30, 5, { team: 'opponent' })]).converted, 0);
    eq(MatchStats.transitionSpeed([shot(40, 0), rec(40, 5)]).converted, 0);
  });
  it('escolhe o remate mais próximo', () => {
    eq(MatchStats.transitionSpeed([rec(50), shot(50, 25), shot(50, 10)]).pairs[0].seconds, 10);
  });
  it('mediana: número par = média dos dois do meio; ímpar = o do meio', () => {
    eq(MatchStats.transitionSpeed([rec(10), shot(10, 8), rec(20), shot(20, 20)]).medianSeconds, 14);
    eq(MatchStats.transitionSpeed([rec(10), shot(10, 8), rec(20), shot(20, 20), rec(30), shot(30, 5)]).medianSeconds, 8);
  });
  it('percentagem e golos', () => {
    const r = MatchStats.transitionSpeed([rec(10), shot(10, 5, { meta: { result: 'goal' } }), rec(20), shot(20, 5), rec(30)]);
    eq([r.recoveries, r.converted, r.pct, r.goals], [3, 2, 67, 1]);
  });
});

describe('MatchStats.costlyLosses — perda seguida de golo sofrido', () => {
  const loss = (m, s = 0, extra = {}) => occ({ source: 'perda', ...at(m, s), meta: { ownPlayerId: 'A' }, ...extra });
  const conceded = (m, s = 0, extra = {}) => occ({ source: 'golo', team: 'opponent', ...at(m, s), meta: { ownGoal: false }, ...extra });
  it('20s ainda conta (com o jogador); 21s já não', () => {
    const r = MatchStats.costlyLosses([loss(30), conceded(30, 20)], match());
    eq([r.total, r.items[0].seconds, r.items[0].playerId], [1, 20, 'A']);
    eq(MatchStats.costlyLosses([loss(40), conceded(40, 21)], match()).total, 0);
  });
  it('remate do adversário marcado golo também conta', () => {
    eq(MatchStats.costlyLosses([loss(30), occ({ source: 'remate', team: 'opponent', ...at(30, 12), meta: { result: 'goal' } })], match()).total, 1);
  });
  it('não conta autogolos, golos nossos, nem outra parte', () => {
    eq(MatchStats.costlyLosses([loss(30), conceded(30, 5, { meta: { ownGoal: true } })], match()).total, 0);
    eq(MatchStats.costlyLosses([loss(30), conceded(30, 5, { team: 'own' })], match()).total, 0);
    eq(MatchStats.costlyLosses([loss(45), conceded(45, 5, { period: '2T' })], match()).total, 0);
  });
});

describe('MatchStats.lossZonesByPlayer — onde se perde a bola', () => {
  it('por jogador e por terço; anónimas e recuperações ficam de fora', () => {
    const p = (id, y, source = 'perda') => occ({ source, meta: { ownPlayerId: id, location: { x: 0.5, y } } });
    eq(MatchStats.lossZonesByPlayer([p('A', 0.8), p('A', 0.5), p('B', 0.2), p(null, 0.5), p('A', 0.5, 'recuperacao')]), [
      { playerId: 'A', def: 1, mid: 1, att: 0, total: 2 },
      { playerId: 'B', def: 0, mid: 0, att: 1, total: 1 },
    ]);
  });
});

describe('MatchStats.scoutingCheck — o que o scouting previa', () => {
  it('sem eventos vindos do scouting', () => {
    eq(MatchStats.scoutingCheck(match(), []), { total: 0, confirmed: [], unseen: [] });
  });
  it('confirmados por contagem, não vistos à parte, eventos normais ignorados', () => {
    const m = match({ observationPlan: [
      { id: 'pe1', name: 'Cantos 2º poste', scoutingRef: { list: 'threats', itemId: 's1' } },
      { id: 'pe2', name: 'Lateral sobe', scoutingRef: { list: 'weaknesses', itemId: 's2' } },
      { id: 'pe3', name: 'Pivot baixa', scoutingRef: { list: 'triggers', itemId: 's3' } },
      { id: 'pe4', name: 'Evento normal' },
    ] });
    const list = [...Array(3)].map(() => occ({ planEventId: 'pe1' }))
      .concat([occ({ planEventId: 'pe3' })], [...Array(5)].map(() => occ({ planEventId: 'pe4' })));
    const r = MatchStats.scoutingCheck(m, list);
    eq([r.total, r.confirmed.map((x) => [x.event.id, x.count]), r.unseen.map((x) => x.event.id)], [3, [['pe1', 3], ['pe3', 1]], ['pe2']]);
    eq(r.confirmed[0].list.title, 'Ameaças Principais');
  });
  it('lista desconhecida não rebenta', () => {
    const r = MatchStats.scoutingCheck(match({ observationPlan: [{ id: 'x', name: 'x', scoutingRef: { list: 'inexistente' } }] }), []);
    eq(r.unseen[0].list, null);
  });
});

describe('MatchStats.periodComparison — 1ª parte vs 2ª parte', () => {
  const shot = (period, extra = {}) => occ({ source: 'remate', period, meta: { result: 'wide' }, ...extra });
  it('números por parte, destaques de 3+ e registos fora de jogo', () => {
    const list = [shot('1T'), shot('1T'), occ({ source: 'perda', period: '1T' }),
      ...[...Array(5)].map(() => shot('2T')), ...[...Array(4)].map(() => occ({ source: 'perda', period: '2T' })),
      occ({ source: 'golo', period: '2T' }), occ({ source: 'nota', period: 'HT' })];
    const pc = MatchStats.periodComparison(match({ score: { team: 1, opponent: 0 } }), list);
    const [g1, g2] = pc.groups;
    eq([g1.own.shots, g2.own.shots, g1.own.goals, g2.own.goals, g1.own.perdas, g2.own.perdas], [2, 5, 0, 1, 1, 4]);
    eq([pc.comparable, pc.outsidePlay, pc.shown.length], [true, 1, 2]);
    eq(pc.goalsCheck.own, { recorded: 1, score: 1 });
    eq(pc.highlights.map((h) => [h.key, h.from, h.to]), [['shots', 2, 5], ['perdas', 1, 4]]);
  });
  it('só com uma parte não há comparação', () => {
    const pc = MatchStats.periodComparison(match(), [shot('1T')]);
    eq([pc.comparable, pc.highlights.length], [false, 0]);
  });
  it('prolongamento junta ET1 e ET2 e só aparece se tiver registos', () => {
    const pc = MatchStats.periodComparison(match(), [shot('1T'), shot('2T'), shot('ET1'), shot('ET2'), shot('ET2')]);
    eq([pc.groups[2].own.shots, pc.shown.length], [3, 3]);
  });
  it('remate marcado golo conta na sua parte; golos que não batem com o resultado ficam ditos', () => {
    const pc = MatchStats.periodComparison(match({ score: { team: 2, opponent: 0 } }),
      [occ({ source: 'golo', period: '1T' }), shot('2T', { meta: { result: 'goal' } })]);
    eq([pc.groups[0].own.goals, pc.groups[1].own.goals], [1, 1]);
    const pc2 = MatchStats.periodComparison(match({ score: { team: 2, opponent: 0 } }), [occ({ source: 'golo', period: '1T' }), shot('2T')]);
    eq(pc2.goalsCheck.own, { recorded: 1, score: 2 });
    ok(MatchStats.periodNotes(pc2, match()).some((n) => n.includes('(1)') && n.includes('(2)')), 'nota da diferença de golos');
  });
  it('as notas não usam símbolos que o PDF apagaria', () => {
    const pc = MatchStats.periodComparison(match({ score: { team: 5, opponent: 0 } }), [shot('1T'), shot('2T'), occ({ period: 'HT' })]);
    MatchStats.periodNotes(pc, match()).forEach((n) => ok(!/[^\x20-\x7E\xA0-\xFF]/.test(n), `símbolo fora do WinAnsi em: ${n}`));
  });
});

// ---------------------------------------------------------------------------
describe('PlayerStats.forMatch — números de um jogador', () => {
  it('golo pelo placar conta ao marcador e a assistência ao assistente', () => {
    const list = [occ({ source: 'golo', meta: { scorerId: 'A', assistId: 'B' } })];
    eq([PlayerStats.forMatch('A', list).goals, PlayerStats.forMatch('B', list).assists], [1, 1]);
  });
  it('remate-golo com assistência: o assistente NÃO ganha remate nem golo', () => {
    const list = [occ({ source: 'remate', playerIds: ['A', 'B'], meta: { result: 'goal', assistId: 'B' } })];
    const a = PlayerStats.forMatch('A', list); const b = PlayerStats.forMatch('B', list);
    eq([a.shots, a.shotsOnTarget, a.goals, a.assists], [1, 1, 1, 0]);
    eq([b.shots, b.goals, b.assists], [0, 0, 1]);
  });
  it('perdas e recuperações são espelho entre os dois jogadores', () => {
    const list = [
      occ({ source: 'perda', playerIds: ['A', 'R'], meta: { ownPlayerId: 'A', oppPlayerId: 'R' } }),
      occ({ source: 'recuperacao', playerIds: ['A', 'R'], meta: { ownPlayerId: 'A', oppPlayerId: 'R' } }),
    ];
    const a = PlayerStats.forMatch('A', list); const r = PlayerStats.forMatch('R', list);
    eq([a.perdas, a.recuperacoes, a.positives, a.negatives], [1, 1, 1, 1]);
    eq([r.perdas, r.recuperacoes], [1, 1]);
  });
  it('faltas cometidas/sofridas e amarelo pela consequência; vermelho pelo registo de cartão', () => {
    const list = [
      occ({ source: 'falta', playerIds: ['A', 'R'], meta: { committedById: 'A', sufferedById: 'R', consequences: ['yellow'] } }),
      occ({ source: 'cartao', playerIds: ['A'], eventName: 'Cartão Vermelho (A)' }),
    ];
    const a = PlayerStats.forMatch('A', list);
    eq([a.foulsCommitted, a.yellow, a.red, PlayerStats.forMatch('R', list).foulsSuffered], [1, 1, 1, 1]);
  });
});

describe('PlayerStats.appearance — minutos jogados', () => {
  const base = () => match({ teams: { own: { teamId: 'T', starterIds: ['A', 'B'], positions: [] }, opponent: {} } });
  it('titular num jogo terminado joga 90', () => {
    eq(PlayerStats.appearance(base(), 'A', 'T', [occ({ minute: 50 })]), { played: true, status: 'starter', minutes: 90 });
  });
  it('entrou aos 70 = 20 minutos; saiu aos 70 = 70 minutos', () => {
    const m = base(); m.substitutions = [{ side: 'own', outId: 'B', inId: 'C', minute: 70 }];
    eq(PlayerStats.appearance(m, 'C', 'T', []), { played: true, status: 'sub', minutes: 20 });
    eq(PlayerStats.appearance(m, 'B', 'T', []).minutes, 70);
  });
  it('expulso aos 30 = 30 minutos', () => {
    const m = base(); m.cards = [{ playerId: 'A', color: 'red', minute: 30 }];
    eq(PlayerStats.appearance(m, 'A', 'T', []).minutes, 30);
  });
  it('quem não entrou não jogou', () => {
    eq(PlayerStats.appearance(base(), 'D', 'T', []), { played: false, status: null, minutes: 0 });
  });
});

describe('LineupState.compute — quem está em campo', () => {
  it('aplica as substituições só do seu lado', () => {
    const m = match({
      teams: { own: { positions: [{ playerId: 'p1' }, { playerId: 'p2' }, { playerId: 'p3' }], subIds: ['p4', 'p5'] }, opponent: {} },
      substitutions: [{ side: 'own', outId: 'p2', inId: 'p4' }, { side: 'opponent', outId: 'p1', inId: 'p9' }],
    });
    const st = LineupState.compute(m, 'own');
    eq([st.onFieldIds, st.benchIds, st.subbedOffIds], [new Set(['p1', 'p3', 'p4']), new Set(['p5']), new Set(['p2'])]);
    eq([st.statusByPlayerId.get('p4'), st.statusByPlayerId.get('p2'), st.statusByPlayerId.get('p1'), st.positions[1].playerId],
      ['sub_in', 'subbed_off', 'starter', 'p4']);
  });
});

// ---------------------------------------------------------------------------
describe('MatchEffects — desfazer/apagar reverte o que o registo mexeu no jogo', () => {
  it('scoreKeyOf', () => {
    eq(MatchEffects.scoreKeyOf(occ({ source: 'golo', team: 'own' })), 'team');
    eq(MatchEffects.scoreKeyOf(occ({ source: 'remate', team: 'opponent', meta: { result: 'goal' } })), 'opponent');
    eq(MatchEffects.scoreKeyOf(occ({ source: 'remate', meta: { result: 'save' } })), null);
    eq(MatchEffects.scoreKeyOf(occ({ source: 'golo', team: null })), null);
  });
  it('apagar um golo desce o placar, sem nunca ficar negativo', () => {
    const m = match({ score: { team: 2, opponent: 1 } });
    eq(MatchEffects.reverse(m, occ({ source: 'golo', team: 'own' })).score, 'team');
    eq(m.score, { team: 1, opponent: 1 });
    const z = match({ score: { team: 0, opponent: 0 } });
    MatchEffects.reverse(z, occ({ source: 'golo', team: 'own' }));
    eq(z.score.team, 0);
  });
  it('apagar um remate-golo do adversário desce o placar dele; um remate defendido não mexe', () => {
    const m = match({ score: { team: 0, opponent: 2 } });
    MatchEffects.reverse(m, occ({ source: 'remate', team: 'opponent', meta: { result: 'goal' } }));
    MatchEffects.reverse(m, occ({ source: 'remate', team: 'opponent', meta: { result: 'save' } }));
    eq(m.score, { team: 0, opponent: 1 });
  });
  it('cartão da falta: gravar duas vezes não duplica; mudar para vermelho atualiza; tirar remove', () => {
    const m = match({ cards: [{ id: 'k0', playerId: 'Z', color: 'yellow' }] });
    const f = occ({ id: 'f1', source: 'falta', minute: 20, meta: { consequences: ['yellow'], committedById: 'A' } });
    MatchEffects.syncFoulCards(m, f, 'A');
    MatchEffects.syncFoulCards(m, f, 'A');
    eq(m.cards.filter((c) => c.fromFoulId === 'f1').length, 1, 'duplicado');
    f.meta.consequences = ['red'];
    MatchEffects.syncFoulCards(m, f, 'A');
    eq(m.cards.find((c) => c.fromFoulId === 'f1').color, 'red');
    f.meta.consequences = ['freeKick'];
    MatchEffects.syncFoulCards(m, f, 'A');
    eq(m.cards.map((c) => c.id), ['k0'], 'o cartão de outra origem fica');
  });
  it('falta com amarelo mas sem quem cometeu não cria cartão', () => {
    const m = match();
    MatchEffects.syncFoulCards(m, occ({ source: 'falta', meta: { consequences: ['yellow'] } }));
    eq(m.cards, []);
  });
  it('apagar a falta retira só o cartão dela', () => {
    const m = match({ cards: [{ id: 'k0', playerId: 'Z' }, { id: 'k1', playerId: 'A', fromFoulId: 'f1' }] });
    eq(MatchEffects.reverse(m, occ({ id: 'f1', source: 'falta' })).cardsRemoved, 1);
    eq(m.cards.map((c) => c.id), ['k0']);
  });
  it('apagar um registo de cartão nunca leva o cartão de uma falta, mesmo que seja o último', () => {
    const m = match({ cards: [
      { id: 'x2', playerId: 'A', color: 'yellow', minute: 35 },
      { id: 'x1', playerId: 'A', color: 'yellow', minute: 20, fromFoulId: 'f9' },
    ] });
    MatchEffects.reverse(m, occ({ source: 'cartao', eventName: 'Cartão Amarelo (A)', playerIds: ['A'], minute: 35 }));
    eq(m.cards.map((c) => c.id), ['x1']);
  });
  it('cartão: respeita a cor e prefere o do mesmo minuto', () => {
    const m = match({ cards: [{ id: 'y', playerId: 'A', color: 'yellow', minute: 10 }, { id: 'r', playerId: 'A', color: 'red', minute: 60 }] });
    MatchEffects.reverse(m, occ({ source: 'cartao', eventName: 'Cartão Amarelo (A)', playerIds: ['A'], minute: 10 }));
    eq(m.cards.map((c) => c.id), ['r']);
    const m2 = match({ cards: [{ id: 'a', playerId: 'A', color: 'yellow', minute: 10 }, { id: 'b', playerId: 'A', color: 'yellow', minute: 40 }] });
    MatchEffects.reverse(m2, occ({ source: 'cartao', eventName: 'Cartão Amarelo (A)', playerIds: ['A'], minute: 10 }));
    eq(m2.cards.map((c) => c.id), ['b']);
  });
  it('apagar a substituição devolve o jogador ao campo', () => {
    const m = match({
      teams: { own: { positions: [{ playerId: 'p1' }, { playerId: 'p2' }], subIds: ['p3'] }, opponent: {} },
      substitutions: [{ side: 'own', outId: 'p2', inId: 'p3', minute: 60 }],
    });
    eq(MatchEffects.reverse(m, occ({ source: 'substituicao', playerIds: ['p2', 'p3'] })).substitutionRemoved, true);
    const st = LineupState.compute(m, 'own');
    eq([st.onFieldIds.has('p2'), st.onFieldIds.has('p3')], [true, false]);
  });
  it('describe diz o que muda (e nada para registos sem efeito)', () => {
    ok(MatchEffects.describe(occ({ source: 'golo', team: 'own' })).includes('resultado'));
    ok(MatchEffects.describe(occ({ source: 'substituicao' })).includes('substituição'));
    eq(MatchEffects.describe(occ({ source: 'perda' })), '');
  });
});

// ---------------------------------------------------------------------------
describe('DataSafety.backupReminder — quando lembrar o backup', () => {
  const DAY = DataSafety.DAY_MS;
  const now = Date.UTC(2026, 8, 14, 12);
  const m = (updatedAt) => ({ id: 'm' + updatedAt, updatedAt });
  // Esqueleto que as migrações criam em todas as equipas no primeiro arranque.
  const skeleton = () => ({ strengths: [], weaknesses: [], threats: [], opportunities: [], triggers: [],
    keyPlayers: [], checklist: null, notes: [], setPieces: [], blocks: {}, _legacyNotesImported: true });
  it('instalação nova: a nossa equipa com o esqueleto de scouting vazio NÃO dispara o aviso', () => {
    eq(DataSafety.backupReminder({ matches: [], teams: [{ id: 't', isOwnTeam: true, scouting: skeleton() }], now }), null);
    eq(DataSafety.backupReminder({ matches: [], teams: [{ id: 't' }, { id: 'u', scouting: {} }], now }), null);
  });
  it('hasScoutingContent: texto ou lista com elementos, em qualquer nível', () => {
    eq(DataSafety.hasScoutingContent(skeleton()), false);
    eq(DataSafety.hasScoutingContent({ ...skeleton(), weaknesses: [{ id: 'w' }] }), true);
    eq(DataSafety.hasScoutingContent({ ...skeleton(), blocks: { model: [] } }), false);
    eq(DataSafety.hasScoutingContent({ ...skeleton(), blocks: { model: [{ text: 'x' }] } }), true);
    eq(DataSafety.hasScoutingContent({ formationMain: '   ' }), false);
    eq(DataSafety.hasScoutingContent({ formationMain: '4-3-3' }), true);
  });
  it('nunca fez backup: lembra (com jogos, ou só com scouting preenchido)', () => {
    eq(DataSafety.backupReminder({ matches: [m(1)], now }).reason, 'never');
    eq(DataSafety.backupReminder({ matches: [], teams: [{ id: 't', scouting: { ...skeleton(), threats: [{ id: 'x' }] } }], now }),
      { reason: 'never', days: null, changedMatches: 0, changedTeams: 1 });
  });
  it('"mais tarde" cala o aviso até ao fim do adiamento', () => {
    eq(DataSafety.backupReminder({ matches: [m(1)], snoozeUntil: now + DAY, now }), null);
  });
  it('backup há 2 dias: 1 jogo alterado não lembra; 3 jogos lembram', () => {
    const last = now - 2 * DAY;
    eq(DataSafety.backupReminder({ lastBackupAt: last, matches: [m(now - DAY)], now }), null);
    eq(DataSafety.backupReminder({ lastBackupAt: last, matches: [m(now - 1), m(now - 2), m(now - 3)], now }),
      { reason: 'many', days: 2, changedMatches: 3, changedTeams: 0 });
  });
  it('backup há 8 dias: lembra se houve alterações (jogos ou scouting), senão não', () => {
    const last = now - 8 * DAY;
    eq(DataSafety.backupReminder({ lastBackupAt: last, matches: [m(now - DAY)], now }).reason, 'stale');
    eq(DataSafety.backupReminder({ lastBackupAt: last, matches: [m(last - DAY)], now }), null);
    eq(DataSafety.backupReminder({ lastBackupAt: last, matches: [m(last - DAY)], teams: [{ id: 't', updatedAt: now - DAY }], now }).changedTeams, 1);
  });
  it('textos', () => {
    eq([DataSafety.relativeDays(now, now), DataSafety.relativeDays(now - DAY, now), DataSafety.relativeDays(now - 5 * DAY, now)], ['hoje', 'ontem', 'há 5 dias']);
    eq([DataSafety.formatBytes(512), DataSafety.formatBytes(2048), DataSafety.formatBytes(5 * 1048576)], ['512 B', '2 KB', '5,0 MB']);
    ok(DataSafety.reminderText({ reason: 'never' }).title.includes('nenhum backup'));
    eq(DataSafety.reminderText({ reason: 'stale', days: 8, changedMatches: 1, changedTeams: 0 }).detail, '1 jogo alterado desde então — ainda não está em nenhum backup.');
  });
});

// ---------------------------------------------------------------------------
describe('SeasonTrends — evolução jogo a jogo', () => {
  const entry = (m, occs = []) => ({ match: m, occurrences: occs });
  const mk = (id, date, own, opp, score) => match({
    id, date, team: 'Nós', opponent: 'Rivais', score,
    teams: { own: { teamId: own, starterIds: ['A'], positions: [] }, opponent: { teamId: opp, starterIds: ['R'], positions: [] } },
  });
  it('lado da equipa em cada jogo', () => {
    const m = mk('m1', '2026-01-01', 'T', 'X', { team: 1, opponent: 0 });
    eq([SeasonTrends.sideOf(m, 'T'), SeasonTrends.sideOf(m, 'X'), SeasonTrends.sideOf(m, 'Z')], ['own', 'opponent', null]);
  });
  it('equipa: golos pelo placar; perdas/recuperações espelhadas quando é o adversário', () => {
    const occs = [occ({ source: 'perda' }), occ({ source: 'perda' }), occ({ source: 'recuperacao' }),
      occ({ source: 'remate', team: 'opponent', meta: { result: 'wide' } })];
    const m = mk('m1', '2026-01-01', 'T', 'X', { team: 2, opponent: 1 });
    const [nos] = SeasonTrends.teamSeries('T', [entry(m, occs)]);
    const [eles] = SeasonTrends.teamSeries('X', [entry(m, occs)]);
    eq([nos.goalsFor, nos.goalsAgainst, nos.perdas, nos.recuperacoes, nos.shots, nos.opponentName], [2, 1, 2, 1, 0, 'Rivais']);
    eq([eles.goalsFor, eles.goalsAgainst, eles.perdas, eles.recuperacoes, eles.shots, eles.opponentName], [1, 2, 1, 2, 1, 'Nós']);
  });
  it('jogador: jogo em que não jogou é null (linha interrompida), nunca 0', () => {
    const m1 = mk('m1', '2026-01-01', 'T', 'X', { team: 0, opponent: 0 });
    const m2 = mk('m2', '2026-01-08', 'T', 'X', { team: 0, opponent: 0 });
    m2.teams.own.starterIds = ['B'];
    const s = SeasonTrends.playerSeries('A', 'T', [entry(m1, [occ({ source: 'remate', playerIds: ['A'], meta: { result: 'wide' } })]), entry(m2)], 'shots');
    eq(s.map((p) => p.value), [1, null]);
  });
  it('minutos exigem presença no onze; nas outras métricas basta participação registada', () => {
    const m = mk('m1', '2026-01-01', 'T', 'X', { team: 0, opponent: 0 });
    m.teams.own.starterIds = [];
    const occs = [occ({ source: 'golo', meta: { scorerId: 'A' } })];
    eq(SeasonTrends.playerSeries('A', 'T', [entry(m, occs)], 'minutes')[0].value, null);
    eq(SeasonTrends.playerSeries('A', 'T', [entry(m, occs)], 'goals')[0].value, 1);
  });
  it('últimos 3 vs anteriores: só com 5+ jogos jogados, sem contar os que não jogou', () => {
    const pts = (vals) => vals.map((value) => ({ value }));
    eq(SeasonTrends.recentVsBefore(pts([1, 2, null, 3, null])), null);
    eq(SeasonTrends.recentVsBefore(pts([0, 1, null, 3, 3, 3])), { recentAvg: 3, beforeAvg: 0.5, delta: 2.5, recentN: 3, beforeN: 2 });
  });
  it('escala com topo "redondo"', () => {
    eq([0, 1, 7, 90, 95, 640].map((n) => SeasonTrends.niceMax(n)), [1, 1, 8, 90, 100, 700]);
  });
});

// ---------------------------------------------------------------------------
describe('PlayerReport.buildSheet — ficha individual', () => {
  const entry = (m, occs = []) => ({ match: m, occurrences: occs });
  const game = (i, starters = ['A']) => match({
    id: 'g' + i, date: `2026-01-${String(i).padStart(2, '0')}`, team: 'Nós', opponent: 'Adv' + i,
    teams: { own: { teamId: 'T', starterIds: starters, positions: [] }, opponent: { teamId: 'X' } },
  });
  const P = { id: 'A', name: 'Jogador A', number: 9, position: 'PL' };
  it('totais, por 90 e tabela limitada aos 12 jogos mais recentes', () => {
    const entries = [...Array(14)].map((_, i) => entry(game(i + 1), [occ({ source: 'remate', playerIds: ['A'], meta: { result: 'wide' } })]));
    const s = PlayerReport.buildSheet({ player: P, teamId: 'T', entries });
    eq([s.totals.apps, s.totals.minutes, s.totals.shots, s.per90.shots], [14, 1260, 14, 1]);
    eq([s.rows.length, s.rowsOmitted, s.rows[0].matchId, s.scope.matches, s.rows[0].opponentName], [12, 2, 'g14', 14, 'Adv14']);
  });
  it('no plantel adversário, o adversário de cada jogo somos nós', () => {
    const m = match({ id: 'o1', date: '2026-02-01', team: 'Nós', opponent: 'Eles',
      teams: { own: { teamId: 'X' }, opponent: { teamId: 'T', starterIds: ['A'], positions: [] } } });
    eq(PlayerReport.buildSheet({ player: P, teamId: 'T', entries: [entry(m)] }).rows[0].opponentName, 'Nós');
  });
  it('por 90 só com 45 minutos ou mais', () => {
    const m = game(1, []);
    m.substitutions = [{ side: 'own', outId: 'Z', inId: 'A', minute: 60 }];
    const s = PlayerReport.buildSheet({ player: P, teamId: 'T', entries: [entry(m)] });
    eq([s.totals.minutes, s.per90.goals], [30, null]);
  });
  it('momentos e notas: só os deste jogador, mais recentes primeiro; nota vazia fica de fora', () => {
    const entries = [
      entry(game(1), [occ({ source: 'momento', playerIds: ['A'], note: 'Boa pressão', minute: 12 }), occ({ source: 'nota', playerIds: ['B'], note: 'De outro' })]),
      entry(game(2), [occ({ source: 'momento', playerIds: ['A'], note: '', minute: 30 }), occ({ source: 'nota', playerIds: ['A'], note: '   ' })]),
    ];
    const s = PlayerReport.buildSheet({ player: P, teamId: 'T', entries });
    eq(s.highlights.map((h) => [h.kind, h.text, h.opponent]), [['Momento', 'Momento marcado (sem nota)', 'Adv2'], ['Momento', 'Boa pressão', 'Adv1']]);
  });
  it('evolução na métrica pedida, com null onde não jogou', () => {
    const s = PlayerReport.buildSheet({ player: P, teamId: 'T', entries: [entry(game(1)), entry(game(2, ['B']))], metricKey: 'minutes' });
    eq([s.trend.key, s.trend.unit, s.trend.points.map((p) => p.value)], ['minutes', "'", [90, null]]);
  });
});

// ---------------------------------------------------------------------------
describe('MatchStats.scoutingTrackRecord — o scouting a aprender com os jogos', () => {
  const plan = (...ids) => ids.map((id, i) => ({ id: `pe${i}${id}`, name: id, scoutingRef: { list: 'threats', itemId: id } }));
  const game = (id, date, status, planEvents) => match({ id, date, status, observationPlan: planEvents });
  it('conta jogos observados e confirmados por item, só em jogos terminados', () => {
    const p1 = plan('s1', 's2');
    const p2 = plan('s1');
    const p3 = plan('s1', 's2');
    const tr = MatchStats.scoutingTrackRecord([
      { match: game('g1', '2026-01-01', 'finished', p1), occurrences: [occ({ planEventId: p1[0].id }), occ({ planEventId: p1[0].id })] },
      { match: game('g2', '2026-02-01', 'finished', p2), occurrences: [] },
      { match: game('g3', '2026-03-01', 'draft', p3), occurrences: [occ({ planEventId: p3[1].id })] },
    ]);
    eq(tr.get('s1'), { tracked: 2, confirmed: 1, occurrences: 2, lastConfirmedDate: '2026-01-01' });
    eq(tr.get('s2'), { tracked: 1, confirmed: 0, occurrences: 0, lastConfirmedDate: null });
  });
  it('o mesmo item importado duas vezes no mesmo plano conta um só jogo', () => {
    const pe = [{ id: 'a', name: 'x', scoutingRef: { list: 'threats', itemId: 's1' } }, { id: 'b', name: 'x', scoutingRef: { list: 'threats', itemId: 's1' } }];
    const tr = MatchStats.scoutingTrackRecord([{ match: game('g1', '2026-01-01', 'finished', pe), occurrences: [occ({ planEventId: 'a' }), occ({ planEventId: 'b' })] }]);
    eq(tr.get('s1'), { tracked: 1, confirmed: 1, occurrences: 2, lastConfirmedDate: '2026-01-01' });
  });
  it('frase curta, com singular e plural', () => {
    eq([
      MatchStats.trackRecordLabel(null),
      MatchStats.trackRecordLabel({ tracked: 1, confirmed: 1 }),
      MatchStats.trackRecordLabel({ tracked: 4, confirmed: 3 }),
      MatchStats.trackRecordLabel({ tracked: 2, confirmed: 0 }),
    ], ['', 'Confirmado em 1 de 1 jogo', 'Confirmado em 3 de 4 jogos', 'Observado em 2 jogos, nunca confirmado']);
  });
});

// ---------------------------------------------------------------------------
describe('Grandes oportunidades criadas — o passe que dá o remate', () => {
  const shot = (extra = {}) => occ({ source: 'remate', ...extra });
  it('passerOf: passe novo, e a assistência antiga de um golo continua a contar', () => {
    eq(MatchStats.passerOf(shot({ meta: { result: 'wide', passerId: 'B' } })), 'B');
    eq(MatchStats.passerOf(shot({ meta: { result: 'goal', assistId: 'B' } })), 'B', 'dados antigos');
    eq(MatchStats.passerOf(shot({ meta: { result: 'wide', assistId: 'B' } })), null, 'assistência só existia em golos');
    eq(MatchStats.passerOf(shot({ meta: { result: 'wide' } })), null);
    eq(MatchStats.passerOf(occ({ source: 'canto', meta: { passerId: 'B' } })), null);
  });
  it('shotAssistOf: só num remate marcado golo', () => {
    eq(MatchStats.shotAssistOf(shot({ meta: { result: 'goal', passerId: 'B' } })), 'B');
    eq(MatchStats.shotAssistOf(shot({ meta: { result: 'save', passerId: 'B' } })), null);
  });
  it('equipa: cada passe conta uma oportunidade criada; só o golo conta assistência', () => {
    const s = MatchStats.compute(match(), [
      shot({ meta: { result: 'wide', passerId: 'B' } }),
      shot({ meta: { result: 'save', passerId: 'C' } }),
      shot({ meta: { result: 'goal', passerId: 'B' } }),
      shot({ meta: { result: 'wide' } }),
    ]);
    eq([s.own.chancesCreated, s.own.assists, s.own.shots], [3, 1, 4]);
  });
  it('jogador: quem passa soma oportunidade criada e NÃO soma remate; no golo soma também assistência', () => {
    const list = [
      shot({ playerIds: ['A', 'B'], meta: { result: 'wide', passerId: 'B' } }),
      shot({ playerIds: ['A', 'B'], meta: { result: 'goal', passerId: 'B', assistId: 'B' } }),
    ];
    const a = PlayerStats.forMatch('A', list);
    const b = PlayerStats.forMatch('B', list);
    eq([a.shots, a.goals, a.chancesCreated, a.assists], [2, 1, 0, 0]);
    eq([b.shots, b.goals, b.chancesCreated, b.assists], [0, 0, 2, 1]);
  });
  it('jogos antigos: a assistência de um remate-golo conta como oportunidade criada', () => {
    const list = [shot({ playerIds: ['A', 'B'], meta: { result: 'goal', assistId: 'B' } })];
    const b = PlayerStats.forMatch('B', list);
    eq([b.chancesCreated, b.assists, b.shots], [1, 1, 0]);
  });
});

// ---------------------------------------------------------------------------
describe('Leitura de vários jogos — época, recorrências e resumo em texto', () => {
  const g = (id, date, status, score, extra = {}) => match({
    id, date, status, score, team: 'Nós', opponent: 'Adv' + id,
    teams: { own: { teamId: 'T' }, opponent: { teamId: 'X' + id } }, ...extra,
  });
  it('resumo da época: só jogos terminados, com forma por ordem cronológica', () => {
    const s = MatchStats.seasonSummary('T', [
      { match: g('1', '2026-01-01', 'finished', { team: 2, opponent: 0 }) },
      { match: g('2', '2026-01-08', 'finished', { team: 1, opponent: 1 }) },
      { match: g('3', '2026-01-15', 'finished', { team: 0, opponent: 3 }) },
      { match: g('4', '2026-01-22', 'draft', { team: 5, opponent: 0 }) },
    ]);
    eq([s.played, s.wins, s.draws, s.losses, s.goalsFor, s.goalsAgainst], [3, 1, 1, 1, 3, 4]);
    eq(s.form.map((f) => f.result), ['V', 'E', 'D']);
  });
  it('resumo da época conta do lado certo quando somos o adversário', () => {
    const m = g('1', '2026-01-01', 'finished', { team: 0, opponent: 2 });
    eq(MatchStats.seasonSummary('X1', [{ match: m }]).wins, 1);
  });
  it('recorrentes: agrupa pelo evento da biblioteca e conta jogos, não ocorrências', () => {
    const plan = (libraryId, name, id) => ({ id, libraryId, name, type: 'negative' });
    const m1 = g('1', '2026-01-01', 'finished', { team: 0, opponent: 0 }, { observationPlan: [plan('lib1', 'Perda de marcação', 'a1'), plan('lib2', 'Fora de jogo', 'b1')] });
    const m2 = g('2', '2026-01-08', 'finished', { team: 0, opponent: 0 }, { observationPlan: [plan('lib1', 'Perda de marcação', 'a2')] });
    const r = MatchStats.recurringPlanEvents([
      { match: m1, occurrences: [occ({ planEventId: 'a1' }), occ({ planEventId: 'a1' }), occ({ planEventId: 'b1' })] },
      { match: m2, occurrences: [occ({ planEventId: 'a2' })] },
    ]);
    eq(r.map((x) => [x.name, x.planned, x.happened, x.total, x.lastDate]), [['Perda de marcação', 2, 2, 3, '2026-01-08']]);
  });
  it('recorrentes: eventos feitos à mão agrupam pelo nome', () => {
    const mk = (id, date, peId) => g(id, date, 'finished', { team: 0, opponent: 0 }, { observationPlan: [{ id: peId, name: 'Saída curta pressionada', type: 'neutral' }] });
    const r = MatchStats.recurringPlanEvents([
      { match: mk('1', '2026-01-01', 'x1'), occurrences: [occ({ planEventId: 'x1' })] },
      { match: mk('2', '2026-01-08', 'x2'), occurrences: [occ({ planEventId: 'x2' })] },
    ]);
    eq([r.length, r[0].happened], [1, 2]);
  });
  it('resumo em texto inclui as mudanças táticas, com o lado', () => {
    const m = match({ team: 'Nós', opponent: 'Rivais', score: { team: 0, opponent: 0 } });
    const txt = MatchStats.matchSummaryText(m, [
      occ({ source: 'tatica', minute: 60, team: 'own', meta: { formationName: '3-5-2' } }),
      occ({ source: 'tatica', minute: 70, team: 'opponent', meta: { formationName: '4-4-2' } }),
    ]);
    ok(txt.includes("Mudanças táticas: 60' 3-5-2 · 70' 4-4-2 (adversário)"), txt);
  });
  it('resumo em texto: só o que foi registado', () => {
    const m = match({ team: 'Nós', opponent: 'Rivais', competition: 'Liga', date: '2026-01-01', score: { team: 2, opponent: 1 } });
    const txt = MatchStats.matchSummaryText(m, [
      occ({ source: 'remate', meta: { result: 'goal', passerId: 'B' } }),
      occ({ source: 'remate', meta: { result: 'wide' } }),
      occ({ source: 'momento', minute: 23, note: 'Boa pressão' }),
    ]);
    ok(txt.startsWith('Nós 2 - 1 Rivais · Liga · 01/01/2026'), txt);
    ok(txt.includes('Remates 2-0'), txt);
    ok(txt.includes('Oport. criadas 1-0'), txt);
    ok(txt.includes("23' Boa pressão"), txt);
    ok(!txt.includes('Padrões:'), 'sem padrões quando não há dados');
  });
});

// ---------------------------------------------------------------------------
describe('VideoSync — levar os focos para o tempo do vídeo', () => {
  const plan = [{ id: 'pe1', name: 'Cantos ao 2º poste', isFocus: true }, { id: 'pe2', name: 'Saída curta', isFocus: false }];
  const m = () => match({ team: 'Nós', opponent: 'Rivais', date: '2026-01-01', observationPlan: plan });
  // Dois registos do mesmo foco: 5 minutos reais separam-nos.
  const t0 = 1700000000000;
  const list = [
    occ({ id: 'o1', planEventId: 'pe1', eventName: 'Cantos ao 2º poste', period: '1T', minute: 12, second: 30, timestamp: t0, playerIds: ['A'] }),
    occ({ id: 'o2', planEventId: 'pe1', eventName: 'Cantos ao 2º poste', period: '1T', minute: 20, second: 0, timestamp: t0 + 300000, note: 'ao primeiro poste' }),
    occ({ id: 'o3', planEventId: 'pe2', eventName: 'Saída curta', period: '1T', minute: 25, second: 0, timestamp: t0 + 600000 }),
    occ({ id: 'o4', planEventId: 'pe1', eventName: 'Cantos ao 2º poste', period: '2T', minute: 60, second: 0, timestamp: t0 + 3600000 }),
  ];
  it('lê e escreve tempos', () => {
    eq([VideoSync.parseTime('23:15'), VideoSync.parseTime('1:02:03'), VideoSync.parseTime('90'), VideoSync.parseTime('abc'), VideoSync.parseTime('')], [1395, 3723, 90, null, null]);
    eq([VideoSync.formatTime(0), VideoSync.formatTime(95), VideoSync.formatTime(3723)], ['0:00', '1:35', '1:02:03']);
  });
  it('só leva os focos do plano', () => {
    eq(VideoSync.focusOccurrences(m(), list).map((o) => o.id), ['o1', 'o2', 'o4']);
  });
  it('usa o tempo real entre registos, não o relógio do jogo', () => {
    // Âncora: o registo o1 aparece aos 10:00 do vídeo. o2 foi 5 minutos reais depois.
    const r = VideoSync.buildClips({ match: m(), occurrences: list, anchors: { '1T': { occurrenceId: 'o1', videoSeconds: 600 } }, preRoll: 8, postRoll: 5, nameOf: () => 'J9' });
    eq(r.clips.map((c) => [c.id, Math.round(c.videoSeconds)]), [['o1', 600], ['o2', 900]]);
    eq([r.clips[0].start, r.clips[0].end], [592, 605]);
    eq(r.missing.map((x) => x.id), ['o4'], 'a 2ª parte não tem âncora');
  });
  it('cada parte tem a sua âncora (vídeo cortado ao intervalo)', () => {
    const r = VideoSync.buildClips({ match: m(), occurrences: list, anchors: { '1T': { occurrenceId: 'o1', videoSeconds: 600 }, '2T': { occurrenceId: 'o4', videoSeconds: 120 } } });
    eq(r.clips.map((c) => [c.id, Math.round(c.videoSeconds)]), [['o4', 120], ['o1', 600], ['o2', 900]]);
    eq(r.missing.length, 0);
  });
  it('nunca gera tempos negativos', () => {
    const r = VideoSync.buildClips({ match: m(), occurrences: list, anchors: { '1T': { occurrenceId: 'o1', videoSeconds: 3 } }, preRoll: 10 });
    eq(r.clips[0].start, 0);
  });
  it('escolher fontes: focos, golos, remates, momentos — sem repetidos', () => {
    const extra = [
      occ({ id: 'g1', source: 'remate', period: '1T', minute: 30, timestamp: t0 + 1000, meta: { result: 'goal', passerId: 'B' } }),
      occ({ id: 'm1', source: 'momento', period: '1T', minute: 35, timestamp: t0 + 2000 }),
      occ({ id: 'x1', source: 'canto', period: '1T', minute: 40, timestamp: t0 + 3000 }),
    ];
    const all = [...list, ...extra];
    eq(VideoSync.selectOccurrences(m(), all, ['focos']).map((o) => o.id), ['o1', 'o2', 'o4']);
    eq(VideoSync.selectOccurrences(m(), all, ['momentos']).map((o) => o.id), ['m1']);
    // "Golos" e "Remates" juntos não duplicam o mesmo remate-golo.
    eq(VideoSync.selectOccurrences(m(), all, ['golos', 'remates']).map((o) => o.id), ['g1']);
    eq(VideoSync.selectOccurrences(m(), all, []).map((o) => o.id), ['o1', 'o2', 'o4'], 'sem escolha, os focos');
  });
  it('filtrar por jogador apanha quem está tagged e os papéis do detalhe', () => {
    const shot = occ({ id: 'g1', source: 'remate', period: '1T', minute: 30, timestamp: t0 + 1000, playerIds: ['A'], meta: { result: 'goal', passerId: 'B' } });
    const all = [...list, shot];
    const ids = (playerId) => VideoSync.buildClips({ match: m(), occurrences: all, anchors: { '1T': { occurrenceId: 'o1', videoSeconds: 600 } }, sources: ['focos', 'golos'], playerId }).clips.map((c) => c.id);
    eq(ids('A'), ['o1', 'g1'], 'tagged no foco e rematador');
    eq(ids('B'), ['g1'], 'só como passador');
    eq(ids(null).length, 3, 'sem filtro');
  });
  it('CSV e XML saem com o conteúdo certo e com escape', () => {
    const r = VideoSync.buildClips({ match: m(), occurrences: list, anchors: { '1T': { occurrenceId: 'o1', videoSeconds: 600 } }, nameOf: () => 'J9 & cia' });
    const csv = VideoSync.toCSV(r.clips);
    ok(csv.split('\n')[0].startsWith('Tempo video;'), csv);
    ok(csv.includes('10:00'), csv);
    const xml = VideoSync.toXML(r.clips, m());
    ok(xml.includes('<code>Cantos ao 2º poste</code>'), xml);
    ok(xml.includes('J9 &amp; cia'), 'escape do &');
    ok(xml.includes('<start>592.0</start>'), xml);
    ok(VideoSync.toText(r.clips, m()).includes("10:00  Cantos ao 2º poste"), 'texto');
  });
});

// ---------------------------------------------------------------------------
describe('MatchStats.patternHighlights — padrões em versão curta (banco)', () => {
  const nameOf = (id) => ({ A: 'J6', B: 'J2' }[id] || null);
  it('sem registos não inventa linhas', () => {
    eq(MatchStats.patternHighlights([], match()).length, 0);
  });
  it('cantos: eficácia sobre o total e golos no detalhe', () => {
    const corner = occ({ id: 'c1', source: 'canto', team: 'own' });
    const corner2 = occ({ id: 'c2', source: 'canto', team: 'own' });
    const shot = occ({ source: 'remate', team: 'own', meta: { fromCornerId: 'c1', result: 'goal' } });
    const rows = MatchStats.patternHighlights([corner, corner2, shot], match());
    const c = rows.find((r) => r.label === 'Cantos a favor');
    eq([c.value, c.detail], ['1/2', '50% com remate · 1 golo']);
  });
  it('livres contam só a zona de remate (nem todo o livre tem remate)', () => {
    // Falta do adversário no nosso terço ofensivo -> livre nosso em zona de remate.
    const perto = occ({ source: 'falta', team: 'opponent', meta: { consequences: ['freeKick'], location: { x: 0.5, y: 0.2 } } });
    const meioCampo = occ({ source: 'falta', team: 'opponent', meta: { consequences: ['freeKick'], location: { x: 0.5, y: 0.5 } } });
    const rows = MatchStats.patternHighlights([perto, meioCampo], match());
    const fk = rows.find((r) => r.label === 'Livres a favor');
    eq(fk.value, '0/1', 'o recomeço a meio-campo não entra no denominador');
  });
  it('transição, perdas caras e zona de perda', () => {
    const rec = occ({ source: 'recuperacao', team: 'own', minute: 10, second: 0, meta: { location: { x: 0.5, y: 0.5 } } });
    const shot = occ({ source: 'remate', team: 'own', minute: 10, second: 12 });
    const perda = occ({ source: 'perda', team: 'own', minute: 20, second: 0, meta: { location: { x: 0.5, y: 0.9 }, ownPlayerId: 'A' } });
    const golo = occ({ source: 'golo', team: 'opponent', minute: 20, second: 10 });
    const rows = MatchStats.patternHighlights([rec, shot, perda, golo], match(), nameOf);
    const t = rows.find((r) => r.label === 'Recuperações com remate');
    eq([t.value, t.detail], ['1/1', '100% · 12s até rematar']);
    const cl = rows.find((r) => r.label === 'Perdas que deram golo');
    eq([cl.value, cl.detail, cl.tone], ['1', 'J6', 'bad']);
    const z = rows.find((r) => r.label === 'Onde se perde mais');
    eq([z.value, z.detail], ['1/1', 'terço defensivo · 100% das perdas']);
  });
});

describe('PlayerGrid — grelha de camisolas', () => {
  const players = [
    { id: 'a', number: 9, shortName: 'J9', name: 'Jogador 9', _onField: true },
    { id: 'b', number: 7, shortName: 'J7', name: 'Jogador 7', _onField: true, _status: 'sub_in' },
    { id: 'c', number: 14, shortName: 'J14', name: 'Jogador 14', _onField: false },
  ];
  it('desenha uma célula por jogador, mais a de "n/d"', () => {
    const h = PlayerGrid.html({ id: 'g', players });
    eq((h.match(/class="pg-cell/g) || []).length, 4);
    ok(h.includes('data-pid="a"') && h.includes('data-pid="b"') && h.includes('data-pid="c"'), h);
    ok(h.includes('pg-unknown'), 'a célula n/d existe');
  });
  it('banco a tracejado e quem entrou marcado', () => {
    const h = PlayerGrid.html({ id: 'g', players });
    ok(/data-pid="c"[\s\S]*?J14/.test(h), 'o banco aparece');
    ok(h.includes('is-bench'), 'classe do banco');
    ok(h.includes('is-sub-in'), 'classe de quem entrou');
  });
  it('marca o escolhido e exclui quem não pode ser escolhido', () => {
    const h = PlayerGrid.html({ id: 'g', players, selectedId: 'b', exclude: ['a'] });
    ok(!h.includes('data-pid="a"'), 'excluído não aparece');
    ok(/data-pid="b"/.test(h) && h.includes('selected'), 'o escolhido fica marcado');
  });
  it('sem jogadores diz o que fazer em vez de ficar vazia', () => {
    const h = PlayerGrid.html({ id: 'g', players: [] });
    ok(h.includes('pg-empty') && h.includes('Equipas'), h);
  });
  it('sem número não parte a célula', () => {
    const h = PlayerGrid.html({ id: 'g', players: [{ id: 'z', name: 'Sem número' }], unknown: false });
    ok(h.includes('>·<'), h);
    eq((h.match(/class="pg-cell/g) || []).length, 1);
  });
});

// ---------------------------------------------------------------------------
describe('CrashGuard — o diário de falhas que o iPad não tem', () => {
  const guardado = () => { const g = Object.create(CrashGuard); g.entries = []; g.KEY = 'teste_erros'; return g; };
  it('sem falhas diz que não há', () => {
    eq(CrashGuard.toText([]), 'Sem falhas registadas.');
  });
  it('escreve data, hora, sítio e mensagem', () => {
    const t = new Date(2026, 8, 20, 15, 4).getTime();
    const txt = CrashGuard.toText([{ at: t, kind: 'erro', message: 'x is not a function', where: 'live.js:12', hash: '#/live/g1', stack: 'at foo' }]);
    ok(txt.includes('20/09/2026 15:04'), txt);
    ok(txt.includes('live.js:12') && txt.includes('#/live/g1'), txt);
    ok(txt.includes('x is not a function') && txt.includes('at foo'), txt);
  });
  it('guarda no máximo MAX falhas, a mais recente primeiro', () => {
    const g = guardado();
    for (let i = 0; i < CrashGuard.MAX + 5; i++) g.record('erro', 'falha ' + i, '', '', false);
    eq(g.entries.length, CrashGuard.MAX);
    eq(g.entries[0].message, 'falha ' + (CrashGuard.MAX + 4), 'a mais recente fica em primeiro');
  });
  it('corta mensagens e pilhas enormes em vez de encher o armazenamento', () => {
    const g = guardado();
    const e = g.record('erro', 'a'.repeat(5000), 'l1\nl2\nl3\nl4\nl5\nl6', '', false);
    eq(e.message.length, 300);
    eq(e.stack.split('\n').length, 4);
  });
  it('nunca deita a app abaixo, mesmo com lixo à entrada', () => {
    const g = guardado();
    ok(g.record('erro', null, undefined, undefined, false) !== null);
    ok(typeof g.toText(g.entries) === 'string');
  });
});

describe('DB — o que fazer quando a gravação falha', () => {
  const erro = (name) => { const e = new Error('x'); e.name = name; return e; };
  it('distingue o que vale a pena repetir do que não vale', () => {
    eq(DB.isFatalWriteError(erro('QuotaExceededError')), true, 'disco cheio: repetir não resolve');
    eq(DB.isFatalWriteError(erro('InvalidStateError')), true);
    eq(DB.isFatalWriteError(erro('AbortError')), false, 'transação abortada: vale a pena repetir');
    eq(DB.isFatalWriteError(erro('UnknownError')), false);
  });
  it('explica a falha em português, sem jargão', () => {
    ok(DB.writeErrorText(erro('QuotaExceededError')).includes('espaço'), 'fala de espaço');
    ok(DB.writeErrorText(erro('QuotaExceededError')).includes('não foi guardado'), 'diz que não guardou');
    ok(DB.writeErrorText(erro('AbortError')).includes('AbortError'), 'no caso desconhecido, mostra o nome técnico');
  });
});

// ---------------------------------------------------------------------------
// TESTE DE FUMO — jogos gerados ao acaso.
//
// Os testes acima verificam casos que alguém se lembrou de escrever. Estes
// verificam VERDADES QUE TÊM DE SE MANTER em qualquer jogo possível, sobre
// dezenas de jogos inteiros gerados. Cada falha traz a semente: reproduzir é
// só chamar MatchGen.match(semente).
const SEMENTES = [1, 7, 13, 42, 99, 123, 404, 777, 1234, 2026, 31337, 60606];

describe('Fumo: as contas do jogo aguentam qualquer jogo', () => {
  it('nenhuma estatística fica negativa ou inválida', () => {
    SEMENTES.forEach((semente) => {
      const { match: m, occurrences } = MatchGen.match(semente);
      const st = MatchStats.compute(m, occurrences);
      ['own', 'opp'].forEach((lado) => {
        MatchStats.STAT_KEYS.forEach((k) => {
          const v = st[lado][k.key];
          ok(Number.isFinite(v) && v >= 0, `semente ${semente}: ${lado}.${k.key} = ${v}`);
        });
      });
    });
  });

  it('o placar bate certo com os registos de golo', () => {
    SEMENTES.forEach((semente) => {
      const { match: m, occurrences } = MatchGen.match(semente);
      const conta = (chave) => occurrences.filter((o) => MatchEffects.scoreKeyOf(o) === chave).length;
      eq([m.score.team, m.score.opponent], [conta('team'), conta('opponent')], `semente ${semente}`);
      const st = MatchStats.compute(m, occurrences);
      eq([st.own.goals, st.opp.goals], [m.score.team, m.score.opponent], `semente ${semente}: compute segue o placar`);
    });
  });

  it('desfazer todos os golos devolve o jogo a 0-0, sem nunca passar a negativo', () => {
    SEMENTES.forEach((semente) => {
      const { match: m, occurrences } = MatchGen.match(semente);
      const golos = occurrences.filter((o) => MatchEffects.scoreKeyOf(o));
      golos.forEach((g) => {
        MatchEffects.reverse(m, g);
        ok(m.score.team >= 0 && m.score.opponent >= 0, `semente ${semente}: placar negativo`);
      });
      eq([m.score.team, m.score.opponent], [0, 0], `semente ${semente}`);
    });
  });

  it('desfazer uma falta leva o cartão com ela', () => {
    SEMENTES.forEach((semente) => {
      const { match: m, occurrences } = MatchGen.match(semente);
      const comCartao = occurrences.filter((o) => o.source === 'falta'
        && (o.meta.consequences || []).some((c) => c === 'yellow' || c === 'red'));
      comCartao.forEach((f) => {
        MatchEffects.reverse(m, f);
        eq((m.cards || []).filter((c) => c.fromFoulId === f.id).length, 0, `semente ${semente}: cartão órfão`);
      });
    });
  });

  it('os blocos de leitura nunca rebentam nem mostram NaN/undefined', () => {
    const nomes = (id) => (id ? String(id).toUpperCase() : null);
    SEMENTES.forEach((semente) => {
      const { match: m, occurrences } = MatchGen.match(semente);
      const saidas = [
        MatchStats.renderPatternsHTML(occurrences, m, nomes),
        MatchStats.renderPatternDigestHTML(occurrences, m, nomes),
        MatchStats.renderScoutingCheckHTML(m, occurrences),
        MatchStats.renderTransitionsMapHTML(occurrences, m.team, m.opponent, 'all', 'all', 90),
        MatchStats.renderPeriodComparisonHTML(m, occurrences),
        MatchStats.renderMapHTML('shots', occurrences, m.team, m.opponent, 'all'),
        MatchStats.matchSummaryText(m, occurrences),
      ];
      saidas.forEach((html, i) => {
        ok(typeof html === 'string' && html.length > 0, `semente ${semente}: saída ${i} vazia`);
        ok(!/NaN|undefined|\[object Object\]/.test(html), `semente ${semente}: saída ${i} com lixo: ${(html.match(/.{0,40}(NaN|undefined|\[object Object\]).{0,40}/) || [])[0]}`);
      });
    });
  });

  it('percentagens ficam sempre entre 0 e 100', () => {
    SEMENTES.forEach((semente) => {
      const { match: m, occurrences } = MatchGen.match(semente);
      const c = MatchStats.setPieceChains(occurrences);
      [c.own.corners, c.own.freeKicks, c.opponent.corners, c.opponent.freeKicks].forEach((x) => {
        ok(x.shotPct >= 0 && x.shotPct <= 100, `semente ${semente}: ${x.shotPct}%`);
        eq(x.total, x.base + x.outOfZone + x.noLocation, `semente ${semente}: total = base + fora de zona + sem localização`);
      });
      const sp = MatchStats.transitionSpeed(occurrences);
      ok(sp.pct >= 0 && sp.pct <= 100, `semente ${semente}`);
      ok(sp.converted <= sp.recoveries, `semente ${semente}: mais conversões do que recuperações`);
    });
  });

  it('os minutos de um jogador nunca passam a duração do jogo', () => {
    SEMENTES.forEach((semente) => {
      const { match: m, occurrences, ownPlayers } = MatchGen.match(semente);
      const fim = PlayerStats.matchEndMinute(m, occurrences);
      ownPlayers.forEach((p) => {
        const app = PlayerStats.appearance(m, p.id, 't1', occurrences);
        ok(app.minutes >= 0 && app.minutes <= fim, `semente ${semente}: ${p.id} com ${app.minutes}′ de ${fim}′`);
        if (!app.played) eq(app.minutes, 0, `semente ${semente}: quem não jogou tem 0′`);
      });
    });
  });

  it('o vídeo nunca inventa nem perde registos, nem gera tempos negativos', () => {
    SEMENTES.forEach((semente) => {
      const { match: m, occurrences } = MatchGen.match(semente);
      const fontes = ['focos', 'golos', 'remates', 'perdasCaras', 'momentos', 'taticas'];
      const escolhidas = VideoSync.selectOccurrences(m, occurrences, fontes);
      const ancora = escolhidas.find((o) => o.period === '1T');
      if (!ancora) return;
      const r = VideoSync.buildClips({ match: m, occurrences, anchors: { '1T': { occurrenceId: ancora.id, videoSeconds: 600 } }, sources: fontes });
      eq(r.clips.length + r.missing.length, escolhidas.length, `semente ${semente}: registos perdidos pelo caminho`);
      r.clips.forEach((c) => {
        ok(c.start >= 0 && c.end > c.start, `semente ${semente}: janela inválida ${c.start}-${c.end}`);
        ok(Number.isFinite(c.videoSeconds), `semente ${semente}: tempo de vídeo inválido`);
      });
    });
  });
});

describe('Fumo: a leitura de uma época inteira', () => {
  const entradas = MatchGen.season(SEMENTES.slice(0, 8), { events: 60 })
    .map(({ match: m, occurrences }) => ({ match: m, occurrences }));
  const jogadores = MatchGen.players('t1', 'p');

  it('a série de um jogador é null (e não 0) nos jogos em que não jogou', () => {
    SeasonTrends.PLAYER_KEYS.forEach((k) => {
      jogadores.forEach((p) => {
        const serie = SeasonTrends.playerSeries(p.id, 't1', entradas, k.key);
        serie.forEach((ponto) => {
          ok(ponto.value === null || Number.isFinite(ponto.value), `${p.id}/${k.key}: ${ponto.value}`);
        });
      });
    });
  });

  it('o agregado da época é coerente com os jogos', () => {
    jogadores.forEach((p) => {
      const agg = PlayerStats.aggregate(p.id, 't1', entradas);
      ok(agg.apps <= entradas.length, `${p.id}: ${agg.apps} jogos em ${entradas.length}`);
      ok(agg.starts <= agg.apps, `${p.id}: mais titularidades do que jogos`);
      ok(agg.minutes >= 0 && Number.isFinite(agg.minutes), `${p.id}: ${agg.minutes}′`);
      ok(agg.goals >= 0 && agg.assists >= 0, `${p.id}: negativos`);
    });
  });

  it('a ficha individual gera-se sempre, com valores finitos', () => {
    jogadores.slice(0, 4).forEach((p) => {
      const sheet = PlayerReport.buildSheet({ player: p, teamId: 't1', entries: entradas, metricKey: 'minutes' });
      ok(Array.isArray(sheet.rows), `${p.id}: sem linhas`);
      Object.values(sheet.per90 || {}).forEach((v) => ok(v === null || Number.isFinite(Number(v)), `${p.id}: per90 inválido ${v}`));
    });
  });

  it('o resumo da época não rebenta com jogos irregulares', () => {
    const s = MatchStats.seasonSummary('t1', entradas);
    ok(s && Number.isFinite(s.played), 'resumo sem jogos contados');
    eq(s.wins + s.draws + s.losses, s.played, `${s.wins}+${s.draws}+${s.losses} != ${s.played}`);
    ok(s.goalsFor >= 0 && s.goalsAgainst >= 0, 'golos negativos');
    eq(s.form.length, s.played, 'a forma tem um resultado por jogo');
  });
});

// ---------------------------------------------------------------------------
describe('SquadLoad — quem joga tudo e quem não sai do banco', () => {
  const jogadores = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const jogo = (id, date, { titulares = ['a', 'b'], subs = ['c'], trocas = [] } = {}) => ({
    match: match({ id, date, status: 'finished',
      teams: { own: { teamId: 'T', starterIds: titulares, subIds: subs, positions: titulares.map((p) => ({ playerId: p })) }, opponent: {} },
      substitutions: trocas }),
    occurrences: [],
  });
  const entradas = [
    jogo('m1', '2026-01-01'),
    jogo('m2', '2026-01-08', { trocas: [{ side: 'own', outId: 'b', inId: 'c', minute: 60 }] }),
    jogo('m3', '2026-01-15'),
  ];

  it('minutos, jogos, titularidades e percentagem de minutos possíveis', () => {
    const linhas = SquadLoad.rows({ players: jogadores, teamId: 'T', entries: entradas });
    const a = linhas.find((r) => r.playerId === 'a');
    eq([a.apps, a.starts, a.minutes, a.sharePct], [3, 3, 270, 100], 'titular sempre');
    const c = linhas.find((r) => r.playerId === 'c');
    eq([c.apps, c.starts, c.minutes], [1, 0, 30], 'entrou aos 60 num jogo só');
  });

  it('conta os jogos seguidos sem entrar, a partir do fim', () => {
    const linhas = SquadLoad.rows({ players: jogadores, teamId: 'T', entries: entradas });
    eq(linhas.find((r) => r.playerId === 'c').benchStreak, 1, 'só o último jogo');
    eq(linhas.find((r) => r.playerId === 'a').benchStreak, 0);
  });

  it('a data do último jogo em que jogou', () => {
    const linhas = SquadLoad.rows({ players: jogadores, teamId: 'T', entries: entradas });
    eq(linhas.find((r) => r.playerId === 'c').lastPlayedDate, '2026-01-08');
  });

  it('sinaliza sobrecarga, banco e quem nunca jogou', () => {
    const linhas = SquadLoad.rows({ players: [...jogadores, { id: 'd' }], teamId: 'T', entries: entradas });
    ok(linhas.find((r) => r.playerId === 'a').flags.includes('sobrecarga'), 'joga tudo');
    ok(linhas.find((r) => r.playerId === 'd').flags.includes('nunca-jogou'));
    ok(linhas.find((r) => r.playerId === 'd').flags.includes('sem-minutos'));
  });

  it('jogos por terminar e de outras equipas ficam de fora', () => {
    const comLixo = [...entradas, { match: match({ id: 'x', date: '2026-02-01', status: 'live', teams: { own: { teamId: 'T', starterIds: ['a'], positions: [{ playerId: 'a' }] }, opponent: {} } }), occurrences: [] }];
    eq(SquadLoad.rows({ players: jogadores, teamId: 'T', entries: comLixo })[0].matches, 3);
  });

  it('resumo: utilizados e concentração dos minutos', () => {
    const linhas = SquadLoad.rows({ players: jogadores, teamId: 'T', entries: entradas });
    const s = SquadLoad.summary(linhas);
    eq([s.used, s.unused], [3, 0]);
    eq(s.concentration, 100, 'com 3 jogadores, os "11 mais usados" são todos');
  });
});

describe('ScoutingFeedback — o dossiê a aprender com os jogos', () => {
  const item = (id, title, extra = {}) => ({ id, title, useAsFocus: false, priority: 'medium', ...extra });
  const equipa = (itens) => ({ id: 'T2', name: 'Eles', scouting: { strengths: [], weaknesses: itens, threats: [], opportunities: [], triggers: [] } });
  const jogo = (id, date, planEvents, occs = []) => ({
    match: match({ id, date, status: 'finished', observationPlan: planEvents }),
    occurrences: occs,
  });
  const pe = (id, itemId, nome) => ({ id, name: nome, scoutingRef: { list: 'weaknesses', itemId }, type: 'negative' });

  it('confirmado em todos os jogos e ainda não é foco: propõe promover', () => {
    const t = equipa([item('w1', 'Lateral sobe muito')]);
    const entradas = [
      jogo('m1', '2026-01-01', [pe('p1', 'w1', 'Lateral')], [occ({ planEventId: 'p1' })]),
      jogo('m2', '2026-01-08', [pe('p2', 'w1', 'Lateral')], [occ({ planEventId: 'p2' })]),
    ];
    const s = ScoutingFeedback.suggestions(t, entradas);
    eq(s.map((x) => x.kind), ['promote']);
    ok(s[0].reason.includes('2 jogos'), s[0].reason);
    eq(ScoutingFeedback.apply(t, s[0]), true);
    eq(t.scouting.weaknesses[0].useAsFocus, true);
  });

  it('observado várias vezes e nunca aconteceu: propõe rever', () => {
    const t = equipa([item('w1', 'Saída curta', { useAsFocus: true })]);
    const entradas = [
      jogo('m1', '2026-01-01', [pe('p1', 'w1', 'Saída')], []),
      jogo('m2', '2026-01-08', [pe('p2', 'w1', 'Saída')], []),
    ];
    const s = ScoutingFeedback.suggestions(t, entradas);
    eq(s.map((x) => x.kind), ['review']);
    ok(/nunca aconteceu/.test(s[0].reason), s[0].reason);
    ScoutingFeedback.apply(t, s[0]);
    eq(t.scouting.weaknesses[0].useAsFocus, false, 'deixa de ser foco');
  });

  it('um só jogo não chega para opinar', () => {
    const t = equipa([item('w1', 'X')]);
    eq(ScoutingFeedback.suggestions(t, [jogo('m1', '2026-01-01', [pe('p1', 'w1', 'X')], [])]).length, 0);
  });

  it('padrões que se repetem e não estão no dossiê: propõe adicionar, na lista certa', () => {
    const t = equipa([]);
    const ev = (id, nome, type) => ({ id, name: nome, type, libraryId: 'lib1' });
    const entradas = [
      jogo('m1', '2026-01-01', [ev('a1', 'Cruzamentos do lado direito', 'negative')], [occ({ planEventId: 'a1' })]),
      jogo('m2', '2026-01-08', [ev('a2', 'Cruzamentos do lado direito', 'negative')], [occ({ planEventId: 'a2' })]),
    ];
    const s = ScoutingFeedback.suggestions(t, entradas);
    eq(s.map((x) => x.kind), ['add']);
    eq(s[0].listId, 'strengths', 'um evento negativo nosso é um ponto forte deles');
    ScoutingFeedback.apply(t, s[0]);
    eq(t.scouting.strengths.length, 1);
    eq(t.scouting.strengths[0].useAsFocus, true);
  });

  it('não propõe adicionar um evento que VEIO do dossiê, mesmo com outro nome no plano', () => {
    // Regressão: o plano guarda "Lateral" e o dossiê "Lateral sobe muito". Comparar
    // títulos não chega — é o scoutingRef que diz que já lá está.
    const t = equipa([item('w1', 'Lateral sobe muito')]);
    const entradas = [
      jogo('m1', '2026-01-01', [pe('p1', 'w1', 'Lateral')], [occ({ planEventId: 'p1' })]),
      jogo('m2', '2026-01-08', [pe('p2', 'w1', 'Lateral')], [occ({ planEventId: 'p2' })]),
    ];
    eq(ScoutingFeedback.suggestions(t, entradas).map((x) => x.kind), ['promote'], 'só a promoção, sem "adicionar"');
  });

  it('não propõe adicionar o que já está no dossiê (acentos e maiúsculas à parte)', () => {
    const t = equipa([item('w1', 'Cruzamentos do lado direito')]);
    const ev = (id, nome) => ({ id, name: nome, type: 'negative', libraryId: 'lib1' });
    const entradas = [
      jogo('m1', '2026-01-01', [ev('a1', 'CRUZAMENTOS DO LADO DIREITO')], [occ({ planEventId: 'a1' })]),
      jogo('m2', '2026-01-08', [ev('a2', 'Cruzamentos do lado direito')], [occ({ planEventId: 'a2' })]),
    ];
    eq(ScoutingFeedback.suggestions(t, entradas).filter((x) => x.kind === 'add').length, 0);
  });

  it('equipa sem dossiê não rebenta', () => {
    eq(ScoutingFeedback.suggestions(null, []).length, 0);
    eq(ScoutingFeedback.suggestions({ name: 'X' }, []).length, 0);
  });
});
