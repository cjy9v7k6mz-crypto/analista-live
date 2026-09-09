/**
 * transportLocal.js — Transporte local (BroadcastChannel).
 *
 * Liga separadores/janelas do MESMO dispositivo e navegador. Não serve para
 * dois iPads em redes diferentes — para isso é o transporte Supabase.
 *
 * Existe por duas razões práticas:
 *  - permite testar toda a lógica de sincronização (fila, deduplicação,
 *    reconexão, ordem dos eventos) sem depender de serviços externos;
 *  - dá um modo de demonstração utilizável sem configurar nada.
 *
 * Guarda o histórico em localStorage para conseguir responder ao `fetchSince`,
 * tal como o servidor faria.
 */

const TransportLocal = {
  name: 'local',
  _channel: null,
  _code: null,
  _onMessage: null,

  _storeKey(code) { return `al_sync_log_${code}`; },

  _readLog(code) {
    try { return JSON.parse(localStorage.getItem(this._storeKey(code)) || '[]'); }
    catch (e) { return []; }
  },

  _writeLog(code, list) {
    // Mantém o histórico dentro de um tamanho razoável (um jogo não passa disto).
    const trimmed = list.slice(-500);
    try { localStorage.setItem(this._storeKey(code), JSON.stringify(trimmed)); } catch (e) { /* cheio: segue sem histórico */ }
  },

  async connect(code, { onMessage, onStatus }) {
    this._code = code;
    this._onMessage = onMessage;
    if (this._channel) this._channel.close();
    this._channel = new BroadcastChannel(`analista-live-${code}`);
    this._channel.onmessage = (ev) => {
      if (ev.data && this._onMessage) this._onMessage(ev.data);
    };
    if (onStatus) onStatus('online');
    return true;
  },

  async send(envelope) {
    if (!this._channel) throw new Error('Sem ligação local');
    const log = this._readLog(envelope.sessionCode);
    log.push(envelope);
    this._writeLog(envelope.sessionCode, log);
    this._channel.postMessage(envelope);
    return true;
  },

  async fetchSince(code, sinceTs) {
    return this._readLog(code).filter((e) => (e.createdAt || 0) > sinceTs);
  },

  async disconnect() {
    if (this._channel) { this._channel.close(); this._channel = null; }
    return true;
  },
};

window.TransportLocal = TransportLocal;
