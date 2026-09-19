/**
 * dataSafety.js — Proteção dos dados guardados no aparelho.
 *
 * Tudo o que a app sabe (jogos, dossiês de scouting, plantéis, biblioteca,
 * desenhos) vive no IndexedDB deste aparelho. A sincronização só leva o jogo
 * em curso para o banco — não é uma cópia de segurança. Daí duas coisas:
 *   1. pedir ao browser armazenamento persistente (não ser limpo quando o
 *      aparelho fica sem espaço);
 *   2. lembrar o backup quando há trabalho que ainda não está em nenhum.
 *
 * `backupReminder` é pura (recebe tudo por parâmetro) e está coberta pelos testes.
 */

const DataSafety = {
  DAY_MS: 24 * 60 * 60 * 1000,
  /** Lembra se já passou uma semana e houve alterações desde o último backup… */
  REMIND_AFTER_DAYS: 7,
  /** …ou, antes disso, se já há vários jogos por guardar. */
  REMIND_AFTER_CHANGED_MATCHES: 3,
  /** "Mais tarde" adia o aviso durante estes dias. */
  SNOOZE_DAYS: 3,

  /** App instalada no ecrã principal (iPad) — é aí que faz sentido pedir sozinha. */
  isStandalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    } catch (e) { return false; }
  },

  /**
   * Pede armazenamento persistente. Devolve true/false, ou null se o browser
   * não suportar. Nunca rebenta.
   */
  async requestPersistence() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return null;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch (e) {
      return null;
    }
  },

  /** Estado atual, para mostrar nas Definições. */
  async storageStatus() {
    const out = { supported: false, persisted: null, usage: null };
    try {
      if (navigator.storage && navigator.storage.persisted) {
        out.supported = true;
        out.persisted = await navigator.storage.persisted();
      }
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        out.usage = typeof e.usage === 'number' ? e.usage : null;
      }
    } catch (e) { /* fica com o que conseguiu */ }
    return out;
  },

  /**
   * O dossiê de scouting tem trabalho feito? As migrações criam em TODAS as
   * equipas (incluindo a nossa, criada no primeiro arranque) um esqueleto de
   * listas vazias — isso não é trabalho e não pode disparar o aviso. Conta como
   * conteúdo qualquer texto não vazio ou lista com elementos, em qualquer nível;
   * valores booleanos (marcas internas) e objetos vazios não contam.
   */
  hasScoutingContent(sc) {
    if (sc == null) return false;
    if (typeof sc === 'string') return sc.trim().length > 0;
    if (Array.isArray(sc)) return sc.length > 0;
    if (typeof sc === 'object') return Object.values(sc).some((v) => this.hasScoutingContent(v));
    return false;
  },

  /**
   * Decide se se deve lembrar o backup.
   * @returns {null | {reason: 'never'|'many'|'stale', days: number|null, changedMatches: number, changedTeams: number}}
   */
  backupReminder({ lastBackupAt = null, snoozeUntil = null, matches = [], teams = [], now = Date.now() } = {}) {
    if (snoozeUntil && snoozeUntil > now) return null;
    const scoutedTeams = teams.filter((t) => t && this.hasScoutingContent(t.scouting));
    // Sem jogos nem scouting não há nada que se perca de importante.
    if (!matches.length && !scoutedTeams.length) return null;

    if (!lastBackupAt) {
      return { reason: 'never', days: null, changedMatches: matches.length, changedTeams: scoutedTeams.length };
    }
    const changedMatches = matches.filter((m) => (m.updatedAt || m.createdAt || 0) > lastBackupAt).length;
    const changedTeams = teams.filter((t) => t && (t.updatedAt || 0) > lastBackupAt).length;
    const days = Math.max(0, Math.floor((now - lastBackupAt) / this.DAY_MS));

    if (changedMatches >= this.REMIND_AFTER_CHANGED_MATCHES) {
      return { reason: 'many', days, changedMatches, changedTeams };
    }
    if (days >= this.REMIND_AFTER_DAYS && changedMatches + changedTeams > 0) {
      return { reason: 'stale', days, changedMatches, changedTeams };
    }
    return null;
  },

  /** Título e detalhe do aviso, a partir do resultado de backupReminder. */
  reminderText(r) {
    if (!r) return null;
    if (r.reason === 'never') {
      return {
        title: 'Ainda não fizeste nenhum backup',
        detail: 'Os jogos, o scouting e os plantéis só existem neste aparelho. Um backup guarda tudo num ficheiro (Ficheiros, AirDrop, email).',
      };
    }
    const parts = [];
    if (r.changedMatches) parts.push(`${r.changedMatches} ${r.changedMatches === 1 ? 'jogo alterado' : 'jogos alterados'}`);
    if (r.changedTeams) parts.push(`o scouting de ${r.changedTeams} ${r.changedTeams === 1 ? 'equipa' : 'equipas'}`);
    return {
      title: `Último backup ${this.relativeDays(Date.now() - r.days * this.DAY_MS)}`,
      detail: `${parts.join(' e ')} desde então — ainda não ${r.changedMatches + r.changedTeams === 1 ? 'está' : 'estão'} em nenhum backup.`,
    };
  },

  /** "hoje" · "ontem" · "há 5 dias" */
  relativeDays(ts, now = Date.now()) {
    const d = Math.max(0, Math.floor((now - ts) / this.DAY_MS));
    if (d === 0) return 'hoje';
    if (d === 1) return 'ontem';
    return `há ${d} dias`;
  },

  formatBytes(n) {
    if (typeof n !== 'number' || n < 0) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  },
};

window.DataSafety = DataSafety;
