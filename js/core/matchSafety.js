/**
 * matchSafety.js — Cópias automáticas do jogo, e a verificação que sabe quando
 * alguma coisa deixou de bater certo.
 *
 * Porque isto existe: em 26/09/2026 um jogo perdeu o placar e o detalhe de
 * remates e faltas por causa de um defeito na sincronização. O defeito está
 * corrigido, mas a lição é outra — o analista não pode ficar dependente de eu
 * não ter escrito nenhum defeito. Precisa de uma rede que apanhe o próximo,
 * seja ele qual for, sem ter de se lembrar de nada.
 *
 * COMO FUNCIONA
 *  - Grava-se uma cópia completa do jogo (jogo + ocorrências) em momentos
 *    fixos: ao intervalo, ao terminar, e de tempos a tempos enquanto o
 *    cronómetro corre. Também antes de qualquer operação que possa estragar
 *    dados (restaurar backup, importar jogo, juntar equipas).
 *  - As cópias vivem numa store própria: nada do que a app faz ao jogo lhes
 *    toca.
 *  - `verify()` confere as invariantes que TÊM de ser verdade num jogo. Se
 *    deixarem de ser, houve estrago — e há de onde voltar.
 *
 * O QUE ISTO NÃO É: substituto do backup para fora do iPad. Protege contra
 * software; não protege contra perder o aparelho.
 */

