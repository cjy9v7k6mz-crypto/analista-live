/**
 * scoutingModel.js — Estrutura do centro de scouting.
 *
 * Todos os campos são OPCIONAIS. A configuração está aqui em dados (não em
 * código de UI) para que acrescentar ou renomear um campo seja trivial e para
 * que o ecrã se construa sozinho a partir desta definição.
 */

const SCOUTING_SECTIONS = [
  {
    id: 'model', icon: '🧠', title: 'Modelo de Jogo',
    fields: [
      { key: 'formationMain', label: 'Formação habitual', placeholder: 'Ex: 4-3-3' },
      { key: 'formationAlt', label: 'Formação alternativa', placeholder: 'Ex: 4-4-2 sem bola' },
      { key: 'structureWith', label: 'Estrutura com bola', long: true },
      { key: 'structureWithout', label: 'Estrutura sem bola', long: true },
      { key: 'buildUp', label: 'Modelo de construção', long: true, placeholder: 'Ex: 3+2 com pivot a baixar' },
      { key: 'exitBall', label: 'Saída de bola', long: true },
      { key: 'progression', label: 'Progressão', long: true },
      { key: 'creation', label: 'Criação', long: true },
      { key: 'finishing', label: 'Finalização', long: true },
    ],
  },
  {
    id: 'offensive', icon: '⚔️', title: 'Organização Ofensiva',
    fields: [
      { key: 'offShape', label: 'Estrutura ofensiva', long: true },
      { key: 'offWidth', label: 'Amplitude e profundidade', long: true },
      { key: 'offCombinations', label: 'Combinações e automatismos', long: true },
      { key: 'offZones', label: 'Zonas de finalização', long: true },
      { key: 'offReferences', label: 'Referências ofensivas (jogadores)', long: true },
    ],
  },
  {
    id: 'defensive', icon: '🛡️', title: 'Organização Defensiva',
    fields: [
      { key: 'pressing', label: 'Pressão', placeholder: 'Ex: alta, por zona' },
      { key: 'blockHeight', label: 'Altura do bloco', placeholder: 'Ex: médio-alto' },
      { key: 'defLine', label: 'Comportamento da linha defensiva', long: true },
      { key: 'containment', label: 'Contenção', long: true },
      { key: 'cover', label: 'Cobertura', long: true },
      { key: 'balance', label: 'Equilíbrio', long: true },
      { key: 'centralCorridor', label: 'Corredor central', long: true },
      { key: 'wideCorridor', label: 'Corredor lateral', long: true },
      { key: 'fullbacks', label: 'Comportamento dos laterais', long: true },
      { key: 'crossDefense', label: 'Defesa de cruzamentos', long: true },
      { key: 'ballsBehind', label: 'Defesa de bolas nas costas', long: true },
    ],
  },
  {
    id: 'transOff', icon: '⚡', title: 'Transição Ofensiva',
    fields: [
      { key: 'firstAction', label: 'Primeira ação após recuperação', long: true },
      { key: 'targetPlayers', label: 'Jogadores procurados', long: true },
      { key: 'speed', label: 'Velocidade', placeholder: 'Ex: muito vertical' },
      { key: 'corridors', label: 'Corredores utilizados', long: true },
      { key: 'depth', label: 'Profundidade', long: true },
      { key: 'counterAttack', label: 'Contra-ataque', long: true },
      { key: 'individualOff', label: 'Comportamentos individuais relevantes', long: true },
    ],
  },
  {
    id: 'transDef', icon: '🔄', title: 'Transição Defensiva',
    fields: [
      { key: 'reactionLoss', label: 'Reação à perda', long: true },
      { key: 'immediatePress', label: 'Pressão imediata', long: true },
      { key: 'pressingPlayers', label: 'Jogadores que pressionam', long: true },
      { key: 'posRecovery', label: 'Recuperação posicional', long: true },
      { key: 'spacesLeft', label: 'Espaços deixados', long: true },
      { key: 'vulnerabilities', label: 'Vulnerabilidades', long: true },
    ],
  },
  {
    id: 'setPieces', icon: '⚽', title: 'Bolas Paradas',
    fields: [
      { key: 'cornersOff', label: 'Cantos ofensivos', long: true },
      { key: 'cornersDef', label: 'Cantos defensivos', long: true },
      { key: 'freeKicksWide', label: 'Livres laterais', long: true },
      { key: 'freeKicksDirect', label: 'Livres frontais', long: true },
      { key: 'throwIns', label: 'Lançamentos', long: true },
      { key: 'penalties', label: 'Penáltis', long: true },
    ],
  },
];

