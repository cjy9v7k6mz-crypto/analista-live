/**
 * utils.js — Funções auxiliares partilhadas.
 */

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Calcula o nível de tendência de um contador, segundo a configuração das definições. */
function getTrendLevel(count, trendConfig) {
  const cfg = trendConfig || window.AnalistaLiveData.DEFAULT_TREND_CONFIG;
  for (const lvl of cfg.levels) {
    if (count >= lvl.min && count <= lvl.max) return lvl;
  }
  // 0 ocorrências (ou qualquer valor fora dos níveis configurados) nunca deve
  // herdar o nível mais grave por omissão — devolve "sem badge".
  return { min: 0, max: 0, label: '', showBadge: false };
}

function vibrate(ms = 15) {
  if (window.AppState?.settings?.haptics === false) return;
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (e) { /* ignora — nem todos os dispositivos suportam */ }
  }
}

function categoryLabel(catId) {
  const c = window.AnalistaLiveData.CATEGORIES.find((c) => c.id === catId);
  return c ? c.name : catId;
}

const PRIORITY_META = {
  critical: { label: 'CRÍTICO', dot: '🔴', order: 0 },
  important: { label: 'IMPORTANTE', dot: '🟡', order: 1 },
  complementary: { label: 'COMPLEMENTAR', dot: '🟢', order: 2 },
};

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.Utils = { uid, formatDate, todayISO, getTrendLevel, vibrate, categoryLabel, PRIORITY_META, escapeHtml };
