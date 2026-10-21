import { describe, it, expect } from 'vitest';
import { criarRelogio, iniciar, pausar, retomar, decorridoMs, estaRodando, pararEm, instanteQueAtinge, formatarTempo, formatarRestante } from '../../src/domain/cronometro.js';

const T0 = 1_760_000_000_000;

describe('cronômetro por instantes', () => {
  it('inicia, pausa e retoma somando corretamente', () => {
    let r = criarRelogio();
    expect(decorridoMs(r, T0)).toBe(0);
    r = iniciar(r, T0);
    expect(estaRodando(r)).toBe(true);
    expect(decorridoMs(r, T0 + 90_000)).toBe(90_000);
    r = pausar(r, T0 + 90_000);
    expect(estaRodando(r)).toBe(false);
    expect(decorridoMs(r, T0 + 500_000)).toBe(90_000); // pausado não conta
    r = retomar(r, T0 + 500_000);
    expect(decorridoMs(r, T0 + 530_000)).toBe(120_000);
  });

  it('continua certo após "tela bloqueada": só depende dos instantes', () => {
    const r = iniciar(criarRelogio(), T0);
    // nenhum tick aconteceu durante 7 minutos; ao voltar, o cálculo é exato
    expect(decorridoMs(r, T0 + 7 * 60_000)).toBe(420_000);
  });

  it('sobrevive à recriação: o estado é só dados serializáveis', () => {
    const r = JSON.parse(JSON.stringify(pausar(iniciar(criarRelogio(), T0), T0 + 10_000)));
    expect(decorridoMs(retomar(r, T0 + 20_000), T0 + 25_000)).toBe(15_000);
  });

  it('iniciar duas vezes ou pausar parado não altera nada', () => {
    const r = iniciar(criarRelogio(), T0);
    expect(iniciar(r, T0 + 5000)).toBe(r);
    const p = pausar(r, T0 + 1000);
    expect(pausar(p, T0 + 9999)).toBe(p);
  });

  it('relógio do aparelho voltando no tempo não gera tempo negativo', () => {
    const r = iniciar(criarRelogio(), T0);
    expect(decorridoMs(r, T0 - 5000)).toBe(0);
  });

  it('calcula o instante exato em que um tempo será atingido', () => {
    const r = retomar({ acumuladoMs: 60_000, retomadoEm: null }, T0);
    expect(instanteQueAtinge(r, 480_000)).toBe(T0 + 420_000);
    expect(instanteQueAtinge(pararEm(r, 480_000), 480_000)).toBeNull();
  });

  it('formata mm:ss', () => {
    expect(formatarTempo(0)).toBe('00:00');
    expect(formatarTempo(65_000)).toBe('01:05');
    expect(formatarTempo(3_605_000)).toBe('60:05');
    expect(formatarTempo(-10)).toBe('00:00');
    expect(formatarRestante(400)).toBe('00:01'); // último segundo ainda aparece
    expect(formatarRestante(480_000)).toBe('08:00');
  });
});
