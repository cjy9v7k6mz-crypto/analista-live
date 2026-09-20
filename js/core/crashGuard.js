/**
 * crashGuard.js — Rede de segurança para o que corre mal onde não se vê.
 *
 * Num iPad não há consola: um erro dentro de um handler de toque desaparece
 * sem deixar rasto, e o analista só descobre que algo partiu quando já é
 * tarde. Este módulo apanha tudo o que escapa (erros e promessas rejeitadas),
 * guarda as últimas ocorrências e avisa com discrição.
 *
 * Decisões deliberadas:
 *  - O registo vai para o `localStorage`, NÃO para o IndexedDB: muitas vezes é
 *    precisamente o IndexedDB que está a falhar, e um diário que depende do que
 *    avariou não serve de nada.
 *  - O aviso é discreto (uma barra que se fecha sozinha). A meio de um jogo,
 *    uma janela modal a pedir atenção faz mais estragos do que o erro.
 *  - Nunca deita a app abaixo: todo este ficheiro falha em silêncio se tiver de
 *    falhar. Uma rede de segurança que parte é pior do que não haver rede.
 */

const CrashGuard = {
  KEY: 'analista_live_errors',
  MAX: 25,
  entries: [],

  install() {
    try {
      this.entries = this._load();
      window.addEventListener('error', (e) => {
        // Erros de carregamento de recursos (img/script) chegam aqui sem `error`.
        const where = e.filename ? `${String(e.filename).split('/').pop()}:${e.lineno}` : '';
        this.record('erro', e.message || 'Erro sem mensagem', e.error && e.error.stack, where);
      });
      window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        const msg = (r && (r.message || r.name)) || String(r);
        this.record('promessa', msg, r && r.stack, '');
      });
    } catch (e) { /* uma rede de segurança nunca pode ser a causa da queda */ }
  },

  /** Regista uma falha. `notify` a falso para gravar sem incomodar o ecrã. */
  record(kind, message, stack, where, notify = true) {
    try {
      const entry = {
        at: Date.now(),
        kind,
        message: String(message || '').slice(0, 300),
        stack: String(stack || '').split('\n').slice(0, 4).join('\n').slice(0, 600),
        where: where || '',
        hash: location.hash || '',
      };
      this.entries.unshift(entry);
      if (this.entries.length > this.MAX) this.entries.length = this.MAX;
      this._save();
      if (notify) this.notify();
      return entry;
    } catch (e) { return null; }
  },

  /** Barra discreta, fecha-se sozinha. Não interrompe o registo do jogo. */
  notify() {
    try {
      let el = document.getElementById('crash-bar');
      if (!el) {
        el = document.createElement('div');
        el.id = 'crash-bar';
        el.className = 'crash-bar';
        document.body.appendChild(el);
      }
      el.innerHTML = '⚠️ Algo falhou por dentro. <button type="button" class="crash-bar-link" data-nav="#/settings">Ver diagnóstico</button>';
      el.classList.add('show');
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => el.classList.remove('show'), 7000);
    } catch (e) { /* ignora */ }
  },

  list() { return this.entries.slice(); },

  clear() {
    this.entries = [];
    try { localStorage.removeItem(this.KEY); } catch (e) { /* ignora */ }
  },

  /** Texto para copiar e enviar (pura: dá sempre o mesmo para a mesma lista). */
  toText(entries = this.entries) {
    if (!entries.length) return 'Sem falhas registadas.';
    return entries.map((e) => {
      const d = new Date(e.at);
      const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const dia = d.toLocaleDateString('pt-PT');
      return `[${dia} ${hora}] ${e.kind}${e.where ? ' @ ' + e.where : ''}${e.hash ? ' (' + e.hash + ')' : ''}\n${e.message}${e.stack ? '\n' + e.stack : ''}`;
    }).join('\n\n');
  },

  _load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, this.MAX) : [];
    } catch (e) { return []; }
  },

  _save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.entries)); } catch (e) { /* cheio ou bloqueado: perde-se o diário, não a app */ }
  },
};

window.CrashGuard = CrashGuard;
