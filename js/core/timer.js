/**
 * timer.js — Cronómetro específico de futebol.
 *
 * Princípios de fiabilidade:
 * - Nunca depende só de setInterval a contar: guarda sempre um timestamp de
 *   referência (Date.now()) e calcula o tempo decorrido por diferença. Isto
 *   evita desvios se o separador ficar em background (Safari/iPadOS suspende
 *   timers em background, mas ao voltar recalculamos pela diferença real).
 * - Cada período (1ª parte, intervalo, 2ª parte, prolongamentos) tem o seu
 *   próprio acumulado, para nunca perder a noção de "em que parte estamos".
 * - Suporta correção manual do minuto (offset) sem tocar no relógio real.
 */

const PERIODS = {
  NOT_STARTED: 'not_started',
  FIRST_HALF: '1T',
  HALF_TIME: 'HT',
  SECOND_HALF: '2T',
  EXTRA_1: 'ET1',
  EXTRA_2: 'ET2',
  FINISHED: 'FT',
};

const PERIOD_LABELS = {
  [PERIODS.NOT_STARTED]: 'Por iniciar',
  [PERIODS.FIRST_HALF]: '1ª Parte',
  [PERIODS.HALF_TIME]: 'Intervalo',
  [PERIODS.SECOND_HALF]: '2ª Parte',
  [PERIODS.EXTRA_1]: 'Prolong. 1',
  [PERIODS.EXTRA_2]: 'Prolong. 2',
  [PERIODS.FINISHED]: 'Terminado',
};

class MatchTimer {
  /**
   * @param {object} snapshot - estado guardado anteriormente (para recuperação)
   * @param {function} onTick - callback(state) chamado a cada segundo
   */
  constructor(snapshot, onTick) {
    this.onTick = onTick || (() => {});
    this._interval = null;

    if (snapshot) {
      this.period = snapshot.period || PERIODS.NOT_STARTED;
      this.running = false; // nunca arrancar automaticamente sozinho; caller decide
      this.periodElapsedMs = snapshot.periodElapsedMs || 0;
      this.runStartedAt = null;
      this.manualOffsetSec = snapshot.manualOffsetSec || 0;
      this.stoppageSec = snapshot.stoppageSec || 0;
      this.periodHistory = snapshot.periodHistory || {}; // { period: elapsedMs }
      // Se o cronómetro estava A CONTAR quando a app foi fechada/recarregada, o
      // tempo de jogo continuou a correr no mundo real. Recuperamos essa
      // diferença pelo relógio do dispositivo — sem isto o jogo "perdia" os
      // minutos que passaram com o iPad bloqueado ou o Safari em segundo plano.
      // `wasRunning` sinaliza ao ecrã LIVE que deve retomar a contagem.
      this.wasRunning = !!snapshot.running;
      if (this.wasRunning && snapshot.savedAt) {
        const awayMs = Math.max(0, Date.now() - snapshot.savedAt);
        // Guarda-costas: ignora ausências absurdas (ex: reabrir no dia seguinte),
        // para nunca saltar para um minuto impossível.
        if (awayMs < 6 * 60 * 60 * 1000) this.periodElapsedMs += awayMs;
      }
    } else {
      this.period = PERIODS.NOT_STARTED;
      this.running = false;
      this.periodElapsedMs = 0;
      this.runStartedAt = null;
      this.manualOffsetSec = 0;
      this.stoppageSec = 0;
      this.periodHistory = {};
    }
  }

  _startInterval() {
    if (this._interval) return;
    this._interval = setInterval(() => {
      this.onTick(this.getState());
    }, 1000);
  }

  _stopInterval() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /** Tempo decorrido no período atual, em ms, calculado por diferença real de relógio. */
  _currentElapsedMs() {
    if (this.running && this.runStartedAt) {
      return this.periodElapsedMs + (Date.now() - this.runStartedAt);
    }
    return this.periodElapsedMs;
  }

  start(period) {
    if (period) {
      // ao entrar num novo período, guarda o histórico do anterior
      if (this.period && this.period !== PERIODS.NOT_STARTED) {
        this.periodHistory[this.period] = this._currentElapsedMs();
      }
      this.period = period;
      this.periodElapsedMs = 0;
      this.manualOffsetSec = 0;
      this.stoppageSec = 0;
    }
    this.running = true;
    this.runStartedAt = Date.now();
    this._startInterval();
  }

  pause() {
    if (this.running) {
      this.periodElapsedMs = this._currentElapsedMs();
      this.running = false;
      this.runStartedAt = null;
    }
    this._stopInterval();
  }

  resume() {
    if (!this.running && this.period !== PERIODS.NOT_STARTED && this.period !== PERIODS.FINISHED) {
      this.running = true;
      this.runStartedAt = Date.now();
      this._startInterval();
    }
  }

  /** Adiciona tempo de compensação (não altera o relógio, só a exibição/registo). */
  addStoppage(seconds) {
    this.stoppageSec += seconds;
  }

  /** Corrige manualmente o minuto exibido (ex: evento registado com atraso). Em segundos, +/-. */
  correctOffset(deltaSeconds) {
    this.manualOffsetSec += deltaSeconds;
  }

  /** Segundos totais decorridos no período atual, incluindo offset manual. */
  getElapsedSeconds() {
    return Math.max(0, Math.floor(this._currentElapsedMs() / 1000) + this.manualOffsetSec);
  }

  /** minuto:segundo formatado, ex "63:42". Base 1ª parte=0-45+, 2ª parte continua de 45. */
  getGameTimeLabel() {
    const secs = this.getElapsedSeconds();
    let baseMin = 0;
    if (this.period === PERIODS.SECOND_HALF) baseMin = 45;
    if (this.period === PERIODS.EXTRA_1) baseMin = 90;
    if (this.period === PERIODS.EXTRA_2) baseMin = 105;
    const totalSec = baseMin * 60 + secs;
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    const stoppageTxt = this.stoppageSec > 0 ? `+${Math.floor(this.stoppageSec / 60)}` : '';
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${stoppageTxt}`;
  }

  /** Devolve { period, minute, second } prontos para gravar num evento. */
  getGameTimeParts() {
    const secs = this.getElapsedSeconds();
    let baseMin = 0;
    if (this.period === PERIODS.SECOND_HALF) baseMin = 45;
    if (this.period === PERIODS.EXTRA_1) baseMin = 90;
    if (this.period === PERIODS.EXTRA_2) baseMin = 105;
    const totalSec = baseMin * 60 + secs;
    return {
      period: this.period,
      minute: Math.floor(totalSec / 60),
      second: totalSec % 60,
    };
  }

  getState() {
    return {
      period: this.period,
      periodLabel: PERIOD_LABELS[this.period] || this.period,
      running: this.running,
      gameTimeLabel: this.getGameTimeLabel(),
      elapsedSeconds: this.getElapsedSeconds(),
    };
  }

  /** Estado serializável para guardar no jogo (recuperação após fechar app). */
  toSnapshot() {
    return {
      period: this.period,
      running: this.running, // essencial para recuperar o tempo real após reload/background
      periodElapsedMs: this._currentElapsedMs(),
      manualOffsetSec: this.manualOffsetSec,
      stoppageSec: this.stoppageSec,
      periodHistory: this.periodHistory,
      savedAt: Date.now(),
    };
  }

  destroy() {
    this._stopInterval();
  }
}

window.MatchTimer = MatchTimer;
window.PERIODS = PERIODS;
window.PERIOD_LABELS = PERIOD_LABELS;
