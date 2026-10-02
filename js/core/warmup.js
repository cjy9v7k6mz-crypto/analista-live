/**
 * warmup.js — Quem está a aquecer, agora.
 *
 * Trabalho de banco que até aqui vivia só na cabeça do adjunto: o treinador
 * manda aquecer dois, e quando a substituição chega ninguém sabe há quanto
 * tempo cada um está de pé. Passa a ser estado do jogo, partilhado pelos dois
 * iPads, e serve três coisas concretas:
 *
 *   1. o adjunto vê há quantos minutos cada um aquece (um jogador que entra
 *      frio é uma lesão à espera de acontecer);
 *   2. o analista vê no seu ecrã quem está a aquecer — a substituição deixa de
 *      ser surpresa e os candidatos aparecem primeiro no seletor;
 *   3. quando o jogador entra, o tempo de aquecimento fica guardado na
 *      substituição, para depois se saber quem entrou preparado e quem não.
 *
 * Como todos os módulos de cálculo da app, isto NÃO grava nada: recebe o jogo,
 * devolve listas novas. Quem chama é que decide persistir e sincronizar.
 *
 * Estado no jogo: match.warmup = [{ playerId, since, minute }]
 *                 match.warmupAt = instante da última alteração (ordem na sincronização)
 */

const Warmup = {
  /** Minutos a partir dos quais um jogador pode entrar sem risco. */
  READY_MIN: 8,
  /** A partir daqui está de pé há demasiado tempo e começa a arrefecer. */
  STALE_MIN: 25,
  /** Quantos fazem sentido ao mesmo tempo. Acima disto é ruído, não informação. */
  MAX: 5,

  /** Lista saneada (sem registos estragados, sem repetidos), mais antigo primeiro. */
  list(match) {
    const raw = Array.isArray(match && match.warmup) ? match.warmup : [];
    const vistos = new Set();
    return raw
      .filter((e) => e && e.playerId && typeof e.since === 'number')
      .filter((e) => (vistos.has(e.playerId) ? false : vistos.add(e.playerId)))
      .map((e) => ({ playerId: e.playerId, since: e.since, minute: Number(e.minute) || 0 }))
      .sort((a, b) => a.since - b.since);
  },

  entry(match, playerId) {
    return this.list(match).find((e) => e.playerId === playerId) || null;
  },

  isWarming(match, playerId) {
    return !!this.entry(match, playerId);
  },

  count(match) {
    return this.list(match).length;
  },

  /** Minutos de aquecimento já feitos (sempre >= 0, arredondados para baixo). */
  minutes(entry, now = Date.now()) {
    if (!entry || typeof entry.since !== 'number') return 0;
    return Math.max(0, Math.floor((now - entry.since) / 60000));
  },

  /**
   * Em que ponto do aquecimento está. É deliberadamente conservador: um sénior
   * não entra pronto aos três minutos, e dizer-lhe que sim seria pior do que
   * não dizer nada.
   */
  state(entry, now = Date.now()) {
    const min = this.minutes(entry, now);
    if (min >= this.STALE_MIN) return 'arrefecer';
    if (min >= this.READY_MIN) return 'pronto';
    if (min >= 3) return 'a-aquecer';
    return 'a-comecar';
  },

  STATE_LABELS: {
    'a-comecar': 'a começar',
    'a-aquecer': 'a aquecer',
    pronto: 'pronto',
    arrefecer: 'há muito a aquecer',
  },

  stateLabel(entry, now = Date.now()) {
    return this.STATE_LABELS[this.state(entry, now)] || '';
  },

  /** Texto curto para um chip: "6′ · pronto". */
  chipLabel(entry, now = Date.now()) {
    return `${this.minutes(entry, now)}′ · ${this.stateLabel(entry, now)}`;
  },

  /**
   * Liga/desliga o aquecimento de um jogador.
   * @returns {{list, at, added, removed, full, minutes}} `full` quando se
   *   tentou passar do máximo — nesse caso a lista volta inalterada.
   */
  toggle(match, playerId, { minute = 0, now = Date.now() } = {}) {
    const atual = this.list(match);
    if (!playerId) return { list: atual, at: match && match.warmupAt, added: false, removed: false, full: false, minutes: 0 };
    const existente = atual.find((e) => e.playerId === playerId);
    if (existente) {
      return {
        list: atual.filter((e) => e.playerId !== playerId),
        at: now, added: false, removed: true, full: false,
        minutes: this.minutes(existente, now),
      };
    }
    if (atual.length >= this.MAX) {
      return { list: atual, at: match && match.warmupAt, added: false, removed: false, full: true, minutes: 0 };
    }
    return {
      list: [...atual, { playerId, since: now, minute: Number(minute) || 0 }],
      at: now, added: true, removed: false, full: false, minutes: 0,
    };
  },

  /**
   * Tira jogadores da lista — usado quando entram em campo. Devolve também
   * quanto tempo cada um aqueceu, para ficar guardado na substituição.
   */
  remove(match, playerIds, now = Date.now()) {
    const ids = new Set((Array.isArray(playerIds) ? playerIds : [playerIds]).filter(Boolean));
    const atual = this.list(match);
    const saem = atual.filter((e) => ids.has(e.playerId));
    if (saem.length === 0) return { list: atual, at: match && match.warmupAt, removed: [] };
    return {
      list: atual.filter((e) => !ids.has(e.playerId)),
      at: now,
      removed: saem.map((e) => ({ playerId: e.playerId, minutes: this.minutes(e, now) })),
    };
  },

  /** Limpa tudo (fim do jogo, ou reposição de um estado antigo). */
  clear(now = Date.now()) {
    return { list: [], at: now };
  },

  /**
   * Quem pode aquecer: está no banco e ainda não foi substituído. Um jogador
   * que já saiu não volta a entrar, por isso não faz sentido aquecer.
   */
  eligible(players, state) {
    if (!state) return [];
    return (players || []).filter((p) => p && !state.onFieldIds.has(p.id) && !state.subbedOffIds.has(p.id));
  },

  /** Os que estão a aquecer primeiro — são os candidatos reais à substituição. */
  sortBench(match, players, now = Date.now()) {
    const ordem = new Map(this.list(match).map((e, i) => [e.playerId, i]));
    return [...(players || [])].sort((a, b) => {
      const ia = ordem.has(a.id) ? ordem.get(a.id) : 999;
      const ib = ordem.has(b.id) ? ordem.get(b.id) : 999;
      if (ia !== ib) return ia - ib;
      return (a.number || 99) - (b.number || 99);
    });
  },

  /** Linha para o ecrã do analista: "🔥 #14 Silva 6′ · #9 Costa 2′". */
  strip(match, players, now = Date.now()) {
    const lista = this.list(match);
    if (lista.length === 0) return '';
    const byId = new Map((players || []).map((p) => [p.id, p]));
    return lista.map((e) => {
      const p = byId.get(e.playerId);
      const nome = p ? `${p.number ? '#' + p.number + ' ' : ''}${p.shortName || p.name}` : 'jogador';
      return `${nome} ${this.minutes(e, now)}′`;
    }).join(' · ');
  },
};

window.Warmup = Warmup;
