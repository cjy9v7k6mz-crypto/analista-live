/**
 * migrations.js — Migração de dados desta fase (plantéis, onze inicial,
 * jogadores associados a eventos). NÃO apaga nada; só acrescenta a
 * estrutura em falta para que jogos e jogadores antigos continuem a abrir
 * normalmente.
 *
 * Corre uma vez no arranque (idempotente — verifica settings.migrations).
 */

const Migrations = {
  async run() {
    const settings = await DB.get(DB.STORES.settings, 'app');
    // Cada sub-migração é idempotente (verifica-e-corrige), por isso corre sempre
    // no arranque — isto é essencial para continuar a "curar" dados antigos que
    // só apareçam mais tarde (ex: um backup JSON de uma versão anterior restaurado
    // depois de já se ter usado esta versão), e não apenas na primeira vez.
    await this._ensureOwnTeam(settings);
    await this._migratePlayers();
    await this._migrateMatches();
    await this._migratePitchOrientation();
    await this._migrateTeamLinks();
    await this._migrateScouting();
  },

  /**
   * Estrutura de scouting nas equipas (V2.3), idempotente.
   * Converte também as notas antigas (team.notes, texto livre) na primeira nota
   * livre da nova estrutura — nada se perde.
   */
  async _migrateScouting() {
    const teams = await DB.getAll(DB.STORES.teams);
    for (const t of teams) {
      let changed = false;
      if (!t.profile) { t.profile = {}; changed = true; }
      if (!t.scouting) {
        t.scouting = {
          strengths: [], weaknesses: [], threats: [], opportunities: [],
          triggers: [], keyPlayers: [], checklist: null, notes: [], setPieces: [],
        };
        changed = true;
      }
      // Esquemas de bola parada (imagens táticas) e metadados do dossier.
      if (!t.scouting.setPieces) { t.scouting.setPieces = []; changed = true; }
      // Blocos livres (texto/imagem) por secção do dossier.
      if (!t.scouting.blocks) { t.scouting.blocks = {}; changed = true; }
      if (t.favorite === undefined) { t.favorite = false; changed = true; }
      if (!t.scoutingUpdatedAt) { t.scoutingUpdatedAt = t.updatedAt || t.createdAt || Date.now(); changed = true; }
      if (!t.scoutingHistory) { t.scoutingHistory = []; changed = true; }
      // Notas antigas em texto livre passam a ser a primeira nota estruturada.
      if (t.notes && String(t.notes).trim() && !t.scouting._legacyNotesImported) {
        t.scouting.notes = t.scouting.notes || [];
        t.scouting.notes.unshift({
          id: Utils.uid('note'),
          text: String(t.notes).trim(),
          tags: [], playerId: null, timeRef: '',
          createdAt: Date.now(),
        });
        t.scouting._legacyNotesImported = true;
        changed = true;
      }
      if (changed) await DB.put(DB.STORES.teams, t);
    }

    // Notas escritas no antigo ecrã "Notas de Adversários" viviam numa store
    // separada (`opponents`) e nunca chegavam ao scouting. Passam para a equipa
    // correspondente (por nome) como nota permanente. A store antiga é mantida
    // intacta — nada é apagado, apenas copiado.
    const legacyOpponents = await DB.getAll(DB.STORES.opponents);
    for (const op of legacyOpponents) {
      if (op._migratedToScouting || !op.notes || !String(op.notes).trim()) continue;
      const team = teams.find((t) => !t.isOwnTeam && t.name.toLowerCase() === String(op.name || '').toLowerCase());
      if (!team) continue;
      team.scouting = team.scouting || { strengths: [], weaknesses: [], threats: [], opportunities: [], triggers: [], keyPlayers: [], checklist: null, notes: [] };
      team.scouting.notes = team.scouting.notes || [];
      team.scouting.notes.unshift({
        id: Utils.uid('note'),
        text: String(op.notes).trim(),
        tags: [], playerId: null, timeRef: '',
        createdAt: op.createdAt || Date.now(),
      });
      await DB.put(DB.STORES.teams, team);
      op._migratedToScouting = true;
      await DB.put(DB.STORES.opponents, op);
    }
  },

  /**
   * Ligação de jogos antigos a equipas reais (V2.2).
   *
   * Jogos criados quando o adversário era apenas texto ficaram sem
   * `teams.opponent.teamId`. Aqui tentamos ligá-los a uma equipa existente com
   * o mesmo nome; se não existir, criamos a equipa a partir do nome guardado,
   * para que o histórico do adversário passe a funcionar. Nunca apagamos nada.
   */
  async _migrateTeamLinks() {
    const matches = await DB.getAll(DB.STORES.matches);
    if (!matches.length) return;
    let teams = await DB.getAll(DB.STORES.teams);
    const byName = (n) => teams.find((t) => !t.isOwnTeam && t.name.toLowerCase() === String(n || '').toLowerCase());

    for (const m of matches) {
      let changed = false;
      m.teams = m.teams || {};
      m.teams.own = m.teams.own || { formationId: null, positions: [], starterIds: [], subIds: [] };
      m.teams.opponent = m.teams.opponent || { formationId: null, positions: [], starterIds: [], subIds: [] };

      if (!m.teams.own.teamId && this._ownTeamId) {
        m.teams.own.teamId = this._ownTeamId;
        changed = true;
      }
      if (!m.teams.opponent.teamId && m.opponent) {
        let t = byName(m.opponent);
        if (!t) {
          t = {
            id: Utils.uid('team'), name: m.opponent, abbreviation: '', logo: null,
            colorPrimary: '#e5555c', colorSecondary: '#12161f', isOwnTeam: false,
            createdAt: Date.now(), createdByMigration: true,
          };
          await DB.put(DB.STORES.teams, t);
          teams.push(t);
        }
        m.teams.opponent.teamId = t.id;
        changed = true;
      }
      if (changed) await DB.put(DB.STORES.matches, m);
    }
  },

  /**
   * Correção de orientação do campo (V2.1).
   *
   * Até aqui as coordenadas y eram guardadas com o guarda-redes em y≈95, o que
   * ao ser desenhado (`top: 100 - y`) colocava a própria baliza no TOPO do ecrã,
   * com a equipa a atacar para baixo. Nessa orientação o lado esquerdo do jogador
   * aparece à direita do ecrã, fazendo com que DE/DD e EE/ED parecessem trocados.
   *
   * A convenção correta (e agora usada) é: y medido a partir da própria baliza,
   * equipa a atacar para CIMA. Esta migração inverte (y -> 100 - y) as posições
   * já guardadas em jogos e formações, marcando-as para nunca serem invertidas
   * duas vezes.
   */
  async _migratePitchOrientation() {
    const matches = await DB.getAll(DB.STORES.matches);
    for (const m of matches) {
      let changed = false;
      ['own', 'opponent'].forEach((side) => {
        const lineup = m.teams?.[side];
        if (lineup && Array.isArray(lineup.positions) && lineup.positions.length && !lineup.pitchOrientationV2) {
          lineup.positions = lineup.positions.map((p) => ({ ...p, y: 100 - p.y }));
          lineup.pitchOrientationV2 = true;
          changed = true;
        } else if (lineup && !lineup.pitchOrientationV2) {
          lineup.pitchOrientationV2 = true; // sem posições: apenas marca
          changed = true;
        }
      });
      if (changed) await DB.put(DB.STORES.matches, m);
    }

    const formations = await DB.getAll(DB.STORES.formations);
    for (const f of formations) {
      if (f.pitchOrientationV2) continue;
      if (Array.isArray(f.slots)) {
        f.slots = f.slots.map((s) => ({ ...s, y: 100 - s.y }));
      }
      f.pitchOrientationV2 = true;
      await DB.put(DB.STORES.formations, f);
    }
  },

  async _migrateMatches() {
    const matches = await DB.getAll(DB.STORES.matches);
    for (const m of matches) {
      let changed = false;
      // Placar é a fonte única dos golos — jogos muito antigos podiam não o ter,
      // o que rebentava os ecrãs de intervalo/pós-jogo/banco ao ler match.score.team.
      if (!m.score || typeof m.score.team !== 'number' || typeof m.score.opponent !== 'number') {
        m.score = { team: m.score?.team || 0, opponent: m.score?.opponent || 0 };
        changed = true;
      }
      if (!m.currentPeriod) { m.currentPeriod = 'not_started'; changed = true; }
      if (!Array.isArray(m.substitutions)) { m.substitutions = []; changed = true; }
      if (!Array.isArray(m.cards)) { m.cards = []; changed = true; }
      if (!m.teams) {
        m.teams = {
          own: { teamId: this._ownTeamId, formationId: null, positions: [], starterIds: [], subIds: [] },
          opponent: { teamId: null, formationId: null, positions: [], starterIds: [], subIds: [] },
        };
        changed = true;
      }
      if (m.lineupConfirmed === undefined) {
        // jogos antigos nunca passaram pelo ecrã de onze inicial — consideramos "confirmado"
        // (vazio) para não bloquear a abertura de jogos já em curso/terminados.
        m.lineupConfirmed = true;
        changed = true;
      }
      // Substituições antigas (V2) não guardavam "side" (nossa/adversário), o que
      // impedia o cálculo correto de quem está em campo. Infere pelo plantel.
      if (m.substitutions && m.substitutions.length) {
        const ownIds = new Set((m.teams.own?.positions || []).map((p) => p.playerId).concat(m.teams.own?.subIds || []));
        m.substitutions.forEach((s) => {
          if (!s.side) {
            s.side = ownIds.has(s.outId) ? 'own' : 'opponent';
            changed = true;
          }
        });
      }
      if (m.focusEventIds === undefined) {
        m.focusEventIds = []; // "Meus Focos" — vazio por omissão, não altera o painel LIVE existente
        changed = true;
      }
      if (changed) await DB.put(DB.STORES.matches, m);
    }
  },

  async _ensureOwnTeam(settings) {
    const teams = await DB.getAll(DB.STORES.teams);
    let own = teams.find((t) => t.isOwnTeam);
    if (!own) {
      own = {
        id: Utils.uid('team'),
        name: (settings && settings.teamName) || 'Nossa Equipa',
        abbreviation: '',
        logo: null,
        colorPrimary: '#5b93f0',
        colorSecondary: '#12161f',
        isOwnTeam: true,
        createdAt: Date.now(),
      };
      await DB.put(DB.STORES.teams, own);
    }
    this._ownTeamId = own.id;
    return own;
  },

  async _migratePlayers() {
    const players = await DB.getAll(DB.STORES.players);
    for (const p of players) {
      let changed = false;
      if (!p.teamId) { p.teamId = this._ownTeamId; changed = true; }
      if (!p.shortName) { p.shortName = p.name ? p.name.split(' ').slice(-1)[0] : ''; changed = true; }
      if (!p.status) { p.status = p.starter ? 'starter' : 'unused'; changed = true; }
      if (p.photo === undefined) { p.photo = null; changed = true; }
      if (p.secondaryPosition === undefined) { p.secondaryPosition = ''; changed = true; }
      if (p.dominantFoot === undefined) { p.dominantFoot = ''; changed = true; }
      if (p.captain === undefined) { p.captain = false; changed = true; }
      if (changed) await DB.put(DB.STORES.players, p);
    }
  },
};

window.Migrations = Migrations;
