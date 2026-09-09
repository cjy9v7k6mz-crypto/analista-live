/**
 * rosterImport.js — Importação e exportação de plantéis.
 *
 * NOTA SOBRE O ZEROZERO (investigado antes de implementar):
 * Não foi encontrada qualquer API pública/oficial do zerozero.pt destinada a
 * integração por terceiros. O site declara "todos os direitos reservados",
 * condiciona o uso à aceitação dos Termos e Condições e usa reCAPTCHA (medida
 * explícita anti-automação). Acresce um impedimento técnico decisivo: esta
 * aplicação é uma PWA que corre no browser e, por política de CORS, não
 * consegue ler páginas de outro domínio sem um servidor intermediário — o que
 * contrariaria também o princípio de funcionamento offline e sem backend.
 *
 * Por isso NÃO foi implementado scraping nem acesso automatizado. Em vez
 * disso, esta é a alternativa segura e igualmente útil: o utilizador cola ou
 * carrega os dados que já tem (de onde tiver o direito de os usar) e a app
 * importa-os com pré-visualização, deteção de duplicados e confirmação.
 */

const RosterImport = {
  team: null,
  existing: [],
  parsed: [],
  onDone: null,
  _dlg: null,

  POSITIONS: ['GR', 'DC', 'DD', 'DE', 'MDC', 'MC', 'MCO', 'ED', 'EE', 'PL'],

  async open(team, { onDone } = {}) {
    this.team = team;
    this.existing = await AppState.getTeamPlayers(team.id);
    this.parsed = [];
    this.onDone = onDone || null;
    this._ensureDialog();
    this.renderInput();
    this._dlg.showModal();
  },

  _ensureDialog() {
    if (this._dlg) return this._dlg;
    const dlg = document.createElement('dialog');
    dlg.id = 'dlg-roster-import';
    dlg.className = 'dialog dialog-wide';
    document.body.appendChild(dlg);
    this._dlg = dlg;
    return dlg;
  },

  close() { if (this._dlg.open) this._dlg.close(); },

  renderInput() {
    this._dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>⬆️ Importar Plantel</h3>
          <button type="button" class="icon-btn" id="ri-close">✕</button>
        </div>
        <p class="muted">Cola a lista de jogadores (um por linha) ou carrega um ficheiro CSV. Formatos aceites por linha:</p>
        <pre class="ri-format">10, João Silva, MCO, D
João Silva
7;Pedro Costa;ED
Nome;Número;Posição;Pé</pre>
        <textarea id="ri-text" rows="8" placeholder="Cola aqui os jogadores…"></textarea>
        <div class="ri-actions">
          <label class="btn btn-small btn-file">📄 Carregar CSV<input type="file" id="ri-file" accept=".csv,.txt,text/csv,text/plain" hidden></label>
          <button class="btn btn-small" id="ri-export">⬇ Exportar plantel atual (CSV)</button>
        </div>
        <p class="muted ri-legal">Importa apenas dados que tenhas o direito de utilizar. A aplicação não recolhe dados de sites externos.</p>
        <div class="dialog-actions">
          <button type="button" class="btn" id="ri-cancel">Cancelar</button>
          <button type="button" class="btn btn-primary" id="ri-preview">Pré-visualizar →</button>
        </div>
      </div>`;

    this._dlg.querySelector('#ri-close').addEventListener('click', () => this.close());
    this._dlg.querySelector('#ri-cancel').addEventListener('click', () => this.close());
    this._dlg.querySelector('#ri-export').addEventListener('click', () => this.exportCSV());
    this._dlg.querySelector('#ri-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      this._dlg.querySelector('#ri-text').value = await f.text();
      toast('Ficheiro carregado — revê e pré-visualiza');
    });
    this._dlg.querySelector('#ri-preview').addEventListener('click', () => {
      const raw = this._dlg.querySelector('#ri-text').value;
      this.parsed = this.parse(raw);
      if (!this.parsed.length) {
        alert('Não foi possível reconhecer jogadores no texto colado. Verifica o formato (um jogador por linha).');
        return;
      }
      this.renderPreview();
    });
  },

  /** Analisa texto livre/CSV de forma tolerante: aceita `,` `;` ou tab. */
  parse(raw) {
    const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    lines.forEach((line) => {
      const parts = line.split(/[;,\t]/).map((p) => p.trim()).filter((p) => p !== '');
      if (!parts.length) return;
      // Ignora uma eventual linha de cabeçalho
      if (/^(nome|name|jogador|player)$/i.test(parts[0])) return;

      let number = null, name = '', position = '', foot = '';
      parts.forEach((p) => {
        if (number === null && /^\d{1,2}$/.test(p)) { number = Number(p); return; }
        if (!position && this.POSITIONS.includes(p.toUpperCase())) { position = p.toUpperCase(); return; }
        if (!foot && /^(d|e|a|direito|esquerdo|ambidextro)$/i.test(p)) {
          foot = p[0].toUpperCase(); return;
        }
        if (!name && /[a-zA-ZÀ-ÿ]{2,}/.test(p)) { name = p; }
      });
      if (!name) return;

      // Deteta se já existe: primeiro por número, depois por nome exato.
      const byNumber = number !== null ? this.existing.find((x) => x.number === number) : null;
      const byName = this.existing.find((x) => x.name.toLowerCase() === name.toLowerCase());
      const dup = byName || byNumber;

      out.push({
        tmpId: Utils.uid('imp'),
        name, number, position, foot,
        selected: true,
        duplicateOf: dup ? dup.id : null,
        duplicateReason: byName ? 'nome' : (byNumber ? 'número' : null),
        action: dup ? 'skip' : 'create', // skip | update | create
      });
    });
    return out;
  },

  renderPreview() {
    const dups = this.parsed.filter((p) => p.duplicateOf).length;
    this._dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>Pré-visualizar Importação</h3>
          <button type="button" class="icon-btn" id="ri-close">✕</button>
        </div>
        <p class="muted">${this.parsed.length} jogador(es) reconhecido(s)${dups ? ` · ${dups} já existe(m) no plantel` : ''}. Revê antes de importar.</p>
        <div class="ri-bulk">
          <button class="btn btn-tiny" id="ri-all">Selecionar todos</button>
          <button class="btn btn-tiny" id="ri-none">Desselecionar todos</button>
        </div>
        <div class="ri-list">
          ${this.parsed.map((p, i) => `
            <div class="ri-row ${p.duplicateOf ? 'is-dup' : ''}">
              <input type="checkbox" data-sel="${i}" ${p.selected ? 'checked' : ''}>
              <input class="ri-num" data-num="${i}" value="${p.number ?? ''}" placeholder="#" inputmode="numeric">
              <input class="ri-name" data-name="${i}" value="${Utils.escapeHtml(p.name)}">
              <select data-pos="${i}">
                <option value="">—</option>
                ${this.POSITIONS.map((pos) => `<option value="${pos}" ${p.position === pos ? 'selected' : ''}>${pos}</option>`).join('')}
              </select>
              ${p.duplicateOf ? `
                <select data-act="${i}" class="ri-action">
                  <option value="skip" ${p.action === 'skip' ? 'selected' : ''}>Utilizar existente</option>
                  <option value="update" ${p.action === 'update' ? 'selected' : ''}>Atualizar</option>
                  <option value="create" ${p.action === 'create' ? 'selected' : ''}>Criar cópia</option>
                </select>
                <span class="sc-badge">já existe (${p.duplicateReason})</span>` : '<span class="sc-badge">novo</span>'}
            </div>`).join('')}
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn" id="ri-back">← Voltar</button>
          <button type="button" class="btn btn-primary" id="ri-import">Importar selecionados</button>
        </div>
      </div>`;

    const d = this._dlg;
    d.querySelector('#ri-close').addEventListener('click', () => this.close());
    d.querySelector('#ri-back').addEventListener('click', () => this.renderInput());
    d.querySelector('#ri-all').addEventListener('click', () => { this.parsed.forEach((p) => p.selected = true); this.renderPreview(); });
    d.querySelector('#ri-none').addEventListener('click', () => { this.parsed.forEach((p) => p.selected = false); this.renderPreview(); });
    d.querySelectorAll('[data-sel]').forEach((cb) => cb.addEventListener('change', () => { this.parsed[Number(cb.dataset.sel)].selected = cb.checked; }));
    d.querySelectorAll('[data-num]').forEach((el) => el.addEventListener('input', () => { this.parsed[Number(el.dataset.num)].number = el.value ? Number(el.value) : null; }));
    d.querySelectorAll('[data-name]').forEach((el) => el.addEventListener('input', () => { this.parsed[Number(el.dataset.name)].name = el.value; }));
    d.querySelectorAll('[data-pos]').forEach((el) => el.addEventListener('change', () => { this.parsed[Number(el.dataset.pos)].position = el.value; }));
    d.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('change', () => { this.parsed[Number(el.dataset.act)].action = el.value; }));
    d.querySelector('#ri-import').addEventListener('click', () => this.doImport());
  },

  async doImport() {
    let created = 0, updated = 0, skipped = 0;
    for (const p of this.parsed) {
      if (!p.selected) { skipped++; continue; }
      if (p.duplicateOf && p.action === 'skip') { skipped++; continue; }

      if (p.duplicateOf && p.action === 'update') {
        const existing = this.existing.find((x) => x.id === p.duplicateOf);
        existing.name = p.name;
        if (p.number !== null) existing.number = p.number;
        if (p.position) existing.position = p.position;
        if (p.foot) existing.dominantFoot = p.foot;
        existing.source = { ...(existing.source || {}), importedAt: Date.now(), via: 'import' };
        await DB.put(DB.STORES.players, existing);
        updated++;
        continue;
      }

      const player = {
        id: Utils.uid('player'),
        teamId: this.team.id,
        name: p.name.trim(),
        shortName: p.name.trim().split(/\s+/).slice(-1)[0],
        number: p.number,
        position: p.position || 'DC',
        secondaryPosition: '',
        dominantFoot: p.foot || '',
        captain: false,
        starter: false,
        status: 'unused',
        photo: null,
        active: true,
        // Rastreio de origem: saber sempre de onde veio cada registo.
        source: { via: 'import', importedAt: Date.now() },
      };
      await DB.put(DB.STORES.players, player);
      created++;
    }
    this.close();
    toast(`${created} criado(s), ${updated} atualizado(s), ${skipped} ignorado(s)`);
    if (this.onDone) this.onDone();
  },

  /** Exporta o plantel atual em CSV — permite editar no Excel e reimportar. */
  exportCSV() {
    const header = ['Numero', 'Nome', 'Posicao', 'Pe'];
    const rows = this.existing
      .sort((a, b) => (a.number || 99) - (b.number || 99))
      .map((p) => [p.number ?? '', p.name, p.position || '', p.dominantFoot || '']);
    const csv = [header, ...rows].map((r) => r.join(';')).join('\n');
    const fname = `plantel_${this.team.name.replace(/\s+/g, '-')}.csv`;
    downloadFile(fname, '\uFEFF' + csv, 'text/csv;charset=utf-8');
    toast('Plantel exportado');
  },
};

window.RosterImport = RosterImport;
