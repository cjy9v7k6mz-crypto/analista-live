/**
 * competition.js — Campeonato: classificação e jornadas.
 *
 * Duas abas. Na primeira, a classificação completa — calculada, nunca guardada.
 * Na segunda, a jornada: é o único sítio onde se escreve, e escreve-se só
 * resultados. Dois campos numéricos por jogo, gravados assim que saem do campo.
 *
 * O nosso jogo tem tratamento diferente de propósito: quando existir na app um
 * jogo registado que corresponda ao do calendário, o resultado passa a vir de
 * lá e deixa de ser editável aqui. Duas fontes de verdade para o mesmo
 * resultado é como se criam contradições que só se descobrem tarde.
 */

const CompetitionScreen = {
  comp: null,
  tab: 'classificacao',   // classificacao | jornada
  round: null,

  async render(root, params) {
    const todas = await DB.getAll(DB.STORES.competitions);
    this.comp = params?.id ? todas.find((c) => c.id === params.id) : (todas[0] || null);

    if (!this.comp) return this.renderEmpty(root, todas);

    // Idempotente: se entretanto apagaste uma equipa, ou se a prova foi
    // importada antes desta versão, as equipas voltam a ficar ligadas.
    const novas = await this.ensureTeams(this.comp);
    if (novas) await DB.putRetry(DB.STORES.competitions, this.comp).catch(() => {});
    await this.loadPending();
    await this.linkOurMatches();
    if (this.round == null) this.round = Standings.currentRound(this.comp);

    root.innerHTML = `
      <div class="screen comp-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>${Utils.escapeHtml(this.comp.shortName || this.comp.name)}</h1>
          <span class="comp-season">${Utils.escapeHtml(this.comp.season || '')}</span>
        </header>

        <div id="comp-pending"></div>

        <div class="comp-tabs">
          <button class="comp-tab ${this.tab === 'classificacao' ? 'active' : ''}" data-tab="classificacao">📊 Classificação</button>
          <button class="comp-tab ${this.tab === 'jornada' ? 'active' : ''}" data-tab="jornada">📅 Jornadas</button>
        </div>

        <div id="comp-body"></div>
      </div>`;

    this.renderPending();
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      this.renderBody();
    }));
    this.renderBody();
  },

  renderEmpty(root, todas) {
    const sementes = (window.COMPETITION_SEEDS || []);
    root.innerHTML = `
      <div class="screen comp-screen">
        <header class="screen-header">
          <button class="icon-btn" data-nav="#/dashboard" aria-label="Voltar">←</button>
          <h1>Campeonato</h1><span></span>
        </header>
        <div class="empty-state">
          <p>Ainda não há nenhuma prova neste aparelho.</p>
          ${sementes.map((s) => `
            <div class="comp-seed">
              <strong>${Utils.escapeHtml(s.name)}</strong>
              <span class="muted">${Utils.escapeHtml(s.season)} · ${s.teams.length} equipas · ${s.fixtures.length} jogos · ${s.rounds || Math.max(...s.fixtures.map((f) => f[0]))} jornadas</span>
              <small class="muted">Calendário completo, já preenchido. Só faltam os resultados.</small>
              <small class="muted">Cria também as ${s.teams.length} equipas na app, com dossiê de scouting pronto a preencher.</small>
              <button class="btn btn-primary" data-seed="${s.id}">Importar esta prova</button>
            </div>`).join('') || '<p class="muted">Não há provas disponíveis para importar.</p>'}
        </div>
      </div>`;
    document.querySelectorAll('[data-seed]').forEach((b) => b.addEventListener('click', async () => {
      const seed = sementes.find((s) => s.id === b.dataset.seed);
      b.disabled = true;
      b.textContent = 'A criar as equipas…';
      try {
        const comp = Standings.fromSeed(seed);
        // As equipas da prova TÊM de ser as equipas da app: é contra elas que se
        // joga, e é nelas que vive o dossiê. Sem isto, a classificação era uma
        // tabela à parte, com nomes que não davam para lado nenhum.
        const criadas = await this.ensureTeams(comp);
        await DB.putRetry(DB.STORES.competitions, comp);
        toast(criadas ? `Prova importada · ${criadas} equipas criadas` : 'Prova importada');
        this.comp = comp; this.round = null;
        await this.render(document.getElementById('app-root'), { id: comp.id });
      } catch (e) {
        b.disabled = false;
        b.textContent = 'Importar esta prova';
        alert(DB.writeErrorText(e));
      }
    }));
  },

  renderBody() {
    const box = document.getElementById('comp-body');
    if (!box) return;
    box.innerHTML = this.tab === 'classificacao' ? this.tableHTML() : this.roundHTML();
    if (this.tab === 'jornada') this.bindRound();
  },

  // ---------- Classificação ----------
  tableHTML() {
    const linhas = Standings.compute(this.comp);
    const p = Standings.progress(this.comp);
    const nosso = this.comp.ourTeamName;
    const forma = (f) => f.slice(-5).map((r) => `<span class="comp-form is-${r}">${r}</span>`).join('');
    return `
      <p class="muted comp-progress">${p.played} de ${p.total} jogos com resultado (${p.pct}%). A classificação é calculada a partir deles — não há nada escrito à mão.</p>
      <div class="comp-table-wrap">
        <table class="comp-table">
          <thead>
            <tr>
              <th class="c-pos">#</th><th class="c-team">Equipa</th>
              <th title="Pontos">P</th><th title="Jogos">J</th>
              <th title="Vitórias">V</th><th title="Empates">E</th><th title="Derrotas">D</th>
              <th title="Golos marcados">GM</th><th title="Golos sofridos">GS</th><th title="Diferença de golos">DG</th>
              <th class="c-wide" title="Pontos por jogo">P/J</th>
              <th class="c-wide" title="Em casa: V-E-D">Casa</th>
              <th class="c-wide" title="Fora: V-E-D">Fora</th>
              <th class="c-wide" title="Últimos 5 jogos (o mais recente à direita)">Forma</th>
            </tr>
          </thead>
          <tbody>
            ${linhas.map((r) => `
              <tr class="${r.team === nosso ? 'is-us' : ''}">
                <td class="c-pos">${r.position}</td>
                <td class="c-team">${this.teamLink(r.team)}</td>
                <td class="c-pts">${r.points}</td><td>${r.played}</td>
                <td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td>
                <td>${r.goalsFor}</td><td>${r.goalsAgainst}</td>
                <td class="${r.goalDiff > 0 ? 'is-pos' : (r.goalDiff < 0 ? 'is-neg' : '')}">${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}</td>
                <td class="c-wide">${r.played ? r.ppg.toFixed(2) : '—'}</td>
                <td class="c-wide">${r.home.wins}-${r.home.draws}-${r.home.losses}</td>
                <td class="c-wide">${r.away.wins}-${r.away.draws}-${r.away.losses}</td>
                <td class="c-wide c-form">${forma(r.form) || '<span class="muted">—</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted pat-note">
        Desempates por esta ordem: ${(this.comp.tiebreakers || []).map((t) => Standings.TIEBREAKER_LABELS[t] || t).join(' → ')}.
        O confronto direto é resolvido como manda o regulamento: entre as equipas empatadas, contam só os jogos entre elas.
      </p>`;
  },

  // ---------- Jornada ----------
  roundHTML() {
    const rondas = Standings.rounds(this.comp);
    const jogos = Standings.fixturesOf(this.comp, this.round);
    const nosso = this.comp.ourTeamName;
    const dia = (f) => (f.tbd ? 'Data por definir' : `${Utils.formatDate(f.date)}${f.time ? ' · ' + f.time : ''}`);
    return `
      <div class="comp-round-nav">
        <button class="btn btn-small" id="r-prev" ${this.round <= rondas[0] ? 'disabled' : ''}>←</button>
        <select id="r-pick">
          ${rondas.map((r) => `<option value="${r}" ${r === this.round ? 'selected' : ''}>Jornada ${r}</option>`).join('')}
        </select>
        <button class="btn btn-small" id="r-next" ${this.round >= rondas[rondas.length - 1] ? 'disabled' : ''}>→</button>
      </div>
      <div class="comp-fixtures">
        ${jogos.map((f) => `
          <div class="comp-fixture ${f.home === nosso || f.away === nosso ? 'is-us' : ''} ${f.matchId ? 'is-linked' : ''}">
            <span class="cf-date">${dia(f)}</span>
            <span class="cf-home">${this.teamLink(f.home)}</span>
            ${f.matchId ? `
              <span class="cf-score is-linked" title="Resultado vindo do jogo registado na app">${f.homeGoals}–${f.awayGoals}</span>
            ` : `
              <span class="cf-score">
                <input type="number" min="0" max="99" inputmode="numeric" value="${f.homeGoals ?? ''}" data-goal="home" data-fix="${f.id}" aria-label="Golos ${Utils.escapeHtml(f.home)}">
                <input type="number" min="0" max="99" inputmode="numeric" value="${f.awayGoals ?? ''}" data-goal="away" data-fix="${f.id}" aria-label="Golos ${Utils.escapeHtml(f.away)}">
              </span>
            `}
            <span class="cf-away">${this.teamLink(f.away)}</span>
            ${f.matchId ? '<span class="cf-tag" title="Este é o teu jogo, registado na app">📋</span>' : '<span class="cf-tag"></span>'}
          </div>`).join('')}
      </div>
      <p class="muted pat-note">Os resultados gravam-se sozinhos. O teu jogo, quando estiver registado na app, aparece ligado (📋) e deixa de se escrever aqui — o resultado passa a vir do próprio jogo.</p>`;
  },

  bindRound() {
    document.getElementById('r-prev')?.addEventListener('click', () => { this.round--; this.renderBody(); });
    document.getElementById('r-next')?.addEventListener('click', () => { this.round++; this.renderBody(); });
    document.getElementById('r-pick')?.addEventListener('change', (e) => { this.round = Number(e.target.value); this.renderBody(); });
    document.querySelectorAll('[data-goal]').forEach((input) => {
      input.addEventListener('change', () => this.saveGoal(input));
      input.addEventListener('blur', () => this.saveGoal(input));
    });
  },

  async saveGoal(input) {
    const f = this.comp.fixtures.find((x) => x.id === input.dataset.fix);
    if (!f) return;
    const bruto = input.value.trim();
    const valor = bruto === '' ? null : Math.max(0, Math.min(99, Number(bruto)));
    const campo = input.dataset.goal === 'home' ? 'homeGoals' : 'awayGoals';
    if (f[campo] === valor) return;
    f[campo] = Number.isFinite(valor) ? valor : null;
    this.comp.updatedAt = Date.now();
    try {
      await DB.putRetry(DB.STORES.competitions, this.comp);
      input.classList.add('saved');
      setTimeout(() => input.classList.remove('saved'), 600);
    } catch (e) {
      alert(DB.writeErrorText(e));
    }
  },

  /**
   * Garante que cada equipa da prova existe como equipa da app, e guarda a
   * ligação em `comp.teamIds` (nome → id). Corre sempre que o ecrã abre.
   *
   * Duas decisões que importam:
   *  - A NOSSA equipa nunca é duplicada: se já existe uma marcada como própria,
   *    é essa que fica ligada ao nome da prova, mesmo que o nome não seja igual.
   *  - As equipas novas nascem com a estrutura completa do dossiê, em vez de
   *    ficarem à espera da migração do próximo arranque.
   *
   * @returns {Promise<number>} quantas equipas foram criadas agora
   */
  async ensureTeams(comp) {
    const existentes = await DB.getAll(DB.STORES.teams);
    // Se houver mais do que uma equipa própria (acontece a quem experimentou),
    // manda a que tem o nome da prova; senão, a que está marcada como própria.
    const nossa = existentes.find((t) => t.isOwnTeam && comp.ourTeamName && this._mesmaEquipa(t.name, comp.ourTeamName))
      || existentes.find((t) => t.isOwnTeam) || null;
    comp.teamIds = comp.teamIds || {};
    let criadas = 0;

    for (const nome of comp.teams || []) {
      const atual = comp.teamIds[nome] && existentes.find((t) => t.id === comp.teamIds[nome]);
      if (atual) continue;
      const somosNos = comp.ourTeamName && this._mesmaEquipa(nome, comp.ourTeamName);
      let equipa = existentes.find((t) => TeamLink.isExact(t, nome))
        || (somosNos && nossa ? nossa : null);
      if (!equipa) {
        // Antes de criar uma ficha nova: já existe alguma parecida? Se existe,
        // NÃO se cria nada — fica por confirmar. É isto que evita ter a mesma
        // equipa duas vezes, com o dossiê da pré-época numa e o calendário na
        // outra. A decisão é de quem sabe; a app só pergunta.
        if (TeamLink.bestCandidate(nome, existentes)) { delete comp.teamIds[nome]; continue; }
        equipa = this.newTeam(nome, { isOwnTeam: !!somosNos && !nossa });
        await DB.putRetry(DB.STORES.teams, equipa);
        existentes.push(equipa);
        criadas++;
      }
      comp.teamIds[nome] = equipa.id;
    }
    if (criadas) comp.updatedAt = Date.now();
    return criadas;
  },

  /** Equipa nova com o dossiê já estruturado (mesma forma que as migrações criam). */
  newTeam(nome, { isOwnTeam = false } = {}) {
    return {
      id: Utils.uid('team'),
      name: nome,
      abbreviation: ImageUtils.initials(nome),
      logo: null,
      colorPrimary: isOwnTeam ? '#5b93f0' : '#e5555c',
      colorSecondary: '#12161f',
      isOwnTeam,
      favorite: false,
      profile: {},
      scouting: {
        strengths: [], weaknesses: [], threats: [], opportunities: [],
        triggers: [], keyPlayers: [], checklist: null, notes: [], setPieces: [], blocks: {},
      },
      scoutingHistory: [],
      scoutingUpdatedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  },

  // ---------- Equipas por confirmar ----------

  async loadPending() {
    const [teams, players, matches] = await Promise.all([
      DB.getAll(DB.STORES.teams), DB.getAll(DB.STORES.players), DB.getAll(DB.STORES.matches),
    ]);
    this._teams = teams; this._players = players; this._matches = matches;
    this.pending = TeamLink.reconcile(this.comp, teams, { players, matches });
  },

  renderPending() {
    const box = document.getElementById('comp-pending');
    if (!box) return;
    const n = (this.pending || []).length;
    if (!n) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="comp-pending">
        <span>🔗 ${n} ${n === 1 ? 'equipa pode já existir' : 'equipas podem já existir'} na app. Juntar evita ter o mesmo adversário em duas fichas.</span>
        <button type="button" class="btn btn-small btn-primary" id="comp-resolve">Ver e confirmar</button>
      </div>`;
    document.getElementById('comp-resolve').addEventListener('click', () => this.openPending());
  },

  /** O que uma equipa já tem lá dentro, em texto — para decidir com dados à frente. */
  teamSummary(team) {
    const jogadores = this._players.filter((p) => p.teamId === team.id).length;
    const jogos = this._matches.filter((m) => m.teams?.own?.teamId === team.id || m.teams?.opponent?.teamId === team.id).length;
    const dossie = DataSafety.hasScoutingContent(team.scouting);
    const partes = [];
    if (jogos) partes.push(`${jogos} ${jogos === 1 ? 'jogo' : 'jogos'}`);
    if (jogadores) partes.push(`${jogadores} ${jogadores === 1 ? 'jogador' : 'jogadores'}`);
    if (dossie) partes.push('dossiê preenchido');
    return partes.length ? partes.join(' · ') : 'ficha vazia';
  },

  openPending() {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head"><h3>🔗 Equipas por confirmar</h3><button type="button" class="icon-btn" data-close>✕</button></div>
        <p class="muted">O calendário usa os nomes oficiais; na app podem estar com outro nome. Confirma uma a uma — nada se junta sem tu dizeres.</p>
        ${this.pending.map((p, i) => `
          <div class="pend-row" data-pend="${i}">
            <div class="pend-names">
              <span class="pend-official">${Utils.escapeHtml(p.name)}<small>no calendário</small></span>
              <span class="pend-arrow">↔</span>
              <span class="pend-mine">${Utils.escapeHtml(p.candidate.team.name)}<small>${Utils.escapeHtml(this.teamSummary(p.candidate.team))}</small></span>
            </div>
            <p class="muted pend-why">${p.kind === 'fundir'
              ? 'A prova criou uma ficha vazia para esta equipa. Se for a mesma, a vazia é apagada e fica só a tua.'
              : `Parecem a mesma equipa: ${Utils.escapeHtml(p.candidate.reason)}.`}</p>
            <div class="pend-actions">
              <select data-pick="${i}">
                ${this._teams.map((t) => `<option value="${t.id}" ${t.id === p.candidate.team.id ? 'selected' : ''}>${Utils.escapeHtml(t.name)} — ${Utils.escapeHtml(this.teamSummary(t))}</option>`).join('')}
              </select>
              <button type="button" class="btn btn-small btn-primary" data-same="${i}">É esta</button>
              <button type="button" class="btn btn-small" data-other="${i}">É nova</button>
            </div>
          </div>`).join('')}
        <h4 class="section-title">Juntar à mão</h4>
        <p class="muted">Se a app não sugeriu e sabes que são a mesma equipa, junta aqui. Nomes muito diferentes não são adivinhados de propósito.</p>
        <div class="pend-manual">
          <select id="pend-comp-name">
            ${(this.comp.teams || []).map((n) => `<option value="${Utils.escapeHtml(n)}">${Utils.escapeHtml(n)}</option>`).join('')}
          </select>
          <span class="pend-arrow">↔</span>
          <select id="pend-app-team">
            ${this._teams.map((t) => `<option value="${t.id}">${Utils.escapeHtml(t.name)} — ${Utils.escapeHtml(this.teamSummary(t))}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-small btn-primary" id="pend-manual-go">Juntar</button>
        </div>
        <div class="dialog-actions"><button type="button" class="btn" data-close>Fechar</button></div>
      </div>`;
    document.body.appendChild(dlg);
    const fechar = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
      fechar();
      this.render(document.getElementById('app-root'), { id: this.comp.id });
    }));
    dlg.addEventListener('cancel', () => dlg.remove());
    dlg.querySelector('#pend-manual-go').addEventListener('click', async (e) => {
      const nome = dlg.querySelector('#pend-comp-name').value;
      const equipa = this._teams.find((t) => t.id === dlg.querySelector('#pend-app-team').value);
      if (!nome || !equipa) return;
      const atual = this.comp.teamIds[nome];
      const outra = atual && atual !== equipa.id ? this._teams.find((t) => t.id === atual) : null;
      const vaziaParaApagar = outra && TeamLink.isEmptyTeam(outra, { players: this._players, matches: this._matches });
      // A mensagem diz exatamente o que vai acontecer: apagar uma ficha só é
      // verdade quando ela está vazia. Se tiver conteúdo, fica intacta.
      const aviso = vaziaParaApagar
        ? `A ficha vazia "${outra.name}" é apagada e fica só a tua.`
        : (outra ? `A ficha "${outra.name}" tem conteúdo e NÃO é apagada — deixa apenas de estar ligada a esta prova.` : '');
      if (!confirm(`Juntar "${nome}" do calendário à equipa "${equipa.name}"?\n\n${aviso}`)) return;
      e.currentTarget.disabled = true;
      await this.confirmSame({
        name: nome, linkedId: outra ? outra.id : null,
        kind: vaziaParaApagar ? 'fundir' : 'ligar',
        candidate: { team: equipa, score: 1, reason: 'ligação manual' },
      });
      fechar();
      this.render(document.getElementById('app-root'), { id: this.comp.id });
    });
    dlg.querySelectorAll('[data-same]').forEach((b) => b.addEventListener('click', async () => {
      const i = Number(b.dataset.same);
      const escolhida = this._teams.find((t) => t.id === dlg.querySelector(`[data-pick="${i}"]`).value);
      const item = { ...this.pending[i] };
      if (escolhida && escolhida.id !== item.candidate.team.id) {
        item.candidate = { team: escolhida, score: 1, reason: 'escolha manual' };
      }
      await this.confirmSame(item);
      b.closest('.pend-row').classList.add('is-done');
      b.closest('.pend-actions').innerHTML = '<span class="muted">✅ Juntas</span>';
    }));
    dlg.querySelectorAll('[data-other]').forEach((b) => b.addEventListener('click', async () => {
      await this.confirmDifferent(this.pending[Number(b.dataset.other)]);
      b.closest('.pend-row').classList.add('is-done');
      b.closest('.pend-actions').innerHTML = '<span class="muted">Ficam separadas</span>';
    }));
    dlg.showModal();
  },

  /** É a mesma: liga (e funde, se a prova já tinha criado uma ficha vazia). */
  async confirmSame(p) {
    const minha = p.candidate.team;
    if (p.kind === 'fundir' && p.linkedId && p.linkedId !== minha.id) {
      const vazia = this._teams.find((t) => t.id === p.linkedId);
      if (vazia) await this.mergeTeams(minha, vazia);
    }
    // O nome oficial fica como apelido: o calendário e os jogos antigos passam
    // a reconhecer a equipa pelos dois nomes, sem lhe mudar o nome.
    if (!TeamLink.isExact(minha, p.name)) {
      minha.aliases = [...new Set([...(minha.aliases || []), p.name])];
      minha.updatedAt = Date.now();
      await DB.putRetry(DB.STORES.teams, minha);
    }
    this.comp.teamIds[p.name] = minha.id;
    this.comp.updatedAt = Date.now();
    await DB.putRetry(DB.STORES.competitions, this.comp);
    toast(`${p.name} ligada a ${minha.name}`);
  },

  /** São diferentes: cria a ficha nova da prova (se ainda não existir). */
  async confirmDifferent(p) {
    if (this.comp.teamIds[p.name]) return;
    const nova = this.newTeam(p.name);
    await DB.putRetry(DB.STORES.teams, nova);
    this.comp.teamIds[p.name] = nova.id;
    this.comp.updatedAt = Date.now();
    await DB.putRetry(DB.STORES.competitions, this.comp);
    toast(`${p.name} criada como equipa nova`);
  },

  /** Funde duas fichas (ver TeamMerge: a ordem das operações é lá explicada). */
  async mergeTeams(keep, drop) {
    await TeamMerge.run(keep.id, drop.id);
    this._teams = this._teams.filter((t) => t.id !== drop.id);
    // A ficha que fica mudou (apelidos, dossiê) — recarrega para não usar a antiga.
    const fresca = await DB.get(DB.STORES.teams, keep.id);
    if (fresca) {
      const i = this._teams.findIndex((t) => t.id === keep.id);
      if (i >= 0) this._teams[i] = fresca; else this._teams.push(fresca);
      Object.assign(keep, fresca);
    }
  },

  /** Id da equipa da app para um nome da prova (null se ainda não ligada). */
  teamIdOf(nome) {
    return (this.comp && this.comp.teamIds && this.comp.teamIds[nome]) || null;
  },

  /** Nome tocável: leva ao dossiê do adversário, ou ao plantel se somos nós. */
  teamLink(nome) {
    const id = this.teamIdOf(nome);
    const texto = Utils.escapeHtml(nome);
    if (!id) return texto;
    const nosso = this.comp.ourTeamName && this._mesmaEquipa(nome, this.comp.ourTeamName);
    const destino = nosso ? `#/team/${id}` : `#/scouting/${id}`;
    return `<button type="button" class="comp-team-link" data-nav="${destino}" title="${nosso ? 'Abrir o plantel' : 'Abrir o dossiê de scouting'}">${texto}</button>`;
  },

  /**
   * Liga os jogos do calendário aos jogos registados na app, pela data e pelo
   * nome do adversário. O resultado passa a vir do jogo — nunca é escrito duas
   * vezes. Correr isto sempre que se abre o ecrã mantém tudo em dia sozinho.
   */
  async linkOurMatches() {
    const nosso = this.comp.ourTeamName;
    if (!nosso) return;
    const jogos = (await DB.getAll(DB.STORES.matches)).filter((m) => m.status === 'finished');
    let mudou = false;
    this.comp.fixtures.forEach((f) => {
      if (f.home !== nosso && f.away !== nosso) return;
      const adversario = f.home === nosso ? f.away : f.home;
      // Pelo ID primeiro: é a ligação verdadeira. O nome só serve de recurso,
      // porque o jogo pode ter sido criado antes de a prova existir.
      const idAdv = this.teamIdOf(adversario);
      const m = jogos.find((x) => x.date === f.date && (
        (idAdv && (x.teams?.opponent?.teamId === idAdv || x.teams?.own?.teamId === idAdv))
        || this._mesmaEquipa(x.opponent, adversario)));
      if (!m) return;
      const nossosGolos = m.score?.team ?? 0;
      const delesGolos = m.score?.opponent ?? 0;
      const casa = f.home === nosso ? nossosGolos : delesGolos;
      const fora = f.home === nosso ? delesGolos : nossosGolos;
      if (f.matchId !== m.id || f.homeGoals !== casa || f.awayGoals !== fora) {
        f.matchId = m.id; f.homeGoals = casa; f.awayGoals = fora;
        mudou = true;
      }
    });
    if (mudou) {
      this.comp.updatedAt = Date.now();
      try { await DB.putRetry(DB.STORES.competitions, this.comp); } catch (e) { /* mostra na mesma o que calculou */ }
    }
  },

  /** Uma regra só para comparar nomes de equipas (ver Standings.sameTeam). */
  _mesmaEquipa(a, b) {
    return Standings.sameTeam(a, b);
  },
};

window.CompetitionScreen = CompetitionScreen;
