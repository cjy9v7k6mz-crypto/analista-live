/**
 * playerBoard.js — Como se estão a sair os jogadores, neste jogo.
 *
 * O intervalo e o fim do jogo são os dois momentos em que alguém pergunta
 * "quem está bem e quem está mal?" — e até aqui a resposta estava espalhada
 * por fichas individuais que ninguém abre com o relógio a andar. Isto junta
 * tudo numa tabela só, por jogador, com os números do jogo e uma leitura curta.
 *
 * A LEITURA NÃO É UMA NOTA. Não há nota de desempenho nenhuma aqui: ninguém
 * consegue avaliar um jogador a partir de registos de eventos, e fingir que sim
 * seria o pior serviço que esta app podia prestar. O que a leitura faz é dizer,
 * em texto, O QUE OS NÚMEROS MOSTRAM ("3 perdas, 0 recuperações", "2 remates
 * enquadrados"), com um sinal de cor para orientar o olhar. A decisão continua
 * a ser de quem viu o jogo.
 *
 * Como o resto dos módulos de cálculo, não grava nada: recebe o jogo e as
 * ocorrências, devolve linhas.
 */

const PlayerBoard = {
  // Limiares da leitura. Ficam à vista para poderem ser discutidos — não são
  // ciência, são o que faz sentido no escalão.
  PERDAS_RISCO: 3,        // perdas a mais do que recuperações: sinal laranja
  FALTAS_RISCO: 3,        // faltas cometidas no mesmo jogo
  DEFESAS_DESTAQUE: 2,    // defesas do guarda-redes que já valem referência

  /** Colunas da tabela. `compact` = também aparece na versão estreita (banco). */
  COLUMNS: [
    { key: 'minutes', label: 'Min', title: 'Minutos jogados (aproximados)', compact: true },
    { key: 'goals', label: 'G', title: 'Golos', compact: true },
    { key: 'assists', label: 'A', title: 'Assistências', compact: true },
    { key: 'chancesCreated', label: 'GOC', title: 'Grandes oportunidades criadas', compact: false },
    { key: 'shots', label: 'Rem', title: 'Remates', compact: true },
    { key: 'shotsOnTarget', label: 'Enq', title: 'Remates enquadrados', compact: false },
    { key: 'saves', label: 'Def', title: 'Defesas (guarda-redes)', compact: false },
    { key: 'recuperacoes', label: 'Rec', title: 'Recuperações de bola', compact: true },
    { key: 'perdas', label: 'Prd', title: 'Perdas de bola', compact: true },
    { key: 'foulsCommitted', label: 'FC', title: 'Faltas cometidas', compact: true },
    { key: 'foulsSuffered', label: 'FS', title: 'Faltas sofridas', compact: false },
    { key: 'yellow', label: '🟨', title: 'Amarelos', compact: false },
    { key: 'red', label: '🟥', title: 'Vermelhos', compact: false },
    { key: 'moments', label: '⭐', title: 'Momentos guardados', compact: false },
  ],

  /**
   * Uma linha por jogador da equipa pedida.
   * @returns {Array<{player, s, minutes, played, status, read}>}
   */
  rows({ match, occurrences = [], players = [], side = 'own' } = {}) {
    if (!match) return [];
    const teamId = match.teams && match.teams[side] && match.teams[side].teamId;
    const estado = LineupState.compute(match, side);
    return (players || [])
      .filter((p) => p && (!teamId || p.teamId === teamId))
      .map((p) => {
        const s = PlayerStats.forMatch(p.id, occurrences);
        const app = PlayerStats.appearance(match, p.id, p.teamId, occurrences);
        return {
          player: p,
          s,
          minutes: app.minutes,
          played: app.played,
          status: estado.statusByPlayerId.get(p.id) || null,
          onField: estado.onFieldIds.has(p.id),
          // Com registos associados conta como ativo mesmo sem onze definido —
          // é o caso normal do adversário, de quem raramente se monta o onze
          // mas a quem se marcam faltas e remates.
          ativo: app.played || s.events > 0,
          read: this.read(s, app),
        };
      })
      .sort((a, b) => {
        if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
        if (b.minutes !== a.minutes) return b.minutes - a.minutes;
        return (a.player.number || 99) - (b.player.number || 99);
      });
  },

  /**
   * A leitura: um nível (para a cor) e as razões em texto, sempre com os
   * números à frente para que se perceba de onde vêm.
   */
  read(s, app) {
    // Sem minutos E sem registos: não entrou. Sem minutos mas COM registos
    // (adversário sem onze definido), vale a leitura na mesma.
    if ((!app || !app.played) && !(s && s.events)) return { level: 'fora', label: 'não entrou', reasons: [] };
    const bons = [];
    const maus = [];
    const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

    if (s.goals) bons.push(plural(s.goals, 'golo', 'golos'));
    if (s.assists) bons.push(plural(s.assists, 'assistência', 'assistências'));
    if (s.chancesCreated) bons.push(plural(s.chancesCreated, 'oportunidade criada', 'oportunidades criadas'));
    if (s.shotsOnTarget) bons.push(plural(s.shotsOnTarget, 'remate enquadrado', 'remates enquadrados'));
    if (s.saves >= this.DEFESAS_DESTAQUE) bons.push(plural(s.saves, 'defesa', 'defesas'));
    const perdasTxt = () => `${plural(s.perdas, 'perda', 'perdas')}, ${plural(s.recuperacoes, 'recuperação', 'recuperações')}`;
    if (s.recuperacoes > s.perdas) bons.push(`${plural(s.recuperacoes, 'recuperação', 'recuperações')}, ${plural(s.perdas, 'perda', 'perdas')}`);

    const saldo = s.perdas - s.recuperacoes;
    if (s.red) maus.push('expulso');
    if (s.yellow) maus.push(s.yellow > 1 ? `${s.yellow} amarelos` : 'amarelo — atenção ao segundo');
    if (saldo >= this.PERDAS_RISCO || (saldo > 0 && s.perdas >= 2)) maus.push(perdasTxt());
    if (s.foulsCommitted >= this.FALTAS_RISCO) maus.push(plural(s.foulsCommitted, 'falta', 'faltas'));

    let level = 'neutro';
    if (s.red || (s.yellow && s.foulsCommitted >= 2) || saldo >= this.PERDAS_RISCO) level = 'atencao';
    else if (bons.length && saldo <= 1) level = 'bom';

    const reasons = level === 'atencao' ? [...maus, ...bons] : [...bons, ...maus];
    return {
      level,
      label: reasons.length ? reasons.slice(0, 2).join(' · ') : 'sem registos associados',
      reasons,
    };
  },

  LEVEL_ICONS: { bom: '🟢', neutro: '⚪', atencao: '🟠', fora: '·' },

  /** Tabela em HTML. `compact` corta as colunas menos usadas (ecrã do banco). */
  tableHTML(rows, { compact = false } = {}) {
    const cols = this.COLUMNS.filter((c) => !compact || c.compact);
    if (!rows.length) return '<p class="muted">Sem jogadores nesta equipa.</p>';
    const linha = (r) => {
      const p = r.player;
      const nome = `${p.number ? '<span class="pb-num">' + p.number + '</span> ' : ''}${Utils.escapeHtml(p.shortName || p.name)}`;
      const marca = r.status === 'sub_in' ? '<span class="pb-mark pb-in" title="Entrou durante o jogo">▲</span>'
        : (r.status === 'subbed_off' ? '<span class="pb-mark pb-out" title="Foi substituído">▼</span>' : '');
      return `<tr class="pb-row ${r.ativo ? '' : 'is-out'} pb-${r.read.level}" data-pb-player="${p.id}">
        <th scope="row" class="pb-name">${nome}${marca}</th>
        ${cols.map((c) => `<td>${c.key === 'minutes' ? (r.played ? r.minutes : '') : (r.ativo ? (r.s[c.key] || 0) : '')}</td>`).join('')}
        <td class="pb-read"><span class="pb-dot">${this.LEVEL_ICONS[r.read.level]}</span> ${Utils.escapeHtml(r.read.label)}</td>
      </tr>`;
    };
    return `
      <div class="pb-scroll">
        <table class="pb-table">
          <thead>
            <tr>
              <th class="pb-name" data-pb-sort="name" title="Ordenar por nome">Jogador</th>
              ${cols.map((c) => `<th data-pb-sort="${c.key}" title="${Utils.escapeHtml(c.title)} — tocar para ordenar">${c.label}</th>`).join('')}
              <th class="pb-read">Leitura</th>
            </tr>
          </thead>
          <tbody>${rows.map(linha).join('')}</tbody>
        </table>
      </div>
      <p class="pb-note muted">A leitura resume as ações registadas — não é uma nota de desempenho.</p>`;
  },

  /**
   * Monta a tabela num elemento, com separador de equipa e ordenação por
   * coluna. Devolve nada: quem chama só precisa do ecrã montado.
   */
  mount(el, { match, occurrences = [], ownPlayers = [], opponentPlayers = [], compact = false, side = 'own', linkPlayers = true } = {}) {
    if (!el || !match) return;
    let ladoAtual = side;
    let ordem = null;        // null = ordem natural (quem jogou primeiro)
    let desc = true;

    const desenha = () => {
      const jogadores = ladoAtual === 'own' ? ownPlayers : opponentPlayers;
      let rows = this.rows({ match, occurrences, players: jogadores, side: ladoAtual });
      if (ordem === 'name') {
        rows = [...rows].sort((a, b) => (a.player.number || 99) - (b.player.number || 99));
        if (!desc) rows.reverse();
      } else if (ordem) {
        rows = [...rows].sort((a, b) => {
          const va = ordem === 'minutes' ? a.minutes : (a.s[ordem] || 0);
          const vb = ordem === 'minutes' ? b.minutes : (b.s[ordem] || 0);
          return desc ? vb - va : va - vb;
        });
      }
      const temAdversario = (opponentPlayers || []).length > 0;
      el.innerHTML = `
        ${temAdversario ? `<div class="pb-tabs">
          <button class="pb-tab ${ladoAtual === 'own' ? 'active' : ''}" data-pb-side="own">${Utils.escapeHtml(match.team)}</button>
          <button class="pb-tab ${ladoAtual === 'opponent' ? 'active' : ''}" data-pb-side="opponent">${Utils.escapeHtml(match.opponent)}</button>
        </div>` : ''}
        ${this.tableHTML(rows, { compact })}`;

      el.querySelectorAll('[data-pb-side]').forEach((b) => b.addEventListener('click', () => {
        ladoAtual = b.dataset.pbSide; ordem = null; desc = true; desenha();
      }));
      el.querySelectorAll('[data-pb-sort]').forEach((th) => th.addEventListener('click', () => {
        const k = th.dataset.pbSort;
        if (ordem === k) desc = !desc; else { ordem = k; desc = true; }
        desenha();
      }));
      // Toque num jogador abre a ficha dele neste jogo — o passo seguinte
      // natural de quem está a olhar para a linha dele. No banco fica
      // desligado: sair do ecrã do jogo a meio é o último que o adjunto quer.
      if (linkPlayers) {
        el.querySelectorAll('[data-pb-player]').forEach((tr) => tr.addEventListener('click', (ev) => {
          if (ev.target.closest('[data-pb-sort]')) return;
          window.location.hash = `#/player/${match.id}/${tr.dataset.pbPlayer}`;
        }));
      }
    };
    desenha();
  },
};

window.PlayerBoard = PlayerBoard;
