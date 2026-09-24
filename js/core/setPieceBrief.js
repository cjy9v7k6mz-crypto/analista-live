/**
 * setPieceBrief.js — O dossiê a chegar no momento da bola parada.
 *
 * O scouting do adversário costuma dizer coisas concretas sobre cantos e
 * livres ("ao 2º poste", "ensaiado curto", "o 5 vai sempre ao primeiro"). Essa
 * informação estava a chegar ao intervalo e ao relatório — tarde. Isto traz a
 * mesma informação para o instante em que o canto vai ser batido, que é o único
 * em que ainda dá para gritar alguma coisa para o campo.
 *
 * Só mostra o que EXISTE: sem dossiê de bolas paradas, não aparece nada em vez
 * de aparecer uma caixa vazia a ocupar o ecrã do analista a meio do jogo.
 */

const SetPieceBrief = {
  /** Palavras que marcam um item do dossiê como sendo de bola parada. */
  KEYWORDS: /canto|cantos|livre|livres|bola parada|bolas paradas|penalt|lateral longo|pontap[ée] de baliza/i,

  /** Categoria usada nos itens do dossiê. */
  CATEGORY: 'Bola parada',

  /**
   * Itens do dossiê do adversário relevantes para uma bola parada.
   * @param {object} team - equipa adversária (com .scouting)
   * @param {'canto'|'falta'} kind
   */
  dossierItems(team, kind) {
    const out = [];
    const listas = window.SCOUTING_LISTS || [];
    const casaComTipo = (texto) => {
      if (!texto) return false;
      if (kind === 'canto') return /canto/i.test(texto);
      if (kind === 'falta') return /livre|falta|barreira/i.test(texto);
      return true;
    };
    listas.forEach((lista) => {
      ((team?.scouting || {})[lista.id] || []).forEach((item) => {
        const texto = `${item.title || ''} ${item.description || ''}`;
        const eBolaParada = item.category === this.CATEGORY || this.KEYWORDS.test(texto);
        if (!eBolaParada) return;
        // Se o item fala explicitamente do OUTRO tipo, não o mostramos: num
        // canto não interessa o que ele faz nos livres.
        const falaDeCantos = /canto/i.test(texto);
        const falaDeLivres = /livre|barreira/i.test(texto);
        if ((falaDeCantos || falaDeLivres) && !casaComTipo(texto)) return;
        out.push({ icon: lista.icon, list: lista.title, title: item.title, description: item.description || '', focus: !!item.useAsFocus });
      });
    });
    ((team?.scouting || {}).setPieces || []).forEach((sp) => {
      const texto = `${sp.title || ''} ${sp.description || ''}`;
      if ((/canto/i.test(texto) || /livre/i.test(texto)) && !casaComTipo(texto)) return;
      out.push({ icon: '⚽', list: 'Esquema', title: sp.title, description: sp.description || '', focus: false });
    });
    // Os marcados como foco primeiro: foi o analista que disse que importavam.
    return out.sort((a, b) => Number(b.focus) - Number(a.focus)).slice(0, 4);
  },

  /** O que já aconteceu HOJE nesta bola parada, do lado do adversário. */
  todayCount(occurrences, kind) {
    const lista = (occurrences || []).filter((o) => o.team === 'opponent' && o.source === kind
      && (kind !== 'falta' || (o.meta?.consequences || []).includes('freeKick')));
    const comRemate = (occurrences || []).filter((o) => o.source === 'remate' && o.team === 'opponent'
      && (kind === 'canto' ? o.meta?.fromCornerId : o.meta?.fromFoulId)).length;
    return { total: lista.length, withShot: comRemate };
  },

  /**
   * O bloco completo. Devolve string vazia quando não há nada a dizer.
   * @returns {string} HTML
   */
  html(team, occurrences, kind) {
    const itens = this.dossierItems(team, kind);
    const hoje = this.todayCount(occurrences, kind);
    if (!itens.length && hoje.total <= 1) return '';
    const nome = kind === 'canto' ? 'cantos' : 'livres';
    return `
      <div class="spb">
        <div class="spb-head">🎯 O que o dossiê diz sobre os ${nome} deles</div>
        ${itens.map((i) => `
          <div class="spb-item ${i.focus ? 'is-focus' : ''}">
            <span class="spb-icon">${i.icon}</span>
            <span><strong>${Utils.escapeHtml(i.title || '')}</strong>${i.description ? ` — ${Utils.escapeHtml(i.description)}` : ''}</span>
          </div>`).join('')}
        ${hoje.total > 1 ? `<p class="spb-today">Hoje: ${hoje.total} ${nome}${hoje.withShot ? ` · ${hoje.withShot} com remate` : ' · nenhum com remate'}.</p>` : ''}
        ${!itens.length ? '<p class="spb-today muted">Sem nada no dossiê sobre esta bola parada.</p>' : ''}
      </div>`;
  },

  /** Versão de uma linha, para o banco. */
  line(team, occurrences, kind) {
    const itens = this.dossierItems(team, kind);
    if (!itens.length) return null;
    const hoje = this.todayCount(occurrences, kind);
    const titulos = itens.slice(0, 2).map((i) => i.title).filter(Boolean).join(' · ');
    return `${kind === 'canto' ? 'Canto' : 'Livre'} deles — dossiê: ${titulos}${hoje.total > 1 ? ` (${hoje.total} hoje)` : ''}`;
  },
};

window.SetPieceBrief = SetPieceBrief;
