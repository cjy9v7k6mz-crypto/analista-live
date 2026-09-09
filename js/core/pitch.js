/**
 * pitch.js — Desenho do campo de futebol, partilhado por TODA a aplicação.
 *
 * Existe um único sítio que sabe desenhar um campo: aqui. É usado pelo mapa de
 * remates e de faltas no ecrã (SVG) e no relatório PDF (pdf-lib). Assim o campo
 * é exatamente igual nos dois sítios e não há duas implementações a divergir.
 *
 * Sistema de coordenadas (o mesmo dos eventos guardados):
 *   x: 0 = esquerda, 1 = direita
 *   y: 0 = topo (baliza adversária), 1 = fundo (baliza própria)
 * Proporções reais de um campo (68 x 105 m), normalizadas.
 */

const Pitch = {
  RATIO: 68 / 105, // largura/altura

  // Medidas oficiais convertidas para fração do campo
  M: {
    boxW: 40.32 / 68,      // grande área: 40.32m de largura
    boxH: 16.5 / 105,      // 16.5m de profundidade
    sixW: 18.32 / 68,      // pequena área
    sixH: 5.5 / 105,
    goalW: 7.32 / 68,      // baliza
    circleR: 9.15 / 68,    // círculo central (raio em fração da largura)
    penaltySpot: 11 / 105,
  },

  /**
   * Campo em SVG, para o ecrã. `markers` é HTML já pronto a sobrepor.
   * O SVG garante que as marcações não deformam em nenhum tamanho de ecrã.
   */
  svg(opts = {}) {
    const { boxW, boxH, sixW, sixH, goalW, circleR, penaltySpot } = this.M;
    const line = 'stroke="rgba(255,255,255,.55)" stroke-width="0.004" fill="none"';
    const cx = 0.5;
    return `
      <svg class="pitch-svg" viewBox="0 0 1 ${1 / this.RATIO}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="pitchGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#17392a"/><stop offset="50%" stop-color="#143223"/><stop offset="100%" stop-color="#17392a"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="1" height="${1 / this.RATIO}" fill="url(#pitchGrad)"/>
        ${this._stripes()}
        <!-- linha exterior -->
        <rect x="0.012" y="0.012" width="${1 - 0.024}" height="${1 / this.RATIO - 0.024}" ${line}/>
        <!-- meio-campo e círculo central -->
        <line x1="0.012" y1="${0.5 / this.RATIO}" x2="${1 - 0.012}" y2="${0.5 / this.RATIO}" ${line}/>
        <circle cx="${cx}" cy="${0.5 / this.RATIO}" r="${circleR}" ${line}/>
        <circle cx="${cx}" cy="${0.5 / this.RATIO}" r="0.008" fill="rgba(255,255,255,.55)"/>
        <!-- grande área (topo e fundo) -->
        <rect x="${cx - boxW / 2}" y="0.012" width="${boxW}" height="${boxH / this.RATIO}" ${line}/>
        <rect x="${cx - boxW / 2}" y="${1 / this.RATIO - 0.012 - boxH / this.RATIO}" width="${boxW}" height="${boxH / this.RATIO}" ${line}/>
        <!-- pequena área -->
        <rect x="${cx - sixW / 2}" y="0.012" width="${sixW}" height="${sixH / this.RATIO}" ${line}/>
        <rect x="${cx - sixW / 2}" y="${1 / this.RATIO - 0.012 - sixH / this.RATIO}" width="${sixW}" height="${sixH / this.RATIO}" ${line}/>
        <!-- balizas -->
        <rect x="${cx - goalW / 2}" y="0.002" width="${goalW}" height="0.012" stroke="rgba(255,255,255,.8)" stroke-width="0.004" fill="none"/>
        <rect x="${cx - goalW / 2}" y="${1 / this.RATIO - 0.014}" width="${goalW}" height="0.012" stroke="rgba(255,255,255,.8)" stroke-width="0.004" fill="none"/>
        <!-- pontos de penálti -->
        <circle cx="${cx}" cy="${penaltySpot / this.RATIO + 0.012}" r="0.006" fill="rgba(255,255,255,.6)"/>
        <circle cx="${cx}" cy="${1 / this.RATIO - 0.012 - penaltySpot / this.RATIO}" r="0.006" fill="rgba(255,255,255,.6)"/>
        <!-- meias-luas -->
        <path d="M ${cx - 0.09} ${(boxH + 0.001) / this.RATIO + 0.012} A ${circleR} ${circleR} 0 0 0 ${cx + 0.09} ${(boxH + 0.001) / this.RATIO + 0.012}" ${line}/>
        <path d="M ${cx - 0.09} ${1 / this.RATIO - 0.012 - (boxH + 0.001) / this.RATIO} A ${circleR} ${circleR} 0 0 1 ${cx + 0.09} ${1 / this.RATIO - 0.012 - (boxH + 0.001) / this.RATIO}" ${line}/>
      </svg>`;
  },

  _stripes() {
    let s = '';
    const h = 1 / this.RATIO;
    const bands = 10;
    for (let i = 0; i < bands; i += 2) {
      s += `<rect x="0" y="${(i * h) / bands}" width="1" height="${h / bands}" fill="rgba(255,255,255,.022)"/>`;
    }
    return s;
  },

  /** Bloco completo de campo com marcadores sobrepostos (ecrã). */
  mapHTML(markersHTML, extraClass = '') {
    return `<div class="pitch-map ${extraClass}">${this.svg()}<div class="pitch-map-layer">${markersHTML}</div></div>`;
  },

  /**
   * Desenha o campo no PDF (pdf-lib), na mesma proporção do ecrã.
   * Devolve as dimensões usadas para colocar os marcadores por cima.
   */
  drawPDF(S, x0, yTop, width) {
    const h = width / this.RATIO;
    const y0 = yTop - h; // canto inferior esquerdo
    const { boxW, boxH, sixW, sixH, goalW, circleR, penaltySpot } = this.M;
    const white = S.rgb(1, 1, 1);
    const lw = 0.7;
    const opts = { borderColor: white, borderWidth: lw, borderOpacity: 0.55, opacity: 0 };

    // relva
    S.page.drawRectangle({ x: x0, y: y0, width, height: h, color: S.rgb(0.09, 0.22, 0.14) });
    // linha exterior
    const inset = width * 0.012;
    S.page.drawRectangle({ x: x0 + inset, y: y0 + inset, width: width - inset * 2, height: h - inset * 2, ...opts });
    // meio-campo + círculo
    S.page.drawLine({ start: { x: x0 + inset, y: y0 + h / 2 }, end: { x: x0 + width - inset, y: y0 + h / 2 }, thickness: lw, color: white, opacity: 0.55 });
    S.page.drawCircle({ x: x0 + width / 2, y: y0 + h / 2, size: circleR * width, ...opts });
    S.page.drawCircle({ x: x0 + width / 2, y: y0 + h / 2, size: 1.6, color: white, opacity: 0.55 });

    const cxp = x0 + width / 2;
    // áreas (em cima e em baixo)
    [true, false].forEach((top) => {
      const boxHeight = boxH * h * (105 / 105);
      const sixHeight = sixH * h;
      const by = top ? y0 + h - inset - boxHeight : y0 + inset;
      const sy = top ? y0 + h - inset - sixHeight : y0 + inset;
      S.page.drawRectangle({ x: cxp - (boxW * width) / 2, y: by, width: boxW * width, height: boxHeight, ...opts });
      S.page.drawRectangle({ x: cxp - (sixW * width) / 2, y: sy, width: sixW * width, height: sixHeight, ...opts });
      // baliza
      const gy = top ? y0 + h - inset : y0 + inset - 3;
      S.page.drawRectangle({ x: cxp - (goalW * width) / 2, y: gy, width: goalW * width, height: 3, borderColor: white, borderWidth: lw, borderOpacity: 0.85, opacity: 0 });
      // ponto de penálti
      const py = top ? y0 + h - inset - penaltySpot * h : y0 + inset + penaltySpot * h;
      S.page.drawCircle({ x: cxp, y: py, size: 1.4, color: white, opacity: 0.6 });
    });

    return { x0, y0, width, height: h };
  },

  /** Converte coordenadas normalizadas (y para baixo) para o espaço do PDF (y para cima). */
  toPDF(rect, xy) {
    return { x: rect.x0 + xy.x * rect.width, y: rect.y0 + (1 - xy.y) * rect.height };
  },
};

window.Pitch = Pitch;
