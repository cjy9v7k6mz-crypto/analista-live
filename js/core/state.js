/**
 * state.js — Estado da sessão em curso + autosave + recuperação.
 * Mantém em memória o jogo ativo e garante que cada alteração importante
 * é imediatamente persistida no IndexedDB (nunca perder dados).
 */

const AppState = {
  currentMatch: null,      // objeto match completo em memória
  timer: null,             // instância de MatchTimer
  settings: null,          // definições do utilizador
  library: [],             // biblioteca global de eventos
  pendingPeriodStart: null, // sinal explícito de transição de período (ex: Intervalo -> 2ª Parte)

  async loadSettings() {
    let s = await DB.get(DB.STORES.settings, 'app');
    if (!s) {
      s = {
        key: 'app',
        theme: 'dark',
        haptics: true,
        buttonSize: 'large', // large | medium | compact
        density: 'comfortable', // comfortable | compact
        colorIntensity: 'normal',
        analystName: '',
        teamName: '',
        trendConfig: window.AnalistaLiveData.DEFAULT_TREND_CONFIG,
        keyboardShortcuts: {},
      };
      await DB.put(DB.STORES.settings, s);
    }
    this.settings = s;
    return s;
  },

  async saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    await DB.put(DB.STORES.settings, this.settings);
    return this.settings;
  },

  async loadLibrary() {
    let lib = await DB.getAll(DB.STORES.library);
    if (!lib || lib.length === 0) {
      lib = window.AnalistaLiveData.DEFAULT_EVENTS.map((e, i) => ({ ...e, position: i }));
      await DB.bulkPut(DB.STORES.library, lib);
    }
    this.library = lib;
    return lib;
  },

  /** Guarda o jogo atual imediatamente (chamado após qualquer ação relevante). */
  async persistMatch() {
    if (!this.currentMatch) return;
    if (this.timer) {
      this.currentMatch.timerSnapshot = this.timer.toSnapshot();
    }
    this.currentMatch.updatedAt = Date.now();
    await DB.put(DB.STORES.matches, this.currentMatch);
    await DB.put(DB.STORES.settings, { ...this.settings, key: 'app', lastOpenMatchId: this.currentMatch.id });
  },

  async setActiveMatch(match) {
    this.currentMatch = match;
    await this.saveSettings({ lastOpenMatchId: match ? match.id : null });
  },

  /** Verifica se existe um jogo "em_curso" para propor recuperação ao abrir a app. */
  async findInProgressMatch() {
    const all = await DB.getAll(DB.STORES.matches);
    return all.find((m) => m.status === 'in_progress') || null;
  },

  async addOccurrence(occurrence) {
    // putRetry e não put: no LIVE, um erro transitório do IndexedDB não pode
    // fazer desaparecer um registo de jogo. Se falhar mesmo, propaga — quem
    // chama tem de avisar o analista (ver LiveScreen.flagUnsaved).
    await DB.putRetry(DB.STORES.occurrences, occurrence);
  },

  async getOccurrences(matchId) {
    return DB.getAllByIndex(DB.STORES.occurrences, 'matchId', matchId);
  },

  async deleteOccurrence(id) {
    return DB.delete(DB.STORES.occurrences, id);
  },

  async updateOccurrence(occurrence) {
    await DB.put(DB.STORES.occurrences, occurrence);
    return occurrence;
  },

  // ---------- Equipas / jogadores ----------

  async getOwnTeam() {
    const teams = await DB.getAll(DB.STORES.teams);
    return teams.find((t) => t.isOwnTeam) || null;
  },

  async getAllTeams() {
    return DB.getAll(DB.STORES.teams);
  },

  async getTeamPlayers(teamId) {
    if (!teamId) return [];
    return DB.getAllByIndex(DB.STORES.players, 'teamId', teamId);
  },

  /** Encontra (ou sugere criar) uma equipa adversária pelo nome exato. */
  async findTeamByName(name) {
    const teams = await DB.getAll(DB.STORES.teams);
    return teams.find((t) => !t.isOwnTeam && t.name.toLowerCase() === (name || '').toLowerCase()) || null;
  },
};

window.AppState = AppState;
