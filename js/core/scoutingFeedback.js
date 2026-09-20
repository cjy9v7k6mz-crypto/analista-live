/**
 * scoutingFeedback.js — O dossiê a aprender com os jogos.
 *
 * O ciclo do scouting estava a meio: o dossiê alimentava o plano de observação,
 * e o `scoutingTrackRecord` já dizia quantas vezes cada previsão se confirmou.
 * Faltava o regresso — o dossiê propor-se a si próprio as correções.
 *
 * O que isto NÃO faz, de propósito: não altera nada sozinho. Propõe, com o
 * motivo à vista e o número de jogos em que se baseia; quem decide é o
 * analista. Um item que nunca se viu tanto pode ser leitura errada como mérito
 * da equipa a anulá-lo — e essa diferença o registo não sabe fazer.
 */

const ScoutingFeedback = {
  /** Abaixo disto não há informação suficiente para opinar seja o que for. */
  MIN_JOGOS: 2,

  /**
   * @param {object} team - equipa adversária (com .scouting)
   * @param {Array<{match, occurrences}>} entries - jogos contra ESTA equipa
   * @returns {Array<{id, kind, listId, itemId, title, reason, actionLabel}>}
   */
  suggestions(team, entries) {
    const out = [];
    if (!team || !team.scouting) return out;
    const rec = MatchStats.scoutingTrackRecord(entries || []);
    const listas = window.SCOUTING_LISTS || [];

    listas.forEach((list) => {
      (team.scouting[list.id] || []).forEach((item) => {
        const r = rec.get(item.id);
        if (!r || r.tracked < this.MIN_JOGOS) return;
        const jogos = (n) => `${n} ${n === 1 ? 'jogo' : 'jogos'}`;

        if (r.confirmed === r.tracked && !item.useAsFocus) {
          out.push({
            id: `promote:${item.id}`, kind: 'promote', listId: list.id, itemId: item.id,
            title: item.title,
            reason: `Confirmou-se nos ${jogos(r.tracked)} em que foi observado (${r.occurrences} registos).`,
            actionLabel: 'Marcar como foco',
          });
        }
        if (r.confirmed === 0) {
          out.push({
            id: `review:${item.id}`, kind: 'review', listId: list.id, itemId: item.id,
            title: item.title,
            reason: `Observado em ${jogos(r.tracked)} e nunca aconteceu. Pode ser leitura errada — ou mérito nosso a anulá-lo.`,
            actionLabel: item.useAsFocus ? 'Deixar de ser foco' : 'Rever no dossiê',
          });
        } else if (item.useAsFocus && r.tracked >= 3 && r.confirmed / r.tracked < 0.5) {
          out.push({
            id: `demote:${item.id}`, kind: 'demote', listId: list.id, itemId: item.id,
            title: item.title,
            reason: `É foco, mas só apareceu em ${r.confirmed} de ${jogos(r.tracked)}.`,
            actionLabel: 'Deixar de ser foco',
          });
        }
      });
    });

    // Padrões que se repetem jogo após jogo e que o dossiê ainda não tem.
    //
    // Duas exclusões, e a segunda é a que interessa: um evento IMPORTADO do
    // dossiê já lá está por definição, mesmo que no plano tenha ficado com
    // outro nome ("Lateral" no plano, "Lateral sobe muito" no dossiê).
    // Comparar títulos não chegava — é preciso seguir o `scoutingRef`.
    const noDossie = new Set();
    listas.forEach((l) => (team.scouting[l.id] || []).forEach((i) => noDossie.add(this._norm(i.title))));
    const vindosDoDossie = new Set();
    (entries || []).forEach(({ match }) => (match?.observationPlan || []).forEach((e) => {
      if (e && e.scoutingRef) vindosDoDossie.add(this._planKey(e));
    }));
    MatchStats.recurringPlanEvents(entries || [], { minMatches: 2 })
      .filter((r) => !noDossie.has(this._norm(r.name)) && !vindosDoDossie.has(r.key))
      .slice(0, 5)
      .forEach((r) => {
        out.push({
          id: `add:${r.key}`, kind: 'add', listId: this.listForType(r.type), itemId: null,
          title: r.name,
          reason: `Aconteceu em ${r.happened} jogos (${r.total} registos) e não está no dossiê.`,
          actionLabel: 'Adicionar ao dossiê',
          source: r,
        });
      });

    return out;
  },

  /** Um evento negativo do adversário é um ponto forte DELES; positivo, um ponto fraco. */
  listForType(type) {
    if (type === 'negative') return 'strengths';
    if (type === 'positive') return 'weaknesses';
    return 'triggers';
  },

  /** A mesma chave que `MatchStats.recurringPlanEvents` usa para agrupar. */
  _planKey(e) {
    return e.libraryId || `nome:${String(e.name || '').toLowerCase()}`;
  },

  _norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  },

  /**
   * Aplica uma sugestão ao dossiê (muta `team`). Quem grava é o ecrã.
   * @returns {boolean} houve alteração
   */
  apply(team, s) {
    if (!team || !s) return false;
    team.scouting = team.scouting || {};
    const lista = team.scouting[s.listId] = team.scouting[s.listId] || [];

    if (s.kind === 'add') {
      lista.push({
        id: Utils.uid('sc'), image: null, caption: '', title: s.title,
        description: `Proposto pelos jogos: ${s.reason}`,
        priority: 'medium', category: 'Outro', timeRef: '', tags: [], playerIds: [],
        useAsFocus: true, createdAt: Date.now(),
      });
      return true;
    }

    const item = lista.find((i) => i.id === s.itemId);
    if (!item) return false;
    if (s.kind === 'promote') { item.useAsFocus = true; return true; }
    if (s.kind === 'demote' || (s.kind === 'review' && item.useAsFocus)) { item.useAsFocus = false; return true; }
    return false; // 'review' de um item que já não é foco: fica só o aviso
  },

  KIND_ICONS: { promote: '⭐', review: '👁', demote: '⬇️', add: '➕' },
};

window.ScoutingFeedback = ScoutingFeedback;
