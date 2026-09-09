/**
 * db.js — Camada de persistência (IndexedDB).
 * Toda a aplicação lê/escreve dados exclusivamente através deste módulo.
 * Nenhuma dependência externa. Promises simples, sem bibliotecas.
 */

const DB_NAME = 'analista_live_db';
const DB_VERSION = 4; // v4: sincronização multi-dispositivo (sessões, fila, mensagens)

const STORES = {
  matches: 'matches',           // 1 registo por jogo (inclui plano, resultado, metadata)
  occurrences: 'occurrences',   // eventos registados durante o jogo (index por matchId)
  players: 'players',           // jogadores (associados a uma equipa via teamId)
  library: 'library',           // biblioteca global de eventos (definições reutilizáveis)
  plans: 'plans',                // planos de observação guardados/reutilizáveis
  opponents: 'opponents',       // notas de scouting sobre adversários (estilo de jogo, observações)
  settings: 'settings',         // definições da app (single row, key='app')
  teams: 'teams',                // identidade + plantel: nossa equipa e equipas adversárias
  formations: 'formations',     // formações táticas reutilizáveis (ex: "4-3-3 habitual")
  drawings: 'drawings',         // notas manuscritas (páginas de desenho por jogo)
  sessions: 'sessions',         // sessões de jogo partilhadas entre dispositivos
  syncQueue: 'syncQueue',       // fila de saída (offline-first): o que falta enviar
  syncApplied: 'syncApplied',   // ids já aplicados vindos de fora (deduplicação)
  messages: 'messages',         // comunicação analista -> banco
};

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORES.matches)) {
        const s = db.createObjectStore(STORES.matches, { keyPath: 'id' });
        s.createIndex('status', 'status');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains(STORES.occurrences)) {
        const s = db.createObjectStore(STORES.occurrences, { keyPath: 'id' });
        s.createIndex('matchId', 'matchId');
        s.createIndex('matchId_category', ['matchId', 'category']);
      }
      if (!db.objectStoreNames.contains(STORES.players)) {
        const s = db.createObjectStore(STORES.players, { keyPath: 'id' });
        s.createIndex('teamId', 'teamId');
      } else {
        // Upgrade de v1: garante o índice teamId em bases já existentes.
        const s = e.target.transaction.objectStore(STORES.players);
        if (!s.indexNames.contains('teamId')) s.createIndex('teamId', 'teamId');
      }
      if (!db.objectStoreNames.contains(STORES.library)) {
        db.createObjectStore(STORES.library, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.plans)) {
        db.createObjectStore(STORES.plans, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.opponents)) {
        db.createObjectStore(STORES.opponents, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.teams)) {
        db.createObjectStore(STORES.teams, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.formations)) {
        db.createObjectStore(STORES.formations, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.drawings)) {
        const s = db.createObjectStore(STORES.drawings, { keyPath: 'id' });
        s.createIndex('matchId', 'matchId');
      }
      if (!db.objectStoreNames.contains(STORES.sessions)) {
        const s = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
        s.createIndex('code', 'code');
        s.createIndex('matchId', 'matchId');
      }
      if (!db.objectStoreNames.contains(STORES.syncQueue)) {
        const s = db.createObjectStore(STORES.syncQueue, { keyPath: 'id' });
        s.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains(STORES.syncApplied)) {
        db.createObjectStore(STORES.syncApplied, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.messages)) {
        const s = db.createObjectStore(STORES.messages, { keyPath: 'id' });
        s.createIndex('matchId', 'matchId');
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

const DB = {
  STORES,

  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const r = store.put(value);
      r.onsuccess = () => resolve(value);
      r.onerror = () => reject(r.error);
    });
  },

  async get(storeName, key) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const r = store.get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  },

  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },

  async getAllByIndex(storeName, indexName, value) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const idx = store.index(indexName);
      const r = idx.getAll(value);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },

  async delete(storeName, key) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const r = store.delete(key);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  },

  async clear(storeName) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const r = store.clear();
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  },

  async bulkPut(storeName, values) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      let tx2 = store.transaction;
      values.forEach((v) => store.put(v));
      tx2.oncomplete = () => resolve(true);
      tx2.onerror = () => reject(tx2.error);
    });
  },

  /** Exporta TODA a base de dados para um objeto simples (usado no backup JSON). */
  async exportAll() {
    const out = {};
    for (const key of Object.values(STORES)) {
      out[key] = await this.getAll(key);
    }
    out.exportedAt = new Date().toISOString();
    out.appVersion = 4;
    return out;
  },

  /** Restaura a base de dados a partir de um objeto de backup (substitui tudo). */
  async importAll(data) {
    for (const key of Object.values(STORES)) {
      if (Array.isArray(data[key])) {
        await this.clear(key);
        await this.bulkPut(key, data[key]);
      }
    }
    return true;
  },
};

window.DB = DB;
