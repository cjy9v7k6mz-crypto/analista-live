/**
 * teamProfile.js — Perfil de uma equipa: identidade (nome, logótipo, cores)
 * e plantel completo (jogadores com foto, número, posição).
 */

const TeamProfileScreen = {
  team: null,
  players: [],

  async render(root, params) {
    this.team = await DB.get(DB.STORES.teams, params.teamId);
    if (!this.team) { window.location.hash = '#/teams'; return; }
    this.players = await AppState.getTeamPlayers(this.team.id);
    this.players.sort((a, b) => (a.number || 99) - (b.number || 99));
    const formations = (await DB.getAll(DB.STORES.formations)).filter((f) => f.teamId === this.team.id);

    root.innerHTML = `
      <div class="screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/teams" aria-label="Voltar">←</button>
          <h1>${Utils.escapeHtml(this.team.name)}</h1>
          <span></span>
        </header>

        <section class="team-identity-card">
          <div class="team-identity-badge">
            ${teamBadge(this.team)}
            <label class="btn btn-tiny btn-file">Alterar logótipo<input type="file" id="input-logo" accept="image/png,image/jpeg,image/webp" hidden></label>
          </div>
          <div class="team-identity-fields">
            <label class="field"><span>Nome</span><input id="field-team-name" value="${Utils.escapeHtml(this.team.name)}" ${this.team.isOwnTeam ? '' : ''}></label>
            <div class="field-row">
              <label class="field"><span>Abreviatura</span><input id="field-team-abbr" maxlength="4" value="${Utils.escapeHtml(this.team.abbreviation || '')}"></label>
              <label class="field"><span>Cor principal</span><input type="color" id="field-team-color1" value="${this.team.colorPrimary || '#5b93f0'}"></label>
              <label class="field"><span>Cor secundária</span><input type="color" id="field-team-color2" value="${this.team.colorSecondary || '#12161f'}"></label>
            </div>
            <button class="btn btn-small" id="btn-save-identity">Guardar Identidade</button>
          </div>
        </section>

        <div class="screen-header" style="padding-top:6px">
          <h2 class="section-title" style="margin:0">Plantel (<span class="roster-count">${this.players.length}</span>)</h2>
          <div style="display:flex;gap:6px"><button class="btn btn-small" id="btn-import-roster">⬆️ Importar</button><button class="btn btn-primary btn-small" id="btn-add-player">＋ Jogador</button></div>
        </div>
        <div id="roster-list" class="roster-list"></div>

        <button class="btn btn-block scouting-entry" data-nav="#/scouting/${this.team.id}">
          🎯 Centro de Scouting — perfil, ameaças, jogadores-chave e histórico
        </button>
        <button class="btn btn-block" data-nav="#/squad-stats/${this.team.id}">
          📈 Estatísticas do plantel — golos, minutos, faltas… jogo a jogo
        </button>

        ${formations.length ? `
        <h2 class="section-title">Formações Guardadas</h2>
        <div class="formations-list">
          ${formations.map((f) => `
            <div class="formation-chip-row">
              <span>${Utils.escapeHtml(f.name)}</span>
              <button class="btn btn-tiny btn-danger" data-delete-formation="${f.id}">Apagar</button>
            </div>
          `).join('')}
        </div>` : ''}

        ${!this.team.isOwnTeam ? `<button class="btn btn-danger-outline" id="btn-delete-team" style="margin-top:16px">Apagar Equipa</button>` : ''}
      </div>

      <dialog id="dlg-player" class="dialog">
        <form id="form-player" class="dialog-card">
          <h3 id="player-dialog-title">Jogador</h3>
          <input type="hidden" name="id">
          <div class="player-photo-edit">
            <div id="player-photo-preview" class="player-avatar player-avatar-lg"></div>
            <label class="btn btn-tiny btn-file">Carregar foto<input type="file" id="input-player-photo" accept="image/png,image/jpeg,image/webp" hidden></label>
          </div>
          <label class="field"><span>Nome completo</span><input name="name" required></label>
          <label class="field"><span>Nome curto (aparece nos grafismos)</span><input name="shortName" maxlength="14"></label>
          <div class="field-row">
            <label class="field"><span>Número</span><input name="number" type="number" min="1" max="99"></label>
            <label class="field"><span>Posição</span>
              <select name="position">
                <option value="GR">GR</option><option value="DC">DC</option><option value="DD">DD</option>
                <option value="DE">DE</option><option value="MDC">MDC</option><option value="MC">MC</option>
                <option value="MCO">MCO</option><option value="ED">ED</option><option value="EE">EE</option>
                <option value="PL">PL</option><option value="OUTRA">Outra</option>
              </select>
            </label>
          </div>
          <div class="field-row">
            <label class="field"><span>Posição secundária</span>
              <select name="secondaryPosition">
                <option value="">—</option>
                <option value="GR">GR</option><option value="DC">DC</option><option value="DD">DD</option>
                <option value="DE">DE</option><option value="MDC">MDC</option><option value="MC">MC</option>
                <option value="MCO">MCO</option><option value="ED">ED</option><option value="EE">EE</option>
                <option value="PL">PL</option><option value="OUTRA">Outra</option>
              </select>
            </label>
            <label class="field"><span>Pé dominante</span>
              <select name="dominantFoot">
                <option value="">—</option>
                <option value="D">Direito</option>
                <option value="E">Esquerdo</option>
                <option value="A">Ambidextro</option>
              </select>
            </label>
          </div>
          <div class="field-row">
            <label class="field checkbox-field"><input type="checkbox" name="starter"><span>Titular habitual</span></label>
            <label class="field checkbox-field"><input type="checkbox" name="captain"><span>🎖️ Capitão</span></label>
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-player">Cancelar</button>
            <button type="submit" class="btn btn-primary">Guardar</button>
          </div>
        </form>
      </dialog>
    `;

    this.renderRoster();
    this.bindEvents();
  },

  renderRoster() {
    const container = document.getElementById('roster-list');
    const countEl = document.querySelector('.roster-count');
    if (countEl) countEl.textContent = this.players.length;
    if (this.players.length === 0) {
      container.innerHTML = '<p class="muted">Ainda não adicionaste jogadores a este plantel.</p>';
      return;
    }
    container.innerHTML = this.players.map((p) => `
      <div class="roster-row" data-id="${p.id}">
        ${playerAvatar(p, 'md')}
        <div class="roster-row-info">
          <strong>${Utils.escapeHtml(p.name)}${p.captain ? ' <span class="captain-badge" title="Capitão">🎖️</span>' : ''}</strong>
          <span class="muted">#${p.number || '-'} · ${p.position || ''}${p.secondaryPosition ? '/' + p.secondaryPosition : ''}${p.dominantFoot ? ' · ' + { D: 'Pé direito', E: 'Pé esquerdo', A: 'Ambidextro' }[p.dominantFoot] : ''}${p.starter ? ' · Titular habitual' : ''}</span>
        </div>
        <button class="btn btn-tiny" data-edit="${p.id}">Editar</button>
        <button class="btn btn-tiny btn-danger" data-delete="${p.id}">Apagar</button>
      </div>
    `).join('');
  },

  bindEvents() {
    // Identidade
    document.getElementById('btn-save-identity').addEventListener('click', async () => {
      this.team.name = document.getElementById('field-team-name').value.trim() || this.team.name;
      this.team.abbreviation = document.getElementById('field-team-abbr').value.trim().toUpperCase();
      this.team.colorPrimary = document.getElementById('field-team-color1').value;
      this.team.colorSecondary = document.getElementById('field-team-color2').value;
      await DB.put(DB.STORES.teams, this.team);
      if (this.team.isOwnTeam) await AppState.saveSettings({ teamName: this.team.name });
      toast('Identidade da equipa guardada');
      document.querySelector('.screen-header h1').textContent = this.team.name;
    });

    this.bindLogoInput();

    // Plantel
    const dlg = document.getElementById('dlg-player');
    const form = document.getElementById('form-player');
    let currentPhoto = null;

    const resetPhotoPreview = (photo) => {
      currentPhoto = photo || null;
      document.getElementById('player-photo-preview').innerHTML = currentPhoto
        ? `<img src="${currentPhoto.thumb || currentPhoto}" alt="">`
        : '<span class="player-avatar-placeholder">👤</span>';
    };

    document.getElementById('btn-import-roster').addEventListener('click', () => {
      RosterImport.open(this.team, { onDone: async () => {
        this.players = await AppState.getTeamPlayers(this.team.id);
        this.players.sort((a, b) => (a.number || 99) - (b.number || 99));
        this.renderRoster();
      } });
    });

    document.getElementById('btn-add-player').addEventListener('click', () => {
      form.reset();
      form.id.value = '';
      document.getElementById('player-dialog-title').textContent = 'Novo Jogador';
      resetPhotoPreview(null);
      dlg.showModal();
    });
    document.getElementById('cancel-player').addEventListener('click', () => dlg.close());

    document.getElementById('input-player-photo').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      currentPhoto = await ImageUtils.processPlayerPhoto(file);
      resetPhotoPreview(currentPhoto);
    });

    document.getElementById('roster-list').addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit]');
      const delBtn = e.target.closest('[data-delete]');
      if (editBtn) {
        const p = this.players.find((pl) => pl.id === editBtn.dataset.edit);
        form.id.value = p.id;
        form.name.value = p.name;
        form.shortName.value = p.shortName || '';
        form.number.value = p.number || '';
        form.position.value = p.position || 'DC';
        form.secondaryPosition.value = p.secondaryPosition || '';
        form.dominantFoot.value = p.dominantFoot || '';
        form.starter.checked = !!p.starter;
        form.captain.checked = !!p.captain;
        resetPhotoPreview(p.photo);
        document.getElementById('player-dialog-title').textContent = 'Editar Jogador';
        dlg.showModal();
      } else if (delBtn) {
        if (!confirm('Apagar este jogador do plantel? Os eventos já registados mantêm-se, apenas deixam de mostrar o jogador associado.')) return;
        await DB.delete(DB.STORES.players, delBtn.dataset.delete);
        this.players = this.players.filter((pl) => pl.id !== delBtn.dataset.delete);
        this.renderRoster();
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const id = fd.get('id') || Utils.uid('player');
      const player = {
        id,
        teamId: this.team.id,
        name: fd.get('name').trim(),
        shortName: fd.get('shortName').trim() || fd.get('name').trim().split(' ').slice(-1)[0],
        number: Number(fd.get('number')) || null,
        position: fd.get('position'),
        secondaryPosition: fd.get('secondaryPosition') || '',
        dominantFoot: fd.get('dominantFoot') || '',
        starter: form.starter.checked,
        captain: form.captain.checked,
        status: form.starter.checked ? 'starter' : 'unused',
        photo: currentPhoto,
        active: true,
      };
      await DB.put(DB.STORES.players, player);
      const idx = this.players.findIndex((p) => p.id === id);
      if (idx >= 0) this.players[idx] = player; else this.players.push(player);
      this.players.sort((a, b) => (a.number || 99) - (b.number || 99));
      dlg.close();
      this.renderRoster();
      toast('Jogador guardado');
    });

    // Formações guardadas
    document.querySelectorAll('[data-delete-formation]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Apagar esta formação guardada?')) return;
        await DB.delete(DB.STORES.formations, btn.dataset.deleteFormation);
        btn.closest('.formation-chip-row').remove();
      });
    });

    // Apagar equipa
    const delTeamBtn = document.getElementById('btn-delete-team');
    if (delTeamBtn) {
      delTeamBtn.addEventListener('click', async () => {
        if (!confirm(`Apagar "${this.team.name}" e todo o seu plantel? Esta ação não pode ser desfeita.`)) return;
        for (const p of this.players) await DB.delete(DB.STORES.players, p.id);
        await DB.delete(DB.STORES.teams, this.team.id);
        window.location.hash = '#/teams';
      });
    }
  },

  bindLogoInput() {
    const input = document.getElementById('input-logo');
    if (!input) return;
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.team.logo = await ImageUtils.processTeamLogo(file);
      await DB.put(DB.STORES.teams, this.team);
      const badgeWrap = document.querySelector('.team-identity-badge');
      const labelHtml = badgeWrap.querySelector('label').outerHTML;
      badgeWrap.innerHTML = teamBadge(this.team) + labelHtml;
      this.bindLogoInput(); // reata o listener ao novo <input> (o anterior foi substituído no DOM)
      toast('Logótipo atualizado');
    });
  },
};

/** Avatar reutilizável de jogador (com foto ou iniciais), em vários tamanhos: sm | md | lg */
function playerAvatar(player, size = 'md') {
  const cls = `player-avatar player-avatar-${size}`;
  if (player && player.photo && (player.photo.thumb || typeof player.photo === 'string')) {
    const src = player.photo.thumb || player.photo;
    return `<span class="${cls}"><img src="${src}" alt=""></span>`;
  }
  const initials = ImageUtils.initials(player ? (player.shortName || player.name) : '?');
  return `<span class="${cls} player-avatar-placeholder">${initials}</span>`;
}

window.TeamProfileScreen = TeamProfileScreen;
window.playerAvatar = playerAvatar;
