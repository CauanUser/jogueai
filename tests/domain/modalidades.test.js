import { describe, it, expect } from 'vitest';
import { normalizarModalidade, regraDaModalidade, validarValor, vencedorPorMeta, avaliarVolei } from '../../src/domain/modalidades.js';
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
    expect(avaliarEventoAutomatico(partida, { agora: 500000, placarA: 21, placarB: 19 })).toBeNull();
  });

  const partidaVolei = (meta = 11) => ({ equipe_a_id: 'A', equipe_b_id: 'B', limite_gols: meta });
  const placarSequencia = (a, b) => Array.from({ length: Math.max(a, b) }, (_, i) => [i < a ? 'A' : null, i < b ? 'B' : null]).flat().filter(Boolean);
  const pontos = (sequencia) => sequencia.map((lado, i) => ({
    id: String(i), equipe_id: lado, valor: 1, tempo_partida_segundos: i + 1,
    ocorrido_em: new Date((i + 1) * 1000).toISOString(), created_at: new Date((i + 1) * 1000).toISOString(),
  }));

  it('ativa o ZEROU em 10 x 10 para meta 11 e mantém o placar normal', () => {
    const eventos = pontos(placarSequencia(10, 10));
    expect(avaliarVolei(eventos, partidaVolei())).toMatchObject({ a: 10, b: 10, zerou: true, zerouA: 0, zerouB: 0, vencedor: null });
  });

  it('reinicia o placar auxiliar quando empata e vence ao abrir 2 a 0', () => {
    const eventos = pontos([
      ...placarSequencia(10, 10), // 10 x 10: entra no ZEROU
      'A', 'B', // empate no ZEROU: volta a 0 x 0
      'A', 'A', // abre 2 x 0 e vence
    ]);
    expect(avaliarVolei(eventos, partidaVolei())).toMatchObject({
      a: 13, b: 11, zerou: true, zerouA: 2, zerouB: 0, vencedor: 'A', vencedorPorZerou: true,
    });
  });

  it('permite que o Time B vença com 0 x 2 no ZEROU', () => {
    const eventos = pontos([
      ...placarSequencia(10, 10),
      'B', 'B',
    ]);
    expect(avaliarVolei(eventos, partidaVolei())).toMatchObject({ vencedor: 'B', vencedorPorZerou: true, zerouA: 0, zerouB: 2 });
  });

  it('não ativa o ZEROU antes do empate faltando um ponto', () => {
    const eventos = pontos(placarSequencia(10, 9));
    expect(avaliarVolei(eventos, partidaVolei())).toMatchObject({ a: 10, b: 9, zerou: false, vencedor: null });
  });

  it('mantém a vitória normal quando alguém alcança a meta antes do ZEROU', () => {
    const eventos = pontos(placarSequencia(11, 9));
    expect(avaliarVolei(eventos, partidaVolei())).toMatchObject({ vencedor: 'A', vencedorPorZerou: false });
  });

});
