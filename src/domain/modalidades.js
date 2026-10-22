// Regras de pontuação separadas por modalidade do JogueAI.
export const MODALIDADES = Object.freeze({
  FUTEBOL: 'futebol',
  BASQUETE: 'basquete',
  VOLEI: 'volei',
});

export const CONFIG_MODALIDADE = Object.freeze({
  futebol: { nome: 'Futebol', unidade: 'gols', botoes: [1], limitePadrao: 2, desempate: 'penaltis' },
  basquete: { nome: 'Basquete', unidade: 'pontos', botoes: [1, 2, 3], limitePadrao: null, desempate: 'prorrogacao' },
  volei: { nome: 'Vôlei', unidade: 'pontos', botoes: [1], limitePadrao: 25, desempate: 'nenhum' },
});

export function normalizarModalidade(valor) {
  return Object.values(MODALIDADES).includes(valor) ? valor : MODALIDADES.FUTEBOL;
}

export function regraDaModalidade(valor) {
  return CONFIG_MODALIDADE[normalizarModalidade(valor)];
}

// Basquete: lance livre = 1, cesta dentro do arco = 2, fora do arco = 3.
export function validarValor(modalidade, valor) {
  const regra = regraDaModalidade(modalidade);
  return regra.botoes.includes(Number(valor)) ? null : `Pontuação inválida para ${regra.nome}.`;
}

// Vôlei casual: uma única partida, vence quem alcançar a meta configurada.
export function vencedorPorMeta(pontosA, pontosB, meta) {
  const alvo = Number(meta);
  if (!Number.isInteger(alvo) || alvo < 1) return null;
  if (pontosA >= alvo && pontosA > pontosB) return 'A';
  if (pontosB >= alvo && pontosB > pontosA) return 'B';
  return null;
}
