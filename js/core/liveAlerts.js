/**
 * liveAlerts.js — Avisos ao vivo, com o jogo a decorrer.
 *
 * Tudo o que está aqui sai de registos que já existem. Não pede nada de novo ao
 * analista: lê o que ele acabou de registar e diz o que isso significa AGORA,
 * enquanto ainda dá para agir. Depois do jogo já não serve de nada.
 *
 * Regras de desenho, para isto não virar ruído:
 *  - Poucos avisos, e cada um tem de sugerir uma ação. "A equipa está pior" não
 *    é um aviso; "3 remates sofridos em 10 minutos" é.
 *  - Cada aviso tem um `id` estável: o ecrã mostra o mesmo aviso uma vez só,
 *    mesmo que ele continue verdadeiro durante minutos.
 *  - Nada de previsões. Só o que já aconteceu, contado numa janela de tempo.
 */

const LiveAlerts = {
  WINDOW: 10,          // minutos da janela curta (pressão, remates)
  DROP_WINDOW: 15,     // janela para quebra individual

  /**
   * @param {object} match
   * @param {Array} occurrences
   * @param {number} nowMinute
   * @param {(id:string)=>object|null} playerOf
   * @returns {Array<{id, level:'warn'|'info'|'good', icon, text, playerId}>}
   */
  compute(match, occurrences, nowMinute, playerOf = () => null) {
    const out = [];
    const nome = (id) => { const p = playerOf(id); return p ? (p.shortName || p.name) : null; };
    const desde = (min) => (occurrences || []).filter((o) => (o.minute ?? 0) >= nowMinute - min && (o.minute ?? 0) <= nowMinute);
    const janela = desde(this.WINDOW);

    // 1. Risco de expulsão: quem já tem amarelo e voltou a fazer falta.
    const amarelados = new Set((match?.cards || [])
      .filter((c) => (c.color || c.type) === 'yellow' && c.playerId)
      .map((c) => c.playerId));
    amarelados.forEach((pid) => {
      const cartao = (match.cards || []).find((c) => c.playerId === pid);
      // A falta que DEU o amarelo não é uma falta nova: o cartão guarda
      // `fromFoulId` e costuma ter o mesmo minuto. Sem isto, o aviso disparava
      // no instante do cartão, dizendo que já tinha feito falta depois dele.
      const faltasDepois = (occurrences || []).filter((o) => o.source === 'falta'
        && o.meta?.committedById === pid
        && o.id !== cartao?.fromFoulId
        && (o.minute ?? 0) > (cartao?.minute ?? 0));
      if (!faltasDepois.length) return;
      const n = nome(pid);
      const nosso = (match.teams?.own?.starterIds || []).includes(pid) || (match.teams?.own?.subIds || []).includes(pid);
      out.push({
        id: `risco:${pid}:${faltasDepois.length}`,
        level: nosso ? 'warn' : 'info',
        icon: nosso ? '🟨' : '🎯',
        playerId: pid,
        text: nosso
          ? `${n || 'Jogador'} tem amarelo e já fez mais ${faltasDepois.length} falta${faltasDepois.length === 1 ? '' : 's'} — risco de expulsão.`
          : `${n || 'Adversário'} tem amarelo e voltou a fazer falta — pode ser um lado a explorar.`,
      });
    });

    // 2. Estamos a sofrer: remates do adversário concentrados.
    const rematesSofridos = janela.filter((o) => o.source === 'remate' && o.team === 'opponent').length;
    if (rematesSofridos >= 3) {
      out.push({
        id: `pressao:${Math.floor(nowMinute / this.WINDOW)}`,
        level: 'warn', icon: '🛡',
        text: `${rematesSofridos} remates sofridos nos últimos ${this.WINDOW} minutos.`,
      });
    }

    // 3. Estamos por cima: vale a pena saber para insistir.
    const rematesNossos = janela.filter((o) => o.source === 'remate' && o.team === 'own').length;
    if (rematesNossos >= 3) {
      out.push({
        id: `dominio:${Math.floor(nowMinute / this.WINDOW)}`,
        level: 'good', icon: '⚡',
        text: `${rematesNossos} remates nossos nos últimos ${this.WINDOW} minutos.`,
      });
    }

    // 4. Jogador a cair: perdas concentradas em quem antes não as tinha.
    const perdas = (occurrences || []).filter((o) => o.source === 'perda' && o.meta?.ownPlayerId);
    const porJogador = new Map();
    perdas.forEach((o) => {
      const rec = porJogador.get(o.meta.ownPlayerId) || { recentes: 0, antes: 0 };
      if ((o.minute ?? 0) >= nowMinute - this.DROP_WINDOW) rec.recentes++; else rec.antes++;
      porJogador.set(o.meta.ownPlayerId, rec);
    });
    porJogador.forEach((rec, pid) => {
      // Três perdas na janela E mais do que teve em todo o resto do jogo:
      // é a mudança que interessa, não o jogador que perde sempre.
      if (rec.recentes >= 3 && rec.recentes > rec.antes) {
        out.push({
          id: `quebra:${pid}:${rec.recentes}`,
          level: 'warn', icon: '📉', playerId: pid,
          text: `${nome(pid) || 'Jogador'} perdeu ${rec.recentes} bolas nos últimos ${this.DROP_WINDOW} minutos (${rec.antes} antes disso).`,
        });
      }
    });

    // 5. Um foco do plano a repetir-se agora.
    const focos = (match?.observationPlan || []).filter((e) => e.isFocus);
    focos.forEach((f) => {
      const n = janela.filter((o) => o.planEventId === f.id).length;
      if (n >= 3) {
        out.push({
          id: `foco:${f.id}:${n}`,
          level: 'info', icon: '🎯',
          text: `"${f.name}" aconteceu ${n} vezes nos últimos ${this.WINDOW} minutos.`,
        });
      }
    });

    return out;
  },

  /** Avisos novos desde a última leitura (por id). */
  fresh(alerts, seen) {
    return (alerts || []).filter((a) => !seen.has(a.id));
  },
};

window.LiveAlerts = LiveAlerts;
