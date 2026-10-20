import { describe, it, expect } from 'vitest';
import { normalizarNome, validarNome, validarNota, validarParticipante, chaveNome } from '../../src/domain/validacao.js';

describe('validação de participantes', () => {
  it('normaliza espaços do nome', () => {
    expect(normalizarNome('  João   Pedro ')).toBe('João Pedro');
  });

  it('rejeita nome vazio e longo demais', () => {
    expect(validarNome('   ')).toMatch(/Informe/);
    expect(validarNome('a'.repeat(41))).toMatch(/40/);
    expect(validarNome('a'.repeat(40))).toBeNull();
  });

  it.each([0, 11, -1, 5.5, '', 'abc', null, undefined, NaN])('rejeita nota inválida %s', (nota) => {
    expect(validarNota(nota)).not.toBeNull();
  });

  it.each([1, 5, 10, '7'])('aceita nota válida %s', (nota) => {
    expect(validarNota(nota)).toBeNull();
  });

  it('detecta nome duplicado sem diferenciar maiúsculas', () => {
    const existentes = [{ id: '1', nome: 'João' }];
    const r = validarParticipante({ nome: ' joão ', nota: 5 }, existentes);
    expect(r.ok).toBe(false);
    expect(r.erros.nome).toMatch(/Já existe "João"/);
  });

  it('permite manter o próprio nome ao editar', () => {
    const existentes = [{ id: '1', nome: 'João' }];
    expect(validarParticipante({ nome: 'JOÃO', nota: 6 }, existentes, '1').ok).toBe(true);
  });

  it('nomes com acento diferente são pessoas diferentes', () => {
    expect(chaveNome('Joao')).not.toBe(chaveNome('João'));
  });

  it('devolve valor normalizado e nota numérica', () => {
    const r = validarParticipante({ nome: ' Ana  Paula ', nota: '9' }, []);
    expect(r).toEqual({ ok: true, erros: {}, valor: { nome: 'Ana Paula', nota: 9 } });
  });
});
