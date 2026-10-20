// Sorteio inteligente de equipes.
//
// Objetivo: minimizar a diferença entre a maior e a menor soma de notas
// (amplitude). Entre distribuições com a mesma amplitude, todas são
// consideradas igualmente equilibradas e uma delas é escolhida ao acaso —
// assim o sorteio não repete sempre a mesma combinação.
//
// Estratégia: várias tentativas aleatórias. Cada tentativa distribui os
// jogadores (do mais forte ao mais fraco, sempre para a equipe de menor
// soma) e depois melhora a distribuição trocando pares de jogadores entre
// equipes enquanto isso reduzir o desequilíbrio. Para os tamanhos de um
// racha (até dezenas de jogadores) isso encontra o ótimo na prática; os
// testes comparam o resultado com uma busca exaustiva.

import { criarRng, embaralhar, inteiroAleatorio } from '../utils/rng.js';

export const MIN_EQUIPES = 2;
export const MAX_EQUIPES = 20;
export const MAX_POR_EQUIPE = 50;

export const CORES_EQUIPES = [
  '#1E88E5', '#E53935', '#FDD835', '#43A047', '#8E24AA',
  '#FB8C00', '#00ACC1', '#6D4C41', '#D81B60', '#546E7A',
];

export function nomeEquipe(indice) {
  // Time A … Time Z
  return `Time ${String.fromCharCode(65 + (indice % 26))}`;
}

export function corEquipe(indice) {
  return CORES_EQUIPES[indice % CORES_EQUIPES.length];
}

/**
 * Valida a configuração e calcula quantas equipes e quantos aguardam.
 * Se qtdEquipes for nulo, usa o máximo de equipes completas possível.
 */
export function calcularConfiguracao({ total, jogadoresPorEquipe, qtdEquipes = null }) {
  const s = Number(jogadoresPorEquipe);
  if (!Number.isInteger(s) || s < 1 || s > MAX_POR_EQUIPE) {
    return { ok: false, erro: `Jogadores por equipe deve ser entre 1 e ${MAX_POR_EQUIPE}.` };
  }
  const k = qtdEquipes === null || qtdEquipes === undefined || qtdEquipes === ''
    ? Math.floor(total / s)
    : Number(qtdEquipes);
  if (!Number.isInteger(k) || k > MAX_EQUIPES) {
    return { ok: false, erro: `A quantidade de equipes deve ser entre ${MIN_EQUIPES} e ${MAX_EQUIPES}.` };
  }
  if (k < MIN_EQUIPES) {
    return {
      ok: false,
      erro: `São necessários pelo menos ${MIN_EQUIPES * s} participantes para formar ${MIN_EQUIPES} equipes de ${s}. Há ${total}.`,
    };
  }
  if (k * s > total) {
    return {
      ok: false,
      erro: `Para ${k} equipes de ${s} são necessários ${k * s} participantes. Há ${total}. Reduza a quantidade de equipes ou de jogadores por equipe.`,
    };
  }
  return { ok: true, qtdEquipes: k, jogadoresPorEquipe: s, emJogo: k * s, aguardando: total - k * s };
}

/** Escolhe quem aguarda: os últimos a chegar (padrão) ou ao acaso. */
export function escolherAguardando(participantes, quantidade, modo, rng) {
  if (quantidade <= 0) return [];
  if (modo === 'aleatorio') {
    return embaralhar(participantes, rng).slice(0, quantidade).map((p) => p.id);
  }
  return participantes.slice(-quantidade).map((p) => p.id);
}

export function avaliarSomas(somas) {
  const max = Math.max(...somas);
  const min = Math.min(...somas);
  const media = somas.reduce((a, b) => a + b, 0) / somas.length;
  const desvio = somas.reduce((a, x) => a + (x - media) ** 2, 0);
  return { amplitude: max - min, desvio };
}

function comparar(a, b) {
  return a.amplitude - b.amplitude || a.desvio - b.desvio;
}

