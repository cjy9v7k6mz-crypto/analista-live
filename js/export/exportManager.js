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

  /**
   * Backup completo (toda a base de dados) em JSON.
   * @returns {Promise<{ok: boolean, fname: string}>} ok=false se a partilha foi cancelada.
   */
  async exportFullBackup() {
    const now = Date.now();
    const data = await DB.exportAll();
    // O ficheiro leva a própria data de backup: restaurá-lo mais tarde mostra
    // o "último backup" certo em vez de uma data antiga.
    if (Array.isArray(data.settings)) {
      data.settings = data.settings.map((s) => (s && s.key === 'app' ? { ...s, lastBackupAt: now, backupSnoozeUntil: null } : s));
    }
    const fname = `analista-live_backup_${new Date(now).toISOString().slice(0, 10)}.json`;
    // No iPad abre a folha de partilha; se for cancelada não há backup nenhum e
    // não se regista como feito. (No computador cai num link de transferência,
    // que não diz se o ficheiro chegou a ser guardado.)
    const ok = await downloadFile(fname, JSON.stringify(data, null, 2), 'application/json');
    if (ok) await AppState.saveSettings({ lastBackupAt: now, backupSnoozeUntil: null });
    return { ok, fname };
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

  /** Lê e valida o ficheiro de UM jogo (o que sai do pós-jogo). */
  async readMatchFile(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      throw new Error('Este ficheiro não é um JSON válido.');
    }
    if (data && Array.isArray(data.matches)) {
      throw new Error('Este ficheiro é um backup completo. Usa "Restaurar backup" para o abrir.');
    }
    if (!data || typeof data !== 'object' || !data.match || !Array.isArray(data.occurrences)) {
      throw new Error('Este ficheiro não é a exportação de um jogo do Analista Live.');
    }
    return data;
  },

  /**
   * Importa UM jogo vindo de outro aparelho.
   *
   * Equipas e jogadores que já existam aqui NUNCA são escritos por cima: o que
   * está neste aparelho pode ter mais (fotos, scouting) do que o ficheiro.
   *
   * @param {'replace'|'copy'} mode - `replace` substitui o jogo com o mesmo id
   *   (apagando os registos antigos dele, senão ficavam duplicados); `copy`
   *   entra como jogo novo e deixa o existente intacto.
   */
  async importMatch(data, mode = 'copy') {
    const report = { teamsAdded: 0, playersAdded: 0, occurrences: 0, drawings: 0, matchId: null, mode };
    for (const t of data.teams || []) {
      if (!(await DB.get(DB.STORES.teams, t.id))) { await DB.put(DB.STORES.teams, t); report.teamsAdded++; }
    }
    for (const p of data.players || []) {
      if (!(await DB.get(DB.STORES.players, p.id))) { await DB.put(DB.STORES.players, p); report.playersAdded++; }
    }

    const match = { ...data.match, updatedAt: Date.now() };
    if (mode === 'copy') {
      match.id = Utils.uid('match');
      match.importedFrom = data.match.id;
    } else {
      const old = await DB.getAllByIndex(DB.STORES.occurrences, 'matchId', match.id);
      for (const o of old) await DB.delete(DB.STORES.occurrences, o.id);
      const oldDrawings = await DB.getAllByIndex(DB.STORES.drawings, 'matchId', match.id);
      for (const d of oldDrawings) await DB.delete(DB.STORES.drawings, d.id);
    }
    await DB.put(DB.STORES.matches, match);
    report.matchId = match.id;

    for (const o of data.occurrences || []) {
      await DB.put(DB.STORES.occurrences, { ...o, matchId: match.id, ...(mode === 'copy' ? { id: Utils.uid('occ') } : {}) });
      report.occurrences++;
    }
    for (const d of data.drawings || []) {
      await DB.put(DB.STORES.drawings, { ...d, matchId: match.id, ...(mode === 'copy' ? { id: Utils.uid('draw') } : {}) });
      report.drawings++;
    }
    return report;
  },

  /** Lê e valida um ficheiro de backup completo. Lança um erro legível se não servir. */
  async readBackupFile(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      throw new Error('Este ficheiro não é um JSON válido.');
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.matches)) {
      throw new Error('Este ficheiro não é um backup completo do Analista Live. (O ficheiro de um só jogo não serve para restaurar tudo.)');
    }
    return data;
  },

  /**
   * Restaura um backup já validado. A "canalização" da sincronização (sessão
   * ligada, fila de envio, ids já aplicados) pertence a este aparelho e não aos
   * dados — trazê-la de um backup antigo podia reenviar eventos velhos ao banco.
   */
  async restoreBackup(data) {
    const copy = { ...data };
    [DB.STORES.sessions, DB.STORES.syncQueue, DB.STORES.syncApplied].forEach((k) => { delete copy[k]; });
    await DB.importAll(copy);
    // As definições e a biblioteca vivem também em memória: sem as recarregar,
    // a próxima gravação das Definições escrevia as antigas por cima.
    await AppState.loadSettings();
    await AppState.loadLibrary();
    return true;
  },

  async importFullBackup(file) {
    return this.restoreBackup(await this.readBackupFile(file));
  },

  /**
   * Partilha um texto: folha de partilha no iPad (WhatsApp, email, notas) e
   * área de transferência no computador. Devolve o que aconteceu, para o ecrã
   * poder dizer a verdade em vez de assumir que correu bem.
   * @returns {Promise<'shared'|'copied'|'cancelled'|'failed'>}
   */
  async shareText(text, title = 'Analista Live') {
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch (e) {
      return 'failed';
    }
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
