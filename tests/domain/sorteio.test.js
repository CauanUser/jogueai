import { describe, it, expect } from 'vitest';
import { sortearEquipes, calcularConfiguracao, avaliarSomas, escolherAguardando } from '../../src/domain/sorteio.js';
import { criarRng } from '../../src/utils/rng.js';

const jogadores = (notas) => notas.map((nota, i) => ({ id: `p${String(i).padStart(2, '0')}`, nota }));

/** Menor amplitude possível por busca exaustiva (só para casos pequenos). */
function amplitudeOtima(notas, k, s) {
  let melhor = Infinity;
  const somas = new Array(k).fill(0);
  const tamanhos = new Array(k).fill(0);
  (function rec(i) {
    if (i === notas.length) {
      melhor = Math.min(melhor, Math.max(...somas) - Math.min(...somas));
      return;
    }
    const vistos = new Set();
    for (let t = 0; t < k; t++) {
      if (tamanhos[t] >= s) continue;
      const assinatura = `${somas[t]}:${tamanhos[t]}`; // simetria: equipes equivalentes
      if (vistos.has(assinatura)) continue;
      vistos.add(assinatura);
      somas[t] += notas[i]; tamanhos[t]++;
      rec(i + 1);
      somas[t] -= notas[i]; tamanhos[t]--;
    }
  })(0);
  return melhor;
}

function verificarIntegridade(r, participantes, k, s) {
  const todos = [...r.equipes.flatMap((e) => e.participantes), ...r.aguardando];
  expect(new Set(todos).size).toBe(todos.length); // ninguém em dois lugares
  expect(new Set(todos)).toEqual(new Set(participantes.map((p) => p.id))); // ninguém descartado
  expect(r.equipes).toHaveLength(k);
  for (const e of r.equipes) {
    expect(e.participantes).toHaveLength(s);
    const soma = e.participantes.reduce((a, id) => a + participantes.find((p) => p.id === id).nota, 0);
    expect(e.soma).toBe(soma);
  }
}

describe('configuração do sorteio', () => {
  it('15 jogadores, 5 por equipe → 3 equipes, ninguém aguarda', () => {
    expect(calcularConfiguracao({ total: 15, jogadoresPorEquipe: 5 })).toMatchObject({ ok: true, qtdEquipes: 3, aguardando: 0 });
  });
  it('17 jogadores, 5 por equipe → 3 equipes e 2 aguardando', () => {
    expect(calcularConfiguracao({ total: 17, jogadoresPorEquipe: 5 })).toMatchObject({ ok: true, qtdEquipes: 3, aguardando: 2 });
  });
  it('quantidade de equipes explícita', () => {
    expect(calcularConfiguracao({ total: 17, jogadoresPorEquipe: 5, qtdEquipes: 2 })).toMatchObject({ ok: true, aguardando: 7 });
  });
  it('participantes insuficientes para as equipes pedidas', () => {
    const r = calcularConfiguracao({ total: 12, jogadoresPorEquipe: 5, qtdEquipes: 3 });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/necessários 15/);
  });
  it('menos de duas equipes possíveis', () => {
    expect(calcularConfiguracao({ total: 7, jogadoresPorEquipe: 5 }).ok).toBe(false);
  });
  it.each([0, -1, 2.5, 51, 'x'])('jogadores por equipe inválido: %s', (s) => {
    expect(calcularConfiguracao({ total: 20, jogadoresPorEquipe: s }).ok).toBe(false);
  });
});

