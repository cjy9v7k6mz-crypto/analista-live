/**
 * goalEditor.js — Corrigir golos e assistências depois do jogo.
 *
 * Durante o jogo o placar muda com um toque e o detalhe é opcional — é isso que
 * permite não perder a jogada seguinte. O preço é que, no fim, pode haver um
 * golo sem marcador, uma assistência por atribuir, ou um golo que ninguém
 * chegou a registar porque aconteceram três coisas ao mesmo tempo.
 *
 * Isto é a rede: lista todos os golos do jogo (venham do placar ou de um remate
 * marcado "Golo"), deixa acertar marcador, assistência e minuto, acrescentar um
 * golo que faltou e retirar um que não existiu. O placar acompanha sempre —
 * nunca fica um resultado a dizer uma coisa e os registos outra.
 *
 * O resto das estatísticas não se toca aqui: isto é só o que tem de ficar
 * sempre certo, que são os golos e quem os fez.
 */

const GoalEditor = {
  el: null,
  ctx: null,

  /**
   * @param {HTMLElement} el
   * @param {{match, occurrences, ownPlayers, opponentPlayers, onChange}} ctx
   */
  mount(el, ctx) {
    if (!el || !ctx || !ctx.match) return;
    this.el = el;
    this.ctx = ctx;
    this.render();
  },

  /** Todos os golos do jogo, das duas fontes, por ordem de minuto. */
  goals(match, occurrences) {
    const out = [];
    for (const o of occurrences || []) {
      if (o.source === 'golo') {
        out.push({
          occ: o, origem: 'placar', side: o.team || 'own', minute: o.minute || 0,
          ownGoal: !!(o.meta && o.meta.ownGoal),
          scorerId: (o.meta && o.meta.scorerId) || null,
          assistId: (o.meta && o.meta.assistId) || null,
        });
      } else if (o.source === 'remate' && o.meta && o.meta.result === 'goal') {
        out.push({
          occ: o, origem: 'remate', side: o.team || 'own', minute: o.minute || 0,
          ownGoal: false,
          scorerId: (o.playerIds || []).find((id) => id !== MatchStats.passerOf(o)) || null,
          assistId: MatchStats.shotAssistOf(o) || null,
        });
      }
    }
    return out.sort((a, b) => a.minute - b.minute || (a.occ.timestamp || 0) - (b.occ.timestamp || 0));
  },

  playersOf(side) {
    return side === 'own' ? (this.ctx.ownPlayers || []) : (this.ctx.opponentPlayers || []);
  },

  nameOf(id) {
    if (!id) return null;
    const p = [...(this.ctx.ownPlayers || []), ...(this.ctx.opponentPlayers || [])].find((x) => x.id === id);
    return p ? `${p.number ? '#' + p.number + ' ' : ''}${p.shortName || p.name}` : null;
  },

  teamName(side) {
    return side === 'own' ? this.ctx.match.team : this.ctx.match.opponent;
  },

  render() {
    const { match, occurrences } = this.ctx;
    const golos = this.goals(match, occurrences);
    const contados = { own: golos.filter((g) => g.side === 'own').length, opponent: golos.filter((g) => g.side === 'opponent').length };
    const bate = contados.own === match.score.team && contados.opponent === match.score.opponent;
    const semMarcador = golos.filter((g) => !g.scorerId).length;

    this.el.innerHTML = `
      <div class="ge-head">
        <span class="ge-score">${Utils.escapeHtml(match.team)} <strong>${match.score.team}</strong> - <strong>${match.score.opponent}</strong> ${Utils.escapeHtml(match.opponent)}</span>
        <span class="ge-check ${bate ? 'is-ok' : 'is-off'}">${bate
          ? '✔ registos a bater certo com o placar'
          : `⚠ ${contados.own}-${contados.opponent} em registos de golo — acrescenta ou retira abaixo`}</span>
      </div>
      ${semMarcador ? `<p class="ge-warn">⚽ ${semMarcador} golo${semMarcador === 1 ? '' : 's'} sem marcador identificado.</p>` : ''}
      <div class="ge-list">
        ${golos.length ? golos.map((g, i) => `
          <div class="ge-row ${g.side === 'own' ? 'is-own' : 'is-opp'}">
            <span class="ge-min">${String(g.minute).padStart(2, '0')}'</span>
            <span class="ge-team">${Utils.escapeHtml(this.teamName(g.side))}</span>
            <span class="ge-who">
              ${g.ownGoal ? '<span class="ge-tag">autogolo</span> ' : ''}
              ${g.scorerId ? Utils.escapeHtml(this.nameOf(g.scorerId) || '') : '<span class="ge-missing">sem marcador</span>'}
              ${g.assistId ? `<span class="muted"> · assist. ${Utils.escapeHtml(this.nameOf(g.assistId) || '')}</span>` : ''}
              ${g.origem === 'remate' ? '<span class="ge-src" title="Veio de um remate marcado Golo">remate</span>' : ''}
            </span>
            <button class="btn btn-tiny" data-ge-edit="${i}">Corrigir</button>
            <button class="btn btn-tiny btn-danger-outline" data-ge-del="${i}">Retirar</button>
          </div>`).join('') : '<p class="muted">Sem golos registados neste jogo.</p>'}
      </div>
      <div class="ge-actions">
        <button class="btn" data-ge-add="own">＋ Golo de ${Utils.escapeHtml(match.team)}</button>
        <button class="btn" data-ge-add="opponent">＋ Golo de ${Utils.escapeHtml(match.opponent)}</button>
      </div>`;

    this.el.querySelectorAll('[data-ge-edit]').forEach((b) => b.addEventListener('click', () => this.openEdit(golos[Number(b.dataset.geEdit)])));
    this.el.querySelectorAll('[data-ge-del]').forEach((b) => b.addEventListener('click', () => this.remove(golos[Number(b.dataset.geDel)])));
    this.el.querySelectorAll('[data-ge-add]').forEach((b) => b.addEventListener('click', () => this.openEdit(null, b.dataset.geAdd)));
  },

  /** Diálogo de correção (ou de criação, quando `novoLado` vem preenchido). */
  openEdit(golo, novoLado = null) {
    const novo = !golo;
    const side = novo ? novoLado : golo.side;
    const match = this.ctx.match;
    let ownGoal = novo ? false : golo.ownGoal;
    let scorerId = novo ? null : golo.scorerId;
    let assistId = novo ? null : golo.assistId;
    const podeMudarTipo = novo || golo.origem === 'placar';

    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>⚽ ${novo ? 'Acrescentar golo' : 'Corrigir golo'} — ${Utils.escapeHtml(this.teamName(side))}</h3>
          <button type="button" class="icon-btn" data-close>✕</button>
        </div>
        ${novo ? '' : `<p class="muted">${golo.origem === 'remate'
          ? 'Este golo veio de um remate marcado "Golo". O marcador aqui é quem rematou.'
          : 'Golo registado pelo placar.'}</p>`}
        <label class="field"><span>Minuto</span><input type="number" id="ge-min" min="0" max="130" value="${novo ? '' : golo.minute}" inputmode="numeric"></label>
        ${podeMudarTipo ? `
        <p class="field-label">Tipo</p>
        <div class="stats-team-pick">
          <button type="button" class="btn result-btn ${ownGoal ? '' : 'selected'}" data-ge-type="normal">Golo normal</button>
          <button type="button" class="btn result-btn ${ownGoal ? 'selected' : ''}" data-ge-type="own">Autogolo</button>
        </div>` : ''}
        <p class="field-label" id="ge-scorer-label">Marcador</p>
        <div id="ge-scorer"></div>
        <div id="ge-assist-wrap">
          <p class="field-label">Assistência <span class="muted">(n/d se não houve)</span></p>
          <div id="ge-assist"></div>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="button" class="btn btn-primary" id="ge-save">${novo ? 'Acrescentar' : 'Guardar'}</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);

    const fechar = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', fechar));
    dlg.addEventListener('cancel', () => dlg.remove());

    // Num autogolo o marcador é da OUTRA equipa (marcou contra a sua baliza) e
    // não há assistência — é a mesma regra do registo ao vivo.
    const pintar = () => {
      const ladoMarcador = ownGoal ? (side === 'own' ? 'opponent' : 'own') : side;
      dlg.querySelector('#ge-scorer-label').textContent = ownGoal
        ? `Autogolo de (jogador d${side === 'own' ? 'o ' + match.opponent : 'a ' + match.team})`
        : 'Marcador';
      dlg.querySelector('#ge-assist-wrap').style.display = ownGoal ? 'none' : '';
      PlayerGrid.render(dlg, { id: 'ge-scorer', players: this.rosterFor(ladoMarcador), selectedId: scorerId }, (id) => {
        scorerId = id;
        if (id && assistId === id) assistId = null;
        pintarAssist();
      });
      pintarAssist();
    };
    const pintarAssist = () => PlayerGrid.render(dlg, {
      id: 'ge-assist', players: this.rosterFor(side), selectedId: assistId, exclude: [scorerId].filter(Boolean),
    }, (id) => { assistId = id; });

    dlg.querySelectorAll('[data-ge-type]').forEach((b) => b.addEventListener('click', () => {
      dlg.querySelectorAll('[data-ge-type]').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      ownGoal = b.dataset.geType === 'own';
      scorerId = null; assistId = null;
      pintar();
    }));
    pintar();

    dlg.querySelector('#ge-save').addEventListener('click', async () => {
      const minuto = Math.max(0, Math.min(130, parseInt(dlg.querySelector('#ge-min').value, 10) || 0));
      fechar();
      if (novo) await this.create(side, minuto, ownGoal, scorerId, assistId);
      else await this.save(golo, minuto, ownGoal, scorerId, assistId);
    });
    dlg.showModal();
  },

  rosterFor(side) {
    return LineupState.annotatedRoster(this.ctx.match, side, this.playersOf(side));
  },

  /** Nome do registo, no mesmo formato do que é escrito ao vivo. */
  labelFor(ownGoal, scorerId, score) {
    const quem = scorerId ? (this.nameOf(scorerId) || '').replace(/^#\d+\s*/, '') : '';
    const placar = `(${score.team}-${score.opponent})`;
    return ownGoal ? `Autogolo${quem ? ' (' + quem + ')' : ''} ${placar}` : `Golo${quem ? ' ' + quem : ''} ${placar}`;
  },

  async save(golo, minuto, ownGoal, scorerId, assistId) {
    const o = golo.occ;
    o.minute = minuto;
    if (golo.origem === 'remate') {
      // Num remate, quem marcou é quem rematou e a assistência é o passe.
      o.meta = { ...(o.meta || {}), assistId: assistId || null, passerId: assistId || null };
      o.playerIds = [scorerId, assistId].filter(Boolean);
    } else {
      o.meta = { ...(o.meta || {}), ownGoal, scorerId: scorerId || null, assistId: ownGoal ? null : (assistId || null) };
      o.playerIds = [scorerId, o.meta.assistId].filter(Boolean);
      o.eventName = this.labelFor(ownGoal, scorerId, this.ctx.match.score);
    }
    await AppState.updateOccurrence(o);
    toast('Golo atualizado');
    await this.changed();
  },

  async create(side, minuto, ownGoal, scorerId, assistId) {
    const match = this.ctx.match;
    if (side === 'own') match.score.team++; else match.score.opponent++;
    const occ = {
      id: Utils.uid('occ'),
      matchId: match.id,
      timestamp: Date.now(),
      period: minuto > 45 ? '2T' : '1T',
      minute: minuto,
      second: 0,
      category: side === 'own' ? 'nossa_equipa' : 'adversario',
      categoryLabel: Utils.categoryLabel(side === 'own' ? 'nossa_equipa' : 'adversario'),
      eventName: this.labelFor(ownGoal, scorerId, match.score),
      eventType: side === 'own' ? 'positive' : 'negative',
      priority: 'critical',
      note: 'Acrescentado depois do jogo',
      planEventId: null,
      playerIds: [scorerId, ownGoal ? null : assistId].filter(Boolean),
      team: side,
      source: 'golo',
      meta: { ownGoal, scorerId: scorerId || null, assistId: ownGoal ? null : (assistId || null), moment: false, addedAfterMatch: true },
      createdAt: Date.now(),
    };
    try {
      await DB.putRetry(DB.STORES.occurrences, occ);
    } catch (e) {
      if (side === 'own') match.score.team--; else match.score.opponent--;
      alert(DB.writeErrorText(e));
      return;
    }
    if (window.SyncCore && SyncCore.session) SyncCore.publish('occurrence', 'upsert', occ);
    this.ctx.occurrences.push(occ);
    await this.persist();
    toast('Golo acrescentado');
    await this.changed();
  },

  async remove(golo) {
    const quem = this.nameOf(golo.scorerId);
    const texto = golo.origem === 'remate'
      ? `Retirar este golo?\n\nO remate fica registado, mas deixa de contar como golo. O placar passa a ${this.placarSem(golo)}.`
      : `Retirar este golo${quem ? ' de ' + quem : ''}?\n\nO registo é apagado e o placar passa a ${this.placarSem(golo)}.`;
    if (!confirm(texto)) return;
    const match = this.ctx.match;
    if (golo.side === 'own') match.score.team = Math.max(0, match.score.team - 1);
    else match.score.opponent = Math.max(0, match.score.opponent - 1);

    if (golo.origem === 'remate') {
      // Não se apaga o remate — deixa de ser golo e passa a remate sem
      // resultado atribuído. Apagá-lo perdia também o sítio de onde saiu.
      const o = golo.occ;
      o.meta = { ...(o.meta || {}), result: 'other', assistId: null, goalZone: null };
      await AppState.updateOccurrence(o);
    } else {
      await AppState.deleteOccurrence(golo.occ.id);
      if (window.SyncCore && SyncCore.session) SyncCore.publish('occurrence', 'delete', { id: golo.occ.id });
      this.ctx.occurrences = this.ctx.occurrences.filter((o) => o.id !== golo.occ.id);
    }
    await this.persist();
    toast('Golo retirado');
    await this.changed();
  },

  placarSem(golo) {
    const s = this.ctx.match.score;
    return golo.side === 'own'
      ? `${Math.max(0, s.team - 1)}-${s.opponent}`
      : `${s.team}-${Math.max(0, s.opponent - 1)}`;
  },

  async persist() {
    const match = this.ctx.match;
    match.updatedAt = Date.now();
    if (AppState.currentMatch && AppState.currentMatch.id === match.id) {
      AppState.currentMatch.score = match.score;
      await AppState.persistMatch();
    } else {
      await DB.putRetry(DB.STORES.matches, match);
      if (window.SyncCore && SyncCore.session) SyncCore.publish('match', 'upsert', SyncCore.lightMatch(match));
    }
  },

  async changed() {
    // As ocorrências vêm da base de dados: depois de uma alteração, relê-se
    // para que a lista e o resto do pós-jogo falem do mesmo.
    this.ctx.occurrences = await AppState.getOccurrences(this.ctx.match.id);
    this.render();
    if (typeof this.ctx.onChange === 'function') this.ctx.onChange();
  },
};

window.GoalEditor = GoalEditor;
