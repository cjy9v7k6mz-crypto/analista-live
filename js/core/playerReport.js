/**
 * playerReport.js — Dados da ficha individual do jogador (para o PDF).
 *
 * Puro: junta o que já existe (PlayerStats, SeasonTrends) numa estrutura pronta
 * a imprimir, para as conversas de feedback. Não pede registo novo nenhum e não
 * guarda nada — é sempre calculado a partir dos jogos em âmbito.
 */

const PlayerReport = {
  /** Linhas "jogo a jogo" que cabem na folha; as mais antigas ficam contadas à parte. */
  MAX_TABLE_ROWS: 12,
  /** Momentos/notas mostrados; os restantes ficam contados à parte. */
  MAX_HIGHLIGHTS: 6,
  /** Métricas mostradas "por 90 minutos" (só com 45 minutos ou mais). */
  PER90_KEYS: ['goals', 'assists', 'chancesCreated', 'shots', 'recuperacoes', 'perdas'],

  /**
   * @param {{player: object, teamId: string, entries: Array<{match, occurrences}>, metricKey?: string}} args
   *   `entries` do jogo mais antigo para o mais recente.
   */
  buildSheet({ player, teamId, entries, metricKey = 'minutes' }) {
    const agg = PlayerStats.aggregate(player.id, teamId, entries);
    const per90 = {};
    this.PER90_KEYS.forEach((k) => { per90[k] = PlayerStats.per90(agg[k], agg.minutes); });

    const meta = SeasonTrends.PLAYER_KEYS.find((k) => k.key === metricKey) || SeasonTrends.PLAYER_KEYS[0];
    const series = SeasonTrends.playerSeries(player.id, teamId, entries, meta.key);

    // Momentos e notas associados ao jogador. Um momento sem texto continua a
    // ser um momento; uma nota sem texto não diz nada e fica de fora.
    const highlights = [];
    entries.forEach(({ match, occurrences }) => {
      (occurrences || []).forEach((o) => {
        if (o.source !== 'momento' && o.source !== 'nota') return;
        if (!(o.playerIds || []).includes(player.id)) return;
        const text = (o.note || '').trim() || (o.source === 'momento' ? 'Momento marcado (sem nota)' : '');
        if (!text) return;
        highlights.push({
          date: match.date || null,
          opponent: SeasonTrends.sideOf(match, teamId) === 'opponent' ? match.team : match.opponent,
          minute: o.minute,
          kind: o.source === 'momento' ? 'Momento' : 'Nota',
          text,
          ts: o.timestamp || 0,
        });
      });
    });
    highlights.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.ts - a.ts);

    // Linhas jogo a jogo (já vêm do mais recente para o mais antigo). O adversário
    // depende do lado: num plantel adversário, o adversário de cada jogo somos nós.
    const matchById = new Map(entries.map((e) => [e.match.id, e.match]));
    const rows = agg.perMatch.map((r) => {
      const m = matchById.get(r.matchId);
      return { ...r, opponentName: m && SeasonTrends.sideOf(m, teamId) === 'opponent' ? m.team : r.opponent };
    });
    const dates = entries.map((e) => e.match.date).filter(Boolean).sort();

    return {
      player: {
        id: player.id,
        name: player.name,
        shortName: player.shortName || '',
        number: player.number || null,
        position: player.position || '',
        secondaryPosition: player.secondaryPosition || '',
        dominantFoot: player.dominantFoot || '',
        photo: player.photo || null,
      },
      scope: { matches: entries.length, firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null },
      totals: agg,
      per90,
      trend: {
        key: meta.key,
        label: meta.label,
        unit: meta.unit || '',
        points: series.map((s) => ({ date: s.date, opponentName: s.opponentName, value: s.value })),
        comparison: SeasonTrends.recentVsBefore(series),
      },
      rows: rows.slice(0, this.MAX_TABLE_ROWS),
      rowsOmitted: Math.max(0, rows.length - this.MAX_TABLE_ROWS),
      highlights: highlights.slice(0, this.MAX_HIGHLIGHTS),
      highlightsOmitted: Math.max(0, highlights.length - this.MAX_HIGHLIGHTS),
    };
  },
};

window.PlayerReport = PlayerReport;
