/**
 * matchCard.js — O jogo numa imagem, para o WhatsApp do staff.
 *
 * O PDF é para ler sentado. O grupo do staff é onde as coisas são mesmo vistas,
 * e lá um PDF de 12 páginas não se abre. Isto desenha uma imagem única, em
 * formato vertical (1080×1350, o que o WhatsApp e o Instagram mostram sem
 * cortar), com o resultado, os números que interessam e as três leituras do
 * jogo tiradas dos padrões.
 *
 * Desenhado em canvas e não em HTML: não depende de bibliotecas, funciona
 * offline e sai sempre igual, independentemente do ecrã.
 */

const MatchCard = {
  W: 1080,
  H: 1350,
  COLORS: {
    bg: '#0f1420', panel: '#161b26', line: '#2a3244',
    text: '#eef1f6', dim: '#a7b0c0', mute: '#79839a',
    own: '#5b93f0', opp: '#e5555c', good: '#3fc98a', warn: '#e3b23c',
  },
  /** Estatísticas mostradas, por ordem. Fora as que não dizem nada num cartão. */
  ROWS: ['shots', 'shotsOnTarget', 'chancesCreated', 'corners', 'foulsCommitted', 'yellowCards'],

  /**
   * @returns {Promise<Blob>} PNG
   */
  async build(match, occurrences, { nameOf = () => null } = {}) {
    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.H;
    const g = c.getContext('2d');
    const C = this.COLORS;
    const st = MatchStats.compute(match, occurrences);

    g.fillStyle = C.bg;
    g.fillRect(0, 0, this.W, this.H);

    const centro = this.W / 2;
    const fonte = (px, peso = '600') => { g.font = `${peso} ${px}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; };
    const texto = (t, x, y, { size = 28, weight = '600', color = C.text, align = 'left', max = this.W - 120 } = {}) => {
      fonte(size, weight); g.fillStyle = color; g.textAlign = align;
      g.fillText(String(t), x, y, max);
    };

    // Cabeçalho
    let y = 92;
    texto((match.competition || 'Jogo').toUpperCase(), centro, y, { size: 26, color: C.mute, align: 'center' });
    y += 40;
    texto(Utils.formatDate ? Utils.formatDate(match.date) : (match.date || ''), centro, y, { size: 24, color: C.mute, align: 'center' });

    // Resultado
    y += 108;
    texto(match.team, centro - 150, y, { size: 40, align: 'right', max: 320 });
    texto(match.opponent, centro + 150, y, { size: 40, align: 'left', color: C.dim, max: 320 });
    fonte(104, '800'); g.textAlign = 'center'; g.fillStyle = C.text;
    g.fillText(`${match.score?.team ?? 0}`, centro - 62, y + 14);
    g.fillStyle = C.mute; g.fillText('-', centro, y + 8);
    g.fillStyle = C.text; g.fillText(`${match.score?.opponent ?? 0}`, centro + 62, y + 14);

    // Barras comparativas
    y += 96;
    const largura = this.W - 160;
    this.ROWS.forEach((k) => {
      const meta = MatchStats.STAT_KEYS.find((x) => x.key === k);
      const a = st.own[k] || 0, b = st.opp[k] || 0;
      const total = a + b;
      y += 76;
      texto(a, 80, y, { size: 30, weight: '800' });
      texto(meta ? meta.label : k, centro, y, { size: 24, color: C.dim, align: 'center', max: 460 });
      texto(b, this.W - 80, y, { size: 30, weight: '800', align: 'right' });
      // A barra só aparece quando há alguma coisa para comparar.
      const by = y + 16;
      g.fillStyle = C.line; g.fillRect(80, by, largura, 8);
      if (total > 0) {
        const wa = Math.round((a / total) * largura);
        g.fillStyle = C.own; g.fillRect(80, by, wa, 8);
        g.fillStyle = C.opp; g.fillRect(80 + wa, by, largura - wa, 8);
      }
    });

    // Leituras: as mesmas do bloco de padrões, em texto corrido.
    const leituras = MatchStats.patternHighlights(occurrences, match, nameOf).slice(0, 3);
    if (leituras.length) {
      y += 92;
      g.fillStyle = C.panel;
      const alturaPainel = 60 + leituras.length * 74;
      this._roundRect(g, 60, y - 40, this.W - 120, alturaPainel, 20);
      g.fill();
      texto('LEITURAS DO JOGO', 96, y, { size: 22, color: C.mute });
      leituras.forEach((l) => {
        y += 74;
        texto(`${l.icon}  ${l.label}`, 96, y, { size: 26, color: C.text, max: 640 });
        texto(l.value, this.W - 96, y, { size: 30, weight: '800', align: 'right', color: C.warn });
        texto(l.detail || '', 96, y + 28, { size: 20, color: C.mute, max: 820 });
      });
    }

    texto('Analista Live', centro, this.H - 56, { size: 22, color: C.mute, align: 'center' });

    return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
  },

  _roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  },

  /** Desenha e entrega ao sistema (partilhar ou descarregar). */
  async share(match, occurrences, opts) {
    const blob = await this.build(match, occurrences, opts);
    const nome = `jogo_${Utils.slug ? Utils.slug(match.opponent) : String(match.opponent || '').replace(/\W+/g, '_')}_${match.date || ''}.png`;
    return saveOrShareBlob(blob, nome);
  },
};

window.MatchCard = MatchCard;
