import { describe, expect, it } from 'vitest';
import {
  aplicarSubstituicao,
  validarSubstituicao,
  validarConfiguracaoGoleiros,
  criarEstadoLados,
  atualizarLadosAposRodizio,
} from '../../src/domain/rodizio.js';

const jogador = (id, nome = id) => ({ id, nome });
const equipe = { id: 'B', jogadores: [jogador('b1'), jogador('b2')] };
const equipes = [{ id: 'A', jogadores: [jogador('a1'), jogador('a2')] }, equipe];
const aguardando = [jogador('x')];

describe('rodízio manual', () => {
  it('permite a substituição escolhida pelo organizador', () => {
    expect(validarSubstituicao({ equipePerdedora: equipe, aguardando, participanteSaiId: 'b1', participanteEntraId: 'x' })).toBeNull();
  });

  it('troca o jogador em campo e coloca o substituído no fim da fila', () => {
    const resultado = aplicarSubstituicao({ equipes, aguardando, equipePerdedoraId: 'B', participanteSaiId: 'b1', participanteEntraId: 'x' });
    expect(resultado.equipes[0].jogadores.map((p) => p.id)).toEqual(['a1', 'a2']);
    expect(resultado.equipes[1].jogadores.map((p) => p.id)).toEqual(['x', 'b2']);
    expect(resultado.aguardando.map((p) => p.id)).toEqual(['b1']);
  });

  it('bloqueia jogador que não está na fila ou não pertence ao time perdedor', () => {
    expect(validarSubstituicao({ equipePerdedora: equipe, aguardando, participanteSaiId: 'a1', participanteEntraId: 'x' })).toMatch(/time perdedor/);
    expect(validarSubstituicao({ equipePerdedora: equipe, aguardando, participanteSaiId: 'b1', participanteEntraId: 'b2' })).toMatch(/fila de espera/);
  });

  it('bloqueia a substituição quando a fila está vazia', () => {
    expect(validarSubstituicao({ equipePerdedora: equipe, aguardando: [], participanteSaiId: 'b1', participanteEntraId: 'x' })).toMatch(/fila de espera/);
  });
});

describe('goleiros fixos por lado físico', () => {
  const participantes = [jogador('g1'), jogador('g2'), jogador('p1')];

  it('permite jogar sem goleiros fixos', () => {
    expect(validarConfiguracaoGoleiros({ quantidade: 0, participantes })).toBeNull();
  });

  it('exige um goleiro válido para o lado esquerdo quando há um fixo', () => {
    expect(validarConfiguracaoGoleiros({ quantidade: 1, goleiroEsquerdoId: 'g1', participantes })).toBeNull();
    expect(validarConfiguracaoGoleiros({ quantidade: 1, participantes })).toMatch(/lado esquerdo/);
  });

  it('exige dois goleiros diferentes quando há dois fixos', () => {
    expect(validarConfiguracaoGoleiros({ quantidade: 2, goleiroEsquerdoId: 'g1', goleiroDireitoId: 'g2', participantes })).toBeNull();
    expect(validarConfiguracaoGoleiros({ quantidade: 2, goleiroEsquerdoId: 'g1', goleiroDireitoId: 'g1', participantes })).toMatch(/diferente/);
  });

  it('mantém cada goleiro no lado físico mesmo quando muda a equipe que ocupa o lado', () => {
    const antes = criarEstadoLados({
      equipeEsquerdaId: 'A', equipeDireitaId: 'B',
      quantidadeGoleirosFixos: 2, goleiroEsquerdoId: 'g1', goleiroDireitoId: 'g2',
    });
    const depois = atualizarLadosAposRodizio({
      estado: antes, equipeEsquerdaId: 'C', equipeDireitaId: 'A',
    });
    expect(depois.esquerda).toEqual({ equipeId: 'C', goleiroId: 'g1' });
    expect(depois.direita).toEqual({ equipeId: 'A', goleiroId: 'g2' });
  });
});
