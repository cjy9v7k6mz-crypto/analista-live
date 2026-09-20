/**
 * videoSync.js — Levar os registos do jogo para o tempo do vídeo.
 *
 * O problema: a app regista o relógio do JOGO (minuto da parte), e o vídeo
 * corre no seu próprio tempo. Os dois não andam a par — há pausas, descontos e
 * correção manual do minuto.
 *
 * A solução: cada registo guarda a hora real em que foi feito (`timestamp`).
 * Escolhendo um registo como âncora e dizendo a que tempo do vídeo ele aparece,
 * todos os outros saem do TEMPO REAL decorrido entre registos — imune a pausas,
 * descontos e correções. Uma âncora por parte resolve também o vídeo cortado ao
 * intervalo.
 *
 * Puro: não toca na base de dados nem no ecrã.
 */

const VideoSync = {
  DEFAULT_PRE_ROLL: 8,
  DEFAULT_POST_ROLL: 5,

  /** "1:02:03" | "23:15" | "90" -> segundos. Devolve null se não perceber. */
  parseTime(str) {
    const s = String(str == null ? '' : str).trim().replace(',', '.');
    if (!s) return null;
    if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return null;
    const parts = s.split(':').map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    const secs = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : (parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0]);
    return secs >= 0 ? secs : null;
  },

  /** segundos -> "mm:ss" (ou "h:mm:ss" a partir de uma hora). */
  formatTime(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0');
    return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
  },

  /** O que se pode levar para o vídeo. `focos` é o que vem escolhido de origem. */
  SOURCES: [
    { key: 'focos', label: 'Focos do plano' },
    { key: 'golos', label: 'Golos' },
    { key: 'remates', label: 'Remates' },
    { key: 'perdasCaras', label: 'Perdas que custaram golo' },
    { key: 'momentos', label: 'Momentos' },
    { key: 'taticas', label: 'Mudanças táticas' },
  ],
  DEFAULT_SOURCES: ['focos'],

  /**
   * Registos a levar para o vídeo, segundo as fontes escolhidas. Sem repetidos:
   * um remate marcado "Golo" entra uma vez, mesmo com "Golos" e "Remates" ligados.
   */
  selectOccurrences(match, occurrences, sources = this.DEFAULT_SOURCES) {
    const set = new Set(sources && sources.length ? sources : this.DEFAULT_SOURCES);
    const chosen = new Map();
    const add = (o) => { if (o) chosen.set(o.id, o); };
    if (set.has('focos')) this.focusOccurrences(match, occurrences).forEach(add);
    if (set.has('golos')) occurrences.filter((o) => o.source === 'golo' || (o.source === 'remate' && o.meta?.result === 'goal')).forEach(add);
    if (set.has('remates')) occurrences.filter((o) => o.source === 'remate').forEach(add);
    if (set.has('perdasCaras')) MatchStats.costlyLosses(occurrences, match).items.forEach((it) => add(it.loss));
    if (set.has('momentos')) occurrences.filter((o) => o.source === 'momento').forEach(add);
    if (set.has('taticas')) occurrences.filter((o) => o.source === 'tatica').forEach(add);
    return [...chosen.values()].sort((a, b) => a.timestamp - b.timestamp);
  },

  /**
   * O registo envolve este jogador? Conta quem está tagged e também os papéis
   * guardados no detalhe (marcador, passador, quem cometeu/sofreu a falta...).
   */
  involvesPlayer(occ, playerId) {
    if (!playerId) return true;
    if ((occ.playerIds || []).includes(playerId)) return true;
    const m = occ.meta || {};
    return [m.scorerId, m.assistId, m.passerId, m.ownPlayerId, m.oppPlayerId, m.committedById, m.sufferedById, m.keeperId]
      .some((id) => id && id === playerId);
  },

  /** Registos ligados a um foco do plano de observação. */
  focusOccurrences(match, occurrences) {
    const focusIds = new Set((match.observationPlan || []).filter((e) => e.isFocus).map((e) => e.id));
    if (!focusIds.size) return [];
    return occurrences
      .filter((o) => o.planEventId && focusIds.has(o.planEventId))
      .sort((a, b) => a.timestamp - b.timestamp);
  },

  /**
   * Converte os registos escolhidos em clips com tempo de vídeo.
   * @param {{match, occurrences, anchors, preRoll, postRoll, nameOf, sources, playerId}} args
   *   `anchors`: { '1T': { occurrenceId, videoSeconds }, ... }
   *   `playerId`: opcional — só os registos que envolvem esse jogador.
   * @returns {{clips: Array, missing: Array}} `missing` = partes sem âncora,
   *   devolvidas à parte em vez de receberem tempos inventados.
   */
  buildClips({ match, occurrences, anchors = {}, preRoll = this.DEFAULT_PRE_ROLL, postRoll = this.DEFAULT_POST_ROLL, nameOf = () => null, sources = this.DEFAULT_SOURCES, playerId = null }) {
    const list = this.selectOccurrences(match, occurrences, sources).filter((o) => this.involvesPlayer(o, playerId));
    const byId = new Map(occurrences.map((o) => [o.id, o]));
    const clips = [];
    const missing = [];

    list.forEach((o) => {
      const anchor = anchors[o.period];
      const anchorOcc = anchor && byId.get(anchor.occurrenceId);
      if (!anchor || !anchorOcc || anchor.videoSeconds == null) {
        missing.push({ id: o.id, period: o.period, name: o.eventName, gameLabel: this.gameLabel(o) });
        return;
      }
      const videoSeconds = anchor.videoSeconds + (o.timestamp - anchorOcc.timestamp) / 1000;
      clips.push({
        id: o.id,
        period: o.period,
        gameLabel: this.gameLabel(o),
        name: o.eventName,
        note: o.note || '',
        players: (o.playerIds || []).map(nameOf).filter(Boolean),
        videoSeconds: Math.max(0, videoSeconds),
        start: Math.max(0, videoSeconds - preRoll),
        end: Math.max(0, videoSeconds + postRoll),
      });
    });

    clips.sort((a, b) => a.videoSeconds - b.videoSeconds);
    return { clips, missing };
  },

  gameLabel(o) {
    return `${o.period} ${String(o.minute).padStart(2, '0')}:${String(o.second).padStart(2, '0')}`;
  },

  /** Lista em texto, para copiar ou imprimir e ter ao lado do vídeo. */
  toText(clips, match) {
    const head = `Focos no vídeo — ${match.team} vs ${match.opponent}${match.date ? ` · ${Utils.formatDate(match.date)}` : ''}`;
    const rows = clips.map((c) => {
      const extra = [c.players.join(' + '), c.note].filter(Boolean).join(' · ');
      return `${this.formatTime(c.videoSeconds)}  ${c.name}${extra ? ` (${extra})` : ''}  [jogo ${c.gameLabel}]`;
    });
    return [head, ...rows].join('\n');
  },

  toCSV(clips) {
    const esc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = ['Tempo video', 'Inicio clip', 'Fim clip', 'Segundos', 'Foco', 'Jogadores', 'Nota', 'Momento do jogo'];
    const rows = clips.map((c) => [
      this.formatTime(c.videoSeconds), this.formatTime(c.start), this.formatTime(c.end),
      c.videoSeconds.toFixed(1), c.name, c.players.join(' + '), c.note, c.gameLabel,
    ]);
    return [header, ...rows].map((r) => r.map(esc).join(';')).join('\n');
  },

  /**
   * XML de instâncias no formato Sportscode — documentado como aceite pelo Once
   * Sport Analyser (XML/CSV de Once Sport, Wyscout, Sportscode e Dartfish).
   * NÃO serve para o Telestrator, que não importa marcações.
   */
  toXML(clips, match) {
    const esc = (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const label = (group, text) => `        <label><group>${esc(group)}</group><text>${esc(text)}</text></label>`;
    const instances = clips.map((c, i) => [
      '      <instance>',
      `        <ID>${i + 1}</ID>`,
      `        <start>${c.start.toFixed(1)}</start>`,
      `        <end>${c.end.toFixed(1)}</end>`,
      `        <code>${esc(c.name)}</code>`,
      label('Parte', c.period),
      label('Momento do jogo', c.gameLabel),
      ...c.players.map((p) => label('Jogador', p)),
      ...(c.note ? [label('Nota', c.note)] : []),
      '      </instance>',
    ].join('\n')).join('\n');
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<file>',
      `  <SESSION_INFO><start_time>${esc(match.date || '')}</start_time></SESSION_INFO>`,
      '  <ALL_INSTANCES>',
      instances,
      '  </ALL_INSTANCES>',
      '</file>',
    ].join('\n');
  },
};

window.VideoSync = VideoSync;
