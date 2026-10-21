import { describe, it, expect } from 'vitest';
import {
  CONFIG_PADRAO, validarConfiguracao, avaliarEventoAutomatico, situacaoTempo, sugerirConfronto, resultado,
} from '../../src/domain/partida.js';

const T0 = 1_760_000_000_000;
const iso = (ms) => new Date(ms).toISOString();
const partida = (extra = {}) => ({
  ...CONFIG_PADRAO, status: 'em_andamento', relogio_acumulado_ms: 0, relogio_retomado_em: iso(T0), ...extra,
});

describe('configuração da partida', () => {
  it('padrão: 8 min, 2 gols, o que vier primeiro, sem acréscimos/intervalo, pênaltis', () => {
    expect(CONFIG_PADRAO).toEqual({
      duracao_segundos: 480, condicao_encerramento: 'o_que_vier_primeiro', limite_gols: 2,
      acrescimos_segundos: 0, intervalo_segundos: 0, desempate: 'penaltis',
    });
    expect(validarConfiguracao({}).ok).toBe(true);
  });

  it('valida limites (espelha o banco)', () => {
    expect(validarConfiguracao({ duracao_segundos: 10 }).erros.duracao_segundos).toBeTruthy();
    expect(validarConfiguracao({ duracao_segundos: 7201 }).ok).toBe(false);
    expect(validarConfiguracao({ limite_gols: 0 }).erros.limite_gols).toBeTruthy();
    expect(validarConfiguracao({ acrescimos_segundos: -1 }).ok).toBe(false);
    expect(validarConfiguracao({ intervalo_segundos: 4000 }).ok).toBe(false);
    expect(validarConfiguracao({ condicao_encerramento: 'xpto' }).ok).toBe(false);
    expect(validarConfiguracao({ desempate: 'moeda' }).ok).toBe(false);
  });

  it('"só tempo" descarta o limite de gols', () => {
    expect(validarConfiguracao({ condicao_encerramento: 'tempo', limite_gols: 5 }).config.limite_gols).toBeNull();
  });
});

describe('encerramento automático', () => {
  it('por tempo, informando o instante exato do fim', () => {
    const p = partida();
    expect(avaliarEventoAutomatico(p, { agora: T0 + 479_000 })).toBeNull();
    expect(avaliarEventoAutomatico(p, { agora: T0 + 480_000 })).toEqual({ tipo: 'encerrar', motivo: 'tempo', instante: T0 + 480_000, decorridoMs: 480_000 });
  });

  it('app reaberto muito depois: o fim fica registrado no momento certo', () => {
    const r = avaliarEventoAutomatico(partida(), { agora: T0 + 3_600_000 });
    expect(r.instante).toBe(T0 + 480_000);
  });

  it('considera pausas e acréscimos', () => {
    const p = partida({ relogio_acumulado_ms: 300_000, acrescimos_segundos: 60 });
    expect(avaliarEventoAutomatico(p, { agora: T0 + 230_000 })).toBeNull();
    expect(avaliarEventoAutomatico(p, { agora: T0 + 240_000 }).instante).toBe(T0 + 240_000);
  });

  it('pausada não encerra por tempo', () => {
    expect(avaliarEventoAutomatico(partida({ status: 'pausada', relogio_retomado_em: null, relogio_acumulado_ms: 480_000 }), { agora: T0 + 1e7 })).toBeNull();
  });

  it('por limite de gols (o que vier primeiro)', () => {
    expect(avaliarEventoAutomatico(partida(), { agora: T0 + 1000, placarA: 2, placarB: 0 })).toMatchObject({ tipo: 'encerrar', motivo: 'gols' });
    expect(avaliarEventoAutomatico(partida(), { agora: T0 + 1000, placarA: 1, placarB: 1 })).toBeNull();
  });

  it('o tempo acaba antes de alguém atingir o limite', () => {
    expect(avaliarEventoAutomatico(partida(), { agora: T0 + 500_000, placarA: 1, placarB: 0 })).toMatchObject({ motivo: 'tempo' });
  });

  it('"só tempo" ignora o limite de gols; "só gols" ignora o tempo', () => {
    const soTempo = partida({ condicao_encerramento: 'tempo', limite_gols: null });
    expect(avaliarEventoAutomatico(soTempo, { agora: T0 + 1000, placarA: 9 })).toBeNull();
    const soGols = partida({ condicao_encerramento: 'gols' });
    expect(avaliarEventoAutomatico(soGols, { agora: T0 + 1e7 })).toBeNull();
    expect(avaliarEventoAutomatico(soGols, { agora: T0 + 1e7, placarB: 2 })).toMatchObject({ motivo: 'gols' });
  });

  it('intervalo: pausa automática na metade do tempo, uma única vez', () => {
    const p = partida({ intervalo_segundos: 300 });
    expect(avaliarEventoAutomatico(p, { agora: T0 + 239_000 })).toBeNull();
    expect(avaliarEventoAutomatico(p, { agora: T0 + 250_000 })).toEqual({ tipo: 'intervalo', instante: T0 + 240_000, decorridoMs: 240_000 });
    // já passou da metade (2º tempo): não pede intervalo de novo
    const segundo = partida({ intervalo_segundos: 300, relogio_acumulado_ms: 240_000 });
    expect(avaliarEventoAutomatico(segundo, { agora: T0 + 100_000 })).toBeNull();
    expect(situacaoTempo({ ...segundo, status: 'pausada', relogio_retomado_em: null }, T0).noIntervalo).toBe(true);
  });
});

describe('situação e confronto', () => {
  it('tempo restante e decorrido', () => {
    const s = situacaoTempo(partida({ relogio_acumulado_ms: 60_000 }), T0 + 30_000);
    expect(s).toMatchObject({ decorridoMs: 90_000, restanteMs: 390_000, totalMs: 480_000, rodando: true });
  });

  it('sugere as equipes que jogaram há mais tempo', () => {
    const equipes = [{ id: 'a', ordem: 1 }, { id: 'b', ordem: 2 }, { id: 'c', ordem: 3 }];
    expect(sugerirConfronto(equipes, [])).toEqual(['a', 'b']);
    expect(sugerirConfronto(equipes, [{ numero: 1, equipe_a_id: 'a', equipe_b_id: 'b', status: 'finalizada' }])).toEqual(['c', 'a']);
    expect(sugerirConfronto(equipes, [{ numero: 1, equipe_a_id: 'a', equipe_b_id: 'b', status: 'cancelada' }])).toEqual(['a', 'b']);
  });

  it('resultado', () => {
    expect(resultado(2, 1)).toBe('A');
    expect(resultado(0, 1)).toBe('B');
    expect(resultado(1, 1)).toBe('empate');
  });
});