/** Listas de itens (mesma forma para todas — um único editor serve as cinco). */
const SCOUTING_LISTS = [
  { id: 'strengths', icon: '🟢', title: 'Pontos Fortes', accent: 'green', canFocus: true },
  { id: 'weaknesses', icon: '🔴', title: 'Pontos Fracos', accent: 'red', canFocus: true },
  { id: 'threats', icon: '⚠️', title: 'Ameaças Principais', accent: 'yellow', canFocus: true },
  { id: 'opportunities', icon: '🎯', title: 'Oportunidades', accent: 'blue', canFocus: true,
    hint: 'A consequência prática para o nosso plano. Um ponto fraco é a observação; a oportunidade é o que fazemos com ela.' },
  { id: 'triggers', icon: '🚦', title: 'Gatilhos a Observar', accent: 'purple', canFocus: true,
    hint: 'Ex: "Quando o lateral sobe → extremo fecha por dentro."' },
];

const ITEM_CATEGORIES = [
  'Construção', 'Pressão', 'Bloco defensivo', 'Transição ofensiva', 'Transição defensiva',
  'Corredor lateral', 'Corredor central', 'Bola parada', 'Individual', 'Outro',
];

const PRIORITIES = [
  { key: 'high', label: '🔴 Alta' },
  { key: 'medium', label: '🟡 Média' },
  { key: 'low', label: '🟢 Baixa' },
];

/** Checklist inicial — totalmente editável pelo utilizador. */
const DEFAULT_CHECKLIST = [
  { id: 'c1', title: 'Construção', items: ['Saída curta', 'Saída longa', '3+2', '2+3', 'Lateral interior', 'Pivot baixa'] },
  { id: 'c2', title: 'Pressão', items: ['Alta', 'Média', 'Baixa', 'Individual', 'Zona'] },
  { id: 'c3', title: 'Transição', items: ['Contra-ataque', 'Ataque rápido', 'Jogo exterior', 'Jogo interior'] },
];

/** Campos do perfil de um jogador-chave do adversário. */
const KEY_PLAYER_FIELDS = [
  { key: 'characteristics', label: 'Características', long: true },
  { key: 'strengths', label: 'Pontos fortes', long: true },
  { key: 'weaknesses', label: 'Pontos a controlar', long: true },
  { key: 'behaviours', label: 'Comportamentos relevantes', long: true },
  { key: 'zones', label: 'Zonas onde aparece', long: true },
  { key: 'withBall', label: 'Com bola', long: true },
  { key: 'withoutBall', label: 'Sem bola', long: true },
  { key: 'relations', label: 'Relações com outros jogadores', long: true },
  { key: 'setPieces', label: 'Bolas paradas', long: true },
];

/** Campos mostrados no "Perfil Rápido" — derivados apenas do que foi preenchido. */
const QUICK_PROFILE = [
  { key: 'formationMain', label: 'Formação' },
  { key: 'pressing', label: 'Pressão' },
  { key: 'blockHeight', label: 'Bloco' },
  { key: 'speed', label: 'Transição' },
];

window.SCOUTING_SECTIONS = SCOUTING_SECTIONS;
window.SCOUTING_LISTS = SCOUTING_LISTS;
window.ITEM_CATEGORIES = ITEM_CATEGORIES;
window.SCOUTING_PRIORITIES = PRIORITIES;
window.DEFAULT_CHECKLIST = DEFAULT_CHECKLIST;
window.KEY_PLAYER_FIELDS = KEY_PLAYER_FIELDS;
window.QUICK_PROFILE = QUICK_PROFILE;
