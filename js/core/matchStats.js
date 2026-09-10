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
