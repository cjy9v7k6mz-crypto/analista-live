/**
 * mirrorUI.js — Ecrãs do Espelho da Equipa: entrar com o link (equipa técnica),
 * o painel nas Definições (analista) e a faixa de estado do modo consulta.
 */

const FREE_PLAN_BYTES = 500 * 1024 * 1024;

const MirrorPairScreen = {
  async render(root, { token } = {}) {
    if (token && Mirror.isReader() && Mirror.decodeLink('#/equipa/' + token)?.readKey === Mirror.cfg.readKey) {
      // Já está ligado (o link guardado como favorito, por exemplo): segue.
      Mirror.pull().catch(() => {});
      window.location.hash = '#/dashboard';
      return;
    }

    root.innerHTML = `
      <div class="screen form-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Equipa técnica</h1>
          <span></span>
        </header>
        <div class="form-card mirror-pair" id="mirror-pair"></div>
      </div>`;
    const box = document.getElementById('mirror-pair');

    if (token) {
      this.run(box, '#/equipa/' + token);
      return;
    }

    box.innerHTML = `
      <h2 class="section-title">Entrar com o link do analista</h2>
      <p class="muted settings-note">Cola o link que o analista partilhou. Só é preciso
        uma vez: a partir daí este aparelho atualiza-se sozinho.</p>
      <label class="field"><span>Link</span>
        <input id="mirror-link" placeholder="https://…#/equipa/…" autocapitalize="off" autocorrect="off" spellcheck="false">
      </label>
      <div class="dialog-actions" style="justify-content:flex-start">
        <button type="button" class="btn" id="mirror-paste">📋 Colar</button>
        <button type="button" class="btn btn-primary" id="mirror-go">Entrar</button>
      </div>`;
    const input = document.getElementById('mirror-link');
    document.getElementById('mirror-paste').addEventListener('click', async () => {
      try {
        input.value = (await navigator.clipboard.readText()).trim();
      } catch (e) {
        toast('Não foi possível ler o que está copiado — cola à mão no campo');
        input.focus();
      }
    });
    document.getElementById('mirror-go').addEventListener('click', () => {
      if (!Mirror.decodeLink(input.value)) { toast('Este link não é válido'); return; }
      this.run(box, input.value);
    });
  },

  async run(box, link) {
    box.innerHTML = `
      <h2 class="section-title">A ligar ao iPad do analista…</h2>
      <p class="muted" id="mirror-progress">A confirmar o acesso…</p>`;
    const progress = document.getElementById('mirror-progress');
    try {
      const n = await Mirror.pair(link, {
        onProgress: (count) => { progress.textContent = `A descarregar… ${count.toLocaleString('pt-PT')} registos`; },
      });
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const standalone = DataSafety.isStandalone();
      box.innerHTML = `
        <h2 class="section-title">✅ Pronto</h2>
        <p>Este aparelho fica ligado ao iPad do analista e <strong>atualiza-se sozinho</strong>.
          Não vais precisar de código outra vez.</p>
        <p class="muted">${n.toLocaleString('pt-PT')} registos descarregados. É só consulta: o que mudares
          aqui não altera os dados do analista.</p>
        ${ios && !standalone ? `
        <p class="muted settings-note">
          <strong>Para ficar no ecrã principal:</strong> toca em Partilhar → “Adicionar ao ecrã principal”.
          O iPhone/iPad guarda essa app à parte do Safari: ao abri-la pela primeira vez, toca em
          “Entrar com o link” e em <em>Colar</em>. O link fica já copiado com o botão abaixo.
        </p>
        <button type="button" class="btn" id="mirror-copy-link">📋 Copiar o link</button>` : ''}
        <div class="dialog-actions" style="justify-content:flex-start">
          <button type="button" class="btn btn-primary" data-nav="#/dashboard">Abrir</button>
        </div>`;
      document.getElementById('mirror-copy-link')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(String(link).startsWith('http') ? link : location.href); toast('Link copiado'); } catch (e) { toast('Não foi possível copiar'); }
      });
    } catch (err) {
      box.innerHTML = `
        <h2 class="section-title">Não foi possível entrar</h2>
        <p class="muted">${Utils.escapeHtml(err.message)}</p>
        <div class="dialog-actions" style="justify-content:flex-start">
          <button type="button" class="btn btn-primary" id="mirror-retry">Tentar de novo</button>
          <button type="button" class="btn" data-nav="#/dashboard">Voltar</button>
        </div>`;
      document.getElementById('mirror-retry').addEventListener('click', () => this.run(box, link));
    }
  },
};

