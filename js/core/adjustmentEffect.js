/**
 * adjustmentEffect.js — Decisão → efeito.
 *
 * O ciclo que faltava fechar: no intervalo decide-se uma coisa ("subir a linha
 * de pressão") e nunca mais se soube se resultou. Isto mede o antes e o depois
 * de cada ajuste, a partir do que já foi registado.
 *
 * Honestidade das contas, porque é fácil enganar-se aqui:
 *  - As janelas quase nunca têm o mesmo tamanho (um ajuste ao minuto 60 tem 15
 *    minutos antes e 30 depois). Por isso a comparação é feita por RITMO — por
 *    15 minutos — e os números crus ficam à vista ao lado.
 *  - Um ajuste de intervalo compara parte com parte, que é a leitura natural.
 *  - Correlação não é causa. O bloco diz o que mudou, nunca "porque mudou":
 *    o adversário também mexeu, alguém foi expulso, o jogo abriu-se. Quem lê
 *    é que sabe.
 */

const AdjustmentEffect = {
  /** Fontes que marcam uma decisão mensurável. */
  MARKER_SOURCES: ['ajuste', 'tatica'],

  /** Minutos de cada lado, quando o ajuste é durante o jogo. */
  WINDOW: 15,

  METRICS: [
    { key: 'shots', label: 'Remates nossos', good: 'up' },
    { key: 'shotsAgainst', label: 'Remates sofridos', good: 'down' },
    { key: 'recuperacoes', label: 'Recuperações', good: 'up' },
    { key: 'perdas', label: 'Perdas', good: 'down' },
    { key: 'corners', label: 'Cantos a favor', good: 'up' },
    { key: 'foulsCommitted', label: 'Faltas nossas', good: 'down' },
  ],

  /** Contagens de uma janela de minutos [de, até). */
  countWindow(occurrences, de, ate) {
    const out = { shots: 0, shotsAgainst: 0, recuperacoes: 0, perdas: 0, corners: 0, foulsCommitted: 0, goals: 0, goalsAgainst: 0, minutes: Math.max(0, ate - de) };
    (occurrences || []).forEach((o) => {
      const m = o.minute ?? 0;
      if (m < de || m >= ate) return;
      const key = MatchEffects.scoreKeyOf(o);
      if (key === 'team') out.goals++;
      if (key === 'opponent') out.goalsAgainst++;
      if (o.source === 'remate') { if (o.team === 'own') out.shots++; else if (o.team === 'opponent') out.shotsAgainst++; }
      else if (o.source === 'canto' && o.team === 'own') out.corners++;
      else if (o.source === 'falta' && o.team === 'own') out.foulsCommitted++;
      else if (o.source === 'recuperacao') out.recuperacoes++;
      else if (o.source === 'perda') out.perdas++;
    });
    return out;
  },

  /** Decisões registadas, por ordem de jogo. */
  markers(occurrences) {
    return (occurrences || [])
      .filter((o) => this.MARKER_SOURCES.includes(o.source) && o.team !== 'opponent')
      .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
  },

  /**
   * Minuto em que o jogo acabou. Delega no `PlayerStats.matchEndMinute`, que já
   * era a definição usada para os minutos jogados: um jogo terminado vale pelo
   * menos 90', mesmo que o último registo seja ao minuto 80. Duas noções
   * diferentes de "fim do jogo" na mesma app dariam contas que não batem certo.
   */
  endMinute(match, occurrences) {
    return PlayerStats.matchEndMinute(match, occurrences || []);
  },

  /**
   * O efeito de UM ajuste.
   * @returns {{marker, halftime:boolean, before, after, rows:Array}}
   */
  effect(match, occurrences, marker, { window = this.WINDOW } = {}) {
    const fim = this.endMinute(match, occurrences);
    const at = marker.minute ?? 45;
    // Ajuste de intervalo: parte contra parte, que é como o treinador pensa.
    const halftime = marker.period === 'HT' || (at >= 44 && at <= 46);
    const de = halftime ? 0 : Math.max(0, at - window);
    const ate = halftime ? Math.min(fim, 90) : Math.min(fim, at + window);
    const before = this.countWindow(occurrences, de, at);
    const after = this.countWindow(occurrences, at, ate);

    const porQuinze = (v, min) => (min > 0 ? Number(((v / min) * 15).toFixed(1)) : 0);
    const rows = this.METRICS.map((m) => {
      const b = porQuinze(before[m.key], before.minutes);
      const a = porQuinze(after[m.key], after.minutes);
      const diff = Number((a - b).toFixed(1));
      return {
        key: m.key, label: m.label,
        beforeRaw: before[m.key], afterRaw: after[m.key],
        before: b, after: a, delta: diff,
        // "Melhorou" depende da métrica: mais remates é bom, mais perdas não.
        tone: diff === 0 ? null : ((m.good === 'up') === (diff > 0) ? 'good' : 'bad'),
      };
    });
    return { marker, halftime, before, after, rows };
  },

  /** Todos os ajustes com o seu efeito. Sem ajustes, lista vazia. */
  list(match, occurrences, opts) {
    return this.markers(occurrences).map((m) => this.effect(match, occurrences, m, opts));
  },

  /** Frase curta do que mais mudou (ou null se nada mexeu). */
  headline(effect) {
    const forte = [...effect.rows].filter((r) => r.tone).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    if (!forte) return null;
    const sinal = forte.delta > 0 ? 'passou de' : 'desceu de';
    return `${forte.label}: ${sinal} ${forte.before} para ${forte.after} por 15′`;
  },

  renderHTML(match, occurrences) {
    const lista = this.list(match, occurrences);
    if (!lista.length) {
      return '<p class="muted">Ainda não há ajustes registados. No intervalo, escreve o que vais mudar — a seguir ao jogo ficas a saber se resultou.</p>';
    }
    return lista.map((e) => `
      <div class="adj-block">
        <h4 class="adj-title">
          <span class="adj-when">${e.halftime ? 'Intervalo' : `${String(e.marker.minute).padStart(2, '0')}′`}</span>
          ${Utils.escapeHtml(e.marker.note || e.marker.eventName || 'Ajuste')}
        </h4>
        <p class="muted adj-scope">${e.halftime
          ? `1ª parte (${e.before.minutes}′) vs 2ª parte (${e.after.minutes}′)`
          : `${e.before.minutes}′ antes vs ${e.after.minutes}′ depois`} · valores por 15 minutos</p>
        <div class="adj-rows">
          ${e.rows.map((r) => `
            <div class="adj-row ${r.tone ? 'is-' + r.tone : ''}">
              <span class="adj-label">${r.label}</span>
              <span class="adj-nums"><b>${r.before}</b> → <b>${r.after}</b></span>
              <span class="adj-raw">(${r.beforeRaw} → ${r.afterRaw})</span>
            </div>`).join('')}
        </div>
      </div>`).join('')
      + '<p class="muted pat-note">O que mudou, não porque mudou: o adversário também mexe, e um golo altera o jogo todo. A leitura é tua.</p>';
  },
};

window.AdjustmentEffect = AdjustmentEffect;
