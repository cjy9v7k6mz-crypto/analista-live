/**
 * referees.js — Aba dos árbitros: lista e ficha individual.
 *
 * A ficha não se escreve: os números saem dos jogos (ver RefereeStats). À mão
 * entram só o nome, a associação, os traços em chips e as notas por jogo — o
 * que não se pode deduzir de faltas e cartões.
 *
 * O ecrã mostra sempre a confiança da amostra e o aviso de que isto descreve
 * como o árbitro NOS apitou. Um número com cara de verdade a partir de dois
 * jogos é pior do que não ter número nenhum.
 */

const RefereesScreen = {
  referees: [],
  entries: [],
  ownTeamId: null,
  openId: null,

  async render(root, params) {
    this.referees = (await DB.getAll(DB.STORES.referees)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt'));
    const own = (await AppState.getAllTeams()).find((t) => t.isOwnTeam);
    this.ownTeamId = own ? own.id : null;
    const matches = await DB.getAll(DB.STORES.matches);
    this.entries = [];
    for (const m of matches.filter((x) => x.status === 'finished' && x.referee)) {
      this.entries.push({ match: m, occurrences: await AppState.getOccurrences(m.id) });
    }
    // Jogos com árbitro escrito mas ainda sem ficha: a ligação faz-se aqui,
    // uma vez, em vez de obrigar a criar a ficha à mão antes do jogo.
    await this.adoptOrphans(matches);
    this.average = RefereeStats.average(this.entries, this.ownTeamId);
    this.openId = params?.id || null;

    if (this.openId) return this.renderOne(root);
    return this.renderList(root);
  },

  /**
   * Jogos onde o árbitro foi escrito à mão (nome sem ficha) ganham ficha e
   * ficam ligados. Idempotente e tolerante à grafia: "Joao Silva" e
   * "João Silva" são o mesmo árbitro.
   */
  async adoptOrphans(matches) {
    let mexeu = false;
    for (const m of matches) {
      const r = m.referee;
      if (!r || !r.name || r.refereeId) continue;
      let ficha = this.referees.find((x) => TeamLink.similarity(x.name, r.name).score >= 0.9);
      if (!ficha) {
        ficha = {
          id: Utils.uid('ref'), name: r.name, association: 'AF Braga',
          traits: {}, notes: [], createdAt: Date.now(), updatedAt: Date.now(),
        };
        await DB.putRetry(DB.STORES.referees, ficha);
        this.referees.push(ficha);
      }
      r.refereeId = ficha.id;
      m.updatedAt = Date.now();
      await DB.putRetry(DB.STORES.matches, m);
      mexeu = true;
    }
    if (mexeu) {
      this.referees.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt'));
      this.entries = [];
      for (const m of (await DB.getAll(DB.STORES.matches)).filter((x) => x.status === 'finished' && x.referee)) {
        this.entries.push({ match: m, occurrences: await AppState.getOccurrences(m.id) });
      }
    }
  },

  // ---------- Lista ----------
  renderList(root) {
    const linhas = this.referees.map((r) => ({ ref: r, s: RefereeStats.compute(r.id, this.entries, this.ownTeamId) }))
      .sort((a, b) => b.s.games - a.s.games || String(a.ref.name).localeCompare(String(b.ref.name), 'pt'));

    root.innerHTML = `
      <div class="screen ref-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Árbitros</h1>
          <button class="btn btn-small" id="ref-new">＋ Novo</button>
        </header>
        ${!linhas.length ? `
          <div class="empty-state">
            <p>Ainda não há árbitros.</p>
            <p class="muted">Escreve o nome no campo "Árbitro" ao criar o jogo e a ficha aparece aqui sozinha — com os números calculados a partir do que registares.</p>
            <button class="btn" id="ref-new-2">＋ Adicionar árbitro</button>
          </div>` : `
          <p class="muted ref-intro">${this.average.referees} ${this.average.referees === 1 ? 'árbitro' : 'árbitros'} · ${this.average.games} ${this.average.games === 1 ? 'jogo' : 'jogos'} registados${this.average.cardsPerGame != null ? ` · média de ${this.average.cardsPerGame} cartões por jogo` : ''}</p>
          <div class="ref-list">
            ${linhas.map(({ ref, s }) => `
              <button type="button" class="ref-card" data-nav="#/arbitros/${ref.id}">
                <span class="ref-name">${Utils.escapeHtml(ref.name)}<small>${Utils.escapeHtml(ref.association || '')}</small></span>
                <span class="ref-nums">
                  <span><b>${s.games}</b> ${s.games === 1 ? 'jogo' : 'jogos'}</span>
                  <span><b>${s.wins}V ${s.draws}E ${s.losses}D</b> nossos</span>
                  <span><b>${s.cardsUs}</b>–<b>${s.cardsThem}</b> cartões</span>
                  ${s.cardsPerGame != null ? `<span class="muted">${s.cardsPerGame}/jogo</span>` : ''}
                </span>
              </button>`).join('')}
          </div>`}
      </div>`;
    ['ref-new', 'ref-new-2'].forEach((id) => document.getElementById(id)?.addEventListener('click', () => this.openEditor(null)));
  },

  // ---------- Ficha ----------
  renderOne(root) {
    const ref = this.referees.find((r) => r.id === this.openId);
    if (!ref) { window.location.hash = '#/arbitros'; return; }
    const s = RefereeStats.compute(ref.id, this.entries, this.ownTeamId);
    const cmp = RefereeStats.compare(s, this.average);
    const num = (v, suf = '') => (v == null ? '—' : `${v}${suf}`);

    root.innerHTML = `
      <div class="screen ref-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/arbitros" aria-label="Voltar">←</button>
          <h1>${Utils.escapeHtml(ref.name)}</h1>
          <button class="btn btn-small" id="ref-edit">Editar</button>
        </header>

        <p class="ref-conf is-${s.confidence.level}">${s.confidence.text}</p>

        <div class="ref-grid">
          <div class="ref-tile"><strong>${s.games}</strong><span>jogos</span></div>
          <div class="ref-tile"><strong>${s.wins}-${s.draws}-${s.losses}</strong><span>V-E-D nossos</span></div>
          <div class="ref-tile"><strong>${s.foulsUs}–${s.foulsThem}</strong><span>faltas nós–eles</span></div>
          <div class="ref-tile"><strong>${s.cardsUs}–${s.cardsThem}</strong><span>cartões nós–eles</span></div>
          <div class="ref-tile"><strong>${num(s.foulShareUs, '%')}</strong><span>faltas contra nós</span></div>
          <div class="ref-tile"><strong>${num(s.foulsPerCard)}</strong><span>faltas por cartão</span></div>
          <div class="ref-tile"><strong>${num(s.firstCardAvg, "′")}</strong><span>1º cartão do jogo</span></div>
          <div class="ref-tile"><strong>${s.pensUs}–${s.pensThem}</strong><span>penáltis</span></div>
          ${s.stoppageAvg != null ? `<div class="ref-tile"><strong>${s.stoppageAvg}′</strong><span>desconto médio</span></div>` : ''}
        </div>

        ${cmp ? `<p class="ref-compare">📊 ${Utils.escapeHtml(cmp.text.charAt(0).toUpperCase() + cmp.text.slice(1))}. <span class="muted">(${Utils.escapeHtml(cmp.basis)})</span></p>` : ''}
        <p class="muted pat-note">Estes números dizem como ele NOS apitou: só entram os jogos em que estivemos. Não descrevem como ele arbitra em geral.</p>

        <h2 class="section-title">Traços</h2>
        <div class="ref-traits">
          ${RefereeStats.TRAITS.map((t) => `
            <div class="ref-trait">
              <span class="ref-trait-label">${t.label}</span>
              ${t.options.map(([v, label]) => `
                <button type="button" class="btn btn-tiny ${ref.traits?.[t.key] === v ? 'selected' : ''}" data-trait="${t.key}" data-val="${v}">${label}</button>`).join('')}
            </div>`).join('')}
        </div>

        <h2 class="section-title">Notas</h2>
        <div class="ref-note-add">
          <input id="ref-note" placeholder="O que viste neste árbitro" autocomplete="off">
          <button type="button" class="btn btn-primary" id="ref-note-add">Adicionar</button>
        </div>
        <div id="ref-notes"></div>

        <h2 class="section-title">Jogos com ele</h2>
        ${s.matches.length ? `
          <div class="ref-matches">
            ${s.matches.map((m) => `
              <button type="button" class="ref-match" data-nav="#/postgame/${m.matchId}">
                <span>${m.date ? Utils.formatDate(m.date) : '—'}</span>
                <span>${Utils.escapeHtml(m.opponent || '')}</span>
                <span class="ref-match-score">${m.score}</span>
                <span class="muted">faltas ${m.foulsUs}–${m.foulsThem} · cartões ${m.yellowsUs}–${m.yellowsThem}</span>
              </button>`).join('')}
          </div>` : '<p class="muted">Ainda não apitou nenhum jogo registado.</p>'}
      </div>`;

    document.getElementById('ref-edit').addEventListener('click', () => this.openEditor(ref));
    document.querySelectorAll('[data-trait]').forEach((b) => b.addEventListener('click', () => this.toggleTrait(ref, b.dataset.trait, b.dataset.val)));
    document.getElementById('ref-note-add').addEventListener('click', () => this.addNote(ref));
    document.getElementById('ref-note').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addNote(ref); } });
    this.renderNotes(ref);
  },

  renderNotes(ref) {
    const box = document.getElementById('ref-notes');
    if (!box) return;
    const notas = [...(ref.notes || [])].sort((a, b) => b.at - a.at);
    if (!notas.length) { box.innerHTML = '<p class="muted">Sem notas. Uma frase por jogo chega — é o que não se deduz dos cartões.</p>'; return; }
    box.innerHTML = notas.map((n) => `
      <div class="ref-note">
        <span class="ref-note-date">${Utils.formatDate(new Date(n.at).toISOString().slice(0, 10))}</span>
        <span>${Utils.escapeHtml(n.text)}</span>
        <button type="button" class="icon-btn" data-note-del="${n.id}" title="Apagar">✕</button>
      </div>`).join('');
    box.querySelectorAll('[data-note-del]').forEach((b) => b.addEventListener('click', async () => {
      ref.notes = (ref.notes || []).filter((n) => n.id !== b.dataset.noteDel);
      await this.save(ref);
      this.renderNotes(ref);
    }));
  },

  async addNote(ref) {
    const campo = document.getElementById('ref-note');
    const texto = (campo.value || '').trim();
    if (!texto) { campo.focus(); return; }
    ref.notes = [...(ref.notes || []), { id: Utils.uid('rn'), at: Date.now(), text: texto }];
    await this.save(ref);
    campo.value = '';
    this.renderNotes(ref);
    toast('Nota guardada');
  },

  async toggleTrait(ref, key, val) {
    ref.traits = ref.traits || {};
    ref.traits[key] = ref.traits[key] === val ? null : val;
    await this.save(ref);
    document.querySelectorAll(`[data-trait="${key}"]`).forEach((b) =>
      b.classList.toggle('selected', ref.traits[key] === b.dataset.val));
  },

  async save(ref) {
    ref.updatedAt = Date.now();
    try { await DB.putRetry(DB.STORES.referees, ref); } catch (e) { alert(DB.writeErrorText(e)); }
  },

  openEditor(ref) {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head"><h3>${ref ? 'Editar árbitro' : 'Novo árbitro'}</h3><button type="button" class="icon-btn" data-close>✕</button></div>
        <label class="field"><span>Nome</span><input id="re-name" value="${Utils.escapeHtml(ref?.name || '')}"></label>
        <label class="field"><span>Associação</span><input id="re-assoc" value="${Utils.escapeHtml(ref?.association || 'AF Braga')}"></label>
        <div class="dialog-actions">
          ${ref ? '<button type="button" class="btn btn-danger" id="re-del">Apagar</button>' : ''}
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="button" class="btn btn-primary" id="re-save">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const fechar = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', fechar));
    dlg.addEventListener('cancel', () => dlg.remove());
    dlg.querySelector('#re-save').addEventListener('click', async () => {
      const nome = dlg.querySelector('#re-name').value.trim();
      if (!nome) { dlg.querySelector('#re-name').focus(); return; }
      const novo = ref || { id: Utils.uid('ref'), traits: {}, notes: [], createdAt: Date.now() };
      novo.name = nome;
      novo.association = dlg.querySelector('#re-assoc').value.trim();
      await this.save(novo);
      fechar();
      window.location.hash = `#/arbitros/${novo.id}`;
      this.render(document.getElementById('app-root'), { id: novo.id });
    });
    dlg.querySelector('#re-del')?.addEventListener('click', async () => {
      const s = RefereeStats.compute(ref.id, this.entries, this.ownTeamId);
      if (!confirm(`Apagar "${ref.name}"?\n\n${s.games ? `Apitou ${s.games} jogo(s) registado(s) — esses jogos ficam sem ficha de árbitro, mas nada mais se perde.` : ''}`)) return;
      await DB.delete(DB.STORES.referees, ref.id);
      fechar();
      window.location.hash = '#/arbitros';
    });
    dlg.showModal();
  },
};

window.RefereesScreen = RefereesScreen;
