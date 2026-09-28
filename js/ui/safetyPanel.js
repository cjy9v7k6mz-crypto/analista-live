/**
 * safetyPanel.js — A lista de cópias de segurança de um jogo, e o caminho de
 * volta.
 *
 * Aparece em dois sítios: no menu do LIVE (quando alguma coisa corre mal com o
 * jogo a decorrer) e no pós-jogo (quando se dá pelo estrago mais tarde).
 *
 * Regra do ecrã: antes de repor, diz-se exatamente o que muda — incluindo o que
 * se perde. E o estado atual fica sempre guardado como cópia, para que voltar
 * atrás nunca seja um caminho sem regresso.
 */

const SafetyPanel = {
  async open(matchId, onRestored) {
    const copias = await MatchSafety.list(matchId);
    const atuais = (await DB.getAllByIndex(DB.STORES.occurrences, 'matchId', matchId)).length;
    const match = await DB.get(DB.STORES.matches, matchId);

    const dlg = document.createElement('dialog');
    dlg.className = 'dialog dialog-wide';
    dlg.innerHTML = `
      <div class="dialog-card">
        <div class="stats-head"><h3>🛟 Cópias de segurança deste jogo</h3><button type="button" class="icon-btn" data-close>✕</button></div>
        <p class="muted">A app grava sozinha: ao abrir o jogo, ao intervalo, ao terminar e de ${MatchSafety.INTERVAL_MIN} em ${MatchSafety.INTERVAL_MIN} minutos enquanto o cronómetro corre. Não tens de fazer nada.</p>
        <p class="sp-now">Agora: <strong>${match ? `${match.score?.team ?? 0}-${match.score?.opponent ?? 0}` : '—'}</strong> · ${atuais} registos</p>
        ${copias.length ? `
          <div class="sp-list">
            ${copias.map((c) => `
              <div class="sp-row ${c.reason !== 'automática' ? 'is-marked' : ''}">
                <span class="sp-when">${MatchSafety.timeLabel(c)}<small>${Utils.escapeHtml(c.gameLabel)}</small></span>
                <span class="sp-what">
                  <strong>${c.score.team}-${c.score.opponent}</strong>
                  <small>${c.counts.occurrences} registos${c.counts.cards ? ` · ${c.counts.cards} cartões` : ''}</small>
                </span>
                <span class="sp-reason">${Utils.escapeHtml(c.reason)}</span>
                <button type="button" class="btn btn-small" data-restore="${c.id}">Repor</button>
              </div>`).join('')}
          </div>` : '<p class="muted">Ainda não há cópias deste jogo. A primeira é gravada assim que abrires o painel do jogo.</p>'}
        <div class="dialog-actions"><button type="button" class="btn" data-close>Fechar</button></div>
      </div>`;
    document.body.appendChild(dlg);
    const fechar = () => { dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', fechar));
    dlg.addEventListener('cancel', () => dlg.remove());

    dlg.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async (e) => {
      const botao = e.currentTarget;
      const copia = copias.find((c) => c.id === botao.dataset.restore);
      if (!copia) return;
      if (!confirm(`Repor esta cópia?\n\n${MatchSafety.describeRestore(copia, atuais)}`)) return;
      botao.disabled = true;
      try {
        await MatchSafety.restore(copia.id);
        fechar();
        toast('Jogo reposto');
        if (onRestored) onRestored();
      } catch (err) {
        botao.disabled = false;
        CrashGuard.record('repor cópia', err && err.message, err && err.stack, 'MatchSafety.restore', false);
        alert('Não foi possível repor: ' + err.message);
      }
    }));
    dlg.showModal();
  },

  /**
   * Aviso quando as contas do jogo deixam de bater certo. É a parte que o
   * analista não tem de procurar: aparece sozinha no pós-jogo.
   */
  problemsHTML(problemas) {
    if (!problemas.length) return '';
    return `
      <div class="sp-alert">
        <div class="sp-alert-head">⚠️ Este jogo tem números que não batem certo</div>
        ${problemas.map((p) => `<p>${Utils.escapeHtml(p.text)}</p>`).join('')}
        <button type="button" class="btn btn-small btn-primary" id="sp-open-safety">Ver cópias de segurança</button>
      </div>`;
  },
};

window.SafetyPanel = SafetyPanel;