describe('sorteio equilibrado', () => {
  it('não aceita participantes repetidos', () => {
    expect(() => sortearEquipes([{ id: 'a', nota: 5 }, { id: 'a', nota: 5 }, { id: 'b', nota: 5 }, { id: 'c', nota: 5 }], { jogadoresPorEquipe: 2 }))
      .toThrow(/repetidos/);
  });

  it('não sorteia com jogador sem nota (importado da lista)', () => {
    const p = [...jogadores([5, 5, 5, 5, 5, 5, 5, 5, 5]), { id: 'novo', nome: 'Pedrin', nota: null }];
    expect(() => sortearEquipes(p, { jogadoresPorEquipe: 5 })).toThrow(/Sem nota: Pedrin/);
  });

  it('erro claro quando faltam participantes', () => {
    expect(() => sortearEquipes(jogadores([5, 5, 5]), { jogadoresPorEquipe: 5 })).toThrow(/pelo menos 10/);
  });

  it('10 notas de 1 a 10 em 2×5: amplitude 1 (ótimo, soma total ímpar)', () => {
    const p = jogadores([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const r = sortearEquipes(p, { jogadoresPorEquipe: 5, semente: 1 });
    verificarIntegridade(r, p, 2, 5);
    expect(r.amplitude).toBe(1);
  });

  it('atinge o ótimo da busca exaustiva em casos aleatórios', () => {
    const rng = criarRng(42);
    const casos = [[3, 3], [2, 5], [3, 4], [4, 3], [2, 6]];
    for (let rep = 0; rep < 30; rep++) {
      const [k, s] = casos[rep % casos.length];
      const notas = Array.from({ length: k * s }, () => 1 + Math.floor(rng() * 10));
      const p = jogadores(notas);
      const r = sortearEquipes(p, { jogadoresPorEquipe: s, qtdEquipes: k, semente: rep });
      verificarIntegridade(r, p, k, s);
      expect(r.amplitude, `notas ${notas} k=${k} s=${s}`).toBe(amplitudeOtima(notas, k, s));
    }
  });

  it('cenário típico: 15 jogadores em 3 times de 5 bem equilibrados', () => {
    const p = jogadores([9, 8, 8, 7, 7, 7, 6, 6, 6, 5, 5, 4, 4, 3, 2]);
    const r = sortearEquipes(p, { jogadoresPorEquipe: 5, semente: 7 });
    verificarIntegridade(r, p, 3, 5);
    expect(r.amplitude).toBe(amplitudeOtima(p.map((x) => x.nota), 3, 5));
    expect(r.amplitude).toBeLessThanOrEqual(1);
  });

  it('é aleatório: com notas iguais gera muitas combinações diferentes', () => {
    const p = jogadores(new Array(15).fill(6));
    const chaves = new Set();
    for (let i = 0; i < 40; i++) {
      const r = sortearEquipes(p, { jogadoresPorEquipe: 5, semente: 1000 + i, tentativas: 20 });
      chaves.add(r.equipes.map((e) => [...e.participantes].sort().join()).sort().join('|'));
    }
    expect(chaves.size).toBeGreaterThan(30);
  });

  it('é aleatório também entre distribuições equilibradas diferentes', () => {
    const p = jogadores([9, 8, 8, 7, 7, 7, 6, 6, 6, 5, 5, 4, 4, 3, 2]);
    const chaves = new Set();
    for (let i = 0; i < 30; i++) {
      const r = sortearEquipes(p, { jogadoresPorEquipe: 5, semente: i });
      chaves.add(r.equipes.map((e) => [...e.participantes].sort().join()).sort().join('|'));
    }
    expect(chaves.size).toBeGreaterThan(5);
  });

  it('mesma semente → mesmo resultado (reprodutível)', () => {
    const p = jogadores([9, 8, 7, 6, 5, 4, 3, 2, 1, 5]);
    expect(sortearEquipes(p, { jogadoresPorEquipe: 5, semente: 3 })).toEqual(sortearEquipes(p, { jogadoresPorEquipe: 5, semente: 3 }));
  });

  it('últimos a chegar aguardam por padrão e não entram em equipe', () => {
    const p = jogadores([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9, 1]);
    const r = sortearEquipes(p, { jogadoresPorEquipe: 5, semente: 1 });
    expect(r.aguardando).toEqual(['p10', 'p11']);
    verificarIntegridade(r, p, 2, 5);
  });

  it('modo aleatório escolhe quem aguarda ao acaso', () => {
    const p = jogadores(new Array(12).fill(5));
    const vistos = new Set();
    for (let i = 0; i < 20; i++) {
      const r = sortearEquipes(p, { jogadoresPorEquipe: 5, modoEspera: 'aleatorio', semente: i, tentativas: 5 });
      expect(r.aguardando).toHaveLength(2);
      r.aguardando.forEach((id) => vistos.add(id));
    }
    expect(vistos.size).toBeGreaterThan(4);
  });

  it('nomes e cores padrão, ordem das equipes aleatória', () => {
    const p = jogadores([10, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const r = sortearEquipes(p, { jogadoresPorEquipe: 5, semente: 2 });
    expect(r.equipes.map((e) => e.nome)).toEqual(['Time A', 'Time B', 'Time C']);
    expect(new Set(r.equipes.map((e) => e.cor)).size).toBe(3);
    const posicoesDoCraque = new Set();
    for (let i = 0; i < 20; i++) {
      const x = sortearEquipes(p, { jogadoresPorEquipe: 5, semente: 100 + i, tentativas: 10 });
      posicoesDoCraque.add(x.equipes.findIndex((e) => e.participantes.includes('p00')));
    }
    expect(posicoesDoCraque.size).toBeGreaterThan(1);
  });

  it('equipes de 1 jogador e muitas equipes', () => {
    const p = jogadores([3, 7, 5, 9]);
    const r = sortearEquipes(p, { jogadoresPorEquipe: 1, semente: 1 });
    verificarIntegridade(r, p, 4, 1);
  });

  it('desempenho: 40 jogadores em 8 equipes em menos de 1 s', () => {
    const rng = criarRng(9);
    const p = jogadores(Array.from({ length: 40 }, () => 1 + Math.floor(rng() * 10)));
    const t0 = performance.now();
    const r = sortearEquipes(p, { jogadoresPorEquipe: 5, semente: 1 });
    expect(performance.now() - t0).toBeLessThan(1000);
    verificarIntegridade(r, p, 8, 5);
    expect(r.amplitude).toBeLessThanOrEqual(1);
  });
});

describe('auxiliares', () => {
  it('avaliarSomas', () => {
    expect(avaliarSomas([35, 34, 35]).amplitude).toBe(1);
  });
  it('escolherAguardando com zero', () => {
    expect(escolherAguardando(jogadores([1, 2]), 0, 'ultimos', criarRng(1))).toEqual([]);
  });
});
