/**
 * teamLink.js — Reconhecer a mesma equipa escrita de maneiras diferentes.
 *
 * O problema real: o calendário oficial diz "GD Selho" e na app a equipa foi
 * criada como "Selho" durante a pré-época, já com dossiê, plantel e jogos. Uma
 * comparação exata não as junta, e o resultado seria a pior coisa possível —
 * duas fichas da mesma equipa, com a informação repartida por ambas.
 *
 * REGRA DE SEGURANÇA: só se liga AUTOMATICAMENTE o que é igual sem margem para
 * dúvida (mesmo nome depois de tirar acentos e pontuação). Tudo o resto é
 * PROPOSTO e tem de ser confirmado. Juntar duas equipas por engano é muito
 * pior do que deixar duas separadas: desfazer uma fusão é trabalho manual.
 *
 * Por isso "Desp. Ronfe" e "Juv. Ronfe" nunca se juntam sozinhas — e nem sequer
 * aparecem como sugestão forte, porque "Juv." não é uma palavra descartável.
 */

const TeamLink = {
  /**
   * Palavras que não distinguem clubes: siglas e designações genéricas.
   * "Juv." (juventude) e "Aca." (academia) NÃO entram aqui de propósito — são
   * o que separa dois clubes da mesma terra.
   */
  STOPWORDS: new Set([
    'gd', 'gc', 'fc', 'sc', 'ad', 'cd', 'cf', 'ac', 'uc', 'ud', 'sl', 'cs', 'rd',
    'acr', 'udc', 'ofc', 'adc', 'crd', 'ccd', 'scr', 'afc',
    'grupo', 'clube', 'club', 'associacao', 'assoc', 'ass', 'sociedade',
    'desportivo', 'desportiva', 'desp', 'sporting', 'sport', 'futebol', 'atletico',
    'recreativo', 'recreativa', 'rec', 'cultural', 'uniao', 'centro',
    'de', 'da', 'do', 'das', 'dos', 'e', 'em',
  ]),

  /** Só letras e dígitos, sem acentos. */
  normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  },

  /** O nome sem as palavras que não distinguem nada. "GD Selho" -> "selho". */
  coreName(s) {
    const tokens = String(s || '').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean)
      .filter((t) => !this.STOPWORDS.has(t));
    return tokens.join('');
  },

  /** Todos os nomes por que uma equipa responde (o próprio e os apelidos). */
  namesOf(team) {
    return [team?.name, ...(team?.aliases || [])].filter(Boolean);
  },

  /** Ligação automática: exatamente o mesmo nome (ou um apelido já guardado). */
  isExact(team, nome) {
    const alvo = this.normalize(nome);
    return !!alvo && this.namesOf(team).some((n) => this.normalize(n) === alvo);
  },

  /**
   * Quão parecidos são? 1 = igual · 0.9 = igual tirando siglas genéricas ·
   * 0.75 = um é o núcleo do outro · 0 = não propor.
   * @returns {{score:number, reason:string}}
   */
  similarity(nomeA, nomeB) {
    const a = this.normalize(nomeA), b = this.normalize(nomeB);
    if (!a || !b) return { score: 0, reason: '' };
    if (a === b) return { score: 1, reason: 'mesmo nome' };
    const ca = this.coreName(nomeA), cb = this.coreName(nomeB);
    if (ca && cb && ca === cb) return { score: 0.9, reason: 'mesmo nome sem a sigla' };
    // Houve aqui uma regra de "um nome contém o outro" e foi retirada: juntava
    // "Desp. Ronfe" com "Juv. Ronfe", porque "ronfe" está dentro de
    // "juvronfe". Dois clubes da mesma terra é exatamente o caso em que um
    // palpite errado custa caro, e um palpite a menos custa um toque. O que
    // esta regra não apanhar resolve-se à mão em "Juntar equipas".
    return { score: 0, reason: '' };
  },

  /** O melhor candidato de uma lista de equipas da app para um nome da prova. */
  bestCandidate(nome, teams, { exclude = [] } = {}) {
    let melhor = null;
    (teams || []).forEach((t) => {
      if (exclude.includes(t.id)) return;
      let s = { score: 0, reason: '' };
      this.namesOf(t).forEach((n) => {
        const r = this.similarity(n, nome);
        if (r.score > s.score) s = r;
      });
      if (s.score > 0 && (!melhor || s.score > melhor.score)) melhor = { team: t, ...s };
    });
    return melhor;
  },

  /** Uma equipa sem nada dentro pode ser apagada sem perder informação. */
  isEmptyTeam(team, { players = [], matches = [] } = {}) {
    if (!team) return false;
    const temJogadores = players.some((p) => p.teamId === team.id);
    const temJogos = matches.some((m) => m.teams?.own?.teamId === team.id || m.teams?.opponent?.teamId === team.id);
    const temDossie = window.DataSafety ? DataSafety.hasScoutingContent(team.scouting) : false;
    const temPerfil = window.DataSafety ? DataSafety.hasScoutingContent(team.profile) : false;
    return !temJogadores && !temJogos && !temDossie && !temPerfil;
  },

  /**
   * O que há a reconciliar numa prova: nomes ainda sem equipa, e nomes ligados
   * a uma ficha vazia quando existe outra com informação lá dentro (o caso da
   * pré-época).
   *
   * @returns {Array<{name, linkedId, candidate, kind:'ligar'|'fundir'}>}
   */
  reconcile(comp, teams, { players = [], matches = [] } = {}) {
    const out = [];
    const ids = comp?.teamIds || {};
    (comp?.teams || []).forEach((nome) => {
      const ligada = ids[nome] ? teams.find((t) => t.id === ids[nome]) : null;
      if (!ligada) {
        const c = this.bestCandidate(nome, teams);
        if (c) out.push({ name: nome, linkedId: null, candidate: c, kind: 'ligar' });
        return;
      }
      // Já ligada — mas se a ficha ligada está vazia e existe outra com
      // informação que parece ser a mesma equipa, isso é uma duplicação.
      if (!this.isEmptyTeam(ligada, { players, matches })) return;
      const c = this.bestCandidate(nome, teams, { exclude: [ligada.id] });
      if (c && !this.isEmptyTeam(c.team, { players, matches })) {
        out.push({ name: nome, linkedId: ligada.id, candidate: c, kind: 'fundir' });
      }
    });
    return out;
  },

  /**
   * O que muda ao fundir duas equipas. Descreve antes de fazer, para o ecrã
   * poder mostrar e o utilizador decidir com os números à frente.
   */
  mergePlan(keep, drop, { players = [], matches = [] } = {}) {
    return {
      keep, drop,
      players: players.filter((p) => p.teamId === drop.id).length,
      matches: matches.filter((m) => m.teams?.own?.teamId === drop.id || m.teams?.opponent?.teamId === drop.id).length,
      scouting: window.DataSafety ? DataSafety.hasScoutingContent(drop.scouting) : false,
    };
  },

  /** Junta as listas do dossiê de `drop` no de `keep`, sem perder nada. */
  mergeScouting(keep, drop) {
    keep.scouting = keep.scouting || {};
    const de = drop.scouting || {};
    Object.keys(de).forEach((k) => {
      if (Array.isArray(de[k])) {
        keep.scouting[k] = [...(keep.scouting[k] || []), ...de[k]];
      } else if (de[k] && !keep.scouting[k]) {
        keep.scouting[k] = de[k];
      }
    });
    keep.profile = { ...(de.profile || {}), ...(drop.profile || {}), ...(keep.profile || {}) };
    // O nome que se perde fica como apelido: é assim que os jogos antigos e o
    // calendário continuam a reconhecer a equipa pelos dois nomes.
    const apelidos = new Set([...(keep.aliases || []), ...(drop.aliases || []), drop.name]);
    keep.aliases = [...apelidos].filter((n) => n && this.normalize(n) !== this.normalize(keep.name));
    keep.updatedAt = Date.now();
    return keep;
  },
};

window.TeamLink = TeamLink;
