/**
 * defaultLibrary.js
 * Biblioteca inicial de eventos/conceitos, organizada por categoria.
 * Isto é apenas o PONTO DE PARTIDA — tudo é editável pelo utilizador
 * na Biblioteca de Eventos (Modo Gestão) e por jogo no Plano de Observação.
 *
 * Cada evento: { id, name, category, description, priority, icon, color, type }
 * priority: 'critical' | 'important' | 'complementary'
 * type: 'positive' | 'negative' | 'neutral'  (usado no resumo de intervalo/pós-jogo)
 */

const CATEGORIES = [
  { id: 'nossa_equipa', name: 'Nossa Equipa', color: 'var(--c-blue)' },
  { id: 'adversario',   name: 'Adversário',   color: 'var(--c-red)' },
  { id: 'individual',   name: 'Individual',   color: 'var(--c-purple)' },
  { id: 'banco',        name: 'Banco',        color: 'var(--c-yellow)' },
];

let _uid = 1;
const id = (prefix) => `${prefix}_${_uid++}_${Date.now().toString(36)}`;

function ev(name, category, priority, type, description = '') {
  return {
    id: id('evt'),
    name,
    category,
    description,
    priority,
    icon: '',
    color: '',
    active: true,
    type, // positive | negative | neutral
    isDefault: true,
  };
}

const DEFAULT_EVENTS = [
  // NOSSA EQUIPA
  ev('Saída de bola', 'nossa_equipa', 'important', 'neutral'),
  ev('Construção', 'nossa_equipa', 'important', 'neutral'),
  ev('Progressão', 'nossa_equipa', 'important', 'positive'),
  ev('Criação', 'nossa_equipa', 'critical', 'positive'),
  ev('Finalização', 'nossa_equipa', 'critical', 'positive'),
  ev('Cruzamento', 'nossa_equipa', 'complementary', 'neutral'),
  ev('Ataque rápido', 'nossa_equipa', 'important', 'positive'),
  ev('Pressão', 'nossa_equipa', 'important', 'positive'),
  ev('Organização defensiva', 'nossa_equipa', 'important', 'neutral'),
  ev('Contenção', 'nossa_equipa', 'complementary', 'neutral'),
  ev('Cobertura', 'nossa_equipa', 'complementary', 'neutral'),
  ev('Equilíbrio', 'nossa_equipa', 'complementary', 'neutral'),
  ev('Transição ofensiva', 'nossa_equipa', 'important', 'positive'),
  ev('Transição defensiva', 'nossa_equipa', 'important', 'negative'),
  ev('Reação à perda', 'nossa_equipa', 'important', 'neutral'),
  ev('Recuperação alta', 'nossa_equipa', 'important', 'positive'),
  ev('Bola parada ofensiva', 'nossa_equipa', 'complementary', 'neutral'),
  ev('Bola parada defensiva', 'nossa_equipa', 'complementary', 'neutral'),

  // ADVERSÁRIO
  ev('Saída de bola', 'adversario', 'important', 'neutral'),
  ev('Construção', 'adversario', 'important', 'neutral'),
  ev('Pressão alta', 'adversario', 'critical', 'negative'),
  ev('Pressão média', 'adversario', 'important', 'negative'),
  ev('Bloco baixo', 'adversario', 'important', 'neutral'),
  ev('Jogo interior', 'adversario', 'complementary', 'neutral'),
  ev('Jogo exterior', 'adversario', 'complementary', 'neutral'),
  ev('Corredor esquerdo', 'adversario', 'important', 'neutral'),
  ev('Corredor direito', 'adversario', 'important', 'neutral'),
  ev('Espaço entre linhas', 'adversario', 'critical', 'negative'),
  ev('Transição ofensiva', 'adversario', 'important', 'negative'),
  ev('Transição defensiva', 'adversario', 'important', 'neutral'),
  ev('Contra-ataque', 'adversario', 'critical', 'negative'),
  ev('Cruzamentos', 'adversario', 'complementary', 'neutral'),
  ev('Bolas nas costas', 'adversario', 'critical', 'negative'),
  ev('Bola parada', 'adversario', 'important', 'negative'),
  ev('Comportamento individual', 'adversario', 'complementary', 'neutral'),

  // INDIVIDUAL
  ev('Boa decisão', 'individual', 'important', 'positive'),
  ev('Má decisão', 'individual', 'important', 'negative'),
  ev('Erro técnico', 'individual', 'important', 'negative'),
  ev('Ação de destaque', 'individual', 'important', 'positive'),
  ev('Comportamento individual', 'individual', 'complementary', 'neutral'),
  ev('Problema individual', 'individual', 'important', 'negative'),
  ev('Ponto forte individual', 'individual', 'complementary', 'positive'),

  // BANCO (ações rápidas de comunicação — também acessíveis pelo botão BANCO)
  ev('Corrigir', 'banco', 'important', 'neutral'),
  ev('Reforçar', 'banco', 'important', 'neutral'),
  ev('Alterar', 'banco', 'important', 'neutral'),
  ev('Informar', 'banco', 'important', 'neutral'),
];

// Templates por estilo de adversário — apenas sugestões, o utilizador cria os seus.
const DEFAULT_TEMPLATES = [
  { id: id('tpl'), name: 'Pressão alta', description: 'Foco em saída de bola sob pressão e bolas nas costas.', eventNames: ['Pressão alta','Contra-ataque','Bolas nas costas','Saída de bola','Espaço entre linhas','Transição defensiva','Recuperação alta'] },
  { id: id('tpl'), name: 'Bloco baixo', description: 'Foco em paciência ofensiva e bola parada.', eventNames: ['Bloco baixo','Criação','Cruzamento','Bola parada ofensiva','Finalização','Espaço entre linhas'] },
  { id: id('tpl'), name: 'Equipa de transição', description: 'Foco nas transições rápidas de ambas as equipas.', eventNames: ['Transição ofensiva','Transição defensiva','Contra-ataque','Reação à perda','Recuperação alta'] },
  { id: id('tpl'), name: 'Equipa de cruzamentos', description: 'Foco nos corredores e cruzamentos.', eventNames: ['Corredor esquerdo','Corredor direito','Cruzamentos','Cruzamento','Bola parada defensiva'] },
];

// Presets rápidos para o modal BANCO
const BENCH_ACTIONS = ['Corrigir', 'Reforçar', 'Alterar', 'Informar'];

// Configuração do sistema de tendências (editável nas Definições)
const DEFAULT_TREND_CONFIG = {
  levels: [
    { min: 1, max: 1, label: '', showBadge: false },
    { min: 2, max: 2, label: 'ATENÇÃO', showBadge: true },
    { min: 3, max: 3, label: 'TENDÊNCIA', showBadge: true },
    { min: 4, max: Infinity, label: 'REPETIDO', showBadge: true },
  ],
};

window.AnalistaLiveData = { CATEGORIES, DEFAULT_EVENTS, DEFAULT_TEMPLATES, BENCH_ACTIONS, DEFAULT_TREND_CONFIG, genId: id };