function distribuicaoInicial(jogadores, k, s, rng) {
  // Embaralha antes de ordenar: jogadores de mesma nota entram em ordem aleatória.
  const ordem = embaralhar(jogadores, rng).sort((a, b) => b.nota - a.nota);
  const times = Array.from({ length: k }, () => []);
  const somas = new Array(k).fill(0);
  for (const j of ordem) {
    let menor = Infinity;
    let candidatos = [];
    for (let t = 0; t < k; t++) {
      if (times[t].length >= s) continue;
      if (somas[t] < menor) { menor = somas[t]; candidatos = [t]; } else if (somas[t] === menor) candidatos.push(t);
    }
    const t = candidatos[inteiroAleatorio(rng, candidatos.length)];
    times[t].push(j);
    somas[t] += j.nota;
  }
  return { times, somas };
}

function melhorarPorTrocas({ times, somas }, rng) {
  const k = times.length;
  let atual = avaliarSomas(somas);
  let melhorou = true;
  while (melhorou && atual.amplitude > 0) {
    melhorou = false;
    const pares = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pares.push([i, j]);
    for (const [i, j] of embaralhar(pares, rng)) {
      for (let a = 0; a < times[i].length && !melhorou; a++) {
        for (let b = 0; b < times[j].length && !melhorou; b++) {
          const d = times[i][a].nota - times[j][b].nota;
          if (d === 0) continue;
          somas[i] -= d; somas[j] += d;
          const novo = avaliarSomas(somas);
          if (comparar(novo, atual) < 0) {
            [times[i][a], times[j][b]] = [times[j][b], times[i][a]];
            atual = novo;
            melhorou = true;
          } else {
            somas[i] += d; somas[j] -= d;
          }
        }
      }
      if (melhorou) break;
    }
  }
  return { times, somas, ...atual };
}

function chaveDistribuicao(times) {
  return times.map((t) => t.map((j) => j.id).sort().join(',')).sort().join('|');
}

/**
 * Sorteia equipes equilibradas.
 * @param {Array<{id:string, nota:number}>} participantes  em ordem de chegada
 * @param {object} opcoes
 * @returns {{ equipes: Array<{nome, cor, participantes: string[], soma}>, aguardando: string[],
 *            amplitude: number, alternativas: number, qtdEquipes, jogadoresPorEquipe }}
 */
export function sortearEquipes(participantes, {
  jogadoresPorEquipe, qtdEquipes = null, modoEspera = 'ultimos', semente = null, tentativas = 300,
} = {}) {
  const ids = new Set(participantes.map((p) => p.id));
  if (ids.size !== participantes.length) throw new Error('Há participantes repetidos na lista.');

  const cfg = calcularConfiguracao({ total: participantes.length, jogadoresPorEquipe, qtdEquipes });
  if (!cfg.ok) throw new Error(cfg.erro);
  const { qtdEquipes: k, jogadoresPorEquipe: s } = cfg;

  const rng = criarRng(semente);
  const aguardando = escolherAguardando(participantes, cfg.aguardando, modoEspera, rng);
  const foraSet = new Set(aguardando);
  const jogadores = participantes
    .filter((p) => !foraSet.has(p.id))
    .map((p) => ({ id: p.id, nota: Number(p.nota) }));

  let melhor = null;
  let candidatas = new Map();
  for (let t = 0; t < tentativas; t++) {
    const sol = melhorarPorTrocas(distribuicaoInicial(jogadores, k, s, rng), rng);
    const c = melhor ? sol.amplitude - melhor.amplitude : -1;
    if (c < 0) {
      melhor = sol;
      candidatas = new Map([[chaveDistribuicao(sol.times), sol]]);
    } else if (c === 0) {
      candidatas.set(chaveDistribuicao(sol.times), sol);
    }
  }

  const opcoes = [...candidatas.values()];
  const escolhida = opcoes[inteiroAleatorio(rng, opcoes.length)];
  // A ordem das equipes também é aleatória (Time A nem sempre é o mais forte).
  const ordem = embaralhar(escolhida.times.map((_, i) => i), rng);
  const equipes = ordem.map((idx, posicao) => ({
    nome: nomeEquipe(posicao),
    cor: corEquipe(posicao),
    participantes: escolhida.times[idx].map((j) => j.id),
    soma: escolhida.somas[idx],
  }));

  return {
    equipes,
    aguardando,
    amplitude: escolhida.amplitude,
    alternativas: opcoes.length,
    qtdEquipes: k,
    jogadoresPorEquipe: s,
  };
}
