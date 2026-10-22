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

/**
 * Recalcula a regra informal de vôlei a partir do histórico de pontos.
 * O placar normal nunca é apagado; no ZEROU, o placar auxiliar volta a 0 x 0
 * sempre que empata. Derivar do histórico permite recalcular após correções.
 */
export function avaliarVolei(gols, partida) {
  const meta = Number(partida?.limite_gols ?? 25);
  const equipeA = partida?.equipe_a_id ?? 'A';
  const equipeB = partida?.equipe_b_id ?? 'B';
  let a = 0; let b = 0; let zerou = false; let za = 0; let zb = 0; let vencedor = null;
  const eventos = [...gols].sort((x, y) => Number(x.tempo_partida_segundos ?? 0) - Number(y.tempo_partida_segundos ?? 0) ||
    String(x.ocorrido_em ?? '').localeCompare(String(y.ocorrido_em ?? '')) || String(x.created_at ?? '').localeCompare(String(y.created_at ?? '')));
  for (const g of eventos) {
    const lado = g.equipe_id === equipeA ? 'A' : g.equipe_id === equipeB ? 'B' : null;
    if (!lado) continue;
    const jaEstavaNoZerou = zerou;
    if (lado === 'A') a += Number(g.valor ?? 1); else b += Number(g.valor ?? 1);
    if (jaEstavaNoZerou) {
      if (lado === 'A') za += Number(g.valor ?? 1); else zb += Number(g.valor ?? 1);
      if (za === zb) { za = 0; zb = 0; }
      else if (Math.abs(za - zb) >= 2) vencedor = za > zb ? 'A' : 'B';
    } else if (a === meta - 1 && b === meta - 1) {
      zerou = true;
      za = 0;
      zb = 0;
    } else if (a >= meta || b >= meta) {
      if (a !== b) vencedor = a > b ? 'A' : 'B';
    }
    if (vencedor) break;
  }
  return { a, b, zerou, zerouA: za, zerouB: zb, vencedor, vencedorPorZerou: Boolean(vencedor && zerou) };
}
