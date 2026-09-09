/**
 * lineupState.js — Estado derivado do onze/plantel de um jogo.
 *
 * Corrige o bug de substituições: em vez de guardar "quem está em campo" em
 * vários sítios (arriscando ficar dessincronizado), isto é sempre CALCULADO
 * a partir de duas fontes únicas:
 *   1. match.teams[side].positions — o onze inicial definido no ecrã de Onze Inicial
 *   2. match.substitutions — o histórico cronológico de substituições
 *
 * Qualquer ecrã que precise de saber quem está em campo (LIVE, painel de
 * equipa, seletor de jogador, pós-jogo, exportações) chama LineupState.compute()
 * em vez de manter o seu próprio estado — assim nunca há duas fontes a divergir.
 */

const LineupState = {
  /**
   * @param {object} match
   * @param {'own'|'opponent'} side
   * @returns {{
   *   positions: Array<{x,y,role,playerId}>, // posições atuais (já com as trocas aplicadas)
   *   onFieldIds: Set<string>,
   *   benchIds: Set<string>,
   *   subbedOffIds: Set<string>,             // saíram e não voltam a entrar
   *   statusByPlayerId: Map<string, 'starter'|'sub_in'|'bench'|'subbed_off'>,
   * }}
   */
  compute(match, side) {
    const lineup = match.teams?.[side];
    const positions = (lineup?.positions || []).map((p) => ({ ...p }));
    const onFieldIds = new Set(positions.map((p) => p.playerId).filter(Boolean));
    const benchIds = new Set((lineup?.subIds || []).filter((id) => !onFieldIds.has(id)));
    const subbedOffIds = new Set();
    const statusByPlayerId = new Map();

    onFieldIds.forEach((id) => statusByPlayerId.set(id, 'starter'));
    benchIds.forEach((id) => statusByPlayerId.set(id, 'bench'));

    // Aplica as substituições por ordem cronológica (timestamp de criação / ordem no array)
    const subsForSide = (match.substitutions || []).filter((s) => s.side === side);
    for (const sub of subsForSide) {
      const slot = positions.find((p) => p.playerId === sub.outId);
      if (slot) slot.playerId = sub.inId;

      onFieldIds.delete(sub.outId);
      benchIds.delete(sub.inId);
      onFieldIds.add(sub.inId);
      subbedOffIds.add(sub.outId);
      // Se um jogador voltasse a entrar, deixaria de estar "saído" — sem isto
      // ficaria em dois estados ao mesmo tempo. (A entrada de quem já saiu é
      // bloqueada na UI, mas o cálculo tem de ser coerente de qualquer forma.)
      subbedOffIds.delete(sub.inId);

      statusByPlayerId.set(sub.outId, 'subbed_off');
      statusByPlayerId.set(sub.inId, 'sub_in');
    }

    return { positions, onFieldIds, benchIds, subbedOffIds, statusByPlayerId };
  },

  /** Devolve os jogadores de uma equipa anotados com `_onField` e `_status`, ordenados (em campo primeiro, por número). */
  annotatedRoster(match, side, players) {
    const state = this.compute(match, side);
    return [...players]
      .map((p) => ({ ...p, _onField: state.onFieldIds.has(p.id), _status: state.statusByPlayerId.get(p.id) || 'unused' }))
      .sort((a, b) => {
        if (a._onField !== b._onField) return a._onField ? -1 : 1;
        return (a.number || 99) - (b.number || 99);
      });
  },
};

window.LineupState = LineupState;
