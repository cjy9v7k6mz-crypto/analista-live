/**
 * imageUtils.js — Redimensiona e comprime imagens (fotos de jogadores, logótipos)
 * para base64 antes de guardar. Isto garante que carregar fotos nunca torna o
 * modo LIVE lento: guardamos sempre uma versão "thumbnail" pequena para uso no
 * painel, e opcionalmente uma versão maior para ecrãs de perfil/gestão.
 *
 * Tudo feito localmente via <canvas>, sem dependências externas.
 */

function readFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Redimensiona a imagem para caber em maxSize x maxSize (mantendo proporção),
 * exporta como JPEG (fotos) ou PNG (logótipos, para preservar transparência).
 */
function resizeToDataURL(img, maxSize, mimeType = 'image/jpeg', quality = 0.82) {
  let { width, height } = img;
  if (width > height) {
    if (width > maxSize) { height = Math.round(height * (maxSize / width)); width = maxSize; }
  } else {
    if (height > maxSize) { width = Math.round(width * (maxSize / height)); height = maxSize; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (mimeType === 'image/jpeg') {
    // fundo branco para fotos sem transparência (evita preto em PNGs com alpha convertidos para JPEG)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL(mimeType, quality);
}

const ImageUtils = {
  /**
   * Processa uma foto de jogador: devolve { thumb, full }.
   * thumb: 96px (usado no painel LIVE e listas — mantém tudo rápido).
   * full: 320px (usado no ecrã de perfil do jogador).
   */
  async processPlayerPhoto(file) {
    const img = await readFileAsImage(file);
    return {
      thumb: resizeToDataURL(img, 96, 'image/jpeg', 0.8),
      full: resizeToDataURL(img, 320, 'image/jpeg', 0.85),
    };
  },

  /**
   * Processa um logótipo de equipa: mantém PNG (transparência) e um único
   * tamanho (160px) — logótipos são pouco usados em simultâneo, não precisam
   * de duas versões.
   */
  async processTeamLogo(file) {
    const isPng = file.type === 'image/png' || file.type === 'image/webp';
    const img = await readFileAsImage(file);
    const mime = isPng ? 'image/png' : 'image/jpeg';
    return resizeToDataURL(img, 160, mime, 0.9);
  },

  /**
   * Processa um esquema tático de bola parada. Ao contrário das fotos de
   * jogador, aqui a resolução IMPORTA: a imagem contém informação tática que
   * tem de continuar legível no PDF e na partilha com a equipa técnica.
   * Guardamos duas versões: uma miniatura leve para a interface (para não
   * carregar tudo em resolução máxima) e uma versão grande de boa qualidade
   * para visualização e relatório.
   */
  async processTacticalImage(file) {
    const img = await readFileAsImage(file);
    const isPng = file.type === 'image/png' || file.type === 'image/webp';
    const mime = isPng ? 'image/png' : 'image/jpeg';
    return {
      thumb: resizeToDataURL(img, 360, 'image/jpeg', 0.8),
      full: resizeToDataURL(img, 1600, mime, 0.92),
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    };
  },

  /** Gera iniciais a partir de um nome, para avatares neutros sem foto. */
  initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  },
};

window.ImageUtils = ImageUtils;