const MatchSafety = {
  /** De quanto em quanto tempo se grava durante o jogo. */
  INTERVAL_MIN: 5,
  /** Cópias guardadas por jogo enquanto ele é recente. */
  MAX_PER_MATCH: 10,
  /** Passados estes dias, de um jogo terminado fica só a última. */
  KEEP_ALL_DAYS: 10,

  /**
   * Grava uma cópia. `reason` é o que se mostra ao utilizador na lista.
   * Nunca deita a app abaixo: uma cópia que falha não pode impedir o jogo.
   */
  async snapshot(matchId, reason = 'automática') {
    try {
      const match = await DB.get(DB.STORES.matches, matchId);
      if (!match) return null;
      const occurrences = await DB.getAllByIndex(DB.STORES.occurrences, 'matchId', matchId);
      const copia = {
        id: Utils.uid('snap'),
        matchId,
        at: Date.now(),
        reason,
        // Rótulo do momento do JOGO, que é o que o analista reconhece.
        gameLabel: this.gameLabel(match),
        score: { ...(match.score || { team: 0, opponent: 0 }) },
        counts: { occurrences: occurrences.length, cards: (match.cards || []).length, subs: (match.substitutions || []).length },
        match: this._light(match),
        occurrences,
      };
      await DB.putRetry(DB.STORES.matchSnapshots, copia);
      await this.prune(matchId);
      return copia;
    } catch (e) {
      try { CrashGuard.record('cópia de segurança', e && e.message, e && e.stack, 'MatchSafety.snapshot', false); } catch (x) { /* ignora */ }
      return null;
    }
  },

  /** O jogo sem as fotos em base64 — senão cada cópia levava megabytes. */
  _light(match) {
    const m = { ...match };
    delete m.teamSnapshot;
    return m;
  },

  gameLabel(match) {
    const p = match.currentPeriod;
    const rotulos = { not_started: 'antes do início', '1T': '1ª parte', HT: 'intervalo', '2T': '2ª parte', ET1: 'prolongamento', ET2: 'prolongamento', FT: 'fim do jogo' };
    const snap = match.timerSnapshot;
    const min = snap ? Math.floor((({ '1T': 0, HT: 45, '2T': 45, ET1: 90, ET2: 105, FT: 90 }[snap.period] ?? 0) * 60000 + (snap.periodElapsedMs || 0)) / 60000) : null;
    return `${rotulos[p] || p || '—'}${min != null && p !== 'not_started' ? ` · ${min}'` : ''}`;
  },

  async list(matchId) {
    const todas = await DB.getAll(DB.STORES.matchSnapshots);
    return todas.filter((s) => s.matchId === matchId).sort((a, b) => b.at - a.at);
  },

  /**
   * Arruma: por jogo ficam as mais recentes até MAX_PER_MATCH, mas as cópias
   * dos momentos que interessam (intervalo, fim, antes de operação arriscada)
   * nunca são deitadas fora enquanto o jogo é recente.
   */
  async prune(matchId) {
    try {
      const lista = await this.list(matchId);
      const protegidas = new Set(lista.filter((s) => s.reason !== 'automática').map((s) => s.id));
      const paraApagar = lista
        .filter((s, i) => i >= this.MAX_PER_MATCH && !protegidas.has(s.id));
      for (const s of paraApagar) await DB.delete(DB.STORES.matchSnapshots, s.id);
      return paraApagar.length;
    } catch (e) { return 0; }
  },

  /** Limpeza de fundo: de jogos antigos fica só a última cópia. */
  async pruneOld(now = Date.now()) {
    try {
      const todas = await DB.getAll(DB.STORES.matchSnapshots);
      const porJogo = new Map();
      todas.forEach((s) => { if (!porJogo.has(s.matchId)) porJogo.set(s.matchId, []); porJogo.get(s.matchId).push(s); });
      let apagadas = 0;
      for (const [, lista] of porJogo) {
        lista.sort((a, b) => b.at - a.at);
        const maisRecente = lista[0];
        if (!maisRecente || now - maisRecente.at < this.KEEP_ALL_DAYS * 86400000) continue;
        for (const s of lista.slice(1)) { await DB.delete(DB.STORES.matchSnapshots, s.id); apagadas++; }
      }
      return apagadas;
    } catch (e) { return 0; }
  },

  /**
   * As invariantes de um jogo. Se alguma partir, houve estrago — e é melhor
   * dizê-lo do que deixar o analista descobrir no relatório.
   * @returns {Array<{key, text}>} problemas encontrados (vazio = está bem)
   */
  verify(match, occurrences) {
    const problemas = [];
    if (!match) return problemas;
    const occ = occurrences || [];

    const golos = (chave) => occ.filter((o) => MatchEffects.scoreKeyOf(o) === chave).length;
    const nossos = golos('team');
    const deles = golos('opponent');
    if ((match.score?.team ?? 0) !== nossos) {
      problemas.push({ key: 'placar-casa', text: `O placar diz ${match.score?.team ?? 0} golos nossos, mas há ${nossos} registos de golo.` });
    }
    if ((match.score?.opponent ?? 0) !== deles) {
      problemas.push({ key: 'placar-fora', text: `O placar diz ${match.score?.opponent ?? 0} golos do adversário, mas há ${deles} registos de golo.` });
    }

    // Cartões que dizem vir de uma falta que já não existe.
    const ids = new Set(occ.map((o) => o.id));
    const orfaos = (match.cards || []).filter((c) => c.fromFoulId && !ids.has(c.fromFoulId));
    if (orfaos.length) {
      problemas.push({ key: 'cartoes-orfaos', text: `${orfaos.length} cartão(ões) apontam para uma falta que já não existe.` });
    }

    // Substituições com jogadores que não estão em lado nenhum do onze.
    const noOnze = new Set([...(match.teams?.own?.starterIds || []), ...(match.teams?.own?.subIds || [])]);
    const subsMas = (match.substitutions || []).filter((s) => s.side === 'own' && noOnze.size && !noOnze.has(s.inId));
    if (subsMas.length) {
      problemas.push({ key: 'subs-fora-do-plantel', text: `${subsMas.length} substituição(ões) com um jogador que não está no plantel do jogo.` });
    }

    // Registos que perderam o detalhe que costumam ter (sinal do defeito de
    // 26/09: o remate volta a branco, sem jogador nem sítio no campo).
    const rematesVazios = occ.filter((o) => o.source === 'remate' && !o.meta?.origin && !(o.playerIds || []).length && !o.meta?.result).length;
    const totalRemates = occ.filter((o) => o.source === 'remate').length;
    if (totalRemates >= 3 && rematesVazios === totalRemates) {
      problemas.push({ key: 'remates-sem-detalhe', text: `Os ${totalRemates} remates estão todos sem jogador, sítio e resultado. Se os detalhaste, alguma coisa os apagou.` });
    }

    return problemas;
  },

  /**
   * Repõe o jogo a partir de uma cópia. Antes de mexer, grava o estado atual —
   * voltar atrás nunca pode ser um caminho sem regresso.
   */
  async restore(snapshotId) {
    const copia = await DB.get(DB.STORES.matchSnapshots, snapshotId);
    if (!copia) throw new Error('Cópia não encontrada.');
    await this.snapshot(copia.matchId, 'antes de repor');

    const atuais = await DB.getAllByIndex(DB.STORES.occurrences, 'matchId', copia.matchId);
    const naCopia = new Set((copia.occurrences || []).map((o) => o.id));
    // O que foi registado DEPOIS da cópia desaparece — é o que "voltar atrás"
    // quer dizer, e está escrito na confirmação.
    for (const o of atuais) if (!naCopia.has(o.id)) await DB.delete(DB.STORES.occurrences, o.id);
    for (const o of copia.occurrences || []) await DB.putRetry(DB.STORES.occurrences, o);

    const atual = await DB.get(DB.STORES.matches, copia.matchId);
    // O `teamSnapshot` (fotos) não vai nas cópias: mantém-se o que está.
    const reposto = { ...copia.match, teamSnapshot: atual ? atual.teamSnapshot : undefined, updatedAt: Date.now() };
    await DB.putRetry(DB.STORES.matches, reposto);
    return { match: reposto, occurrences: copia.occurrences || [] };
  },

  /** Descrição do que muda ao repor, para a confirmação. */
  describeRestore(copia, atuaisCount) {
    const diff = atuaisCount - (copia.counts?.occurrences ?? 0);
    const linhas = [`Volta ao estado de ${this.timeLabel(copia)} (${copia.gameLabel}).`,
      `Placar: ${copia.score.team}-${copia.score.opponent}.`];
    if (diff > 0) linhas.push(`Perdem-se ${diff} registo(s) feitos depois dessa cópia.`);
    else if (diff < 0) linhas.push(`Recuperam-se ${-diff} registo(s).`);
    else linhas.push('O número de registos é o mesmo.');
    linhas.push('O estado atual fica guardado como cópia, para poderes voltar.');
    return linhas.join('\n');
  },

  timeLabel(copia) {
    const d = new Date(copia.at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
};

window.MatchSafety = MatchSafety;
