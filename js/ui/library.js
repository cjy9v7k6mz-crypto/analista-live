/**
 * library.js — Biblioteca de Eventos (gestão completa: criar, editar, duplicar, apagar, ordenar).
 */

const LibraryScreen = {
  library: [],
  search: '',

  async render(root) {
    this.library = await DB.getAll(DB.STORES.library);
    root.innerHTML = `
      <div class="screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Biblioteca de Eventos</h1>
          <button class="btn btn-primary" id="btn-add-event">＋ Novo Evento</button>
        </header>
        <div class="library-toolbar">
          <input type="search" id="lib-search" placeholder="Pesquisar eventos...">
        </div>
        <div id="library-table" class="library-table"></div>
      </div>

      <dialog id="dlg-edit-event" class="dialog">
        <form id="form-edit-event" class="dialog-card">
          <h3 id="edit-event-title">Editar Evento</h3>
          <input type="hidden" name="id">
          <label class="field"><span>Nome</span><input name="name" required></label>
          <label class="field"><span>Categoria</span>
            <select name="category">${window.AnalistaLiveData.CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
          </label>
          <label class="field"><span>Prioridade</span>
            <select name="priority">
              <option value="critical">🔴 Crítico</option>
              <option value="important">🟡 Importante</option>
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
          <label class="field"><span>Descrição</span><textarea name="description" rows="2"></textarea></label>
          <label class="field checkbox-field"><input type="checkbox" name="active"><span>Ativo (visível ao criar planos)</span></label>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-edit-event">Cancelar</button>
            <button type="submit" class="btn btn-primary">Guardar</button>
          </div>
        </form>
      </dialog>
    `;

    this.renderTable();
    this.bindEvents();
  },

  renderTable() {
    const container = document.getElementById('library-table');
    const term = this.search.toLowerCase();
    const filtered = this.library.filter((e) => !term || e.name.toLowerCase().includes(term));

    if (filtered.length === 0) {
      container.innerHTML = '<p class="muted">Nenhum evento encontrado.</p>';
      return;
    }

    container.innerHTML = window.AnalistaLiveData.CATEGORIES.map((cat) => {
      const items = filtered.filter((e) => e.category === cat.id);
      if (items.length === 0) return '';
      return `
        <div class="lib-mgmt-section">
          <h3 class="lib-category-title" style="border-color:${cat.color}">${cat.name}</h3>
          ${items.map((e) => `
            <div class="lib-mgmt-row ${e.active === false ? 'is-inactive' : ''}" data-id="${e.id}">
              <span class="lib-row-priority">${Utils.PRIORITY_META[e.priority]?.dot || ''}</span>
              <span class="lib-mgmt-name">${Utils.escapeHtml(e.name)}</span>
              <span class="lib-mgmt-type type-${e.type}">${e.type || 'neutral'}</span>
              ${e.active === false ? '<span class="muted">inativo</span>' : ''}
              <div class="lib-mgmt-actions">
                <button class="btn btn-tiny" data-edit="${e.id}">Editar</button>
                <button class="btn btn-tiny" data-duplicate="${e.id}">Duplicar</button>
                <button class="btn btn-tiny btn-danger" data-delete="${e.id}">Apagar</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }).join('');
  },

  bindEvents() {
    document.getElementById('lib-search').addEventListener('input', (e) => {
      this.search = e.target.value;
      this.renderTable();
    });

    const dlg = document.getElementById('dlg-edit-event');
    const form = document.getElementById('form-edit-event');

    document.getElementById('btn-add-event').addEventListener('click', () => {
      form.reset();
      form.id.value = '';
      form.active.checked = true;
      document.getElementById('edit-event-title').textContent = 'Novo Evento';
      dlg.showModal();
    });

    document.getElementById('cancel-edit-event').addEventListener('click', () => dlg.close());

    document.getElementById('library-table').addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit]');
      const dupBtn = e.target.closest('[data-duplicate]');
      const delBtn = e.target.closest('[data-delete]');

      if (editBtn) {
        const evt = this.library.find((l) => l.id === editBtn.dataset.edit);
        if (!evt) return;
        form.id.value = evt.id;
        form.name.value = evt.name;
        form.category.value = evt.category;
        form.priority.value = evt.priority;
        form.type.value = evt.type || 'neutral';
        form.description.value = evt.description || '';
        form.active.checked = evt.active !== false;
        document.getElementById('edit-event-title').textContent = 'Editar Evento';
        dlg.showModal();
      } else if (dupBtn) {
        const evt = this.library.find((l) => l.id === dupBtn.dataset.duplicate);
        if (!evt) return;
        const copy = { ...evt, id: Utils.uid('evt'), name: `${evt.name} (cópia)`, isDefault: false };
        await DB.put(DB.STORES.library, copy);
        this.library.push(copy);
        this.renderTable();
        toast('Evento duplicado');
      } else if (delBtn) {
        if (!confirm('Apagar este evento da biblioteca? Jogos já registados não são afetados.')) return;
        await DB.delete(DB.STORES.library, delBtn.dataset.delete);
        this.library = this.library.filter((l) => l.id !== delBtn.dataset.delete);
        this.renderTable();
        toast('Evento apagado');
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const id = fd.get('id') || Utils.uid('evt');
      const evt = {
        id,
        name: fd.get('name').trim(),
        category: fd.get('category'),
        priority: fd.get('priority'),
        type: fd.get('type'),
        description: fd.get('description').trim(),
        active: form.active.checked,
        icon: '', color: '', isDefault: false,
        position: this.library.length,
      };
      await DB.put(DB.STORES.library, evt);
      const idx = this.library.findIndex((l) => l.id === id);
      if (idx >= 0) this.library[idx] = evt; else this.library.push(evt);
      dlg.close();
      this.renderTable();
      toast('Evento guardado');
    });
  },
};

window.LibraryScreen = LibraryScreen;
