/**
 * syncUI.js — Interface da sincronização:
 *   • escolha do transporte (Supabase se configurado, local caso contrário);
 *   • ecrã "Ligar Dispositivo" com código e QR;
 *   • comunicação rápida do analista para o banco;
 *   • indicador de estado da ligação.
 */

const SyncTransports = {
  /**
   * Escolhe o transporte adequado. O Supabase é o único que funciona entre
   * dispositivos em REDES DIFERENTES; o local serve para separadores do mesmo
   * browser (útil para experimentar sem configurar nada).
   */
  async pick() {
    if (await TransportSupabase.isConfigured()) return TransportSupabase;
    return TransportLocal;
  },

  async isCloud() {
    return TransportSupabase.isConfigured();
  },
};

const PairingScreen = {
  async render(root, params) {
    const matchId = params.matchId;
    const match = await DB.get(DB.STORES.matches, matchId);
    if (!match) { window.location.hash = '#/dashboard'; return; }

    const cloud = await SyncTransports.isCloud();
    const transport = await SyncTransports.pick();
    const session = await SyncCore.createSession(match, transport);
    const joinUrl = `${location.origin}${location.pathname}#/coach?code=${session.code}`;

    root.innerHTML = `
      <div class="screen pairing-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/live/${matchId}" aria-label="Voltar">←</button>
          <h1>Ligar Dispositivo</h1>
          <span></span>
        </header>

        <div class="pairing-card">
          <p class="muted">No iPad do banco, abre a aplicação, escolhe <strong>Modo Banco</strong> e introduz este código:</p>
          <div class="pairing-code">${session.code}</div>
          <div class="pairing-qr" id="pairing-qr"></div>
          <p class="muted pairing-url">${Utils.escapeHtml(joinUrl)}</p>

          <div class="pairing-status ${cloud ? 'is-cloud' : 'is-local'}">
            ${cloud
              ? '☁️ <strong>Sincronização pela nuvem ativa</strong> — funciona entre iPads em redes diferentes.'
              : '⚠️ <strong>Supabase não configurado.</strong> Neste momento a ligação só funciona entre separadores do mesmo dispositivo. Para ligar o iPad do banco (rede diferente), configura o Supabase em Definições → Sincronização.'}
          </div>

          <button class="btn btn-block btn-primary" id="pair-resend">🔄 Reenviar estado do jogo</button>
          <p class="muted" id="pair-diag"></p>
          <button class="btn btn-block" data-nav="#/settings">Definições de sincronização</button>
        </div>
      </div>`;

    this.renderQR(joinUrl);

    // Reenviar o snapshot resolve o caso mais comum: o banco entrou depois do
    // jogo começar, ou o primeiro envio falhou.
    const diag = document.getElementById('pair-diag');
    const paintDiag = async () => {
      const pend = await SyncCore.pendingCount();
      const estado = { online: 'ligado', syncing: 'a sincronizar', offline: 'sem ligação' }[SyncCore.status] || SyncCore.status;
      diag.textContent = `Estado: ${estado}${pend ? ` · ${pend} por enviar` : ''}${SyncCore.lastError ? ` · último erro: ${SyncCore.lastError}` : ''}`;
    };
    paintDiag();
    SyncCore.onStatus(() => paintDiag());

    document.getElementById('pair-resend').addEventListener('click', async () => {
      const btn = document.getElementById('pair-resend');
      btn.disabled = true; btn.textContent = 'A reenviar…';
      await SyncCore.publishSnapshot(match);
      await SyncCore.flush();
      await paintDiag();
      btn.disabled = false; btn.textContent = '🔄 Reenviar estado do jogo';
      toast('Estado do jogo reenviado');
    });
  },

  /**
   * QR gerado localmente, sem serviços externos (a app tem de funcionar sem
   * internet). Implementação mínima: usa a API de canvas para desenhar um
   * código simples — se a biblioteca não existir, mostramos só o código.
   */
  renderQR(url) {
    const box = document.getElementById('pairing-qr');
    if (!box) return;
    if (typeof window.QRSimple === 'function') {
      try { box.innerHTML = window.QRSimple(url); return; } catch (e) { /* segue para o fallback */ }
    }
    box.innerHTML = '<p class="muted">Introduz o código manualmente no outro dispositivo.</p>';
  },
};

