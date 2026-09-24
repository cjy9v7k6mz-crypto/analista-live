/**
 * teamMerge.js — Juntar duas fichas da mesma equipa, sem perder nada.
 *
 * Existe porque duplicados acontecem por vias legítimas: o calendário oficial
 * escreve "GD Selho" e na app a equipa nasceu como "Selho" na pré-época; um
 * backup restaurado por cima; dois nomes para o mesmo clube.
 *
 * ORDEM DAS OPERAÇÕES, e é deliberada: primeiro move-se tudo o que aponta para
 * a ficha que vai desaparecer (jogadores, jogos, provas), e só no fim é que ela
 * é apagada. Se algo falhar a meio, fica tudo como estava — nunca ficam
 * jogadores órfãos a apontar para uma ficha que já não existe.
 *
 * `plan()` descreve o que vai mudar ANTES de mudar, para o ecrã poder mostrar e
 * o utilizador decidir com os números à frente.
 */

const TeamMerge = {
  /** O que a fusão vai mexer. Não altera nada. */
  async plan(keepId, dropId) {
    const [teams, players, matches, comps] = await Promise.all([
      DB.getAll(DB.STORES.teams), DB.getAll(DB.STORES.players),
      DB.getAll(DB.STORES.matches), DB.getAll(DB.STORES.competitions),
    ]);
    const keep = teams.find((t) => t.id === keepId);
    const drop = teams.find((t) => t.id === dropId);
    if (!keep || !drop || keep.id === drop.id) return null;

    const daDrop = (m) => m.teams?.own?.teamId === drop.id || m.teams?.opponent?.teamId === drop.id;
    const listas = ['strengths', 'weaknesses', 'threats', 'opportunities', 'triggers', 'keyPlayers', 'notes', 'setPieces'];
    return {
      keep, drop,
      players: players.filter((p) => p.teamId === drop.id).length,
      matches: matches.filter(daDrop).length,
      scoutingItems: listas.reduce((n, k) => n + ((drop.scouting && drop.scouting[k]) || []).length, 0),
      competitions: comps.filter((c) => Object.values(c.teamIds || {}).includes(drop.id)).length,
      keepIsOwn: !!keep.isOwnTeam,
      dropIsOwn: !!drop.isOwnTeam,
    };
  },

  /**
   * Executa a fusão. `keep` sobrevive; `drop` desaparece e o nome dela fica
   * como apelido, para o calendário e os jogos antigos continuarem a
   * reconhecer a equipa pelos dois nomes.
   * @returns {Promise<object>} o que foi movido
   */
  async run(keepId, dropId) {
    const p = await this.plan(keepId, dropId);
    if (!p) throw new Error('Equipas inválidas para juntar.');
    const { keep, drop } = p;

    const players = await DB.getAll(DB.STORES.players);
    for (const jogador of players.filter((x) => x.teamId === drop.id)) {
      jogador.teamId = keep.id;
      await DB.putRetry(DB.STORES.players, jogador);
    }

    const matches = await DB.getAll(DB.STORES.matches);
    for (const m of matches) {
      let mexeu = false;
      ['own', 'opponent'].forEach((lado) => {
        if (m.teams?.[lado]?.teamId === drop.id) { m.teams[lado].teamId = keep.id; mexeu = true; }
        if (m.teamSnapshot?.[lado]?.teamId === drop.id) { m.teamSnapshot[lado].teamId = keep.id; mexeu = true; }
      });
      // O nome escrito no jogo passa a ser o da ficha que fica, para os ecrãs
      // e as exportações não mostrarem um nome que já não existe.
      if (mexeu) {
        if (m.teams?.own?.teamId === keep.id && Standings.sameTeam(m.team, drop.name)) m.team = keep.name;
        if (m.teams?.opponent?.teamId === keep.id && Standings.sameTeam(m.opponent, drop.name)) m.opponent = keep.name;
        m.updatedAt = Date.now();
        await DB.putRetry(DB.STORES.matches, m);
      }
    }

    const comps = await DB.getAll(DB.STORES.competitions);
    for (const c of comps) {
      let mexeu = false;
      Object.keys(c.teamIds || {}).forEach((nome) => {
        if (c.teamIds[nome] === drop.id) { c.teamIds[nome] = keep.id; mexeu = true; }
      });
      if (mexeu) { c.updatedAt = Date.now(); await DB.putRetry(DB.STORES.competitions, c); }
    }

    TeamLink.mergeScouting(keep, drop);
    // A marca de "nossa equipa" nunca se perde numa fusão.
    if (drop.isOwnTeam) keep.isOwnTeam = true;
    await DB.putRetry(DB.STORES.teams, keep);
    await DB.delete(DB.STORES.teams, drop.id);
    return p;
  },

  /** Pares de equipas que parecem a mesma, para o ecrã avisar sozinho. */
  duplicates(teams) {
    const out = [];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const s = TeamLink.similarity(teams[i].name, teams[j].name);
        if (s.score >= 0.9) out.push({ a: teams[i], b: teams[j], reason: s.reason });
      }
    }
    return out;
  },

  /** Frase de confirmação, para o utilizador saber exatamente o que vai acontecer. */
  describe(p) {
    const partes = [];
    if (p.players) partes.push(`${p.players} ${p.players === 1 ? 'jogador' : 'jogadores'}`);
    if (p.matches) partes.push(`${p.matches} ${p.matches === 1 ? 'jogo' : 'jogos'}`);
    if (p.scoutingItems) partes.push(`${p.scoutingItems} ${p.scoutingItems === 1 ? 'registo de dossiê' : 'registos de dossiê'}`);
    if (p.competitions) partes.push(`${p.competitions} ${p.competitions === 1 ? 'prova' : 'provas'}`);
    const move = partes.length ? `Passa para "${p.keep.name}": ${partes.join(', ')}.` : 'A ficha a apagar está vazia.';
    return `${move}\n\n"${p.drop.name}" desaparece e fica como nome alternativo de "${p.keep.name}". Não há nada a perder — mas não se desfaz com um toque.`;
  },
};

window.TeamMerge = TeamMerge;
