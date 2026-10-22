// Regras de pontuação separadas por modalidade do JogueAI.
export const MODALIDADES = Object.freeze({
  FUTEBOL: 'futebol',
  BASQUETE: 'basquete',
  VOLEI: 'volei',
});

export const CONFIG_MODALIDADE = Object.freeze({
  futebol: { nome: 'Futebol', unidade: 'gols', botoes: [1], limitePadrao: 2, desempate: 'penaltis' },
  basquete: { nome: 'Basquete', unidade: 'pontos', botoes: [1, 2, 3], limitePadrao: null, desempate: 'prorrogacao' },
  volei: { nome: 'Vôlei', unidade: 'pontos', botoes: [1], limitePadrao: 25, desempate: 'sets' },
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

// Vôlei: sets convencionais de 25 pontos (5º set a 15), sempre com vantagem de 2.
export function setVencido(pontosA, pontosB, decisivo = false) {
  const alvo = decisivo ? 15 : 25;
  return Math.max(pontosA, pontosB) >= alvo && Math.abs(pontosA - pontosB) >= 2
    ? (pontosA > pontosB ? 'A' : 'B')
    : null;
}

export function partidaVencidaNoVolei(setsA, setsB, melhorDe = 5) {
  const setsNecessarios = Math.floor(melhorDe / 2) + 1;
  if (setsA >= setsNecessarios) return 'A';
  if (setsB >= setsNecessarios) return 'B';
  return null;
}
