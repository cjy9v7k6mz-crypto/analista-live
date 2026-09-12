/**
 * matchStats.js — Estatísticas derivadas do jogo.
 *
 * PRINCÍPIO CENTRAL (pedido explicitamente): nunca duplicar dados nem inventar
 * estatísticas. Este módulo NÃO guarda números — calcula-os sempre a partir de:
 *   - match.score (golos, fonte única — quer venha do toque rápido no placar
 *     quer de um remate detalhado marcado como "Golo")
 *   - occurrences (remates, cantos, faltas, cartões, e os contadores rápidos
 *     de fora-de-jogo/ataque perigoso/livre/penálti)
 *
 * Isto significa: registar um remate como "Golo" nunca cria um segundo registo
 * de golo — o placar é que é a fonte da verdade, e o módulo de remates
 * incrementa-o diretamente (ver live.js). As estatísticas aqui limitam-se a
 * CONTAR o que já foi registado, nunca a estimar ou inferir.
 */

const MatchStats = {
  STAT_KEYS: [
    { key: 'goals', label: 'Golos' },
    { key: 'ownGoals', label: 'Autogolos' },
    { key: 'assists', label: 'Assistências' },
    { key: 'shots', label: 'Remates' },
    { key: 'shotsOnTarget', label: 'Enquadrados' },
    { key: 'shotsOffTarget', label: 'Não Enquadrados' },
    { key: 'saves', label: 'Defesas do GR' },
    { key: 'corners', label: 'Cantos' },
    { key: 'foulsCommitted', label: 'Faltas Cometidas' },
    { key: 'foulsSuffered', label: 'Faltas Sofridas' },
    { key: 'offside', label: 'Fora de Jogo' },
    { key: 'yellowCards', label: 'Amarelos' },
    { key: 'redCards', label: 'Vermelhos' },
    { key: 'dangerousAttacks', label: 'Ataques Perigosos' },
    { key: 'freeKicks', label: 'Livres' },
    { key: 'penalties', label: 'Penáltis' },
  ],
  QUICK_KEYS: ['offside', 'dangerousAttacks', 'freeKicks', 'penalties'],

  SHOT_RESULTS: [
    { key: 'goal', label: 'Golo' },
    { key: 'save', label: 'Defesa' },
    { key: 'blocked', label: 'Bloqueado' },
    { key: 'wide', label: 'Fora' },
    { key: 'post', label: 'Poste/Trave' },
    { key: 'other', label: 'Outro' },
  ],
  GOAL_ZONES: [
    ['TL', 'TC', 'TR'],
    ['ML', 'MC', 'MR'],
    ['BL', 'BC', 'BR'],
  ],
  FOUL_CONSEQUENCES: [
    { key: 'freeKick', label: 'Livre' },
    { key: 'penalty', label: 'Penálti' },
    { key: 'yellow', label: '🟨 Amarelo' },
    { key: 'red', label: '🟥 Vermelho' },
  ],
  SAVE_TYPES: [
    { key: 'easy', label: 'Defesa fácil' },
    { key: 'medium', label: 'Defesa média' },
    { key: 'hard', label: 'Defesa difícil' },
    { key: 'great', label: 'Grande defesa' },
    { key: 'feet', label: 'Com os pés' },
    { key: 'dive', label: 'Em mergulho' },
    { key: 'aerial', label: 'Aérea' },
    { key: 'one_v_one', label: 'Saída / 1x1' },
  ],
  FOUL_TYPES: [
    { key: 'tactical', label: 'Tática' },
    { key: 'normal', label: 'Normal' },
    { key: 'reckless', label: 'Entrada' },
    { key: 'charge', label: 'Carga' },
    { key: 'handball', label: 'Mão' },
    { key: 'other', label: 'Outro' },
  ],
  CORNER_RESULTS: [
    { key: 'opportunity', label: 'Oportunidade' },
    { key: 'shot', label: 'Remate' },
    { key: 'goal', label: 'Golo' },
    { key: 'cleared', label: 'Afastado' },
    { key: 'second_ball', label: '2ª Bola' },
    { key: 'lost', label: 'Perdido' },
  ],

  empty() {
    const o = {};
    this.STAT_KEYS.forEach((k) => { o[k.key] = 0; });
    return o;
  },

  compute(match, occurrences) {
    const own = this.empty();
    const opp = this.empty();
    own.goals = match.score?.team || 0;
    opp.goals = match.score?.opponent || 0;

    occurrences.forEach((o) => {
      const t = o.team === 'own' ? own : (o.team === 'opponent' ? opp : null);
      if (!t) return;
      const other = t === own ? opp : own;

      if (o.source === 'remate') {
        t.shots++;
        const r = o.meta?.result;
        if (r === 'goal' || r === 'save') t.shotsOnTarget++;
        else if (r === 'wide' || r === 'post') t.shotsOffTarget++;
        // Um remate marcado "Golo" pode ter assistência própria (não passa
        // pelo fluxo do placar) — conta-se aqui tal como a do golo por placar.
        if (r === 'goal' && o.meta?.assistId) t.assists++;
      } else if (o.source === 'canto') {
        t.corners++;
      } else if (o.source === 'falta') {
        t.foulsCommitted++;
        other.foulsSuffered++;
        // As consequências vivem no MESMO evento — nunca se cria um segundo
        // registo de cartão ou de livre, para não duplicar contagens.
        const c = o.meta?.consequences || [];
        if (c.includes('freeKick')) other.freeKicks++;
        if (c.includes('penalty')) other.penalties++;
        if (c.includes('yellow')) t.yellowCards++;
        if (c.includes('red')) t.redCards++;
      } else if (o.source === 'cartao') {
        if (/vermelho/i.test(o.eventName)) t.redCards++; else t.yellowCards++;
      } else if (o.source === 'golo') {
        // O placar é a fonte de verdade dos golos; aqui só contamos os detalhes.
        if (o.meta?.ownGoal) t.ownGoals++;
        if (o.meta?.assistId) t.assists++;
      } else if (o.source === 'defesa') {
        t.saves++;
      } else if (o.source === 'stat_quick' && o.meta?.statKey && t[o.meta.statKey] !== undefined) {
        t[o.meta.statKey]++;
      }
    });

    return { own, opp };
  },

  shotsList(occurrences) {
    return occurrences.filter((o) => o.source === 'remate');
  },

  /**
   * "Momentum" de uma janela de tempo — quem tem estado por cima, calculado só
   * a partir do que foi registado (sem inventar). Devolve pontuações brutas por
   * equipa; a UI transforma em percentagem/barra. Não guarda nada.
   *
   * Pesos: golo 6 · remate enquadrado 4 · remate 2 · canto 1 · ataque perigoso 1
   *        · falta sofrida 0.5 (bola parada perto). Bola parada defensiva não conta.
   */
  momentum(occurrences, fromMinute = 0, toMinute = Infinity) {
    const w = { own: 0, opp: 0 };
    const add = (team, n) => { if (team === 'own') w.own += n; else if (team === 'opponent') w.opp += n; };
    occurrences.forEach((o) => {
      if (o.minute < fromMinute || o.minute > toMinute) return;
      if (o.source === 'golo') add(o.team, 6);
      else if (o.source === 'remate') {
        const r = o.meta?.result;
        add(o.team, (r === 'goal' || r === 'save') ? 4 : 2);
      } else if (o.source === 'canto') add(o.team, 1);
      else if (o.source === 'stat_quick' && o.meta?.statKey === 'dangerousAttacks') add(o.team, 1);
      else if (o.source === 'falta') add(o.team === 'own' ? 'opponent' : 'own', 0.5);
    });
    const total = w.own + w.opp;
    return {
      own: w.own, opp: w.opp,
      ownPct: total ? Math.round((w.own / total) * 100) : 50,
      oppPct: total ? Math.round((w.opp / total) * 100) : 50,
      total,
    };
  },

  foulsList(occurrences) {
    return occurrences.filter((o) => o.source === 'falta');
  },

  // ---------- Perdas & Recuperações (transições de posse) ----------
  transitionsList(occurrences) {
    return occurrences.filter((o) => o.source === 'perda' || o.source === 'recuperacao');
  },

  /**
   * Terço do campo de uma coordenada y (0 = baliza adversária / topo, 1 = nossa
   * baliza / fundo), do ponto de vista da NOSSA equipa (ataca para cima):
   *   y < 1/3  -> terço ofensivo   ·   1/3..2/3 -> meio-campo   ·   y > 2/3 -> terço defensivo
   */
  thirdOf(y) {
    if (y == null) return null;
    if (y < 1 / 3) return 'att';
    if (y > 2 / 3) return 'def';
    return 'mid';
  },

  /** Contagem por terço (def/mid/att) de perdas ou recuperações. */
  transitionsByThird(occurrences, kind) {
    const out = { def: 0, mid: 0, att: 0, total: 0 };
    this.transitionsList(occurrences)
      .filter((o) => !kind || o.source === kind)
      .forEach((o) => {
        const t = this.thirdOf(o.meta?.location?.y);
        if (t) { out[t]++; out.total++; }
      });
    out.defPct = out.total ? Math.round((out.def / out.total) * 100) : 0;
    out.midPct = out.total ? Math.round((out.mid / out.total) * 100) : 0;
    out.attPct = out.total ? Math.round((out.att / out.total) * 100) : 0;
    return out;
  },

  /**
   * Mapa de perdas e recuperações — pitch com pontos (🔴 perda · 🟢 recuperação)
   * + leitura por terços. Usado no LIVE, no pós-jogo e no ecrã do banco.
   * @param {'all'|'perda'|'recuperacao'} filter
   * @param {'all'|'1T'|'2T'|'last'} period
   */
  renderTransitionsMapHTML(occurrences, ownName, oppName, filter = 'all', period = 'all', nowMin = 999) {
    let list = this.transitionsList(occurrences)
      .filter((o) => filter === 'all' || o.source === filter)
      .filter((o) => {
        if (period === '1T') return o.period === '1T';
        if (period === '2T') return o.period === '2T';
        if (period === 'last') return (o.minute || 0) >= nowMin - 10;
        return true;
      });
    const withCoords = list.filter((o) => o.meta?.location);
    const markers = withCoords.map((o) => {
      const xy = o.meta.location;
      const cls = o.source === 'perda' ? 'is-loss' : 'is-recover';
      return `<span class="tmap-dot ${cls}" style="left:${xy.x * 100}%; top:${xy.y * 100}%" title="${o.minute}' — ${o.source === 'perda' ? 'perda' : 'recuperação'}"></span>`;
    }).join('');

    const perda = this.transitionsByThird(list.filter((o) => o.source === 'perda'), 'perda');
    const rec = this.transitionsByThird(list.filter((o) => o.source === 'recuperacao'), 'recuperacao');
    const bar = (label, t, cls) => `
      <div class="tmap-third-row">
        <span class="tmap-third-label">${label}</span>
        <span class="tmap-third-cells">
          <span class="${cls}">Def ${t.defPct}%</span>
          <span class="${cls}">Meio ${t.midPct}%</span>
          <span class="${cls}">Of. ${t.attPct}%</span>
        </span>
        <span class="tmap-third-total">${t.total}</span>
      </div>`;

    return `
      <div class="transitions-map">
        ${Pitch.mapHTML(markers)}
        <div class="map-legend">
          <span><span class="tmap-dot is-loss"></span> Perda</span>
          <span><span class="tmap-dot is-recover"></span> Recuperação</span>
          <span class="muted">${Utils.escapeHtml(ownName)} ataca ↑</span>
        </div>
        <div class="tmap-thirds">
          ${bar('🔴 Perdas', perda, 'is-loss')}
          ${bar('🟢 Recuper.', rec, 'is-recover')}
        </div>
      </div>`;
  },

  // ---------- Padrões (leitura derivada — não pede nenhum registo novo) ----------
  //
  // Tudo o que está abaixo é calculado a partir de ocorrências que já existem.
  // Não há aqui nenhum dado novo a pedir ao analista: só se lê melhor o que ele
  // já registou. Se um número não puder ser sustentado pelos registos, não é
  // mostrado (devolve-se `total: 0`) — nunca se estima.

  /** Janelas de tempo (segundos) usadas para ligar acontecimentos em cadeia. */
  CHAIN_WINDOW: { transition: 30, costlyLoss: 20 },

  /** Segundos entre duas ocorrências, usando o relógio de jogo (minuto+segundo). */
  _gapSeconds(a, b) {
    const secs = (o) => (o.minute || 0) * 60 + (o.second || 0);
    return secs(b) - secs(a);
  },

  /**
   * Eficácia de bolas paradas, usando as ligações que já gravamos no remate
   * (`meta.fromCornerId` / `meta.fromFoulId`). Um canto/livre só conta como
   * "com remate" se existir mesmo um remate ligado — não se infere pelo
   * resultado escrito no canto.
   *
   * CUIDADO COM O DENOMINADOR: um canto é sempre uma bola parada ofensiva, por
   * isso a eficácia sobre o total de cantos é justa. Um LIVRE não — a maioria
   * são recomeços a meio-campo onde rematar nunca foi opção, e metê-los no
   * denominador faria a eficácia parecer péssima sem razão. Por isso a eficácia
   * dos livres é calculada só sobre os que estavam em zona de remate (pela
   * localização já registada na falta) mais os que, de facto, deram remate —
   * se deu remate, era rematável, venha de onde vier. Os livres fora dessa zona
   * e os que não têm localização são contados à parte, nunca diluídos na conta.
   */
  setPieceChains(occurrences) {
    const shots = this.shotsList(occurrences);
    const linked = (key, id) => shots.filter((s) => s.meta && s.meta[key] === id);
    /** @param {(occ)=>boolean|null} inShootingZone - null = todas contam (cantos). */
    const build = (list, key, inShootingZone = null) => {
      const rows = list.map((o) => {
        const ss = linked(key, o.id);
        return { occ: o, shots: ss, goals: ss.filter((s) => s.meta?.result === 'goal').length };
      });
      // Base da eficácia: só as jogadas em que rematar era mesmo uma opção.
      const base = inShootingZone
        ? rows.filter((r) => inShootingZone(r.occ) || r.shots.length)
        : rows;
      const baseWithShot = base.filter((r) => r.shots.length).length;
      return {
        total: rows.length,
        withShot: rows.filter((r) => r.shots.length).length,
        goals: rows.reduce((n, r) => n + r.goals, 0),
        // `base*` = o subconjunto sobre o qual a % faz sentido.
        base: base.length,
        baseWithShot,
        baseGoals: base.reduce((n, r) => n + r.goals, 0),
        shotPct: base.length ? Math.round((baseWithShot / base.length) * 100) : 0,
        outOfZone: rows.length - base.length,
        noLocation: rows.filter((r) => r.occ.meta?.location?.y == null && !r.shots.length).length,
        rows,
      };
    };
    // Zona de remate de um livre, do ponto de vista de quem o vai bater:
    // para nós é o terço ofensivo (y baixo); para o adversário, o nosso terço
    // defensivo (y alto) — é o mesmo sítio do campo visto do outro lado.
    const zoneFor = (side) => (o) => this.thirdOf(o.meta?.location?.y) === (side === 'own' ? 'att' : 'def');
    const corners = occurrences.filter((o) => o.source === 'canto');
    const fouls = this.foulsList(occurrences)
      .filter((o) => (o.meta?.consequences || []).includes('freeKick'));
    return {
      own: {
        corners: build(corners.filter((o) => o.team === 'own'), 'fromCornerId'),
        // Falta cometida PELO adversário -> o livre é nosso.
        freeKicks: build(fouls.filter((o) => o.team === 'opponent'), 'fromFoulId', zoneFor('own')),
      },
      opponent: {
        corners: build(corners.filter((o) => o.team === 'opponent'), 'fromCornerId'),
        freeKicks: build(fouls.filter((o) => o.team === 'own'), 'fromFoulId', zoneFor('opponent')),
      },
    };
  },

  /**
   * Velocidade de transição ofensiva: de cada recuperação nossa até ao primeiro
   * remate nosso dentro da janela. Só conta pares dentro do mesmo período —
   * um remate no 2T não pode "resultar" de uma recuperação do 1T.
   */
  transitionSpeed(occurrences) {
    const recs = this.transitionsList(occurrences)
      .filter((o) => o.source === 'recuperacao')
      .sort((a, b) => a.timestamp - b.timestamp);
    const shots = this.shotsList(occurrences).filter((s) => s.team === 'own');
    const win = this.CHAIN_WINDOW.transition;
    const pairs = [];
    recs.forEach((r) => {
      const hit = shots
        .filter((s) => s.period === r.period)
        .map((s) => ({ s, gap: this._gapSeconds(r, s) }))
        .filter((x) => x.gap >= 0 && x.gap <= win)
        .sort((a, b) => a.gap - b.gap)[0];
      if (hit) pairs.push({ rec: r, shot: hit.s, seconds: hit.gap, goal: hit.s.meta?.result === 'goal' });
    });
    const secs = pairs.map((p) => p.seconds).sort((a, b) => a - b);
    return {
      recoveries: recs.length,
      converted: pairs.length,
      pct: recs.length ? Math.round((pairs.length / recs.length) * 100) : 0,
      goals: pairs.filter((p) => p.goal).length,
      medianSeconds: secs.length ? secs[Math.floor(secs.length / 2)] : null,
      pairs,
    };
  },

  /**
   * Perdas que custaram caro: perda nossa seguida de golo sofrido dentro da
   * janela. Serve para isolar o erro que pesou no resultado, não para culpar —
   * por isso guarda-se também o jogador, só quando ele foi mesmo registado.
   */
  costlyLosses(occurrences, match) {
    const losses = this.transitionsList(occurrences).filter((o) => o.source === 'perda');
    const win = this.CHAIN_WINDOW.costlyLoss;
    // Golos sofridos: pelo placar (source 'golo', team 'opponent') ou por um
    // remate do adversário marcado como golo. São fluxos distintos (ver compute).
    const conceded = occurrences.filter((o) =>
      (o.source === 'golo' && o.team === 'opponent' && !o.meta?.ownGoal)
      || (o.source === 'remate' && o.team === 'opponent' && o.meta?.result === 'goal'));
    const out = [];
    losses.forEach((l) => {
      const g = conceded
        .filter((c) => c.period === l.period)
        .map((c) => ({ c, gap: this._gapSeconds(l, c) }))
        .filter((x) => x.gap >= 0 && x.gap <= win)
        .sort((a, b) => a.gap - b.gap)[0];
      if (g) out.push({ loss: l, goal: g.c, seconds: g.gap, playerId: l.meta?.ownPlayerId || null });
    });
    return { total: out.length, items: out };
  },

  /**
   * Onde cada jogador perde a bola. Só entram perdas com jogador identificado —
   * as anónimas ficam de fora em vez de serem atribuídas a alguém.
   */
  lossZonesByPlayer(occurrences) {
    const byPlayer = new Map();
    this.transitionsList(occurrences)
      .filter((o) => o.source === 'perda' && o.meta?.ownPlayerId)
      .forEach((o) => {
        const id = o.meta.ownPlayerId;
        if (!byPlayer.has(id)) byPlayer.set(id, { playerId: id, def: 0, mid: 0, att: 0, total: 0 });
        const row = byPlayer.get(id);
        const t = this.thirdOf(o.meta?.location?.y);
        if (t) row[t]++;
        row.total++;
      });
    return [...byPlayer.values()].sort((a, b) => b.total - a.total);
  },

  /**
   * Fecho do ciclo do scouting: o plano de observação guarda `scoutingRef` nos
   * eventos importados do dossiê do adversário, mas até aqui ninguém lia esse
   * campo. Isto responde à pergunta que fica no fim: "o que eu previ no
   * scouting chegou a acontecer?".
   *
   * Não julga o scouting — um item que não se viu tanto pode ser um erro de
   * análise como um problema que a equipa resolveu bem. Só separa o que foi
   * observado do que não foi.
   */
  scoutingCheck(match, occurrences) {
    const plan = (match.observationPlan || []).filter((e) => e && e.scoutingRef);
    if (!plan.length) return { total: 0, confirmed: [], unseen: [] };
    const counts = {};
    occurrences.forEach((o) => {
      if (o.planEventId) counts[o.planEventId] = (counts[o.planEventId] || 0) + 1;
    });
    const lists = window.SCOUTING_LISTS || [];
    const rows = plan.map((e) => ({
      event: e,
      count: counts[e.id] || 0,
      list: lists.find((l) => l.id === e.scoutingRef.list) || null,
    }));
    return {
      total: rows.length,
      confirmed: rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count),
      unseen: rows.filter((r) => r.count === 0),
    };
  },

  /** Bloco do fecho do ciclo do scouting (intervalo e pós-jogo). */
  renderScoutingCheckHTML(match, occurrences) {
    const sc = this.scoutingCheck(match, occurrences);
    if (!sc.total) {
      return `<p class="muted">Este plano não tem eventos importados do scouting. No construtor do plano, o botão “🎯 Importar do Scouting” traz os pontos fracos, ameaças e gatilhos do adversário — e depois aparece aqui se aconteceram.</p>`;
    }
    const row = (r) => `
      <div class="sck-row ${r.count ? 'is-seen' : 'is-unseen'}">
        <span class="sck-badge">${r.list ? r.list.icon : '🎯'}</span>
        <span class="sck-name">${Utils.escapeHtml(r.event.name)}</span>
        ${r.event.isFocus ? '<span class="sc-badge">⭐</span>' : ''}
        <strong class="sck-count">${r.count ? r.count + '×' : '—'}</strong>
      </div>`;
    return `
      <div class="scouting-check">
        <p class="muted pat-intro">${sc.confirmed.length} de ${sc.total} ${sc.total === 1 ? 'previsão' : 'previsões'} do scouting ${sc.confirmed.length === 1 ? 'confirmou-se' : 'confirmaram-se'} em campo.</p>
        ${sc.confirmed.length ? `<h4 class="sck-head">✅ Confirmado</h4>${sc.confirmed.map(row).join('')}` : ''}
        ${sc.unseen.length ? `<h4 class="sck-head">👁 Não se viu</h4>${sc.unseen.map(row).join('')}
          <p class="muted pat-note">Não ter acontecido pode significar que a leitura estava errada — ou que a equipa o anulou bem. O registo não distingue as duas coisas.</p>` : ''}
      </div>`;
  },

  /**
   * Bloco único de "padrões" — usado no LIVE (diálogo) e no pós-jogo. Recebe uma
   * função `nameOf(playerId)` para não depender de nenhum ecrã em concreto.
   */
  renderPatternsHTML(occurrences, match, nameOf = () => null) {
    const chains = this.setPieceChains(occurrences);
    const speed = this.transitionSpeed(occurrences);
    const costly = this.costlyLosses(occurrences, match);
    const zones = this.lossZonesByPlayer(occurrences);
    const ownName = Utils.escapeHtml(match.team);
    const oppName = Utils.escapeHtml(match.opponent);

    // Cantos: a % é sobre o total (todo o canto é uma bola parada ofensiva).
    const cornerRow = (c) => `
      <div class="pat-row">
        <span class="pat-row-label">⛳ Cantos</span>
        <span class="pat-row-val">${c.total}</span>
        <span class="pat-row-val">${c.withShot}</span>
        <span class="pat-row-val">${c.goals}</span>
        <span class="pat-row-pct">${c.total ? c.shotPct + '%' : '—'}</span>
      </div>`;

    // Livres: a % é só sobre os que estavam em zona de remate — os recomeços
    // a meio-campo aparecem à parte, para não fingirem ser oportunidades falhadas.
    const fkRow = (c) => `
      <div class="pat-row">
        <span class="pat-row-label" title="Livres em zona de remate (ou que deram remate)">🎯 Livres <span class="pat-row-sub">zona rem.</span></span>
        <span class="pat-row-val">${c.base}</span>
        <span class="pat-row-val">${c.baseWithShot}</span>
        <span class="pat-row-val">${c.baseGoals}</span>
        <span class="pat-row-pct">${c.base ? c.shotPct + '%' : '—'}</span>
      </div>
      ${c.total ? `<p class="pat-block-note">${c.total} ${c.total === 1 ? 'livre' : 'livres'} no total${c.outOfZone ? ` · ${c.outOfZone} fora da zona de remate` : ''}${c.noLocation ? ` · ${c.noLocation} sem localização` : ''}</p>` : ''}`;

    const chainBlock = (title, side) => `
      <div class="pat-block">
        <h4>${title}</h4>
        <div class="pat-row pat-row-head">
          <span class="pat-row-label"></span>
          <span class="pat-row-val" title="Jogadas contadas na eficácia">Tot.</span>
          <span class="pat-row-val" title="Com remate ligado">Rem.</span>
          <span class="pat-row-val" title="Golos">Gol.</span>
          <span class="pat-row-pct" title="% que resultou em remate">Efic.</span>
        </div>
        ${cornerRow(side.corners)}
        ${fkRow(side.freeKicks)}
      </div>`;

    const hasChains = chains.own.corners.total || chains.own.freeKicks.total
      || chains.opponent.corners.total || chains.opponent.freeKicks.total;

    return `
      <div class="patterns">
        <p class="muted pat-intro">Tudo aqui é lido dos registos que já fizeste — não há nada de novo a registar.</p>

        ${hasChains ? `
        <h3 class="section-title">🔗 Bolas paradas</h3>
        <div class="pat-grid">
          ${chainBlock(ownName, chains.own)}
          ${chainBlock(oppName, chains.opponent)}
        </div>
        <p class="muted pat-note">Um canto/livre só conta como “com remate” se tiver mesmo um remate ligado (o botão 🎯 no detalhe). Nos livres, a eficácia é só sobre os que estavam em zona de remate — um recomeço a meio-campo não é uma oportunidade falhada.</p>
        ` : `<p class="muted">Sem cantos ou livres ligados a remates ainda. Usa o botão 🎯 no detalhe do canto/falta para os ligares.</p>`}

        <h3 class="section-title">⚡ Transição ofensiva</h3>
        ${speed.recoveries ? `
          <div class="pat-cards">
            <div class="pat-card"><strong>${speed.converted}/${speed.recoveries}</strong><span>recuperações com remate em ${this.CHAIN_WINDOW.transition}s</span></div>
            <div class="pat-card"><strong>${speed.pct}%</strong><span>taxa de conversão</span></div>
            <div class="pat-card"><strong>${speed.medianSeconds != null ? speed.medianSeconds + 's' : '—'}</strong><span>tempo mediano até rematar</span></div>
            <div class="pat-card ${speed.goals ? 'is-good' : ''}"><strong>${speed.goals}</strong><span>golos nascidos de recuperação</span></div>
          </div>
        ` : '<p class="muted">Ainda não há recuperações registadas.</p>'}

        <h3 class="section-title">🩸 Perdas que custaram caro</h3>
        ${costly.total ? `
          <div class="pat-list">
            ${costly.items.map((it) => {
              const who = it.playerId ? nameOf(it.playerId) : null;
              return `<div class="pat-list-row">
                <span class="history-time">${String(it.loss.minute).padStart(2, '0')}'</span>
                <span>Perda${who ? ` de <strong>${Utils.escapeHtml(who)}</strong>` : ''} → golo sofrido <strong>${it.seconds}s</strong> depois</span>
              </div>`;
            }).join('')}
          </div>
        ` : `<p class="muted">Nenhuma perda seguida de golo sofrido em ${this.CHAIN_WINDOW.costlyLoss}s. Boa notícia.</p>`}

        <h3 class="section-title">📍 Onde se perde a bola</h3>
        ${zones.length ? `
          <div class="pat-row pat-row-head">
            <span class="pat-row-label">Jogador</span>
            <span class="pat-row-val" title="Terço defensivo">Def</span>
            <span class="pat-row-val" title="Meio-campo">Meio</span>
            <span class="pat-row-val" title="Terço ofensivo">Of.</span>
            <span class="pat-row-pct">Total</span>
          </div>
          ${zones.map((z) => `
            <div class="pat-row">
              <span class="pat-row-label">${Utils.escapeHtml(nameOf(z.playerId) || '—')}</span>
              <span class="pat-row-val">${z.def}</span>
              <span class="pat-row-val">${z.mid}</span>
              <span class="pat-row-val">${z.att}</span>
              <span class="pat-row-pct">${z.total}</span>
            </div>`).join('')}
          <p class="muted pat-note">Só entram perdas com jogador identificado.</p>
        ` : '<p class="muted">Ainda não há perdas com jogador identificado.</p>'}
      </div>`;
  },

  /**
   * Gera o HTML do mapa de remates ou faltas (reutilizado no LIVE e no pós-jogo,
   * para não duplicar a mesma lógica de desenho em dois sítios).
   */
  renderMapHTML(mode, occurrences, ownName, oppName, filter = 'all') {
    const list = (mode === 'shots' ? this.shotsList(occurrences) : this.foulsList(occurrences))
      .filter((o) => filter === 'all' || o.team === filter);
    const withCoords = list.filter((o) => (mode === 'shots' ? o.meta?.origin : o.meta?.location));

    const markers = withCoords.map((o) => {
      const xy = mode === 'shots' ? o.meta.origin : o.meta.location;
      const cls = o.team === 'own' ? 'map-marker-own' : 'map-marker-opp';
      let symbol = '●';
      let extra = '';
      if (mode === 'shots') {
        const r = o.meta.result;
        if (r === 'goal') { symbol = '★'; extra = 'is-goal'; }
        else if (r === 'save') { symbol = '◆'; }
        else if (r === 'wide' || r === 'post') { symbol = '✕'; }
        else if (r === 'blocked') { symbol = '■'; }
      }
      return `<span class="map-marker ${cls} ${extra}" style="left:${xy.x * 100}%; top:${xy.y * 100}%" title="${o.minute}'">${symbol}</span>`;
    }).join('');

    return `
      <div class="stats-map-wrap">
        <h4>${mode === 'shots' ? 'Mapa de Remates' : 'Mapa de Faltas'} <span class="muted">(${withCoords.length}/${list.length} com localização)</span></h4>
        ${Pitch.mapHTML(markers)}
        <div class="map-legend">
          <span><span class="map-marker map-marker-own">●</span> ${Utils.escapeHtml(ownName)} <span class="muted">(ataca ↑)</span></span>
          <span><span class="map-marker map-marker-opp">●</span> ${Utils.escapeHtml(oppName)} <span class="muted">(ataca ↓)</span></span>
          ${mode === 'shots' ? '<span>★ Golo · ◆ Defendido · ✕ Fora/Poste · ■ Bloqueado</span>' : ''}
        </div>
      </div>
    `;
  },
};

window.MatchStats = MatchStats;
