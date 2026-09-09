/**
 * exportManager.js — Exportação/Importação de dados.
 * CSV (compatível com Excel), JSON (backup completo) e lista de momentos
 * para revisão posterior no Once Sport Analyser Pro.
 */

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n;]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Guarda (ou partilha) um Blob. No iPad instalado como app (standalone), os
 * links `<a download>` são ignorados pelo Safari — o ficheiro abria dentro da
 * app e "engolia-a". Por isso tentamos primeiro a folha de partilha do sistema
 * (navigator.share com ficheiros: guardar em Ficheiros, enviar por AirDrop,
 * email, etc.) e só caímos no link de transferência quando não está disponível
 * (ex: computador).
 */
async function saveOrShareBlob(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
  } catch (e) {
    // Utilizador cancelou a partilha, ou não é suportado — segue para o fallback.
    if (e && e.name === 'AbortError') return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

function downloadFile(filename, content, mime) {
  return saveOrShareBlob(new Blob([content], { type: mime }), filename);
}

window.saveOrShareBlob = saveOrShareBlob;
window.downloadFile = downloadFile;

/** Coordenadas normalizadas (0–1) de remates/faltas, formatadas como "x=0.62; y=0.31". */
function formatCoords(o) {
  const xy = o.meta?.origin || o.meta?.location;
  if (!xy) return '';
  return `x=${xy.x}; y=${xy.y}`;
}

/** Metadados específicos (resultado do remate, zona da baliza, tipo de falta, lado do canto...). */
function formatMeta(o) {
  if (!o.meta) return '';
  const parts = [];
  if (o.meta.result) parts.push(`resultado=${o.meta.result}`);
  if (o.meta.goalZone) parts.push(`zona=${o.meta.goalZone}`);
  if (o.meta.side) parts.push(`lado=${o.meta.side}`);
  if (o.meta.type) parts.push(`tipo=${o.meta.type}`);
  if (o.meta.statKey) parts.push(`stat=${o.meta.statKey}`);
  return parts.join('; ');
}

const ExportManager = {
  /** Exportação principal — todas as ocorrências do jogo em CSV. `players` (opcional)
   * é a lista combinada dos dois plantéis, usada para resolver playerIds em nomes. */
  async exportMatchCSV(match, occurrences, players = []) {
    const header = [
      'Match ID', 'Data', 'Equipa', 'Adversário', 'Parte', 'Minuto', 'Segundo',
      'Categoria', 'Evento', 'Prioridade', 'Lado', 'Jogadores', 'Nota',
      'Coordenadas', 'Detalhe', 'Timestamp', 'Tipo de Ocorrência',
    ];
    const playerName = (id) => {
      const p = players.find((pl) => pl.id === id);
      return p ? (p.shortName || p.name) : id;
    };
    const rows = occurrences
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((o) => [
        match.id,
        match.date,
        match.team,
        match.opponent,
        o.period,
        o.minute,
        o.second,
        o.categoryLabel || o.category,
        o.eventName,
        o.priority,
        o.team === 'own' ? 'Nossa Equipa' : (o.team === 'opponent' ? 'Adversário' : ''),
        (o.playerIds || []).map(playerName).join(' + '),
        o.note || '',
        formatCoords(o),
        formatMeta(o),
        new Date(o.timestamp).toISOString(),
        o.source, // event | momento | banco | nota | golo | cartao | substituicao | remate | canto | falta | stat_quick
      ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\n');
    const fname = `analista-live_${(match.opponent || 'jogo').replace(/\s+/g, '-')}_${match.date}.csv`;
    downloadFile(fname, '\uFEFF' + csv, 'text/csv;charset=utf-8');
    return fname;
  },

  /** Backup completo (toda a base de dados) em JSON. */
  async exportFullBackup() {
    const data = await DB.exportAll();
    const fname = `analista-live_backup_${new Date().toISOString().slice(0, 10)}.json`;
    downloadFile(fname, JSON.stringify(data, null, 2), 'application/json');
    return fname;
  },

  /** Backup de um único jogo (mais leve, para partilhar). */
  /** Backup de um único jogo. Inclui plantéis e notas manuscritas para o jogo
   * poder ser reconstruído por completo a partir deste ficheiro. */
  async exportMatchJSON(match, occurrences) {
    const drawings = await DB.getAllByIndex(DB.STORES.drawings, 'matchId', match.id);
    const teamIds = [match.teams?.own?.teamId, match.teams?.opponent?.teamId].filter(Boolean);
    const teams = [];
    const players = [];
    for (const id of teamIds) {
      const t = await DB.get(DB.STORES.teams, id);
      if (t) teams.push(t);
      players.push(...await DB.getAllByIndex(DB.STORES.players, 'teamId', id));
    }
    const data = { match, occurrences, drawings, teams, players, exportedAt: new Date().toISOString(), appVersion: 3 };
    const fname = `analista-live_${(match.opponent || 'jogo').replace(/\s+/g, '-')}_${match.date}.json`;
    downloadFile(fname, JSON.stringify(data, null, 2), 'application/json');
    return fname;
  },

  async importFullBackup(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    await DB.importAll(data);
    return true;
  },

  /** Lista de "Momentos para Rever" — minutos-chave para o Once Sport Analyser Pro. */
  buildMomentsList(occurrences) {
    return occurrences
      .filter((o) => o.source === 'momento' || o.priority === 'critical')
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((o) => ({
        period: o.period,
        minute: o.minute,
        second: o.second,
        label: `${String(o.minute).padStart(2, '0')}:${String(o.second).padStart(2, '0')}`,
        type: o.source,
        event: o.eventName,
        note: o.note || '',
      }));
  },

  async copyMomentsToClipboard(moments) {
    const text = moments.map((m) => m.label).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // fallback: cria textarea temporário
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    }
  },

  exportMomentsCSV(match, moments) {
    const header = ['Parte', 'Minuto', 'Segundo', 'Tipo', 'Evento', 'Nota'];
    const rows = moments.map((m) => [m.period, m.minute, m.second, m.type, m.event, m.note]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\n');
    const fname = `momentos_${(match.opponent || 'jogo').replace(/\s+/g, '-')}_${match.date}.csv`;
    downloadFile(fname, '\uFEFF' + csv, 'text/csv;charset=utf-8');
    return fname;
  },
};

window.ExportManager = ExportManager;
