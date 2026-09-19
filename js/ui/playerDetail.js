/**
 * playerDetail.js — "Ver Jogador": ficha individual num jogo, com timeline
 * de eventos associados e estatísticas calculadas automaticamente a partir
 * dos eventos realmente associados a este jogador.
 */

const PlayerDetailScreen = {
  async render(root, params) {
    const match = await DB.get(DB.STORES.matches, params.matchId);
    const player = await DB.get(DB.STORES.players, params.playerId);
    if (!match || !player) { window.location.hash = '#/dashboard'; return; }

    const allOccurrences = await AppState.getOccurrences(match.id);
    const events = allOccurrences
      .filter((o) => (o.playerIds || []).includes(player.id))
      .sort((a, b) => a.timestamp - b.timestamp);

    const positives = events.filter((e) => e.eventType === 'positive');
    const negatives = events.filter((e) => e.eventType === 'negative');
    const moments = events.filter((e) => e.source === 'momento');
    const interventions = events.filter((e) => e.source === 'banco');
    const cards = events.filter((e) => e.source === 'cartao');
    // Um remate pode ter um segundo jogador tagged: quem fez o passe. Esse
    // remate não conta como remate/golo DELE — conta como oportunidade criada.
    const shots = events.filter((e) => e.source === 'remate' && MatchStats.passerOf(e) !== player.id);
    const chancesCreated = allOccurrences.filter((o) => MatchStats.passerOf(o) === player.id).length;
    const shotsOnTarget = shots.filter((e) => e.meta?.result === 'goal' || e.meta?.result === 'save');
    // Golos = remates marcados "Golo" + golos do placar atribuídos a este jogador
    // (dois fluxos distintos, nunca o mesmo golo — ver PlayerStats).
    const goalCount = shots.filter((e) => e.meta?.result === 'goal').length
      + allOccurrences.filter((o) => o.source === 'golo' && o.meta?.scorerId === player.id).length;
    const assistCount = allOccurrences.filter((o) => o.source === 'golo' && o.meta?.assistId === player.id).length
      + allOccurrences.filter((o) => MatchStats.shotAssistOf(o) === player.id).length;
    const corners = events.filter((e) => e.source === 'canto');
    const foulsCommitted = events.filter((e) => e.source === 'falta' && e.meta?.committedById === player.id);
    const foulsSuffered = events.filter((e) => e.source === 'falta' && e.meta?.sufferedById === player.id);
    const subs = events.filter((e) => e.source === 'substituicao');

    // Notas de scouting sobre este jogador (pertencem à equipa, não a este jogo).
    // Mostradas aqui para o analista ter o contexto todo num só sítio.
    const team = player.teamId ? await DB.get(DB.STORES.teams, player.teamId) : null;
    const sc = team?.scouting;
    const keyProfile = sc ? (sc.keyPlayers || []).find((k) => k.playerId === player.id) : null;
    const scoutNotes = sc ? (sc.notes || []).filter((n) => n.playerId === player.id) : [];
    const scoutItems = [];
    if (sc) {
      SCOUTING_LISTS.forEach((list) => {
        (sc[list.id] || []).filter((it) => (it.playerIds || []).includes(player.id))
          .forEach((it) => scoutItems.push({ list, it }));
      });
    }
    const hasScouting = !!(keyProfile || scoutNotes.length || scoutItems.length);
    // Jogos terminados voltam ao resumo, não ao painel LIVE (que reativaria o jogo).
    const backHash = match.status === 'finished' ? `#/postgame/${match.id}` : `#/live/${match.id}`;

    root.innerHTML = `
      <div class="screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="${backHash}" aria-label="Voltar">←</button>
          <h1>Ficha do Jogador</h1>
          <button class="btn btn-small" id="btn-player-pdf" title="Ficha individual deste jogo em PDF">📄 Ficha PDF</button>
        </header>

        <div class="player-profile-head">
          ${playerAvatar(player, 'lg')}
          <div>
            <h2>${Utils.escapeHtml(player.name)}${player.captain ? ' 🎖️' : ''}</h2>
            <p class="muted">${player.number ? '#' + player.number + ' · ' : ''}${player.position || ''}${player.secondaryPosition ? '/' + player.secondaryPosition : ''}${player.dominantFoot ? ' · ' + { D: 'Pé direito', E: 'Pé esquerdo', A: 'Ambidextro' }[player.dominantFoot] : ''}</p>
          </div>
        </div>

        <div class="player-stats-grid">
          ${statCard(events.length, 'Eventos')}
          ${statCard(positives.length, 'Positivos', 'positive')}
          ${statCard(negatives.length, 'Negativos', 'negative')}
          ${statCard(goalCount, 'Golos', 'positive')}
          ${statCard(assistCount, 'Assistências', assistCount ? 'positive' : '')}
          ${statCard(chancesCreated, 'Grandes Oport. Criadas', chancesCreated ? 'positive' : '')}
          ${statCard(shots.length, 'Remates')}
          ${statCard(shotsOnTarget.length, 'Enquadrados')}
          ${statCard(corners.length, 'Cantos')}
          ${statCard(foulsCommitted.length, 'Faltas Cometidas', 'negative')}
          ${statCard(foulsSuffered.length, 'Faltas Sofridas')}
          ${statCard(cards.length, 'Cartões', cards.length ? 'negative' : '')}
          ${statCard(moments.length, 'Momentos')}
          ${statCard(interventions.length, 'Intervenções do Banco')}
        </div>
        ${subs.length ? `<p class="muted center">${subs.map((s) => Utils.escapeHtml(s.eventName)).join(' · ')}</p>` : ''}

        ${hasScouting ? `
        <h2 class="section-title">🎯 Do Scouting <span class="muted">(notas permanentes da equipa)</span></h2>
        <div class="sc-items">
          ${keyProfile ? KEY_PLAYER_FIELDS.filter((f) => keyProfile[f.key] && keyProfile[f.key].trim()).map((f) => `
            <div class="sc-item"><div class="sc-item-head"><strong>${f.label}</strong></div><p class="sc-item-desc">${Utils.escapeHtml(keyProfile[f.key])}</p></div>
          `).join('') : ''}
          ${scoutItems.map(({ list, it }) => `
            <div class="sc-item accent-${list.accent}">
              <div class="sc-item-head"><strong>${list.icon} ${Utils.escapeHtml(it.title)}</strong></div>
              ${it.description ? `<p class="sc-item-desc">${Utils.escapeHtml(it.description)}</p>` : ''}
            </div>`).join('')}
          ${scoutNotes.map((n) => `
            <div class="sc-item">
              <p class="sc-item-desc">${Utils.escapeHtml(n.text)}</p>
              <div class="sc-item-meta">${(n.tags || []).map((t) => `<span class="sc-tag">#${Utils.escapeHtml(t)}</span>`).join('')}</div>
            </div>`).join('')}
        </div>
        ${team ? `<button class="btn btn-small" data-nav="#/scouting/${team.id}">Abrir Centro de Scouting</button>` : ''}
        ` : ''}

        <h2 class="section-title">Linha do Tempo</h2>
        <div class="player-timeline">
          ${events.length ? events.map((e) => `
            <div class="player-timeline-row type-${e.eventType}">
              <span class="history-time">${String(e.minute).padStart(2, '0')}:${String(e.second).padStart(2, '0')}</span>
              <span>${Utils.escapeHtml(e.eventName)}</span>
              ${e.note ? `<span class="muted">"${Utils.escapeHtml(e.note)}"</span>` : ''}
            </div>
          `).join('') : '<p class="muted">Ainda não há eventos associados a este jogador neste jogo.</p>'}
        </div>

        ${team ? `<button class="btn btn-block" data-nav="#/squad-stats/${team.id}">📈 Estatísticas deste jogador em todos os jogos</button>` : ''}
      </div>
    `;

    // Ficha individual em PDF, só com este jogo.
    document.getElementById('btn-player-pdf').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const opp = PlayerStats.sideOf(match, player.id, player.teamId) === 'opponent' ? match.team : match.opponent;
        await PDFPlayer.generate({
          player,
          teamId: player.teamId,
          team,
          entries: [{ match, occurrences: allOccurrences }],
          metricKey: 'minutes',
          scopeLabel: `Jogo de ${Utils.formatDate(match.date)} vs ${opp}`,
        });
      } catch (err) {
        console.error('Ficha PDF falhou:', err);
        alert('Não foi possível gerar a ficha: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  },
};

function statCard(value, label, type = '') {
  return `<div class="player-stat-card ${type ? 'type-' + type : ''}"><strong>${value}</strong><span>${label}</span></div>`;
}

window.PlayerDetailScreen = PlayerDetailScreen;
