/**
 * playerGrid.js — Grelha de camisolas para escolher um jogador SEM abrir nada.
 *
 * Porque existe: nos detalhes do jogo (remate, canto, falta, defesa, golo) havia
 * um botão "＋ Escolher jogador" que abria o seletor em modal. Era um toque a
 * mais e tapava o resto do diálogo. Aqui os jogadores estão logo à vista — um
 * toque resolve.
 *
 * Números grandes, alcunha pequena, os que estão EM CAMPO primeiro (a ordem vem
 * do LineupState) e o banco a tracejado. A célula "n/d" limpa a escolha: um
 * campo sem jogador é uma resposta legítima (ninguém identificado) e não um
 * esquecimento.
 *
 * Uso:
 *   container.innerHTML = PlayerGrid.html({ id: 'pg-shooter', players });
 *   PlayerGrid.bind(dlg, 'pg-shooter', (id) => { chosen = id; });
 *   PlayerGrid.render(dlg, { id: 'pg-passer', players, exclude: [chosen] }, cb);
 */

const PlayerGrid = {
  /** @returns {string} HTML da grelha (inclui o próprio contentor com este id). */
  html({ id, players = [], selectedId = null, unknown = true, exclude = [] }) {
    const list = players.filter((p) => p && !exclude.includes(p.id));
    if (!list.length) {
      return `<div class="pg" id="${id}"><p class="muted pg-empty">Sem jogadores nesta equipa — o plantel adiciona-se em Equipas.</p></div>`;
    }
    const cell = (p) => {
      const cls = ['pg-cell',
        p._onField === false ? 'is-bench' : '',
        p._status === 'sub_in' ? 'is-sub-in' : '',
        p.id === selectedId ? 'selected' : ''].filter(Boolean).join(' ');
      const short = p.shortName || p.name || '';
      return `<button type="button" class="${cls}" data-pid="${p.id}" title="${Utils.escapeHtml(p.name || short)}">
        <span class="pg-num">${(p.number === 0 || p.number) ? p.number : '·'}</span>
        <span class="pg-name">${Utils.escapeHtml(short)}</span>
      </button>`;
    };
    return `<div class="pg" id="${id}">
      ${list.map(cell).join('')}
      ${unknown ? `<button type="button" class="pg-cell pg-unknown" data-pid="" title="Ninguém identificado (limpa a escolha)"><span class="pg-nd">n/d</span></button>` : ''}
    </div>`;
  },

  /**
   * Liga os toques. `onPick(playerId|null)` — null quando se toca em "n/d" ou
   * se volta a tocar no jogador já escolhido (desmarcar).
   */
  bind(root, id, onPick) {
    const box = (root || document).querySelector(`#${id}`);
    if (!box) return;
    box.querySelectorAll('[data-pid]').forEach((b) => b.addEventListener('click', () => {
      const wasSelected = b.classList.contains('selected');
      box.querySelectorAll('[data-pid]').forEach((x) => x.classList.remove('selected'));
      if (b.dataset.pid && !wasSelected) {
        b.classList.add('selected');
        onPick(b.dataset.pid);
      } else {
        onPick(null);
      }
    }));
  },

  /** Redesenha a grelha no lugar (ex.: a lista mudou de equipa ou de excluídos). */
  render(root, opts, onPick) {
    const box = (root || document).querySelector(`#${opts.id}`);
    if (!box) return;
    box.outerHTML = this.html(opts);
    this.bind(root, opts.id, onPick);
  },
};

window.PlayerGrid = PlayerGrid;