const MirrorUI = {
  _fresh: false,

  /** Faixa fixa em baixo, só em modo consulta: "Em dia · última alteração há 4 min". */
  installStatusPill() {
    if (document.getElementById('mirror-pill')) return;
    const pill = document.createElement('button');
    pill.id = 'mirror-pill';
    pill.type = 'button';
    pill.className = 'mirror-pill';
    pill.hidden = true;
    document.body.appendChild(pill);

    const paint = () => {
      const f = Mirror.freshness(Mirror.cfg, Date.now(), navigator.onLine);
      // No início o cartão de estado já diz o mesmo; ao entrar com o link, ainda não há nada a dizer.
      const h = location.hash || '#/dashboard';
      pill.hidden = !f || h === '#/dashboard' || h.startsWith('#/equipa');
      if (pill.hidden) return;
      pill.dataset.state = this._fresh ? 'new' : f.state;
      pill.textContent = this._fresh ? '↻ Há novidades do analista · toca para ver' : f.text;
    };
    pill.addEventListener('click', async () => {
      if (this._fresh) {
        this._fresh = false;
        paint();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        return;
      }
      pill.textContent = 'A atualizar…';
      try {
        await Mirror.pull();
      } catch (e) {
        toast(e.offline ? 'Sem internet — ficam os dados que já tens' : e.message);
      }
      paint();
    });

    Mirror.onChange((info) => {
      if (info.kind === 'pulled' && info.count > 0) {
        // Nas listas a novidade entra sozinha. Num relatório aberto, não se
        // muda o ecrã debaixo dos dedos de quem está a ler: avisa-se.
        const h = location.hash || '#/dashboard';
        const quiet = !document.querySelector('dialog[open]');
        if (quiet && (h === '#/dashboard' || h === '#/games')) window.dispatchEvent(new HashChangeEvent('hashchange'));
        else if (!h.startsWith('#/equipa')) this._fresh = true;
      }
      paint();
    });
    window.addEventListener('hashchange', () => { this._fresh = false; paint(); });
    window.addEventListener('online', paint);
    window.addEventListener('offline', paint);
    setInterval(paint, 20000);
    paint();
  },

  /** Lugar do painel nas Definições (preenchido por `paintSettings`). */
  settingsSectionHtml() {
    return `
      <h2 class="section-title">Equipa técnica (consulta 24/7)</h2>
      <div id="mirror-section"><p class="muted">A verificar…</p></div>`;
  },

  async paintSettings() {
    const el = document.getElementById('mirror-section');
    if (!el) return;
    const cfg = Mirror.cfg || {};

    if (Mirror.isReader()) {
      const f = Mirror.freshness(cfg, Date.now(), navigator.onLine);
      el.innerHTML = `
        <p class="muted settings-note">Este aparelho está em <strong>modo consulta</strong>, ligado ao iPad do
          analista. Os dados atualizam-se sozinhos sempre que a app está aberta.</p>
        <div class="data-safety">
          <div class="ds-row"><span>Estado</span><strong class="${f.state === 'ok' ? 'ds-ok' : 'ds-warn'}">${Utils.escapeHtml(f.text)}</strong></div>
        </div>
        <div class="backup-panel">
          <button type="button" class="btn" id="mirror-pull-now">↻ Atualizar agora</button>
          <button type="button" class="btn btn-danger" id="mirror-unpair">Sair do modo consulta</button>
        </div>`;
      document.getElementById('mirror-pull-now').addEventListener('click', async () => {
        try { const n = await Mirror.pull(); toast(n ? `${n} alterações recebidas` : 'Já estava em dia'); } catch (e) { toast(e.message); }
        this.paintSettings();
      });
      document.getElementById('mirror-unpair').addEventListener('click', async () => {
        if (!confirm('Sair do modo consulta?\n\nA cópia dos dados do analista é apagada deste aparelho. Para voltar, basta abrir o link outra vez.')) return;
        await Mirror.unpair();
        toast('Modo consulta desligado');
        window.location.hash = '#/dashboard';
      });
      return;
    }

    if (!Mirror.isWriter()) {
      el.innerHTML = `
        <p class="muted settings-note">
          Uma cópia sempre atualizada do que está neste iPad — jogos, relatórios, plantel, scouting,
          campeonato e árbitros — para o adjunto e a equipa técnica consultarem a qualquer hora, no
          telemóvel, iPad ou computador. Usa o mesmo projeto Supabase de cima (corre uma vez o ficheiro
          <code>supabase-espelho.sql</code>). Partilhas um link uma vez; quem o abrir fica a ver,
          só em consulta, sem código para escrever de cada vez.
        </p>
        <div class="backup-panel">
          <button type="button" class="btn btn-primary" id="mirror-activate">Ativar a consulta pela equipa técnica</button>
          <button type="button" class="btn" data-nav="#/equipa">Sou da equipa técnica — entrar com o link</button>
        </div>
        <p class="muted" id="mirror-msg"></p>`;
      document.getElementById('mirror-activate').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const msg = document.getElementById('mirror-msg');
        // Usa o que está escrito nos campos, mesmo antes de "Guardar".
        await AppState.saveSettings({
          supabaseUrl: TransportSupabase.normalizeUrl(document.querySelector('[name="supabaseUrl"]').value),
          supabaseAnonKey: document.querySelector('[name="supabaseAnonKey"]').value.trim(),
        });
        btn.disabled = true;
        msg.textContent = 'A ativar e a enviar tudo pela primeira vez…';
        try {
          await Mirror.activate();
          if (Mirror.cfg.lastError) throw new Error(Mirror.cfg.lastError);
          toast('Consulta ativada');
        } catch (err) {
          msg.textContent = '❌ ' + err.message;
          btn.disabled = false;
          return;
        }
        this.paintSettings();
      });
      return;
    }

    // iPad do analista com a partilha ativa.
    const pending = Mirror.pendingCount();
    const estado = cfg.lastError
      ? `<strong class="ds-warn">⚠️ ${Utils.escapeHtml(cfg.lastError)}</strong>`
      : pending ? `<strong class="ds-warn">${pending} alteração(ões) por enviar</strong>` : '<strong class="ds-ok">✅ Em dia</strong>';
    el.innerHTML = `
      <p class="muted settings-note">Ativo. Tudo o que gravas segue sozinho para a equipa técnica
        (durante um jogo, no máximo de 30 em 30 segundos; sem rede, quando ela voltar).</p>
      <div class="data-safety">
        <div class="ds-row"><span>Estado</span>${estado}</div>
        <div class="ds-row"><span>Último envio</span><strong>${cfg.lastPushAt ? `${Utils.formatDate(cfg.lastPushAt)} · ${new Date(cfg.lastPushAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}` : '—'}</strong></div>
        <div class="ds-row"><span>Na nuvem</span><strong id="mirror-usage">a calcular…</strong></div>
        <div class="ds-row"><span>Base de dados (plano gratuito: 500 MB)</span><strong id="mirror-db">…</strong></div>
      </div>
      <div class="backup-panel">
        <button type="button" class="btn btn-primary" id="mirror-share">📤 Partilhar o link</button>
        <button type="button" class="btn" id="mirror-copy">📋 Copiar o link</button>
        <button type="button" class="btn" id="mirror-resend">Enviar tudo de novo</button>
        <button type="button" class="btn" id="mirror-rotate">Mudar o link…</button>
        <button type="button" class="btn btn-danger" id="mirror-off">Desligar</button>
      </div>`;

    Mirror.status().then((st) => {
      if (!st) return;
      const u = document.getElementById('mirror-usage');
      const d = document.getElementById('mirror-db');
      if (u) u.textContent = `${Number(st.rows).toLocaleString('pt-PT')} registos · ${DataSafety.formatBytes(Number(st.bytes))}`;
      if (d) {
        const pct = Math.round((Number(st.dbBytes) / FREE_PLAN_BYTES) * 100);
        d.textContent = `${DataSafety.formatBytes(Number(st.dbBytes))} · ${pct}%`;
        d.className = pct >= 80 ? 'ds-warn' : 'ds-ok';
      }
    }).catch((err) => {
      const u = document.getElementById('mirror-usage');
      if (u) u.textContent = err.offline ? 'sem internet' : err.message;
    });

    const link = Mirror.shareLink();
    const copy = async () => {
      try { await navigator.clipboard.writeText(link); toast('Link copiado'); } catch (e) { window.prompt('Copia o link:', link); }
    };
    document.getElementById('mirror-copy').addEventListener('click', copy);
    document.getElementById('mirror-share').addEventListener('click', async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Analista Live — equipa técnica', text: 'Abre este link uma vez para acompanhares os jogos e os relatórios (só consulta).', url: link });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      copy();
    });
    document.getElementById('mirror-resend').addEventListener('click', async () => {
      Mirror._fullScan = true;
      toast('A comparar e a enviar…');
      await Mirror.flush();
      toast(Mirror.cfg.lastError ? 'Falhou: ' + Mirror.cfg.lastError : 'Equipa técnica em dia');
      this.paintSettings();
    });
    document.getElementById('mirror-rotate').addEventListener('click', async () => {
      if (!confirm('Mudar o link?\n\nQuem tem o link antigo deixa de ver os dados. Terás de partilhar o novo com quem deve continuar a ver.')) return;
      try { await Mirror.rotateReadKey(); toast('Link novo criado — partilha-o com a equipa técnica'); } catch (e) { alert(e.message); }
      this.paintSettings();
    });
    document.getElementById('mirror-off').addEventListener('click', async () => {
      if (!confirm('Desligar a consulta pela equipa técnica?\n\nDeixa de enviar alterações. O que já está na nuvem fica lá (desatualizado) até voltares a ligar.')) return;
      await Mirror.deactivate();
      this.paintSettings();
    });
  },
};

window.MirrorPairScreen = MirrorPairScreen;
window.MirrorUI = MirrorUI;
