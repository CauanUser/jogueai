import { describe, expect, it } from 'vitest';
import { aplicarSubstituicao, validarSubstituicao } from '../../src/domain/rodizio.js';

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
