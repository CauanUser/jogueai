import { describe, it, expect } from 'vitest';
import { normalizarModalidade, regraDaModalidade, validarValor, vencedorPorMeta } from '../../src/domain/modalidades.js';
import { avaliarEventoAutomatico, CONDICOES, STATUS_PARTIDA } from '../../src/domain/partida.js';

describe('regras específicas por modalidade', () => {
  it('mantém pontuação própria para cada esporte', () => {
    expect(regraDaModalidade('futebol').unidade).toBe('gols');
    expect(regraDaModalidade('basquete').botoes).toEqual([1, 2, 3]);
    expect(regraDaModalidade('volei').unidade).toBe('pontos');
    expect(validarValor('basquete', 1)).toBeNull();
    expect(validarValor('basquete', 2)).toBeNull();
    expect(validarValor('basquete', 3)).toBeNull();
    expect(validarValor('basquete', 4)).toMatch(/inválida/);
    expect(normalizarModalidade('desconhecido')).toBe('futebol');
  });

  it('encerra o vôlei casual por meta de pontos sem sets', () => {
    expect(vencedorPorMeta(24, 23, 25)).toBeNull();
    expect(vencedorPorMeta(25, 23, 25)).toBe('A');
    expect(vencedorPorMeta(20, 25, 25)).toBe('B');
    expect(vencedorPorMeta(25, 25, 25)).toBeNull();
  });

  it('aplica a meta configurada ao vôlei sem depender do cronômetro', () => {
    const partida = {
      status: STATUS_PARTIDA.EM_ANDAMENTO,
      configuracao_extra: { modalidade: 'volei' },
      condicao_encerramento: CONDICOES.GOLS,
      limite_gols: 21,
      duracao_segundos: 480,
      acrescimos_segundos: 0,
      intervalo_segundos: 0,
      relogio_acumulado_ms: 0,
      relogio_retomado_em: new Date(0).toISOString(),
    };
    expect(avaliarEventoAutomatico(partida, { agora: 500000, placarA: 20, placarB: 19 })).toBeNull();
    expect(avaliarEventoAutomatico(partida, { agora: 500000, placarA: 21, placarB: 19 })?.motivo).toBe('gols');
  });
});
