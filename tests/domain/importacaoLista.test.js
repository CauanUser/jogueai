import { describe, it, expect } from 'vitest';
import { interpretarListaWhatsApp, separarJaCadastrados, validarNomesParaImportar } from '../../src/domain/importacaoLista.js';

const LISTA_9 = `LISTA DO RACHA - DOMINGO 07:00

01 - Alisson
02 - Michel
03 - Lucas
04 - Cauan
05 - Caua Lima
06 - Werbesson
07 - VT
08 - Jadson
09 - Pedrin
10 -
11 -
12 -
13 -
14 -
15 -`;

const nomes = (r) => r.jogadores.map((j) => j.nome);

describe('lista do WhatsApp', () => {
  it('lista oficial com 9 nomes e 6 vagas', () => {
    const r = interpretarListaWhatsApp(LISTA_9);
    expect(nomes(r)).toEqual(['Alisson', 'Michel', 'Lucas', 'Cauan', 'Caua Lima', 'Werbesson', 'VT', 'Jadson', 'Pedrin']);
    expect(r.vagas).toBe(6);
    expect(r.posicoes).toBe(15);
    expect(r.cabecalho).toBe('LISTA DO RACHA - DOMINGO 07:00');
    expect(r.naoReconhecidas).toEqual([]);
    expect(nomes(r)).not.toContain('10');
  });

  it('lista com os 15 nomes preenchidos', () => {
    const linhas = Array.from({ length: 15 }, (_, i) => `${String(i + 1).padStart(2, '0')} - Jogador ${i + 1}`);
    const r = interpretarListaWhatsApp(`LISTA DO RACHA - DOMINGO 07:00\n\n${linhas.join('\n')}`);
    expect(r.jogadores).toHaveLength(15);
    expect(r.vagas).toBe(0);
    expect(r.jogadores[14]).toMatchObject({ nome: 'Jogador 15', numero: 15 });
  });

  it('não fica limitada a 15 posições', () => {
    const linhas = Array.from({ length: 22 }, (_, i) => `${String(i + 1).padStart(2, '0')} - J${i + 1}`);
    expect(interpretarListaWhatsApp(linhas.join('\n')).jogadores).toHaveLength(22);
  });

  it('espaços irregulares, tabs e hífen colado', () => {
    const r = interpretarListaWhatsApp('  01   -    Alisson   \n02-Michel\n03 -Lucas\n04- Cauan  Silva\n\t05\t-\tVT\n06 –  Jadson\n07 — Pedrin');
    expect(nomes(r)).toEqual(['Alisson', 'Michel', 'Lucas', 'Cauan Silva', 'VT', 'Jadson', 'Pedrin']);
  });

  it('linhas vazias, quebras do Windows e caracteres invisíveis', () => {
    const r = interpretarListaWhatsApp('\r\n\r\n01 - Ana\r\n\r\n\r\n02 - Bia\u200B\r\n03\u00A0-\u00A0Caio\r\n   \r\n04 -   \r\n');
    expect(nomes(r)).toEqual(['Ana', 'Bia', 'Caio']);
    expect(r.vagas).toBe(1);
  });

  it('nomes repetidos entram uma vez e são avisados (sem diferenciar maiúsculas e espaços)', () => {
    const r = interpretarListaWhatsApp('01 - Lucas\n02 - Michel\n03 -  lucas \n04 - LUCAS\n05 - Lucas Silva');
    expect(nomes(r)).toEqual(['Lucas', 'Michel', 'Lucas Silva']);
    expect(r.repetidos.map((x) => x.linha)).toEqual([3, 4]);
  });

  it('lista sem cabeçalho', () => {
    const r = interpretarListaWhatsApp('01 - Ana\n02 - Bia\n03 -');
    expect(r.cabecalho).toBeNull();
    expect(nomes(r)).toEqual(['Ana', 'Bia']);
  });

  it('cabeçalho em várias linhas e com números (ex.: horário)', () => {
    const r = interpretarListaWhatsApp('⚽ LISTA DO RACHA ⚽\nDomingo 07:00\nCampo do Zé\n\n01 - Ana');
    expect(r.cabecalho).toMatch(/LISTA DO RACHA/);
    expect(nomes(r)).toEqual(['Ana']);
  });

  it('linhas mal formatadas são avisadas e não viram jogadores', () => {
    const r = interpretarListaWhatsApp('01 - Ana\n02 Bia\nCaio\n03 - 11\n04 - Duda\n05 - ' + 'x'.repeat(50));
    expect(nomes(r)).toEqual(['Ana', 'Duda']);
    expect(r.naoReconhecidas.map((x) => x.linha)).toEqual([2, 3, 4, 6]);
    expect(r.naoReconhecidas[0].motivo).toMatch(/formato/);
    expect(r.naoReconhecidas[2].motivo).toMatch(/números/);
  });

  it('marcadores de vaga e formatação do WhatsApp', () => {
    const r = interpretarListaWhatsApp('01 - *Alisson*\n02 - _Michel_\n03 - VAGA\n04 - vaga\n05 - ...\n06 - ~Lucas~');
    expect(nomes(r)).toEqual(['Alisson', 'Michel', 'Lucas']);
    expect(r.vagas).toBe(3);
  });

  it('texto vazio ou nulo não quebra', () => {
    expect(interpretarListaWhatsApp('')).toMatchObject({ jogadores: [], vagas: 0, posicoes: 0 });
    expect(interpretarListaWhatsApp(null).jogadores).toEqual([]);
    expect(interpretarListaWhatsApp('Só um texto qualquer').cabecalho).toBe('Só um texto qualquer');
  });

  it('o número da lista não é usado como nota nem identificador', () => {
    const r = interpretarListaWhatsApp('07 - VT');
    expect(r.jogadores[0]).toEqual({ nome: 'VT', numero: 7, linha: 1 });
    expect(r.jogadores[0]).not.toHaveProperty('nota');
  });
});

describe('comparação com jogadores já cadastrados', () => {
  const existentes = [{ id: '1', nome: 'Alisson', nota: 8 }, { id: '2', nome: 'Caua Lima', nota: 6 }];

  it('separa quem já está cadastrado (sem diferenciar maiúsculas e espaços)', () => {
    const r = separarJaCadastrados(['alisson', 'Michel', ' CAUA   LIMA '], existentes);
    expect(r.novos).toEqual(['Michel']);
    expect(r.jaCadastrados.map((x) => x.existente.id)).toEqual(['1', '2']);
  });

  it('nomes parecidos mas diferentes não são tratados como iguais', () => {
    expect(separarJaCadastrados(['Caua', 'Alison'], existentes).novos).toEqual(['Caua', 'Alison']);
  });

  it('valida a lista final editada na prévia', () => {
    const ok = validarNomesParaImportar([' Michel ', 'Lucas'], existentes);
    expect(ok).toEqual({ ok: true, erros: [], nomes: ['Michel', 'Lucas'] });
    const ruim = validarNomesParaImportar(['Michel', 'michel', '', 'alisson'], existentes);
    expect(ruim.ok).toBe(false);
    expect(ruim.erros.map((e) => e.indice)).toEqual([1, 2, 3]);
    expect(ruim.erros[2].erro).toMatch(/já cadastrado/);
  });
});
