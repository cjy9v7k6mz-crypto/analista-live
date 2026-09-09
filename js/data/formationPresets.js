/**
 * formationPresets.js — Formações táticas predefinidas.
 * Coordenadas em percentagem (x: 0-100 esquerda→direita, y: 0-100 medido a
 * partir da PRÓPRIA baliza: y=5 é a linha do guarda-redes e y=92 é a linha
 * mais avançada. A equipa ataca para CIMA no ecrã (convenção tática habitual),
 * o que garante que o lado esquerdo do jogador coincide com o lado esquerdo
 * do ecrã (DE/EE à esquerda, DD/ED à direita).
 * Isto é apenas o ponto de partida visual — todos os jogadores podem ser
 * arrastados livremente depois de colocados (o desenho tático nem sempre
 * corresponde à posição nominal).
 *
 * "role" é a etiqueta nominal da posição, usada para sugerir automaticamente
 * que jogador colocar em cada slot (por posição), mas não é vinculativa.
 */

function slot(x, y, role) { return { x, y, role }; }

const FORMATION_PRESETS = [
  {
    id: 'f-433', name: '4-3-3',
    slots: [
      slot(50, 5, 'GR'),
      slot(18, 24, 'DE'), slot(38, 20, 'DC'), slot(62, 20, 'DC'), slot(82, 24, 'DD'),
      slot(30, 45, 'MC'), slot(50, 40, 'MC'), slot(70, 45, 'MC'),
      slot(20, 75, 'EE'), slot(50, 85, 'PL'), slot(80, 75, 'ED'),
    ],
  },
  {
    id: 'f-442', name: '4-4-2',
    slots: [
      slot(50, 5, 'GR'),
      slot(18, 24, 'DE'), slot(38, 20, 'DC'), slot(62, 20, 'DC'), slot(82, 24, 'DD'),
      slot(18, 50, 'EE'), slot(40, 48, 'MC'), slot(60, 48, 'MC'), slot(82, 50, 'ED'),
      slot(38, 82, 'PL'), slot(62, 82, 'PL'),
    ],
  },
  {
    id: 'f-4231', name: '4-2-3-1',
    slots: [
      slot(50, 5, 'GR'),
      slot(18, 24, 'DE'), slot(38, 20, 'DC'), slot(62, 20, 'DC'), slot(82, 24, 'DD'),
      slot(38, 42, 'MDC'), slot(62, 42, 'MDC'),
      slot(20, 66, 'EE'), slot(50, 68, 'MCO'), slot(80, 66, 'ED'),
      slot(50, 88, 'PL'),
    ],
  },
  {
    id: 'f-4312', name: '4-3-1-2',
    slots: [
      slot(50, 5, 'GR'),
      slot(18, 24, 'DE'), slot(38, 20, 'DC'), slot(62, 20, 'DC'), slot(82, 24, 'DD'),
      slot(30, 42, 'MC'), slot(50, 38, 'MC'), slot(70, 42, 'MC'),
      slot(50, 66, 'MCO'),
      slot(38, 86, 'PL'), slot(62, 86, 'PL'),
    ],
  },
  {
    id: 'f-343', name: '3-4-3',
    slots: [
      slot(50, 5, 'GR'),
      slot(28, 22, 'DC'), slot(50, 18, 'DC'), slot(72, 22, 'DC'),
      slot(15, 48, 'EE'), slot(38, 44, 'MC'), slot(62, 44, 'MC'), slot(85, 48, 'ED'),
      slot(20, 78, 'EE'), slot(50, 86, 'PL'), slot(80, 78, 'ED'),
    ],
  },
  {
    id: 'f-352', name: '3-5-2',
    slots: [
      slot(50, 5, 'GR'),
      slot(28, 22, 'DC'), slot(50, 18, 'DC'), slot(72, 22, 'DC'),
      slot(12, 45, 'EE'), slot(32, 42, 'MC'), slot(50, 40, 'MC'), slot(68, 42, 'MC'), slot(88, 45, 'ED'),
      slot(38, 82, 'PL'), slot(62, 82, 'PL'),
    ],
  },
  {
    id: 'f-532', name: '5-3-2',
    slots: [
      slot(50, 5, 'GR'),
      slot(10, 26, 'DE'), slot(30, 22, 'DC'), slot(50, 20, 'DC'), slot(70, 22, 'DC'), slot(90, 26, 'DD'),
      slot(32, 48, 'MC'), slot(50, 44, 'MC'), slot(68, 48, 'MC'),
      slot(38, 82, 'PL'), slot(62, 82, 'PL'),
    ],
  },
];

function getFormationPreset(id) {
  return FORMATION_PRESETS.find((f) => f.id === id) || FORMATION_PRESETS[0];
}

window.FORMATION_PRESETS = FORMATION_PRESETS;
window.getFormationPreset = getFormationPreset;
