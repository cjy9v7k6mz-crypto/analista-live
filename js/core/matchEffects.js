/**
 * matchEffects.js — Efeitos que uma ocorrência tem FORA da lista de ocorrências.
 *
 * Alguns registos mexem no próprio jogo: o golo (toque no placar) e o remate
 * marcado "Golo" somam ao resultado; a substituição entra em
 * `match.substitutions`; o cartão — e a falta com amarelo/vermelho — entra em
 * `match.cards` (é daí que saem os minutos jogados de um expulso). Apagar ou
 * desfazer um destes registos tem de reverter esse efeito, senão o placar, o
 * onze ou os minutos ficam errados.
 *
 * Funções puras sobre o objeto `match`: mutam-no, mas não tocam na base de
 * dados nem no ecrã — por isso são cobertas pelos testes em tests/.
 */

const MatchEffects = {
  /** Chave do placar que esta ocorrência incrementou ('team' | 'opponent'), ou null. */
  scoreKeyOf(occ) {
    if (!occ) return null;
    const scored = occ.source === 'golo' || (occ.source === 'remate' && occ.meta?.result === 'goal');
    if (!scored) return null;
    if (occ.team === 'own') return 'team';
    if (occ.team === 'opponent') return 'opponent';
    return null;
  },

  /**
   * Põe `match.cards` de acordo com as consequências de UMA falta. Idempotente:
   * reabrir o detalhe e voltar a gravar não duplica o cartão, e retirar o
   * amarelo/vermelho retira-o. Cartões de outras origens ficam intactos.
   */
  syncFoulCards(match, foulOcc, playerName = '') {
    if (!match || !foulOcc) return;
    match.cards = (match.cards || []).filter((c) => c.fromFoulId !== foulOcc.id);
    const consequences = foulOcc.meta?.consequences || [];
    const who = foulOcc.meta?.committedById;
    if (!who || !(consequences.includes('yellow') || consequences.includes('red'))) return;
    match.cards.push({
      id: Utils.uid('card'),
      playerId: who,
      player: playerName,
      color: consequences.includes('red') ? 'red' : 'yellow',
      fromFoulId: foulOcc.id,
      period: foulOcc.period,
      minute: foulOcc.minute,
    });
  },

  /** Frase curta sobre o que apagar este registo muda no jogo ('' se nada). */
  describe(occ) {
    if (!occ) return '';
    if (this.scoreKeyOf(occ)) return 'O resultado desce um golo.';
    if (occ.source === 'substituicao') return 'A substituição é desfeita e o jogador volta a campo.';
    if (occ.source === 'cartao') return 'O cartão sai também da lista de cartões do jogo.';
    const c = occ.meta?.consequences || [];
    if (occ.source === 'falta' && (c.includes('yellow') || c.includes('red'))) return 'O cartão desta falta sai também.';
    return '';
  },

  /**
   * Reverte em `match` o que `occ` provocou. Chamar ANTES de apagar a ocorrência.
   * @returns {{score: 'team'|'opponent'|null, cardsRemoved: number, substitutionRemoved: boolean}}
   */
  reverse(match, occ) {
    const out = { score: null, cardsRemoved: 0, substitutionRemoved: false };
    if (!match || !occ) return out;

    const key = this.scoreKeyOf(occ);
    if (key && match.score) {
      match.score[key] = Math.max(0, (match.score[key] || 0) - 1);
      out.score = key;
    }

    if (occ.source === 'falta' && Array.isArray(match.cards)) {
      const before = match.cards.length;
      match.cards = match.cards.filter((c) => c.fromFoulId !== occ.id);
      out.cardsRemoved = before - match.cards.length;
    }

    if (occ.source === 'cartao' && Array.isArray(match.cards)) {
      // Só cartões dados pelo registo de cartão: os que vêm de uma falta
      // pertencem a essa falta e saem apenas com ela.
      const pid = (occ.playerIds || [])[0];
      const color = /vermelho/i.test(occ.eventName || '') ? 'red' : 'yellow';
      const candidates = match.cards
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => !c.fromFoulId && (!pid || c.playerId === pid) && (c.color || 'yellow') === color);
      const sameMinute = candidates.filter(({ c }) => c.minute === occ.minute);
      const pick = (sameMinute.length ? sameMinute : candidates).pop();
      if (pick) {
        match.cards.splice(pick.i, 1);
        out.cardsRemoved = 1;
      }
    }

    if (occ.source === 'substituicao' && Array.isArray(match.substitutions)) {
      const [outId, inId] = occ.playerIds || [];
      const pick = match.substitutions
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.outId === outId && s.inId === inId)
        .pop();
      if (pick) {
        match.substitutions.splice(pick.i, 1);
        out.substitutionRemoved = true;
      }
    }

    return out;
  },
};

window.MatchEffects = MatchEffects;