/** Comunicação rápida analista → banco. */
const BenchMessaging = {
  PRESETS: [
    { icon: '📣', title: 'Pressão', text: 'A pressão está a funcionar — manter.', priority: 'normal' },
    { icon: '⚠️', title: 'Atenção', text: 'Estão a encontrar espaço entre linhas.', priority: 'high' },
    { icon: '🔴', title: 'Perigo', text: 'Estamos expostos nas costas da defesa.', priority: 'critical' },
    { icon: '🟢', title: 'Positivo', text: 'Corredor direito livre — explorar.', priority: 'normal' },
    { icon: '🧠', title: 'Nota', text: '', priority: 'normal' },
  ],

  open(live) {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.id = 'dlg-bench-msg';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head">
          <h3>📣 Comunicar ao Banco</h3>
          <button type="button" class="icon-btn" data-close>✕</button>
        </div>
        <div class="msg-presets">
          ${this.PRESETS.map((p, i) => `
            <button class="btn btn-lg msg-preset prio-${p.priority}" data-preset="${i}">
              <span>${p.icon} ${p.title}</span>
              ${p.text ? `<small>${Utils.escapeHtml(p.text)}</small>` : '<small>escrever…</small>'}
            </button>`).join('')}
        </div>
        <label class="field"><span>Mensagem personalizada</span><textarea id="msg-text" rows="3" placeholder="Ex: O lateral esquerdo deles está a sair demasiado."></textarea></label>
        <label class="field"><span>Prioridade</span>
          <select id="msg-priority">
            <option value="low">Baixa</option>
            <option value="normal" selected>Normal</option>
            <option value="high">Alta</option>
            <option value="critical">Crítica</option>
          </select>
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" id="msg-send">Enviar ao banco</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();

    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('[data-close]').addEventListener('click', close);

    dlg.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', async () => {
      const preset = this.PRESETS[Number(b.dataset.preset)];
      if (!preset.text) {
        // "Nota" abre o campo livre em vez de enviar algo vazio.
        dlg.querySelector('#msg-text').focus();
        return;
      }
      await this.send(live, preset.icon, preset.title, preset.text, preset.priority);
      close();
    }));

    dlg.querySelector('#msg-send').addEventListener('click', async () => {
      const text = dlg.querySelector('#msg-text').value.trim();
      if (!text) { dlg.querySelector('#msg-text').focus(); return; }
      await this.send(live, '🧠', 'Analista', text, dlg.querySelector('#msg-priority').value);
      close();
    });
  },

  async send(live, icon, title, text, priority) {
    const parts = AppState.timer ? AppState.timer.getGameTimeParts() : { minute: 0, period: '1T' };
    const msg = {
      id: Utils.uid('msg'),
      matchId: live.match.id,
      sender: 'analyst',
      icon, title, text,
      priority: priority || 'normal',
      minute: parts.minute,
      period: parts.period,
      createdAt: Date.now(),
      readStatus: false,
    };
    await DB.put(DB.STORES.messages, msg);
    SyncCore.publish('message', 'upsert', msg);
    // Fica também no histórico do jogo, para aparecer no relatório.
    await live.recordOccurrence({
      eventName: `Banco: ${title}`,
      category: 'banco', priority: priority === 'critical' ? 'critical' : 'important',
      source: 'banco', type: 'neutral', note: text,
    });
    live.renderHistory();
    toast('Mensagem enviada ao banco');
  },
};

/** Indicador discreto do estado da ligação, no ecrã do analista. */
const ConnectionBadge = {
  mount(container) {
    if (!container) return;
    const el = document.createElement('button');
    el.className = 'conn-badge';
    el.id = 'live-conn';
    el.title = 'Estado da sincronização';
    container.prepend(el);
    SyncCore.onStatus(async (st) => {
      const pending = await SyncCore.pendingCount();
      const map = {
        online: ['🟢', 'Sincronizado'],
        syncing: ['🟡', `A sincronizar${pending ? ` (${pending} pendentes)` : ''}`],
        offline: ['🔴', `Sem ligação — os eventos continuam a ser guardados localmente${pending ? ` (${pending} por enviar)` : ''}`],
      };
      const [icon, label] = map[st] || map.offline;
      el.textContent = icon;
      el.title = label;
      el.className = `conn-badge conn-${st}`;
    });
    el.addEventListener('click', async () => {
      const pending = await SyncCore.pendingCount();
      alert(pending
        ? `${pending} registo(s) por sincronizar. Vão ser enviados automaticamente assim que houver ligação — não é preciso fazer nada.`
        : 'Tudo sincronizado.');
    });
  },
};

window.SyncTransports = SyncTransports;
window.PairingScreen = PairingScreen;
window.BenchMessaging = BenchMessaging;
window.ConnectionBadge = ConnectionBadge;
