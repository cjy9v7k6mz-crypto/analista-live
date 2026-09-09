/**
 * planBuilder.js — Plano de Observação.
 * Permite montar o painel de eventos deste jogo a partir da biblioteca,
 * com prioridades, ordem, edição rápida e opção de reutilizar planos.
 */

const PlanBuilderScreen = {
  match: null,
  library: [],
  planEvents: [], // cópia dos eventos escolhidos para ESTE jogo (com priority/position próprios)
  searchTerm: '',

  async render(root, params) {
    this.match = await DB.get(DB.STORES.matches, params.matchId);
    if (!this.match) { window.location.hash = '#/dashboard'; return; }
    this.library = await DB.getAll(DB.STORES.library);
    this.planEvents = this.match.observationPlan && this.match.observationPlan.length
      ? [...this.match.observationPlan]
      : [];

    const savedPlans = await DB.getAll(DB.STORES.plans);

    root.innerHTML = `
      <div class="screen plan-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Plano de Observação</h1>
          <button class="btn btn-primary" id="btn-start-live">Continuar → Onze Inicial</button>
        </header>
        <p class="screen-subtitle">${Utils.escapeHtml(this.match.team)} vs ${Utils.escapeHtml(this.match.opponent)}</p>

        ${this.planEvents.length === 0 ? `
        <div class="plan-quickstart">
          <p class="muted">Como queres começar este plano?</p>
          <div class="quickstart-actions">
            <button class="btn" id="qs-empty">Plano vazio</button>
            <button class="btn" id="qs-duplicate" ${savedPlans.length === 0 ? 'disabled' : ''}>Duplicar plano anterior</button>
            <button class="btn" id="qs-template">Usar template</button>
          </div>
        </div>` : ''}

        <div class="plan-layout">
          <section class="plan-library">
            <div class="plan-library-head">
              <h2 class="section-title">Biblioteca de Eventos</h2>
              <input type="search" id="plan-search" placeholder="Pesquisar..." value="${Utils.escapeHtml(this.searchTerm)}">
            </div>
            <button class="btn btn-dashed btn-block" id="btn-new-library-event">＋ Criar novo evento</button>
            <button class="btn btn-dashed btn-block" id="btn-import-scouting">🎯 Importar focos do scouting do adversário</button>
            <div id="plan-library-list" class="plan-library-list"></div>
          </section>

          <section class="plan-selected">
            <div class="plan-selected-head">
              <h2 class="section-title">Plano deste Jogo (<span id="plan-count">${this.planEvents.length}</span>)</h2>
              <button class="btn btn-small" id="btn-save-plan-template">Guardar como plano reutilizável</button>
            </div>
            <div id="plan-selected-list" class="plan-selected-list"></div>
          </section>
        </div>
      </div>

      <dialog id="dlg-new-event" class="dialog">
        <form id="form-new-event" class="dialog-card">
          <h3>Novo Evento</h3>
          <label class="field"><span>Nome</span><input name="name" required autofocus></label>
          <label class="field"><span>Categoria</span>
            <select name="category">
              ${window.AnalistaLiveData.CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Prioridade</span>
            <select name="priority">
              <option value="critical">🔴 Crítico</option>
              <option value="important" selected>🟡 Importante</option>
              <option value="complementary">🟢 Complementar</option>
            </select>
          </label>
          <label class="field"><span>Tipo</span>
            <select name="type">
              <option value="neutral">Neutro</option>
              <option value="positive">Positivo</option>
              <option value="negative">Negativo</option>
            </select>
          </label>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-new-event">Cancelar</button>
            <button type="submit" class="btn btn-primary">Criar e adicionar ao plano</button>
          </div>
        </form>
      </dialog>

      <dialog id="dlg-save-plan" class="dialog">
        <form id="form-save-plan" class="dialog-card">
          <h3>Guardar Plano Reutilizável</h3>
          <label class="field"><span>Nome do plano</span><input name="planName" required placeholder="Ex: Plano vs equipa de pressão alta" autofocus></label>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-save-plan">Cancelar</button>
            <button type="submit" class="btn btn-primary">Guardar</button>
          </div>
        </form>
      </dialog>

      <dialog id="dlg-choose-plan" class="dialog">
        <div class="dialog-card">
          <h3 id="choose-plan-title">Escolher plano</h3>
          <div id="choose-plan-list" class="choose-plan-list"></div>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-choose-plan">Cancelar</button>
          </div>
        </div>
      </dialog>
    `;

    this.renderLibraryList();
    this.renderSelectedList();
    this.bindEvents(savedPlans);
  },

  renderLibraryList() {
    const container = document.getElementById('plan-library-list');
    if (!container) return;
    const selectedIds = new Set(this.planEvents.map((e) => e.libraryId || e.id));
    const term = this.searchTerm.toLowerCase();

    const byCategory = {};
    this.library
      .filter((e) => e.active !== false)
      .filter((e) => !term || e.name.toLowerCase().includes(term))
      .forEach((e) => {
        (byCategory[e.category] = byCategory[e.category] || []).push(e);
      });

    container.innerHTML = window.AnalistaLiveData.CATEGORIES.map((cat) => {
      const items = byCategory[cat.id] || [];
      if (items.length === 0) return '';
      return `
        <div class="lib-category">
          <h3 class="lib-category-title" style="border-color:${cat.color}">${cat.name}</h3>
          ${items.map((e) => `
            <div class="lib-row ${selectedIds.has(e.id) ? 'is-selected' : ''}" data-id="${e.id}">
              <span class="lib-row-priority">${Utils.PRIORITY_META[e.priority]?.dot || '•'}</span>
              <span class="lib-row-name">${Utils.escapeHtml(e.name)}</span>
              <button class="btn btn-tiny btn-add" data-add="${e.id}">${selectedIds.has(e.id) ? '✓' : '＋'}</button>
            </div>
          `).join('')}
        </div>
      `;
    }).join('') || '<p class="muted">Nenhum evento encontrado.</p>';
  },

  renderSelectedList() {
    const container = document.getElementById('plan-selected-list');
    const countEl = document.getElementById('plan-count');
    if (!container) return;
    if (countEl) countEl.textContent = this.planEvents.length;

    if (this.planEvents.length === 0) {
      container.innerHTML = '<p class="muted">Ainda não selecionaste eventos. Escolhe da biblioteca à esquerda.</p>';
      return;
    }

    const focusCount = this.planEvents.filter((e) => e.isFocus).length;

    container.innerHTML = `
      <p class="muted plan-focus-hint">⭐ Marca 5–8 eventos como "Foco" — ficam em destaque no painel LIVE. (${focusCount} marcados)</p>
      ${this.planEvents.map((e, idx) => `
      <div class="sel-row ${e.isFocus ? 'is-focus' : ''}" data-idx="${idx}">
        <div class="sel-row-order">
          <button class="btn btn-tiny" data-move="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn btn-tiny" data-move="down" data-idx="${idx}" ${idx === this.planEvents.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <button class="btn btn-tiny sel-row-focus-toggle ${e.isFocus ? 'is-active' : ''}" data-toggle-focus="${idx}" title="Marcar como Foco">⭐</button>
        <input class="sel-row-name" data-edit-name="${idx}" value="${Utils.escapeHtml(e.name)}">
        <select class="sel-row-priority" data-edit-priority="${idx}">
          <option value="critical" ${e.priority === 'critical' ? 'selected' : ''}>🔴 Crítico</option>
          <option value="important" ${e.priority === 'important' ? 'selected' : ''}>🟡 Importante</option>
          <option value="complementary" ${e.priority === 'complementary' ? 'selected' : ''}>🟢 Complementar</option>
        </select>
        <span class="sel-row-cat">${Utils.categoryLabel(e.category)}</span>
        <button class="btn btn-tiny btn-danger" data-remove="${idx}">✕</button>
      </div>
    `).join('')}
    `;
  },

  /**
   * Importa itens do scouting do adversário (pontos fracos, ameaças, gatilhos,
   * oportunidades, pontos fortes) como eventos do plano de observação.
   *
   * É sempre uma CÓPIA: alterar o plano depois nunca altera o scouting, e
   * editar o scouting não altera planos já criados.
   */
  async openScoutingImport() {
    const teamId = this.match.teams?.opponent?.teamId;
    const team = teamId ? await DB.get(DB.STORES.teams, teamId) : null;
    const sc = team?.scouting;

    const collected = [];
    if (sc) {
      SCOUTING_LISTS.forEach((list) => {
        (sc[list.id] || []).forEach((it) => collected.push({ ...it, _list: list }));
      });
    }
    // Os marcados com ⭐ no scouting vêm pré-selecionados.
    collected.sort((a, b) => (b.useAsFocus ? 1 : 0) - (a.useAsFocus ? 1 : 0));

    const dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    dlg.id = 'dlg-scouting-import';
    dlg.innerHTML = `
      <div class="dialog-card">
        <h3>🎯 Importar do Scouting</h3>
        ${!team ? '<p class="muted">Este jogo ainda não tem uma equipa adversária associada.</p>'
          : collected.length === 0
            ? `<p class="muted">Ainda não há registos no scouting de ${Utils.escapeHtml(team.name)}. Cria pontos fracos, ameaças ou gatilhos no Centro de Scouting e depois importa-os aqui.</p>
               <button class="btn btn-block" data-nav="#/scouting/${team.id}">Abrir Centro de Scouting</button>`
            : `
          <p class="muted">Escolhe o que queres observar neste jogo. Cada item entra como evento do plano (os marcados com ⭐ ficam como Foco).</p>
          <div class="sc-import-list">
            ${collected.map((it) => `
              <label class="sc-import-item">
                <input type="checkbox" data-import="${it.id}" ${it.useAsFocus ? 'checked' : ''}>
                <span class="sc-badge">${it._list.icon} ${it._list.title}</span>
                <span class="sc-import-title">${Utils.escapeHtml(it.title)}</span>
                ${it.useAsFocus ? '<span class="sc-badge">⭐ Foco</span>' : ''}
              </label>
            `).join('')}
          </div>`}
        <div class="dialog-actions">
          <button type="button" class="btn" id="si-cancel">Fechar</button>
          ${collected.length ? '<button type="button" class="btn btn-primary" id="si-import">Adicionar ao plano</button>' : ''}
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();

    document.getElementById('si-cancel').addEventListener('click', () => { dlg.close(); dlg.remove(); });
    const importBtn = document.getElementById('si-import');
    if (importBtn) importBtn.addEventListener('click', async () => {
      const chosen = Array.from(dlg.querySelectorAll('[data-import]:checked')).map((cb) => cb.dataset.import);
      let added = 0;
      for (const id of chosen) {
        const it = collected.find((x) => x.id === id);
        if (!it) continue;
        // Cria o evento também na biblioteca, para poder ser reutilizado noutros jogos.
        const libEvent = {
          id: Utils.uid('evt'),
          name: it.title,
          category: 'adversario',
          priority: it.priority === 'high' ? 'critical' : (it.priority === 'low' ? 'complementary' : 'important'),
          type: it._list.id === 'strengths' || it._list.id === 'threats' ? 'negative' : 'neutral',
          description: it.description || '',
          icon: '', color: '', active: true, isDefault: false,
          position: this.library.length,
          fromScouting: true,
        };
        await DB.put(DB.STORES.library, libEvent);
        this.library.push(libEvent);
        this.planEvents.push({
          id: Utils.uid('pe'), libraryId: libEvent.id, name: libEvent.name,
          category: libEvent.category, priority: libEvent.priority, type: libEvent.type,
          isFocus: !!it.useAsFocus, scoutingRef: { list: it._list.id, itemId: it.id },
        });
        added++;
      }
      dlg.close(); dlg.remove();
      document.querySelector('.plan-quickstart')?.remove();
      this.renderLibraryList();
      this.renderSelectedList();
      toast(`${added} ${added === 1 ? 'item importado' : 'itens importados'} do scouting`);
    });
  },

  toggleFocus(idx) {
    const e = this.planEvents[idx];
    const currentFocusCount = this.planEvents.filter((p) => p.isFocus).length;
    if (!e.isFocus && currentFocusCount >= 8) {
      if (!confirm('Já tens 8 eventos marcados como Foco. Continuar mesmo assim?')) return;
    }
    e.isFocus = !e.isFocus;
    this.renderSelectedList();
  },

  bindEvents(savedPlans) {
    document.getElementById('plan-search').addEventListener('input', (e) => {
      this.searchTerm = e.target.value;
      this.renderLibraryList();
    });

    document.getElementById('plan-library-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-add]');
      if (!btn) return;
      const libEvent = this.library.find((l) => l.id === btn.dataset.add);
      if (!libEvent) return;
      const already = this.planEvents.find((p) => (p.libraryId || p.id) === libEvent.id);
      if (already) {
        this.planEvents = this.planEvents.filter((p) => (p.libraryId || p.id) !== libEvent.id);
      } else {
        this.planEvents.push({
          id: Utils.uid('pe'),
          libraryId: libEvent.id,
          name: libEvent.name,
          category: libEvent.category,
          priority: libEvent.priority,
          type: libEvent.type,
          icon: libEvent.icon,
          color: libEvent.color,
        });
      }
      this.renderLibraryList();
      this.renderSelectedList();
    });

    document.getElementById('plan-selected-list').addEventListener('click', (e) => {
      const move = e.target.closest('[data-move]');
      const remove = e.target.closest('[data-remove]');
      const focusToggle = e.target.closest('[data-toggle-focus]');
      if (move) {
        const idx = Number(move.dataset.idx);
        const dir = move.dataset.move === 'up' ? -1 : 1;
        const target = idx + dir;
        if (target < 0 || target >= this.planEvents.length) return;
        [this.planEvents[idx], this.planEvents[target]] = [this.planEvents[target], this.planEvents[idx]];
        this.renderSelectedList();
      } else if (remove) {
        const idx = Number(remove.dataset.remove);
        this.planEvents.splice(idx, 1);
        this.renderSelectedList();
        this.renderLibraryList();
      } else if (focusToggle) {
        this.toggleFocus(Number(focusToggle.dataset.toggleFocus));
      }
    });

    document.getElementById('plan-selected-list').addEventListener('change', (e) => {
      const prioSel = e.target.closest('[data-edit-priority]');
      if (prioSel) {
        this.planEvents[Number(prioSel.dataset.editPriority)].priority = prioSel.value;
      }
    });

    document.getElementById('plan-selected-list').addEventListener('input', (e) => {
      const nameInput = e.target.closest('[data-edit-name]');
      if (nameInput) {
        this.planEvents[Number(nameInput.dataset.editName)].name = nameInput.value;
      }
    });

    // Novo evento
    const dlgNew = document.getElementById('dlg-new-event');
    document.getElementById('btn-new-library-event').addEventListener('click', () => dlgNew.showModal());

    // Importar focos do scouting do adversário (secção "Ligação ao plano de jogo").
    document.getElementById('btn-import-scouting').addEventListener('click', () => this.openScoutingImport());
    document.getElementById('cancel-new-event').addEventListener('click', () => dlgNew.close());
    document.getElementById('form-new-event').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newEvent = {
        id: Utils.uid('evt'),
        name: fd.get('name').trim(),
        category: fd.get('category'),
        priority: fd.get('priority'),
        type: fd.get('type'),
        description: '',
        icon: '',
        color: '',
        active: true,
        isDefault: false,
        position: this.library.length,
      };
      await DB.put(DB.STORES.library, newEvent);
      this.library.push(newEvent);
      this.planEvents.push({
        id: Utils.uid('pe'),
        libraryId: newEvent.id,
        name: newEvent.name,
        category: newEvent.category,
        priority: newEvent.priority,
        type: newEvent.type,
      });
      dlgNew.close();
      e.target.reset();
      this.renderLibraryList();
      this.renderSelectedList();
    });

    // Guardar plano reutilizável
    const dlgSave = document.getElementById('dlg-save-plan');
    document.getElementById('btn-save-plan-template').addEventListener('click', () => dlgSave.showModal());
    document.getElementById('cancel-save-plan').addEventListener('click', () => dlgSave.close());
    document.getElementById('form-save-plan').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const plan = {
        id: Utils.uid('plan'),
        name: fd.get('planName').trim(),
        events: this.planEvents,
        createdAt: Date.now(),
        opponentTag: this.match.opponent,
      };
      await DB.put(DB.STORES.plans, plan);
      dlgSave.close();
      toast('Plano guardado para reutilização');
    });

    // Quickstart
    const qsEmpty = document.getElementById('qs-empty');
    if (qsEmpty) qsEmpty.addEventListener('click', () => { qsEmpty.closest('.plan-quickstart').remove(); });

    const qsTemplate = document.getElementById('qs-template');
    if (qsTemplate) qsTemplate.addEventListener('click', () => this.openChoiceDialog('template'));

    const qsDuplicate = document.getElementById('qs-duplicate');
    if (qsDuplicate) qsDuplicate.addEventListener('click', () => this.openChoiceDialog('plan', savedPlans));

    document.getElementById('cancel-choose-plan').addEventListener('click', () => document.getElementById('dlg-choose-plan').close());

    document.getElementById('btn-start-live').addEventListener('click', async () => {
      if (this.planEvents.length === 0) {
        if (!confirm('Não selecionaste nenhum evento. Queres continuar mesmo assim? Podes adicionar eventos durante o jogo.')) return;
      }
      this.match.observationPlan = this.planEvents;
      this.match.updatedAt = Date.now();
      await DB.put(DB.STORES.matches, this.match);
      window.location.hash = `#/lineup/${this.match.id}`;
    });
  },

  openChoiceDialog(mode, savedPlans) {
    const dlg = document.getElementById('dlg-choose-plan');
    const title = document.getElementById('choose-plan-title');
    const list = document.getElementById('choose-plan-list');

    if (mode === 'template') {
      title.textContent = 'Escolher Template';
      list.innerHTML = window.AnalistaLiveData.DEFAULT_TEMPLATES.map((t) => `
        <button class="choose-plan-item" data-tpl="${t.id}">
          <strong>${Utils.escapeHtml(t.name)}</strong>
          <span class="muted">${Utils.escapeHtml(t.description)}</span>
        </button>
      `).join('');
      list.onclick = (e) => {
        const btn = e.target.closest('[data-tpl]');
        if (!btn) return;
        const tpl = window.AnalistaLiveData.DEFAULT_TEMPLATES.find((t) => t.id === btn.dataset.tpl);
        this.planEvents = tpl.eventNames
          .map((name) => this.library.find((l) => l.name === name))
          .filter(Boolean)
          .map((libEvent) => ({
            id: Utils.uid('pe'), libraryId: libEvent.id, name: libEvent.name,
            category: libEvent.category, priority: libEvent.priority, type: libEvent.type,
          }));
        dlg.close();
        document.querySelector('.plan-quickstart')?.remove();
        this.renderLibraryList();
        this.renderSelectedList();
      };
    } else {
      title.textContent = 'Duplicar Plano Anterior';
      if (!savedPlans || savedPlans.length === 0) {
        list.innerHTML = '<p class="muted">Ainda não guardaste nenhum plano.</p>';
      } else {
        list.innerHTML = savedPlans.map((p) => `
          <button class="choose-plan-item" data-plan="${p.id}">
            <strong>${Utils.escapeHtml(p.name)}</strong>
            <span class="muted">${p.events.length} eventos</span>
          </button>
        `).join('');
        list.onclick = (e) => {
          const btn = e.target.closest('[data-plan]');
          if (!btn) return;
          const plan = savedPlans.find((p) => p.id === btn.dataset.plan);
          this.planEvents = plan.events.map((e) => ({ ...e, id: Utils.uid('pe') }));
          dlg.close();
          document.querySelector('.plan-quickstart')?.remove();
          this.renderLibraryList();
          this.renderSelectedList();
        };
      }
    }
    dlg.showModal();
  },
};

function toast(msg) {
  // Reutiliza um único toast em vez de empilhar vários quando disparado em sucessão rápida.
  let el = document.querySelector('.toast');
  if (el) {
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth; // força reflow para reiniciar a transição
    el.classList.add('show');
  } else {
    el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
  }
  clearTimeout(toast._hideTimer);
  clearTimeout(toast._removeTimer);
  toast._hideTimer = setTimeout(() => {
    el.classList.remove('show');
    toast._removeTimer = setTimeout(() => el.remove(), 300);
  }, 2200);
}

window.PlanBuilderScreen = PlanBuilderScreen;
window.toast = toast;
