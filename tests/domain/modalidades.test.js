import { describe, it, expect } from 'vitest';
import { normalizarModalidade, regraDaModalidade, validarValor, setVencido, partidaVencidaNoVolei } from '../../src/domain/modalidades.js';

describe('regras específicas por modalidade', () => {
  it('mantém unidades e opções de pontuação próprias', () => {
    expect(regraDaModalidade('futebol').unidade).toBe('gols');
    expect(regraDaModalidade('basquete').botoes).toEqual([1, 2, 3]);
    expect(regraDaModalidade('volei').unidade).toBe('pontos');
    expect(validarValor('basquete', 3)).toBeNull();
    expect(validarValor('basquete', 4)).toMatch(/inválida/);
    expect(normalizarModalidade('desconhecido')).toBe('futebol');
  });

  it('aplica a vantagem mínima de dois pontos nos sets de vôlei', () => {
    expect(setVencido(25, 24)).toBeNull();
    expect(setVencido(26, 24)).toBe('A');
    expect(setVencido(15, 13, true)).toBe('A');
    expect(setVencido(15, 14, true)).toBeNull();
  });

  it('decide a partida de vôlei por sets vencidos', () => {
    expect(partidaVencidaNoVolei(2, 2)).toBeNull();
    expect(partidaVencidaNoVolei(3, 1)).toBe('A');
    expect(partidaVencidaNoVolei(1, 3)).toBe('B');
    expect(partidaVencidaNoVolei(2, 1, 3)).toBe('A');
  });
});
