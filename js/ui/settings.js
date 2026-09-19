/**
 * settings.js — Definições e perfil do analista.
 */

const SettingsScreen = {
  async render(root) {
    const s = AppState.settings;
    root.innerHTML = `
      <div class="screen form-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Definições</h1>
          <span></span>
        </header>

        <form id="settings-form" class="form-card">
          <h2 class="section-title">Perfil</h2>
          <label class="field"><span>Nome do analista</span><input name="analystName" value="${Utils.escapeHtml(s.analystName || '')}"></label>
          <label class="field"><span>Equipa</span><input name="teamName" value="${Utils.escapeHtml(s.teamName || '')}"></label>

          <h2 class="section-title">Aparência</h2>
          <label class="field"><span>Tema</span>
            <select name="theme">
              <option value="stadium" ${(s.theme === 'stadium' || s.theme === 'dark' || !s.theme) ? 'selected' : ''}>Stadium (escuro, sóbrio)</option>
              <option value="midnight" ${s.theme === 'midnight' ? 'selected' : ''}>Midnight (mais escuro)</option>
              <option value="graphite" ${s.theme === 'graphite' ? 'selected' : ''}>Graphite (cinza premium)</option>
              <option value="forest" ${s.theme === 'forest' ? 'selected' : ''}>Forest (verde escuro)</option>
              <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Claro</option>
            </select>
          </label>
          <label class="field"><span>Fundo</span>
            <select name="background">
              <option value="solid" ${(s.background === 'solid' || !s.background) ? 'selected' : ''}>Sólido</option>
              <option value="gradient" ${s.background === 'gradient' ? 'selected' : ''}>Gradiente discreto</option>
              <option value="texture" ${s.background === 'texture' ? 'selected' : ''}>Textura subtil</option>
              <option value="pattern" ${s.background === 'pattern' ? 'selected' : ''}>Padrão discreto</option>
              <option value="image" ${s.background === 'image' ? 'selected' : ''}>Imagem personalizada</option>
            </select>
          </label>
          <div class="field" id="bg-image-controls" ${s.background === 'image' ? '' : 'hidden'}>
            <span>Imagem de fundo</span>
            <div class="bg-image-row">
              <div class="bg-image-preview" id="bg-image-preview">${s.backgroundImage ? `<img src="${s.backgroundImage}" alt="">` : '<span class="muted">Sem imagem</span>'}</div>
              <div class="bg-image-actions">
                <label class="btn btn-small btn-file">Carregar<input type="file" id="input-bg-image" accept="image/png,image/jpeg,image/webp" hidden></label>
                <button type="button" class="btn btn-small btn-danger" id="btn-remove-bg">Remover</button>
              </div>
            </div>
            <label class="field">
              <span>Escurecimento do fundo (protege a legibilidade)</span>
              <input type="range" name="backgroundOverlay" min="0.5" max="0.95" step="0.05" value="${s.backgroundOverlay ?? 0.82}">
            </label>
          </div>
          <label class="field"><span>Tamanho dos botões</span>
            <select name="buttonSize">
              <option value="large" ${s.buttonSize === 'large' ? 'selected' : ''}>Grande</option>
              <option value="medium" ${s.buttonSize === 'medium' ? 'selected' : ''}>Médio</option>
              <option value="compact" ${s.buttonSize === 'compact' ? 'selected' : ''}>Compacto</option>
            </select>
          </label>
          <label class="field"><span>Densidade do painel</span>
            <select name="density">
              <option value="comfortable" ${s.density === 'comfortable' ? 'selected' : ''}>Confortável</option>
              <option value="compact" ${s.density === 'compact' ? 'selected' : ''}>Compacta</option>
            </select>
          </label>

          <h2 class="section-title">Segurança dos dados</h2>
          <p class="muted settings-note">
            Os jogos, o scouting, os plantéis e a biblioteca ficam guardados só neste
            aparelho. A sincronização com o banco leva apenas o jogo em curso — não é
            uma cópia de segurança. Faz backups regulares e guarda o ficheiro fora do iPad.
          </p>
          <div class="data-safety" id="data-safety"><p class="muted">A verificar…</p></div>
          <div class="backup-panel">
            <button type="button" class="btn" id="btn-settings-backup">💾 Fazer backup agora</button>
            <button type="button" class="btn" data-nav="#/games">Restaurar um backup…</button>
          </div>

          <h2 class="section-title">Sincronização (multi-dispositivo)</h2>
          <p class="muted settings-note">
            Para ligar o iPad do banco quando está noutra rede, é preciso um projeto
            Supabase gratuito. Cola aqui o URL e a chave <strong>anon</strong> (é pública
            por desenho — nunca uses a chave <em>service_role</em>). O ficheiro
            <code>supabase-setup.sql</code>, incluído no projeto, cria a tabela e as
            regras de segurança.
          </p>
          <label class="field"><span>Supabase URL</span><input name="supabaseUrl" value="${Utils.escapeHtml(s.supabaseUrl || '')}" placeholder="https://xxxx.supabase.co" autocapitalize="off" autocorrect="off" spellcheck="false"><small class="muted">Sem barra no fim. Se colares o endereço do painel, é corrigido automaticamente.</small></label>
          <label class="field"><span>Supabase anon key</span><input name="supabaseAnonKey" value="${Utils.escapeHtml(s.supabaseAnonKey || '')}" placeholder="eyJhbGciOi..."></label>

          <button type="button" class="btn btn-block" id="btn-test-sync">🔌 Testar ligação ao Supabase</button>
          <pre class="sync-diag" id="sync-diag" hidden></pre>

          <h2 class="section-title">Interação</h2>
          <label class="field checkbox-field"><input type="checkbox" name="haptics" ${s.haptics ? 'checked' : ''}><span>Vibração (haptic feedback) ao registar evento</span></label>
          <label class="field"><span>Notas manuscritas — o que desenha</span>
            <select name="sketchInputMode">
              <option value="both" ${(s.sketchInputMode === 'both' || !s.sketchInputMode) ? 'selected' : ''}>Apple Pencil + dedo</option>
              <option value="pen" ${s.sketchInputMode === 'pen' ? 'selected' : ''}>Só Apple Pencil</option>
              <option value="touch" ${s.sketchInputMode === 'touch' ? 'selected' : ''}>Só dedo</option>
            </select>
          </label>
          <p class="muted settings-note">
            Dica para iPad: se a escrita com Apple Pencil falhar traços, desliga o
            "Scribble" em Definições → Apple Pencil. O iPadOS intercepta parte dos
            toques da caneta quando essa função está ativa.
          </p>

          <button type="submit" class="btn btn-primary btn-block btn-lg">Guardar Definições</button>
        </form>
      </div>
    `;

    // ---------- Fundo personalizado ----------
    const bgSelect = document.querySelector('select[name="background"]');
    const bgControls = document.getElementById('bg-image-controls');
    bgSelect.addEventListener('change', () => {
      bgControls.hidden = bgSelect.value !== 'image';
    });

    document.getElementById('input-bg-image').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Reutiliza o redimensionamento já existente para não guardar imagens enormes
      // no IndexedDB nem tornar o arranque lento.
      const img = await ImageUtils.processTeamLogo(file);
      await AppState.saveSettings({ backgroundImage: img, background: 'image' });
      document.getElementById('bg-image-preview').innerHTML = `<img src="${img}" alt="">`;
      bgSelect.value = 'image';
      bgControls.hidden = false;
      applyTheme();
      toast('Imagem de fundo aplicada');
    });

    document.getElementById('btn-remove-bg').addEventListener('click', async () => {
      await AppState.saveSettings({ backgroundImage: null, background: 'solid' });
      document.getElementById('bg-image-preview').innerHTML = '<span class="muted">Sem imagem</span>';
      bgSelect.value = 'solid';
      bgControls.hidden = true;
      applyTheme();
      toast('Imagem de fundo removida');
    });

    // Pré-visualização imediata do tema/fundo enquanto se escolhe
    ['theme', 'background', 'buttonSize', 'density'].forEach((name) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el) el.addEventListener('change', () => {
        AppState.settings = { ...AppState.settings, [name]: el.value };
        applyTheme();
      });
    });
    const overlayInput = document.querySelector('[name="backgroundOverlay"]');
    if (overlayInput) overlayInput.addEventListener('input', () => {
      AppState.settings = { ...AppState.settings, backgroundOverlay: Number(overlayInput.value) };
      applyTheme();
    });

    document.getElementById('btn-test-sync').addEventListener('click', async () => {
      const btn = document.getElementById('btn-test-sync');
      const box = document.getElementById('sync-diag');
      // Guarda primeiro, para testar exatamente o que está nos campos.
      await AppState.saveSettings({
        supabaseUrl: TransportSupabase.normalizeUrl(document.querySelector('[name="supabaseUrl"]').value),
        supabaseAnonKey: document.querySelector('[name="supabaseAnonKey"]').value.trim(),
      });
      btn.disabled = true; btn.textContent = 'A testar…';
      box.hidden = false;
      box.textContent = 'A testar…';
      const r = await TransportSupabase.testConnection();
      box.textContent = [
        `URL usado: ${r.url || '(vazio)'}`,
        `Chave: ${r.keyLength} caracteres`,
        ...(r.steps || []),
        r.ok ? '✅ Ligação OK — escrita e tempo real a funcionar.' : '❌ ' + r.error,
      ].join('\n');
      btn.disabled = false; btn.textContent = '🔌 Testar ligação ao Supabase';
    });

    // ---------- Segurança dos dados ----------
    const paintSafety = async () => {
      const el = document.getElementById('data-safety');
      if (!el) return;
      const status = await DataSafety.storageStatus();
      const last = AppState.settings?.lastBackupAt;
      const protection = !status.supported
        ? '<strong class="ds-muted">Não disponível neste browser</strong>'
        : (status.persisted ? '<strong class="ds-ok">✅ Protegido</strong>' : '<strong class="ds-warn">⚠️ Não protegido</strong>');
      el.innerHTML = `
        <div class="ds-row"><span>Proteção do armazenamento</span>${protection}</div>
        ${status.supported && !status.persisted ? `
          <p class="muted settings-note">Sem proteção, o browser pode limpar os dados se o aparelho ficar sem espaço.
            <button type="button" class="btn btn-small" id="btn-request-persist">Pedir proteção</button></p>` : ''}
        <div class="ds-row"><span>Último backup</span><strong class="${last ? '' : 'ds-warn'}">${last ? `${Utils.formatDate(last)} · ${DataSafety.relativeDays(last)}` : 'Nunca'}</strong></div>
        ${status.usage != null ? `<div class="ds-row"><span>Espaço ocupado pela app</span><strong>${DataSafety.formatBytes(status.usage)}</strong></div>` : ''}`;
      document.getElementById('btn-request-persist')?.addEventListener('click', async () => {
        const granted = await DataSafety.requestPersistence();
        toast(granted ? 'Armazenamento protegido' : 'O browser não concedeu a proteção — faz backups regulares');
        paintSafety();
      });
    };
    paintSafety();
    document.getElementById('btn-settings-backup').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await ExportManager.exportFullBackup();
        toast(r.ok ? 'Backup completo exportado' : 'Backup cancelado — nada foi guardado');
        if (r.ok) paintSafety();
      } catch (err) {
        console.error('Backup falhou:', err);
        alert('Não foi possível criar o backup: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await AppState.saveSettings({
        analystName: fd.get('analystName').trim(),
        teamName: fd.get('teamName').trim(),
        theme: fd.get('theme'),
        background: fd.get('background'),
        backgroundOverlay: Number(fd.get('backgroundOverlay') || 0.82),
        buttonSize: fd.get('buttonSize'),
        density: fd.get('density'),
        haptics: fd.get('haptics') === 'on',
        supabaseUrl: TransportSupabase.normalizeUrl(fd.get('supabaseUrl')),
        supabaseAnonKey: (fd.get('supabaseAnonKey') || '').trim(),
        sketchInputMode: fd.get('sketchInputMode'),
      });
      applyTheme();
      toast('Definições guardadas');
    });
  },
};

function applyTheme() {
  const s = AppState.settings;
  const root = document.documentElement;
  // "dark" era o valor usado nas versões anteriores — mapeado para "stadium".
  const theme = s?.theme === 'dark' || !s?.theme ? 'stadium' : s.theme;
  root.dataset.theme = theme;
  root.dataset.buttonSize = s?.buttonSize || 'large';
  root.dataset.density = s?.density || 'comfortable';
  root.dataset.bg = s?.background || 'solid';

  // Imagem de fundo personalizada (guardada localmente como data URL).
  if (s?.background === 'image' && s?.backgroundImage) {
    root.style.setProperty('--bg-image', `url("${s.backgroundImage}")`);
  } else {
    root.style.removeProperty('--bg-image');
  }
  // Intensidade do overlay: quanto maior, mais escuro (mais legível).
  root.style.setProperty('--bg-overlay', String(s?.backgroundOverlay ?? 0.82));
}

window.SettingsScreen = SettingsScreen;
window.applyTheme = applyTheme;
