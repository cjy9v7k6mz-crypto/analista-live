/**
 * scouting.js — Centro de Inteligência do Adversário.
 *
 * Tudo o que é escrito aqui pertence à EQUIPA (é permanente e reutilizável
 * entre jogos), ao contrário das notas registadas durante um jogo, que
 * pertencem ao encontro. Essa separação é intencional e está visível na UI.
 *
 * Guarda imediatamente a cada alteração — nunca é preciso carregar em "guardar".
 */

const ScoutingScreen = {
  team: null,
  players: [],
  matches: [],
  tab: 'resumo',
  search: '',

  TABS: [
    { id: 'resumo', label: 'Resumo' },
    { id: 'modelo', label: 'Modelo de Jogo' },
    { id: 'listas', label: 'Forças / Ameaças' },
    { id: 'jogadores', label: 'Jogadores-Chave' },
    { id: 'bolasparadas', label: '⚽ Bolas Paradas' },
    { id: 'checklist', label: 'Checklist' },
    { id: 'notas', label: 'Notas' },
    { id: 'historico', label: 'Histórico' },
    { id: 'pesquisa', label: '🔍 Pesquisar' },
  ],

  async render(root, params) {
    this.team = await DB.get(DB.STORES.teams, params.teamId);
    if (!this.team) { window.location.hash = '#/teams'; return; }
    this.team.profile = this.team.profile || {};
    this.team.scouting = this.team.scouting || { strengths: [], weaknesses: [], threats: [], opportunities: [], triggers: [], keyPlayers: [], checklist: null, notes: [] };
    this.players = await AppState.getTeamPlayers(this.team.id);
    this.players.sort((a, b) => (a.number || 99) - (b.number || 99));
    const all = await DB.getAll(DB.STORES.matches);
    this.matches = all
      .filter((m) => m.teams?.opponent?.teamId === this.team.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    root.innerHTML = `
      <div class="screen scouting-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/team/${this.team.id}" aria-label="Voltar">←</button>
          <h1>Scouting · ${Utils.escapeHtml(this.team.name)}</h1>
          <span></span>
        </header>
        <nav class="cat-tabs scouting-tabs" id="sc-tabs">
          ${this.TABS.map((t) => `<button class="cat-tab ${t.id === this.tab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </nav>
        <div class="sc-meta-bar">
          <span class="muted">Última atualização: <strong>${this.team.scoutingUpdatedAt ? Utils.formatDate(this.team.scoutingUpdatedAt) : '—'}</strong>${this.team.lastScoutingChange ? ` · última alteração: ${Utils.escapeHtml(this.team.lastScoutingChange.section)}` : ''}</span>
          <button class="btn btn-small btn-primary" id="sc-pdf">📄 Gerar Scouting Report</button>
        </div>
        <div id="sc-body"></div>
      </div>

      <dialog id="dlg-sc-pdf" class="dialog dialog-wide">
        <div class="dialog-card">
          <h3>📄 Configurar Scouting Report</h3>
          <label class="field"><span>Título</span><input id="scp-title" value="Scouting Report"></label>
          <label class="field"><span>Subtítulo</span><input id="scp-subtitle" placeholder="Ex: Preparação para a jornada 3"></label>
          <p class="field-label">Secções a incluir</p>
          <div class="report-sections" id="scp-sections"></div>
          <div class="dialog-actions">
            <button type="button" class="btn" id="scp-cancel">Cancelar</button>
            <button type="button" class="btn" id="scp-template">Guardar como modelo</button>
            <button type="button" class="btn btn-primary" id="scp-generate">Gerar PDF</button>
          </div>
        </div>
      </dialog>
    `;

    document.getElementById('sc-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      document.querySelectorAll('#sc-tabs .cat-tab').forEach((t) => t.classList.toggle('active', t === b));
      this.renderBody();
    });

    this.renderBody();
    this.bindPdf();
  },

  /** Configuração e geração do Scouting Report (independente de jogos). */
  bindPdf() {
    const dlg = document.getElementById('dlg-sc-pdf');
    const saved = AppState.settings?.scoutingReportTemplate || null;

    document.getElementById('scp-sections').innerHTML = PDFScouting.SECTIONS.map((s) => {
      const checked = saved ? (saved.sections?.[s.key] ? 'checked' : '') : 'checked';
      return `<label class="report-section-item"><input type="checkbox" data-scp="${s.key}" ${checked}><span>${s.label}</span></label>`;
    }).join('');
    if (saved) {
      document.getElementById('scp-title').value = saved.title || 'Scouting Report';
      document.getElementById('scp-subtitle').value = saved.subtitle || '';
    }

    const readConfig = () => {
      const sections = {};
      document.querySelectorAll('#scp-sections [data-scp]').forEach((cb) => { sections[cb.dataset.scp] = cb.checked; });
      return {
        sections,
        title: document.getElementById('scp-title').value.trim(),
        subtitle: document.getElementById('scp-subtitle').value.trim(),
      };
    };

    document.getElementById('sc-pdf').addEventListener('click', () => dlg.showModal());
    document.getElementById('scp-cancel').addEventListener('click', () => dlg.close());
    document.getElementById('scp-template').addEventListener('click', async () => {
      await AppState.saveSettings({ scoutingReportTemplate: readConfig() });
      toast('Modelo de scouting guardado');
    });
    document.getElementById('scp-generate').addEventListener('click', async () => {
      const btn = document.getElementById('scp-generate');
      btn.disabled = true; btn.textContent = 'A gerar…';
      try {
        const ownTeam = await AppState.getOwnTeam();
        await PDFScouting.generate(
          { team: this.team, players: this.players, matches: this.matches, ownTeam },
          readConfig()
        );
        dlg.close();
        toast('Scouting Report gerado');
      } catch (err) {
        console.error('Erro no Scouting Report:', err);
        alert('Não foi possível gerar o PDF: ' + err.message);
      } finally {
        btn.disabled = false; btn.textContent = 'Gerar PDF';
      }
    });
  },

  async save(changeLabel) {
    this.team.updatedAt = Date.now();
    this.team.scoutingUpdatedAt = Date.now();
    if (changeLabel) {
      // Regista a última alteração e mantém um histórico curto de versões
      // (o que mudou e quando), sem versionamento pesado.
      this.team.lastScoutingChange = { section: changeLabel, at: Date.now() };
      this.team.scoutingHistory = this.team.scoutingHistory || [];
      const last = this.team.scoutingHistory[this.team.scoutingHistory.length - 1];
      const sameDay = last && new Date(last.at).toDateString() === new Date().toDateString() && last.section === changeLabel;
      if (!sameDay) {
        this.team.scoutingHistory.push({ section: changeLabel, at: Date.now() });
        if (this.team.scoutingHistory.length > 60) this.team.scoutingHistory.shift();
      }
    }
    await DB.put(DB.STORES.teams, this.team);
  },

  // ---------- Bolas paradas (galeria de esquemas) ----------
  SET_PIECE_CATEGORIES: [
    { key: 'corner_off', label: 'Canto ofensivo' },
    { key: 'corner_def', label: 'Canto defensivo' },
    { key: 'fk_off', label: 'Livre ofensivo' },
    { key: 'fk_def', label: 'Livre defensivo' },
    { key: 'throw', label: 'Lançamento' },
    { key: 'penalty', label: 'Penálti' },
    { key: 'other', label: 'Outro' },
  ],

  renderBolasParadas() {
    const list = this.team.scouting.setPieces || [];
    const byCat = {};
    list.forEach((sp) => { (byCat[sp.category] = byCat[sp.category] || []).push(sp); });

    document.getElementById('sc-body').innerHTML = `
      <div class="sc-section-head">
        <h2 class="sc-section-title">⚽ Bolas Paradas</h2>
        <button class="btn btn-small btn-primary" id="sp-add">＋ Esquema</button>
      </div>
      <p class="muted sc-hint">Carrega esquemas feitos noutra aplicação (JPG, PNG ou WEBP). As imagens são guardadas em boa resolução para o relatório e ficam disponíveis offline.</p>
      ${list.length === 0 ? '<p class="muted">Ainda não há esquemas. Toca em "＋ Esquema" para carregar o primeiro.</p>' : ''}
      ${this.SET_PIECE_CATEGORIES.filter((c) => byCat[c.key]).map((c) => `
        <section class="sc-section">
          <h3 class="sc-group-title">${c.label} <span class="muted">(${byCat[c.key].length})</span></h3>
          <div class="sp-grid">
            ${byCat[c.key].map((sp) => {
              const idx = list.indexOf(sp);
              return `
              <div class="sp-card">
                <div class="sp-thumb" data-view="${sp.id}">
                  <img src="${sp.image.thumb}" alt="${Utils.escapeHtml(sp.title)}" loading="lazy">
                </div>
                <div class="sp-body">
                  <strong>${Utils.escapeHtml(sp.title)}</strong>
                  ${sp.priority ? `<span class="sc-badge">${(SCOUTING_PRIORITIES.find((p) => p.key === sp.priority) || {}).label || ''}</span>` : ''}
                  ${sp.description ? `<p class="sc-item-desc">${Utils.escapeHtml(sp.description)}</p>` : ''}
                  <div class="sc-item-meta">${(sp.tags || []).map((t) => `<span class="sc-tag">#${Utils.escapeHtml(t)}</span>`).join('')}</div>
                  <div class="sp-actions">
                    <button class="btn btn-tiny" data-move-sp="${sp.id}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>▲</button>
                    <button class="btn btn-tiny" data-move-sp="${sp.id}" data-dir="1" ${idx === list.length - 1 ? 'disabled' : ''}>▼</button>
                    <button class="btn btn-tiny" data-edit-sp="${sp.id}">Editar</button>
                    <button class="btn btn-tiny" data-dup-sp="${sp.id}">Duplicar</button>
                    <button class="btn btn-tiny btn-danger" data-del-sp="${sp.id}">✕</button>
                  </div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </section>`).join('')}
    `;

    document.getElementById('sp-add').addEventListener('click', () => this.openSetPieceEditor(null));
    document.querySelectorAll('[data-edit-sp]').forEach((b) => b.addEventListener('click', () => this.openSetPieceEditor(b.dataset.editSp)));
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => this.viewSetPiece(b.dataset.view)));
    document.querySelectorAll('[data-dup-sp]').forEach((b) => b.addEventListener('click', async () => {
      const sp = this.team.scouting.setPieces.find((x) => x.id === b.dataset.dupSp);
      this.team.scouting.setPieces.push({ ...sp, id: Utils.uid('sp'), title: sp.title + ' (cópia)', createdAt: Date.now() });
      await this.save('Bolas Paradas');
      this.renderBolasParadas();
    }));
    document.querySelectorAll('[data-del-sp]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Apagar este esquema? A imagem é removida.')) return;
      this.team.scouting.setPieces = this.team.scouting.setPieces.filter((x) => x.id !== b.dataset.delSp);
      await this.save('Bolas Paradas');
      this.renderBolasParadas();
    }));
    document.querySelectorAll('[data-move-sp]').forEach((b) => b.addEventListener('click', async () => {
      const arr = this.team.scouting.setPieces;
      const i = arr.findIndex((x) => x.id === b.dataset.moveSp);
      const j = i + Number(b.dataset.dir);
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      await this.save('Bolas Paradas');
      this.renderBolasParadas();
    }));
  },

  /** Vista ampliada — a imagem completa, sem deformar nem cortar. */
  viewSetPiece(id) {
    const sp = this.team.scouting.setPieces.find((x) => x.id === id);
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>${Utils.escapeHtml(sp.title)}</h3>
          <button type="button" class="icon-btn" data-close>✕</button>
        </div>
        <img class="sp-full" src="${sp.image.full}" alt="">
        ${sp.description ? `<p class="sc-item-desc">${Utils.escapeHtml(sp.description)}</p>` : ''}
        ${sp.notes ? `<p class="muted">${Utils.escapeHtml(sp.notes)}</p>` : ''}
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-close]').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  },

  openSetPieceEditor(id) {
    const existing = id ? this.team.scouting.setPieces.find((x) => x.id === id) : null;
    let image = existing ? existing.image : null;
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    dlg.innerHTML = `
      <form class="dialog-card">
        <h3>${existing ? 'Editar' : 'Novo'} Esquema de Bola Parada</h3>
        <div class="sp-upload">
          <div class="sp-preview" id="sp-preview">${image ? `<img src="${image.thumb}" alt="">` : '<span class="muted">Sem imagem</span>'}</div>
          <label class="btn btn-small btn-file">${image ? 'Substituir imagem' : 'Carregar imagem'}<input type="file" id="sp-file" accept="image/png,image/jpeg,image/webp" hidden></label>
        </div>
        <label class="field"><span>Título</span><input name="title" required value="${Utils.escapeHtml(existing?.title || '')}" placeholder="Ex: Canto 1 — Primeiro poste"></label>
        <div class="field-row">
          <label class="field"><span>Categoria</span>
            <select name="category">
              ${this.SET_PIECE_CATEGORIES.map((c) => `<option value="${c.key}" ${existing?.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Prioridade</span>
            <select name="priority">
              <option value="">—</option>
              ${SCOUTING_PRIORITIES.map((p) => `<option value="${p.key}" ${existing?.priority === p.key ? 'selected' : ''}>${p.label}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="field"><span>Descrição</span><textarea name="description" rows="3" placeholder="Ex: Movimento do #9 ao primeiro poste. #5 bloqueia marcador.">${Utils.escapeHtml(existing?.description || '')}</textarea></label>
        <label class="field"><span>Notas</span><textarea name="notes" rows="2">${Utils.escapeHtml(existing?.notes || '')}</textarea></label>
        <label class="field"><span>Tags</span><input name="tags" value="${Utils.escapeHtml((existing?.tags || []).join(' '))}" placeholder="canto primeiro-poste"></label>
        <div class="dialog-actions">
          <button type="button" class="btn" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.showModal();

    dlg.querySelector('[data-cancel]').addEventListener('click', () => { dlg.close(); dlg.remove(); });
    dlg.querySelector('#sp-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      dlg.querySelector('#sp-preview').innerHTML = '<span class="muted">A processar…</span>';
      image = await ImageUtils.processTacticalImage(f);
      dlg.querySelector('#sp-preview').innerHTML = `<img src="${image.thumb}" alt="">`;
    });
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!image) { alert('Carrega uma imagem para o esquema.'); return; }
      const fd = new FormData(e.target);
      const sp = {
        id: existing?.id || Utils.uid('sp'),
        title: fd.get('title').trim(),
        category: fd.get('category'),
        priority: fd.get('priority'),
        description: fd.get('description').trim(),
        notes: fd.get('notes').trim(),
        tags: fd.get('tags').split(/\s+/).map((t) => t.replace('#', '').trim()).filter(Boolean),
        image,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      this.team.scouting.setPieces = this.team.scouting.setPieces || [];
      const idx = this.team.scouting.setPieces.findIndex((x) => x.id === sp.id);
      if (idx >= 0) this.team.scouting.setPieces[idx] = sp; else this.team.scouting.setPieces.push(sp);
      await this.save('Bolas Paradas');
      dlg.close(); dlg.remove();
      this.renderBolasParadas();
      toast('Esquema guardado');
    });
  },

  renderBody() {
    const fn = {
      resumo: () => this.renderResumo(),
      modelo: () => this.renderModelo(),
      listas: () => this.renderListas(),
      jogadores: () => this.renderJogadores(),
      bolasparadas: () => this.renderBolasParadas(),
      checklist: () => this.renderChecklist(),
      notas: () => this.renderNotas(),
      historico: () => this.renderHistorico(),
      pesquisa: () => this.renderPesquisa(),
    }[this.tab];
    fn();
  },

  /**
   * Pesquisa global — atravessa TODO o scouting desta equipa: campos do modelo
   * de jogo, listas, jogadores-chave, checklist, notas permanentes e ainda as
   * notas registadas durante os jogos anteriores contra esta equipa.
   */
  async renderPesquisa() {
    const body = document.getElementById('sc-body');
    body.innerHTML = `
      <input type="search" id="sc-global-search" class="sc-search" placeholder="Pesquisar em todo o scouting: palavra, jogador, categoria, #tag, prioridade..." value="${Utils.escapeHtml(this.search)}">
      <div id="sc-global-results"></div>
    `;
    const input = document.getElementById('sc-global-search');
    input.addEventListener('input', () => {
      this.search = input.value;
      this.renderGlobalResults();
    });
    input.focus();
    await this.renderGlobalResults();
  },

  async renderGlobalResults() {
    const out = document.getElementById('sc-global-results');
    const raw = this.search.trim().toLowerCase().replace('#', '');
    if (!raw) {
      out.innerHTML = '<p class="muted">Escreve para pesquisar em todo o perfil desta equipa.</p>';
      return;
    }
    const hit = (txt) => String(txt || '').toLowerCase().includes(raw);
    const groups = [];

    // 1. Campos do modelo de jogo
    const fieldHits = [];
    SCOUTING_SECTIONS.forEach((sec) => {
      sec.fields.forEach((f) => {
        const v = this.team.profile[f.key];
        if (v && (hit(v) || hit(f.label))) fieldHits.push({ sec, f, v });
      });
    });
    if (fieldHits.length) {
      groups.push({
        title: 'Modelo de Jogo', tab: 'modelo',
        html: fieldHits.map((x) => `<div class="sc-item"><div class="sc-item-head"><strong>${x.sec.icon} ${x.f.label}</strong></div><p class="sc-item-desc">${Utils.escapeHtml(x.v)}</p></div>`).join(''),
      });
    }

    // 2. Listas (forças, fracos, ameaças, oportunidades, gatilhos)
    SCOUTING_LISTS.forEach((list) => {
      const items = (this.team.scouting[list.id] || []).filter((it) => this.matchesSearch(it, raw));
      if (items.length) {
        groups.push({ title: `${list.icon} ${list.title}`, tab: 'listas', html: items.map((it) => this.itemCardHTML(list, it)).join('') });
      }
    });

    // 3. Jogadores-chave (nome do jogador ou conteúdo das notas)
    const kpHits = (this.team.scouting.keyPlayers || []).filter((k) => {
      const p = this.players.find((x) => x.id === k.playerId);
      const txt = KEY_PLAYER_FIELDS.map((f) => k[f.key]).join(' ');
      return hit(txt) || (p && (hit(p.name) || hit(String(p.number))));
    });
    if (kpHits.length) {
      groups.push({
        title: '👤 Jogadores-Chave', tab: 'jogadores',
        html: kpHits.map((k) => {
          const p = this.players.find((x) => x.id === k.playerId);
          const filled = KEY_PLAYER_FIELDS.filter((f) => k[f.key] && hit(k[f.key]));
          return `<div class="sc-item"><div class="sc-item-head"><strong>${p ? (p.number ? '#' + p.number + ' ' : '') + Utils.escapeHtml(p.name) : '—'}</strong></div>
            ${(filled.length ? filled : KEY_PLAYER_FIELDS.filter((f) => k[f.key])).slice(0, 3).map((f) => `<p class="sc-item-desc"><span class="muted">${f.label}:</span> ${Utils.escapeHtml(k[f.key])}</p>`).join('')}</div>`;
        }).join(''),
      });
    }

    // 4. Checklist
    const clHits = [];
    (this.team.scouting.checklist || []).forEach((g) => {
      g.items.filter((it) => hit(it.label) || hit(g.title)).forEach((it) => clHits.push({ g, it }));
    });
    if (clHits.length) {
      groups.push({
        title: '☑️ Checklist', tab: 'checklist',
        html: `<div class="sc-items">${clHits.map((x) => `<div class="sc-item"><strong>${Utils.escapeHtml(x.g.title)}</strong> · ${x.it.checked ? '☑' : '☐'} ${Utils.escapeHtml(x.it.label)}</div>`).join('')}</div>`,
      });
    }

    // 5. Notas permanentes
    const noteHits = (this.team.scouting.notes || []).filter((n) => hit(n.text) || (n.tags || []).some(hit));
    if (noteHits.length) {
      groups.push({
        title: '📝 Notas Permanentes', tab: 'notas',
        html: noteHits.map((n) => `<div class="sc-item"><p class="sc-item-desc">${Utils.escapeHtml(n.text)}</p><div class="sc-item-meta">${(n.tags || []).map((t) => `<span class="sc-tag">#${Utils.escapeHtml(t)}</span>`).join('')}</div></div>`).join(''),
      });
    }

    // 6. Notas registadas nos jogos contra esta equipa (contexto de cada jogo)
    const matchNoteHits = [];
    for (const m of this.matches) {
      const occ = await AppState.getOccurrences(m.id);
      occ.filter((o) => (o.note && hit(o.note)) || hit(o.eventName)).forEach((o) => matchNoteHits.push({ m, o }));
    }
    if (matchNoteHits.length) {
      groups.push({
        title: '🕓 Registos de Jogos Anteriores', tab: 'historico',
        html: matchNoteHits.slice(0, 20).map(({ m, o }) => `
          <div class="sc-item">
            <div class="sc-item-head"><strong>${Utils.escapeHtml(o.eventName)}</strong><span class="muted">${Utils.formatDate(m.date)}</span></div>
            ${o.note ? `<p class="sc-item-desc">${Utils.escapeHtml(o.note)}</p>` : ''}
            <div class="sc-item-meta"><span class="sc-badge sc-badge-time">${o.period} ${String(o.minute).padStart(2, '0')}'</span></div>
          </div>`).join(''),
      });
    }

    const total = groups.length;
    out.innerHTML = total ? groups.map((g) => `
      <section class="sc-section">
        <div class="sc-section-head">
          <h3 class="sc-section-title">${g.title}</h3>
          <button class="btn btn-tiny" data-goto-tab="${g.tab}">Abrir</button>
        </div>
        <div class="sc-items">${g.html}</div>
      </section>
    `).join('') : '<p class="muted">Sem resultados para esta pesquisa.</p>';

    out.querySelectorAll('[data-goto-tab]').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.gotoTab;
      document.querySelectorAll('#sc-tabs .cat-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === this.tab));
      this.renderBody();
    }));
  },

  // ---------- Resumo (perfil rápido) ----------
  renderResumo() {
    const p = this.team.profile;
    const sc = this.team.scouting;
    const topThreat = (sc.threats || []).find((t) => t.priority === 'high') || (sc.threats || [])[0];
    const topOpp = (sc.opportunities || []).find((t) => t.priority === 'high') || (sc.opportunities || [])[0];
    const quick = QUICK_PROFILE.map((q) => ({ label: q.label, value: p[q.key] })).filter((q) => q.value && q.value.trim());

    const counts = [
      ['🟢 Pontos fortes', (sc.strengths || []).length],
      ['🔴 Pontos fracos', (sc.weaknesses || []).length],
      ['⚠️ Ameaças', (sc.threats || []).length],
      ['🎯 Oportunidades', (sc.opportunities || []).length],
      ['🚦 Gatilhos', (sc.triggers || []).length],
      ['👤 Jogadores-chave', (sc.keyPlayers || []).length],
    ];

    document.getElementById('sc-body').innerHTML = `
      <section class="sc-quick">
        <h2 class="section-title">Perfil Rápido</h2>
        ${quick.length || topThreat || topOpp ? `
          <div class="sc-quick-grid">
            ${quick.map((q) => `<div class="sc-quick-card"><span class="muted">${q.label}</span><strong>${Utils.escapeHtml(q.value)}</strong></div>`).join('')}
            ${topThreat ? `<div class="sc-quick-card accent-yellow"><span class="muted">Principal ameaça</span><strong>${Utils.escapeHtml(topThreat.title)}</strong></div>` : ''}
            ${topOpp ? `<div class="sc-quick-card accent-blue"><span class="muted">Principal oportunidade</span><strong>${Utils.escapeHtml(topOpp.title)}</strong></div>` : ''}
          </div>
        ` : `<p class="muted">Sem dados suficientes. Preenche o Modelo de Jogo e as Ameaças para veres aqui um resumo.</p>`}
      </section>

      <section>
        <h2 class="section-title">Conteúdo Registado</h2>
        <div class="sc-counts">
          ${counts.map(([l, n]) => `<div class="sc-count ${n ? '' : 'is-empty'}"><strong>${n}</strong><span>${l}</span></div>`).join('')}
        </div>
      </section>

      ${this.matches.length ? `
      <section>
        <h2 class="section-title">Último Jogo</h2>
        <div class="game-row" data-nav="${this.matches[0].status === 'finished' ? `#/postgame/${this.matches[0].id}` : `#/live/${this.matches[0].id}`}">
          <div class="game-row-main">
            <strong>${Utils.escapeHtml(this.matches[0].team)} ${this.matches[0].score?.team ?? 0} - ${this.matches[0].score?.opponent ?? 0} ${Utils.escapeHtml(this.matches[0].opponent)}</strong>
            <span class="muted">${Utils.formatDate(this.matches[0].date)} · ${Utils.escapeHtml(this.matches[0].competition || '—')}</span>
          </div>
          <span class="chevron">›</span>
        </div>
      </section>` : ''}
    `;
  },

  // ---------- Modelo de jogo / secções táticas ----------
  renderModelo() {
    document.getElementById('sc-body').innerHTML = SCOUTING_SECTIONS.map((sec) => `
      <section class="sc-section">
        <h2 class="sc-section-title">${sec.icon} ${sec.title}</h2>
        <div class="sc-fields">
          ${sec.fields.map((f) => `
            <label class="field">
              <span>${f.label}</span>
              ${f.long
                ? `<textarea rows="2" data-profile="${f.key}" placeholder="${f.placeholder || ''}">${Utils.escapeHtml(this.team.profile[f.key] || '')}</textarea>`
                : `<input data-profile="${f.key}" value="${Utils.escapeHtml(this.team.profile[f.key] || '')}" placeholder="${f.placeholder || ''}">`}
            </label>
          `).join('')}
        </div>
        <div class="sc-blocks" data-blocks-for="${sec.id}">
          ${this.blocksHTML(sec.id)}
        </div>
        <div class="sc-block-actions">
          <button class="btn btn-tiny btn-dashed" data-add-block="${sec.id}" data-type="text">＋ Texto</button>
          <button class="btn btn-tiny btn-dashed" data-add-block="${sec.id}" data-type="image">＋ Imagem</button>
        </div>
      </section>
    `).join('') + '<p class="muted center sc-autosave">Guardado automaticamente.</p>';

    this.bindProfileFields();
    this.bindBlocks();
  },

  /**
   * Blocos livres de uma secção: texto ou imagem, ordenáveis. Complementam os
   * campos estruturados — servem para o que não cabe num campo fixo (um
   * esquema tático, uma observação longa, uma captura de vídeo).
   */
  blocksHTML(sectionId) {
    const blocks = (this.team.scouting.blocks || {})[sectionId] || [];
    if (!blocks.length) return '';
    return blocks.map((b, i) => `
      <div class="sc-block sc-block-${b.type}">
        <div class="sc-block-tools">
          <button class="btn btn-tiny" data-move-block="${b.id}" data-section="${sectionId}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn btn-tiny" data-move-block="${b.id}" data-section="${sectionId}" data-dir="1" ${i === blocks.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="btn btn-tiny" data-edit-block="${b.id}" data-section="${sectionId}">Editar</button>
          <button class="btn btn-tiny btn-danger" data-del-block="${b.id}" data-section="${sectionId}">✕</button>
        </div>
        ${b.type === 'image'
          ? `<figure class="sc-block-figure">
               <img src="${b.image.thumb}" alt="${Utils.escapeHtml(b.caption || '')}" data-zoom-block="${b.id}" data-section="${sectionId}" loading="lazy">
               ${b.caption ? `<figcaption>${Utils.escapeHtml(b.caption)}</figcaption>` : ''}
             </figure>`
          : `<p class="sc-block-text">${Utils.escapeHtml(b.text || '')}</p>`}
      </div>`).join('');
  },

  bindProfileFields() {
    let saveTimer = null;
    document.querySelectorAll('[data-profile]').forEach((el) => {
      const commit = async () => {
        this.team.profile[el.dataset.profile] = el.value.trim();
        await this.save('Modelo de Jogo');
      };
      el.addEventListener('change', commit);
      el.addEventListener('input', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(commit, 800);
      });
    });
    if (!this._blurGuard) {
      this._blurGuard = () => {
        const active = document.activeElement;
        if (active && active.dataset && active.dataset.profile) {
          this.team.profile[active.dataset.profile] = active.value.trim();
          this.save();
        }
      };
      document.addEventListener('visibilitychange', this._blurGuard);
      window.addEventListener('pagehide', this._blurGuard);
    }
  },

  bindBlocks() {
    document.querySelectorAll('[data-add-block]').forEach((b) => b.addEventListener('click', () =>
      this.openBlockEditor(b.dataset.addBlock, null, b.dataset.type)));
    document.querySelectorAll('[data-edit-block]').forEach((b) => b.addEventListener('click', () =>
      this.openBlockEditor(b.dataset.section, b.dataset.editBlock)));
    document.querySelectorAll('[data-del-block]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Apagar este bloco?')) return;
      const arr = this.team.scouting.blocks[b.dataset.section];
      this.team.scouting.blocks[b.dataset.section] = arr.filter((x) => x.id !== b.dataset.delBlock);
      await this.save('Modelo de Jogo');
      this.renderModelo();
    }));
    document.querySelectorAll('[data-move-block]').forEach((b) => b.addEventListener('click', async () => {
      const arr = this.team.scouting.blocks[b.dataset.section];
      const i = arr.findIndex((x) => x.id === b.dataset.moveBlock);
      const j = i + Number(b.dataset.dir);
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      await this.save('Modelo de Jogo');
      this.renderModelo();
    }));
    document.querySelectorAll('[data-zoom-block]').forEach((img) => img.addEventListener('click', () => {
      const b = (this.team.scouting.blocks[img.dataset.section] || []).find((x) => x.id === img.dataset.zoomBlock);
      if (!b) return;
      const dlg = document.createElement('dialog');
      dlg.className = 'dialog dialog-wide';
      dlg.innerHTML = `<div class="dialog-card">
        <div class="stats-head"><h3>${Utils.escapeHtml(b.caption || 'Imagem')}</h3><button type="button" class="icon-btn" data-close>✕</button></div>
        <img class="sp-full" src="${b.image.full}" alt="">
      </div>`;
      document.body.appendChild(dlg);
      dlg.showModal();
      dlg.querySelector('[data-close]').addEventListener('click', () => { dlg.close(); dlg.remove(); });
    }));
  },

  openBlockEditor(sectionId, blockId, forcedType) {
    const list = (this.team.scouting.blocks || {})[sectionId] || [];
    const existing = blockId ? list.find((x) => x.id === blockId) : null;
    const type = existing ? existing.type : forcedType;
    let image = existing ? existing.image : null;

    const dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    dlg.innerHTML = `
      <form class="dialog-card">
        <h3>${existing ? 'Editar' : 'Novo'} bloco de ${type === 'image' ? 'imagem' : 'texto'}</h3>
        ${type === 'image' ? `
          <div class="sp-upload">
            <div class="sp-preview" id="blk-preview">${image ? `<img src="${image.thumb}" alt="">` : '<span class="muted">Sem imagem</span>'}</div>
            <label class="btn btn-small btn-file">${image ? 'Substituir' : 'Carregar imagem'}<input type="file" id="blk-file" accept="image/png,image/jpeg,image/webp" hidden></label>
          </div>
          <label class="field"><span>Legenda</span><input name="caption" value="${Utils.escapeHtml(existing?.caption || '')}" placeholder="Ex: Estrutura 4-3-3 com bola"></label>
        ` : `
          <label class="field"><span>Texto</span><textarea name="text" rows="6" required autofocus>${Utils.escapeHtml(existing?.text || '')}</textarea></label>
        `}
        <div class="dialog-actions">
          <button type="button" class="btn" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-cancel]').addEventListener('click', () => { dlg.close(); dlg.remove(); });

    const fileInput = dlg.querySelector('#blk-file');
    if (fileInput) fileInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      dlg.querySelector('#blk-preview').innerHTML = '<span class="muted">A processar…</span>';
      // Mesma qualidade dos esquemas de bola parada: as imagens táticas têm de
      // continuar legíveis no PDF.
      image = await ImageUtils.processTacticalImage(f);
      dlg.querySelector('#blk-preview').innerHTML = `<img src="${image.thumb}" alt="">`;
    });

    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (type === 'image' && !image) { alert('Carrega uma imagem para este bloco.'); return; }
      const block = {
        id: existing?.id || Utils.uid('blk'),
        type,
        text: type === 'text' ? (fd.get('text') || '').trim() : '',
        caption: type === 'image' ? (fd.get('caption') || '').trim() : '',
        image: type === 'image' ? image : null,
        createdAt: existing?.createdAt || Date.now(),
      };
      this.team.scouting.blocks = this.team.scouting.blocks || {};
      this.team.scouting.blocks[sectionId] = this.team.scouting.blocks[sectionId] || [];
      const arr = this.team.scouting.blocks[sectionId];
      const idx = arr.findIndex((x) => x.id === block.id);
      if (idx >= 0) arr[idx] = block; else arr.push(block);
      await this.save(SCOUTING_SECTIONS.find((s) => s.id === sectionId)?.title || 'Modelo de Jogo');
      dlg.close(); dlg.remove();
      this.renderModelo();
      toast('Bloco guardado');
    });
  },


  // ---------- Listas (fortes / fracos / ameaças / oportunidades / gatilhos) ----------
  renderListas() {
    const term = this.search.toLowerCase();
    document.getElementById('sc-body').innerHTML = `
      <input type="search" id="sc-search" class="sc-search" placeholder="Pesquisar por palavra, categoria ou #tag..." value="${Utils.escapeHtml(this.search)}">
      ${SCOUTING_LISTS.map((list) => {
        const items = (this.team.scouting[list.id] || []).filter((it) => this.matchesSearch(it, term));
        return `
        <section class="sc-section">
          <div class="sc-section-head">
            <h2 class="sc-section-title accent-${list.accent}">${list.icon} ${list.title}</h2>
            <button class="btn btn-small" data-add-item="${list.id}">＋ Adicionar</button>
          </div>
          ${list.hint ? `<p class="muted sc-hint">${list.hint}</p>` : ''}
          <div class="sc-items">
            ${items.length ? items.map((it) => this.itemCardHTML(list, it)).join('') : '<p class="muted">Sem registos.</p>'}
          </div>
        </section>`;
      }).join('')}
    `;

    document.getElementById('sc-search').addEventListener('input', (e) => {
      this.search = e.target.value;
      const pos = e.target.selectionStart;
      this.renderListas();
      const el = document.getElementById('sc-search');
      el.focus();
      el.setSelectionRange(pos, pos);
    });

    document.querySelectorAll('[data-add-item]').forEach((b) =>
      b.addEventListener('click', () => this.openItemEditor(b.dataset.addItem, null)));
    document.querySelectorAll('[data-edit-item]').forEach((b) =>
      b.addEventListener('click', () => this.openItemEditor(b.dataset.list, b.dataset.editItem)));
    document.querySelectorAll('[data-del-item]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Apagar este registo?')) return;
        this.team.scouting[b.dataset.list] = this.team.scouting[b.dataset.list].filter((x) => x.id !== b.dataset.delItem);
        await this.save();
        this.renderListas();
      }));
    document.querySelectorAll('[data-zoom-item]').forEach((img) => img.addEventListener('click', () => {
      const it = (this.team.scouting[img.dataset.list] || []).find((x) => x.id === img.dataset.zoomItem);
      if (!it || !it.image) return;
      const d = document.createElement('dialog');
      d.className = 'dialog dialog-wide';
      d.innerHTML = `<div class="dialog-card"><div class="stats-head"><h3>${Utils.escapeHtml(it.title)}</h3><button type="button" class="icon-btn" data-close>✕</button></div><img class="sp-full" src="${it.image.full}" alt=""></div>`;
      document.body.appendChild(d); d.showModal();
      d.querySelector('[data-close]').addEventListener('click', () => { d.close(); d.remove(); });
    }));
    document.querySelectorAll('[data-toggle-focus-item]').forEach((b) =>
      b.addEventListener('click', async () => {
        const list = this.team.scouting[b.dataset.list];
        const it = list.find((x) => x.id === b.dataset.toggleFocusItem);
        it.useAsFocus = !it.useAsFocus;
        await this.save();
        this.renderListas();
        toast(it.useAsFocus ? 'Marcado para os focos do jogo' : 'Removido dos focos');
      }));
  },

  matchesSearch(it, term) {
    if (!term) return true;
    const hay = [it.title, it.description, it.category, it.priority, (it.tags || []).join(' ')].join(' ').toLowerCase();
    return hay.includes(term.replace('#', ''));
  },

  itemCardHTML(list, it) {
    const prio = SCOUTING_PRIORITIES.find((p) => p.key === it.priority);
    const players = (it.playerIds || []).map((id) => this.players.find((p) => p.id === id)).filter(Boolean);
    return `
      <div class="sc-item accent-${list.accent}">
        <div class="sc-item-head">
          <strong>${Utils.escapeHtml(it.title)}</strong>
          <div class="sc-item-actions">
            ${list.canFocus ? `<button class="btn btn-tiny ${it.useAsFocus ? 'btn-primary' : ''}" data-toggle-focus-item="${it.id}" data-list="${list.id}" title="Usar como foco no plano de observação">⭐ Foco</button>` : ''}
            <button class="btn btn-tiny" data-edit-item="${it.id}" data-list="${list.id}">Editar</button>
            <button class="btn btn-tiny btn-danger" data-del-item="${it.id}" data-list="${list.id}">✕</button>
          </div>
        </div>
        ${it.description ? `<p class="sc-item-desc">${Utils.escapeHtml(it.description)}</p>` : ''}
        ${it.image ? `<figure class="sc-block-figure sc-item-figure"><img src="${it.image.thumb}" alt="" data-zoom-item="${it.id}" data-list="${list.id}" loading="lazy">${it.caption ? `<figcaption>${Utils.escapeHtml(it.caption)}</figcaption>` : ''}</figure>` : ''}
        <div class="sc-item-meta">
          ${prio ? `<span class="sc-badge">${prio.label}</span>` : ''}
          ${it.category ? `<span class="sc-badge">${Utils.escapeHtml(it.category)}</span>` : ''}
          ${it.timeRef ? `<span class="sc-badge sc-badge-time">⏱ ${Utils.escapeHtml(it.timeRef)}</span>` : ''}
          ${players.map((p) => `<span class="sc-badge sc-badge-player">${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.shortName || p.name)}</span>`).join('')}
          ${(it.tags || []).map((t) => `<span class="sc-tag">#${Utils.escapeHtml(t)}</span>`).join('')}
        </div>
      </div>`;
  },

  openItemEditor(listId, itemId) {
    const list = SCOUTING_LISTS.find((l) => l.id === listId);
    const existing = itemId ? this.team.scouting[listId].find((x) => x.id === itemId) : null;
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `
      <form class="dialog-card">
        <h3>${list.icon} ${existing ? 'Editar' : 'Novo'} — ${list.title}</h3>
        <label class="field"><span>Título</span><input name="title" required autofocus value="${Utils.escapeHtml(existing?.title || '')}"></label>
        <label class="field"><span>Descrição</span><textarea name="description" rows="3">${Utils.escapeHtml(existing?.description || '')}</textarea></label>
        <div class="field-row">
          <label class="field"><span>Prioridade</span>
            <select name="priority">
              <option value="">—</option>
              ${SCOUTING_PRIORITIES.map((p) => `<option value="${p.key}" ${existing?.priority === p.key ? 'selected' : ''}>${p.label}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Categoria</span>
            <select name="category">
              <option value="">—</option>
              ${ITEM_CATEGORIES.map((c) => `<option value="${c}" ${existing?.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="sp-upload">
          <div class="sp-preview" id="item-img-preview">${existing?.image ? `<img src="${existing.image.thumb}" alt="">` : '<span class="muted">Sem imagem</span>'}</div>
          <div class="bg-image-actions">
            <label class="btn btn-tiny btn-file">${existing?.image ? 'Substituir imagem' : '＋ Imagem'}<input type="file" id="item-img-file" accept="image/png,image/jpeg,image/webp" hidden></label>
            ${existing?.image ? '<button type="button" class="btn btn-tiny btn-danger" id="item-img-remove">Remover</button>' : ''}
          </div>
        </div>
        <label class="field"><span>Legenda da imagem</span><input name="caption" value="${Utils.escapeHtml(existing?.caption || '')}" placeholder="Opcional"></label>
        <label class="field"><span>Referência de tempo (para procurar no vídeo/Once)</span><input name="timeRef" placeholder="Ex: 32:14" value="${Utils.escapeHtml(existing?.timeRef || '')}"></label>
        <label class="field"><span>Tags (separadas por espaço)</span><input name="tags" placeholder="pressão transição 10" value="${Utils.escapeHtml((existing?.tags || []).join(' '))}"></label>
        <label class="field"><span>Jogadores associados</span>
          <select name="playerIds" multiple size="4">
            ${this.players.map((p) => `<option value="${p.id}" ${(existing?.playerIds || []).includes(p.id) ? 'selected' : ''}>${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field checkbox-field"><input type="checkbox" name="useAsFocus" ${existing?.useAsFocus ? 'checked' : ''}><span>⭐ Usar como foco no plano de observação</span></label>
        <div class="dialog-actions">
          <button type="button" class="btn" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-cancel]').addEventListener('click', () => { dlg.close(); dlg.remove(); });

    let itemImage = existing?.image || null;
    dlg.querySelector('#item-img-file').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      dlg.querySelector('#item-img-preview').innerHTML = '<span class="muted">A processar…</span>';
      itemImage = await ImageUtils.processTacticalImage(f);
      dlg.querySelector('#item-img-preview').innerHTML = `<img src="${itemImage.thumb}" alt="">`;
    });
    const rmBtn = dlg.querySelector('#item-img-remove');
    if (rmBtn) rmBtn.addEventListener('click', () => {
      itemImage = null;
      dlg.querySelector('#item-img-preview').innerHTML = '<span class="muted">Sem imagem</span>';
    });

    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const item = {
        id: existing?.id || Utils.uid('sc'),
        image: itemImage,
        caption: (fd.get('caption') || '').trim(),
        title: fd.get('title').trim(),
        description: fd.get('description').trim(),
        priority: fd.get('priority'),
        category: fd.get('category'),
        timeRef: fd.get('timeRef').trim(),
        tags: fd.get('tags').split(/\s+/).map((t) => t.replace('#', '').trim()).filter(Boolean),
        playerIds: Array.from(e.target.playerIds.selectedOptions).map((o) => o.value),
        useAsFocus: e.target.useAsFocus.checked,
        createdAt: existing?.createdAt || Date.now(),
      };
      this.team.scouting[listId] = this.team.scouting[listId] || [];
      const idx = this.team.scouting[listId].findIndex((x) => x.id === item.id);
      if (idx >= 0) this.team.scouting[listId][idx] = item; else this.team.scouting[listId].push(item);
      await this.save();
      dlg.close(); dlg.remove();
      this.renderListas();
      toast('Registo guardado');
    });
  },

  // ---------- Jogadores-chave ----------
  renderJogadores() {
    const kp = this.team.scouting.keyPlayers || [];
    document.getElementById('sc-body').innerHTML = `
      <div class="sc-section-head">
        <h2 class="sc-section-title">👤 Jogadores-Chave</h2>
        <button class="btn btn-small" id="sc-add-kp" ${this.players.length ? '' : 'disabled'}>＋ Adicionar</button>
      </div>
      ${this.players.length === 0 ? '<p class="muted">Este plantel ainda não tem jogadores. Adiciona-os no perfil da equipa para poderes marcar jogadores-chave.</p>' : ''}
      <div class="sc-kp-list">
        ${kp.length ? kp.map((k) => {
          const p = this.players.find((x) => x.id === k.playerId);
          if (!p) return '';
          const filled = KEY_PLAYER_FIELDS.filter((f) => k[f.key] && k[f.key].trim());
          return `
            <div class="sc-kp-card">
              <div class="sc-kp-head">
                ${playerAvatar(p, 'md')}
                <div class="sc-kp-id">
                  <strong>${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.name)}</strong>
                  <span class="muted">${p.position || ''}${p.dominantFoot ? ' · ' + { D: 'Pé direito', E: 'Pé esquerdo', A: 'Ambidextro' }[p.dominantFoot] : ''}</span>
                </div>
                <button class="btn btn-tiny" data-edit-kp="${k.playerId}">Editar</button>
                <button class="btn btn-tiny btn-danger" data-del-kp="${k.playerId}">✕</button>
              </div>
              ${filled.length ? filled.map((f) => `
                <div class="sc-kp-field"><span class="muted">${f.label}</span><p>${Utils.escapeHtml(k[f.key])}</p></div>
              `).join('') : '<p class="muted">Sem notas ainda.</p>'}
              ${(k.images || []).length ? `<div class="sc-kp-images">${k.images.map((im, ii) => `
                <figure class="sc-block-figure"><img src="${im.thumb}" alt="" data-zoom-kp="${k.playerId}" data-idx="${ii}" loading="lazy">${im.caption ? `<figcaption>${Utils.escapeHtml(im.caption)}</figcaption>` : ''}</figure>
              `).join('')}</div>` : ''}
            </div>`;
        }).join('') : '<p class="muted">Nenhum jogador-chave marcado.</p>'}
      </div>
    `;

    const addBtn = document.getElementById('sc-add-kp');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const already = new Set((this.team.scouting.keyPlayers || []).map((k) => k.playerId));
      const result = await PlayerPicker.open({
        title: 'Escolher jogador-chave',
        groups: [{ label: this.team.name, players: this.players.filter((p) => !already.has(p.id)) }],
        multi: false,
      });
      if (!result || !result.players.length) return;
      this.openKeyPlayerEditor(result.players[0].id);
    });
    document.querySelectorAll('[data-zoom-kp]').forEach((img) => img.addEventListener('click', () => {
      const k = (this.team.scouting.keyPlayers || []).find((x) => x.playerId === img.dataset.zoomKp);
      const im = k && (k.images || [])[Number(img.dataset.idx)];
      if (!im) return;
      const d = document.createElement('dialog');
      d.className = 'dialog dialog-wide';
      d.innerHTML = `<div class="dialog-card"><div class="stats-head"><h3>${Utils.escapeHtml(im.caption || 'Imagem')}</h3><button type="button" class="icon-btn" data-close>✕</button></div><img class="sp-full" src="${im.full}" alt=""></div>`;
      document.body.appendChild(d); d.showModal();
      d.querySelector('[data-close]').addEventListener('click', () => { d.close(); d.remove(); });
    }));
    document.querySelectorAll('[data-edit-kp]').forEach((b) =>
      b.addEventListener('click', () => this.openKeyPlayerEditor(b.dataset.editKp)));
    document.querySelectorAll('[data-del-kp]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Remover este jogador-chave? As notas associadas são apagadas.')) return;
        this.team.scouting.keyPlayers = this.team.scouting.keyPlayers.filter((k) => k.playerId !== b.dataset.delKp);
        await this.save();
        this.renderJogadores();
      }));
  },

  openKeyPlayerEditor(playerId) {
    const p = this.players.find((x) => x.id === playerId);
    const existing = (this.team.scouting.keyPlayers || []).find((k) => k.playerId === playerId) || { playerId };
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    dlg.innerHTML = `
      <form class="dialog-card">
        <h3>${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.name)}</h3>
        ${KEY_PLAYER_FIELDS.map((f) => `
          <label class="field"><span>${f.label}</span><textarea name="${f.key}" rows="2">${Utils.escapeHtml(existing[f.key] || '')}</textarea></label>
        `).join('')}
        <p class="field-label">Imagens <span class="muted">(posicionamento, movimentos — podes juntar várias)</span></p>
        <div class="sc-kp-image-editor" id="kp-images"></div>
        <label class="btn btn-small btn-file">＋ Adicionar imagem<input type="file" id="kp-img-file" accept="image/png,image/jpeg,image/webp" hidden></label>
        <div class="dialog-actions">
          <button type="button" class="btn" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-cancel]').addEventListener('click', () => { dlg.close(); dlg.remove(); });
    let kpImages = [...(existing.images || [])];
    const renderKpImages = () => {
      const box = dlg.querySelector('#kp-images');
      box.innerHTML = kpImages.length ? kpImages.map((im, i) => `
        <div class="kp-img-row">
          <img src="${im.thumb}" alt="">
          <input class="kp-img-caption" data-cap="${i}" value="${Utils.escapeHtml(im.caption || '')}" placeholder="Legenda">
          <button type="button" class="btn btn-tiny btn-danger" data-rm-img="${i}">✕</button>
        </div>`).join('') : '<p class="muted">Sem imagens.</p>';
      box.querySelectorAll('[data-rm-img]').forEach((b) => b.addEventListener('click', () => {
        kpImages.splice(Number(b.dataset.rmImg), 1);
        renderKpImages();
      }));
      box.querySelectorAll('[data-cap]').forEach((inp) => inp.addEventListener('input', () => {
        kpImages[Number(inp.dataset.cap)].caption = inp.value;
      }));
    };
    renderKpImages();
    dlg.querySelector('#kp-img-file').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const img = await ImageUtils.processTacticalImage(f);
      kpImages.push({ ...img, caption: '' });
      renderKpImages();
      ev.target.value = '';
    });

    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const entry = { playerId, images: kpImages };
      KEY_PLAYER_FIELDS.forEach((f) => { entry[f.key] = (fd.get(f.key) || '').trim(); });
      this.team.scouting.keyPlayers = this.team.scouting.keyPlayers || [];
      const idx = this.team.scouting.keyPlayers.findIndex((k) => k.playerId === playerId);
      if (idx >= 0) this.team.scouting.keyPlayers[idx] = entry; else this.team.scouting.keyPlayers.push(entry);
      await this.save();
      dlg.close(); dlg.remove();
      this.renderJogadores();
      toast('Jogador-chave guardado');
    });
  },

  // ---------- Checklist ----------
  renderChecklist() {
    if (!this.team.scouting.checklist) {
      this.team.scouting.checklist = DEFAULT_CHECKLIST.map((g) => ({
        id: Utils.uid('cl'), title: g.title,
        items: g.items.map((label) => ({ id: Utils.uid('cli'), label, checked: false })),
      }));
    }
    const cl = this.team.scouting.checklist;
    document.getElementById('sc-body').innerHTML = `
      <div class="sc-section-head">
        <h2 class="sc-section-title">☑️ Checklist de Scouting</h2>
        <button class="btn btn-small" id="cl-add-group">＋ Secção</button>
      </div>
      ${cl.map((g) => `
        <section class="sc-section">
          <div class="sc-section-head">
            <h3 class="sc-group-title">${Utils.escapeHtml(g.title)}</h3>
            <div>
              <button class="btn btn-tiny" data-cl-add="${g.id}">＋ Item</button>
              <button class="btn btn-tiny btn-danger" data-cl-delgroup="${g.id}">✕</button>
            </div>
          </div>
          <div class="cl-items">
            ${g.items.map((it) => `
              <label class="cl-item ${it.checked ? 'is-checked' : ''}">
                <input type="checkbox" data-cl-toggle="${it.id}" data-group="${g.id}" ${it.checked ? 'checked' : ''}>
                <span>${Utils.escapeHtml(it.label)}</span>
                <button type="button" class="btn btn-tiny btn-danger" data-cl-del="${it.id}" data-group="${g.id}">✕</button>
              </label>
            `).join('')}
          </div>
        </section>
      `).join('')}
    `;

    document.getElementById('cl-add-group').addEventListener('click', async () => {
      const title = prompt('Nome da nova secção:');
      if (!title) return;
      this.team.scouting.checklist.push({ id: Utils.uid('cl'), title: title.trim(), items: [] });
      await this.save();
      this.renderChecklist();
    });
    document.querySelectorAll('[data-cl-add]').forEach((b) => b.addEventListener('click', async () => {
      const label = prompt('Novo item:');
      if (!label) return;
      const g = this.team.scouting.checklist.find((x) => x.id === b.dataset.clAdd);
      g.items.push({ id: Utils.uid('cli'), label: label.trim(), checked: false });
      await this.save();
      this.renderChecklist();
    }));
    document.querySelectorAll('[data-cl-toggle]').forEach((cb) => cb.addEventListener('change', async () => {
      const g = this.team.scouting.checklist.find((x) => x.id === cb.dataset.group);
      const it = g.items.find((x) => x.id === cb.dataset.clToggle);
      it.checked = cb.checked;
      await this.save();
      cb.closest('.cl-item').classList.toggle('is-checked', cb.checked);
    }));
    document.querySelectorAll('[data-cl-del]').forEach((b) => b.addEventListener('click', async (e) => {
      e.preventDefault();
      const g = this.team.scouting.checklist.find((x) => x.id === b.dataset.group);
      g.items = g.items.filter((x) => x.id !== b.dataset.clDel);
      await this.save();
      this.renderChecklist();
    }));
    document.querySelectorAll('[data-cl-delgroup]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Apagar esta secção da checklist?')) return;
      this.team.scouting.checklist = this.team.scouting.checklist.filter((x) => x.id !== b.dataset.clDelgroup);
      await this.save();
      this.renderChecklist();
    }));
  },

  // ---------- Notas permanentes ----------
  renderNotas() {
    const term = this.search.toLowerCase();
    const notes = (this.team.scouting.notes || [])
      .filter((n) => !term || [n.text, (n.tags || []).join(' ')].join(' ').toLowerCase().includes(term.replace('#', '')))
      .sort((a, b) => b.createdAt - a.createdAt);

    document.getElementById('sc-body').innerHTML = `
      <div class="sc-section-head">
        <h2 class="sc-section-title">📝 Notas Permanentes</h2>
        <button class="btn btn-small" id="sc-add-note">＋ Nota</button>
      </div>
      <p class="muted sc-hint">Estas notas pertencem à equipa e continuam válidas de jogo para jogo. As notas registadas durante um jogo ficam guardadas nesse encontro (ver Histórico).</p>
      <input type="search" id="sc-note-search" class="sc-search" placeholder="Pesquisar nota ou #tag..." value="${Utils.escapeHtml(this.search)}">
      <div class="sc-items">
        ${notes.length ? notes.map((n) => {
          const p = n.playerId ? this.players.find((x) => x.id === n.playerId) : null;
          return `
          <div class="sc-item">
            <div class="sc-item-head">
              <span class="muted">${new Date(n.createdAt).toLocaleDateString('pt-PT')}</span>
              <div class="sc-item-actions">
                <button class="btn btn-tiny" data-edit-note="${n.id}">Editar</button>
                <button class="btn btn-tiny btn-danger" data-del-note="${n.id}">✕</button>
              </div>
            </div>
            <p class="sc-item-desc">${Utils.escapeHtml(n.text)}</p>
            <div class="sc-item-meta">
              ${n.timeRef ? `<span class="sc-badge sc-badge-time">⏱ ${Utils.escapeHtml(n.timeRef)}</span>` : ''}
              ${p ? `<span class="sc-badge sc-badge-player">${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.shortName || p.name)}</span>` : ''}
              ${(n.tags || []).map((t) => `<span class="sc-tag">#${Utils.escapeHtml(t)}</span>`).join('')}
            </div>
          </div>`;
        }).join('') : '<p class="muted">Sem notas.</p>'}
      </div>
    `;

    document.getElementById('sc-note-search').addEventListener('input', (e) => {
      this.search = e.target.value;
      const pos = e.target.selectionStart;
      this.renderNotas();
      const el = document.getElementById('sc-note-search');
      el.focus(); el.setSelectionRange(pos, pos);
    });
    document.getElementById('sc-add-note').addEventListener('click', () => this.openNoteEditor(null));
    document.querySelectorAll('[data-edit-note]').forEach((b) =>
      b.addEventListener('click', () => this.openNoteEditor(b.dataset.editNote)));
    document.querySelectorAll('[data-del-note]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Apagar esta nota?')) return;
        this.team.scouting.notes = this.team.scouting.notes.filter((n) => n.id !== b.dataset.delNote);
        await this.save();
        this.renderNotas();
      }));
  },

  openNoteEditor(noteId) {
    const existing = noteId ? this.team.scouting.notes.find((n) => n.id === noteId) : null;
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `
      <form class="dialog-card">
        <h3>${existing ? 'Editar Nota' : 'Nova Nota'}</h3>
        <label class="field"><span>Texto</span><textarea name="text" rows="5" required autofocus>${Utils.escapeHtml(existing?.text || '')}</textarea></label>
        <label class="field"><span>Tags (separadas por espaço)</span><input name="tags" value="${Utils.escapeHtml((existing?.tags || []).join(' '))}" placeholder="pressão saída 10"></label>
        <div class="field-row">
          <label class="field"><span>Referência de tempo</span><input name="timeRef" placeholder="Ex: 32:14" value="${Utils.escapeHtml(existing?.timeRef || '')}"></label>
          <label class="field"><span>Jogador</span>
            <select name="playerId">
              <option value="">—</option>
              ${this.players.map((p) => `<option value="${p.id}" ${existing?.playerId === p.id ? 'selected' : ''}>${p.number ? '#' + p.number + ' ' : ''}${Utils.escapeHtml(p.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-cancel]').addEventListener('click', () => { dlg.close(); dlg.remove(); });
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const note = {
        id: existing?.id || Utils.uid('note'),
        text: fd.get('text').trim(),
        tags: fd.get('tags').split(/\s+/).map((t) => t.replace('#', '').trim()).filter(Boolean),
        timeRef: fd.get('timeRef').trim(),
        playerId: fd.get('playerId') || null,
        createdAt: existing?.createdAt || Date.now(),
      };
      this.team.scouting.notes = this.team.scouting.notes || [];
      const idx = this.team.scouting.notes.findIndex((n) => n.id === note.id);
      if (idx >= 0) this.team.scouting.notes[idx] = note; else this.team.scouting.notes.push(note);
      await this.save();
      dlg.close(); dlg.remove();
      this.renderNotas();
      toast('Nota guardada');
    });
  },

  // ---------- Histórico / evolução ----------
  async renderHistorico() {
    const body = document.getElementById('sc-body');
    body.innerHTML = '<p class="muted">A carregar…</p>';
    const rows = [];
    for (const m of this.matches) {
      const occ = await AppState.getOccurrences(m.id);
      rows.push({
        m,
        eventos: occ.length,
        momentos: occ.filter((o) => o.source === 'momento').length,
        notas: occ.filter((o) => o.source === 'nota'),
        focos: (m.observationPlan || []).filter((e) => e.isFocus).length,
        topFocos: (m.observationPlan || []).filter((e) => e.isFocus).slice(0, 3).map((e) => e.name),
        formacao: m.teams?.opponent?.formationId ? (getFormationPreset(m.teams.opponent.formationId)?.name || '') : '',
      });
    }

    body.innerHTML = `
      <h2 class="sc-section-title">🕓 Histórico de Jogos</h2>
      <p class="muted sc-hint">Cada jogo guarda o seu próprio contexto. Nada aqui é alterado quando editas o perfil da equipa.</p>

      ${rows.length > 1 ? `
      <section class="sc-section">
        <h3 class="sc-section-title">📈 Evolução entre jogos</h3>
        <p class="muted sc-hint">Comparação lado-a-lado do que foi registado em cada encontro, do mais antigo para o mais recente.</p>
        <div class="sc-evolution">
          ${[...rows].reverse().map((r, i) => `
            <div class="sc-evo-col">
              <span class="sc-evo-step">Jogo ${i + 1}</span>
              <strong>${Utils.formatDate(r.m.date)}</strong>
              <span class="muted">${r.m.score?.team ?? 0} - ${r.m.score?.opponent ?? 0} · ${r.m.venue === 'home' ? 'Casa' : 'Fora'}</span>
              <div class="sc-evo-facts">
                <span class="sc-badge">${r.formacao || 'Formação não definida'}</span>
                <span class="sc-badge">${r.eventos} eventos</span>
                <span class="sc-badge">${r.focos} focos</span>
              </div>
              ${r.topFocos.length ? `<p class="sc-evo-focos">${r.topFocos.map((f) => Utils.escapeHtml(f)).join(' · ')}</p>` : ''}
            </div>
          `).join('')}
        </div>
      </section>` : ''}

      ${rows.length ? rows.map((r) => `
        <div class="sc-history-card">
          <div class="sc-history-head" data-open-match="${r.m.id}" data-status="${r.m.status}">
            <div>
              <strong>${Utils.escapeHtml(r.m.team)} ${r.m.score?.team ?? 0} - ${r.m.score?.opponent ?? 0} ${Utils.escapeHtml(r.m.opponent)}</strong>
              <span class="muted">${Utils.formatDate(r.m.date)} · ${Utils.escapeHtml(r.m.competition || '—')} · ${r.m.venue === 'home' ? 'Casa' : 'Fora'}</span>
            </div>
            <span class="chevron">›</span>
          </div>
          <div class="sc-history-meta">
            ${r.formacao ? `<span class="sc-badge">Formação: ${r.formacao}</span>` : ''}
            <span class="sc-badge">${r.eventos} eventos</span>
            <span class="sc-badge">${r.momentos} momentos</span>
            <span class="sc-badge">${r.focos} focos no plano</span>
          </div>
          ${r.notas.length ? `<div class="sc-history-notes">
            <span class="muted">Notas deste jogo:</span>
            ${r.notas.slice(0, 4).map((n) => `<p class="sc-item-desc">${String(n.minute).padStart(2, '0')}' — ${Utils.escapeHtml(n.note)}</p>`).join('')}
          </div>` : ''}
        </div>
      `).join('') : '<p class="muted">Ainda não existem jogos contra esta equipa.</p>'}
    `;

    body.querySelectorAll('[data-open-match]').forEach((el) => el.addEventListener('click', () => {
      const id = el.dataset.openMatch;
      window.location.hash = el.dataset.status === 'finished' ? `#/postgame/${id}` : `#/live/${id}`;
    }));
  },
};

window.ScoutingScreen = ScoutingScreen;
