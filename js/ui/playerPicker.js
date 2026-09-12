/**
 * playerPicker.js — Seletor rápido de jogador(es), reutilizável em toda a app
 * (depois de um evento, substituições, cartões, notas...).
 *
 * Uso:
 *   const result = await PlayerPicker.open({
 *     title: 'Perda de bola',
 *     groups: [{ label: 'Nossa Equipa', players: [...] }, { label: 'Adversário', players: [...] }],
 *     multi: false,
 *   });
 *   // result = { players: [ {id, name, ...} ] } | { players: [] } (Desconhecido) | null (cancelado)
 *
 * Modo rápido: em seleção única, tocar num cartão fecha e resolve imediatamente
 * (sem passo de confirmação extra) — mantém a velocidade do LIVE.
 *
 * Visual: cada equipa é uma faixa de CARTÕES grandes, deslizável horizontalmente
 * (toca ou arrasta) — em vez de obrigar a procurar por nome, os jogadores mais
 * prováveis (em campo) aparecem logo nos primeiros cartões.
 */

const PlayerPicker = {
  _dlg: null,
  _resolver: null,
  _multi: false,
  _selected: [],
  _allPlayers: [],

  _ensureDialog() {
    if (this._dlg) return this._dlg;
    const dlg = document.createElement('dialog');
    dlg.id = 'dlg-player-picker';
    dlg.className = 'dialog dialog-wide';
    dlg.innerHTML = `
      <div class="dialog-card">
        <h3 id="pp-title">Selecionar Jogador</h3>
        <input type="search" id="pp-search" placeholder="Pesquisar jogador...">
        <div id="pp-groups" class="pp-groups"></div>
        <div class="dialog-actions pp-actions">
          <button type="button" class="btn" id="pp-cancel">Cancelar</button>
          <button type="button" class="btn" id="pp-unknown">Desconhecido</button>
          <button type="button" class="btn btn-primary" id="pp-confirm" style="display:none">Guardar Seleção</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    this._dlg = dlg;

    dlg.querySelector('#pp-cancel').addEventListener('click', () => this._close(null));
    dlg.querySelector('#pp-unknown').addEventListener('click', () => this._close({ players: [] }));
    dlg.querySelector('#pp-confirm').addEventListener('click', () => this._close({ players: this._selected }));
    dlg.querySelector('#pp-search').addEventListener('input', (e) => this._filter(e.target.value));
    dlg.addEventListener('cancel', () => this._close(null)); // tecla Esc / swipe-down no iPad

    return dlg;
  },

  open({ title = 'Selecionar Jogador', groups = [], multi = false }) {
    const dlg = this._ensureDialog();
    this._multi = multi;
    this._selected = [];
    this._allPlayers = groups.flatMap((g) => g.players.map((p) => ({ ...p, _group: g.label })));

    dlg.querySelector('#pp-title').textContent = title;
    dlg.querySelector('#pp-search').value = '';
    dlg.querySelector('#pp-confirm').style.display = multi ? 'inline-flex' : 'none';
    this._renderGroups(groups);

    return new Promise((resolve) => {
      this._resolver = resolve;
      dlg.showModal();
    });
  },

  _renderGroups(groups) {
    const container = this._dlg.querySelector('#pp-groups');
    container.innerHTML = groups.map((g) => {
      if (!g.players || g.players.length === 0) return '';
      // Se os jogadores trazem informação de campo/banco (LineupState), mostra
      // "EM CAMPO" primeiro — são os candidatos mais prováveis durante o jogo,
      // por isso ficam logo nos primeiros cartões, sem precisar de deslizar.
      const hasFieldInfo = g.players.some((p) => p._onField !== undefined);
      if (!hasFieldInfo) {
        return this._groupBlock(g.label, g.players);
      }
      const onField = g.players.filter((p) => p._onField);
      const bench = g.players.filter((p) => !p._onField);
      return `
        <div class="pp-group">
          <h4 class="pp-group-title">${Utils.escapeHtml(g.label)}</h4>
          ${onField.length ? `<p class="pp-subheading">EM CAMPO</p>${this._playerSlide(onField)}` : ''}
          ${bench.length ? `<p class="pp-subheading">BANCO</p>${this._playerSlide(bench)}` : ''}
        </div>
      `;
    }).join('') || '<p class="muted">Sem jogadores disponíveis nesta equipa.</p>';

    container.querySelectorAll('.pp-card').forEach((btn) => {
      btn.addEventListener('click', () => this._onPick(btn.dataset.id));
    });
  },

  _groupBlock(label, players) {
    return `
      <div class="pp-group">
        <h4 class="pp-group-title">${Utils.escapeHtml(label)}</h4>
        ${this._playerSlide(players)}
      </div>
    `;
  },

  /** Faixa de cartões grandes, deslizável horizontalmente (toque imediato, sem procurar). */
  _playerSlide(players) {
    return `
      <div class="pp-slide">
        ${players.map((p) => `
          <button type="button" class="pp-card ${p._status === 'sub_in' ? 'is-sub-in' : ''}" data-id="${p.id}">
            ${playerAvatar(p, 'lg')}
            <span class="pp-card-num">${p.number ? '#' + p.number : ''}</span>
            <span class="pp-card-name">${Utils.escapeHtml(p.shortName || p.name)}</span>
          </button>
        `).join('')}
      </div>
    `;
  },

  _onPick(playerId) {
    const player = this._allPlayers.find((p) => p.id === playerId);
    if (!player) return;
    if (!this._multi) {
      this._close({ players: [player] });
      return;
    }
    const btn = this._dlg.querySelector(`.pp-card[data-id="${playerId}"]`);
    const idx = this._selected.findIndex((p) => p.id === playerId);
    if (idx >= 0) {
      this._selected.splice(idx, 1);
      btn.classList.remove('selected');
    } else {
      this._selected.push(player);
      btn.classList.add('selected');
    }
  },

  _filter(term) {
    const t = term.toLowerCase();
    this._dlg.querySelectorAll('.pp-card').forEach((btn) => {
      const name = btn.querySelector('.pp-card-name').textContent.toLowerCase();
      const num = btn.querySelector('.pp-card-num').textContent.toLowerCase();
      btn.style.display = (!t || name.includes(t) || num.includes(t)) ? '' : 'none';
    });
  },

  _close(result) {
    if (this._dlg.open) this._dlg.close();
    const resolve = this._resolver;
    this._resolver = null;
    if (resolve) resolve(result);
  },
};

window.PlayerPicker = PlayerPicker;
