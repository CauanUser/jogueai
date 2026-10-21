import { describe, it, expect, beforeEach } from 'vitest';
import { bancoDeTeste } from '../helpers.js';
import { STORES } from '../../src/services/localStore.js';
import { criarSessoesRepo } from '../../src/repositories/sessoesRepo.js';
import { criarParticipantesRepo } from '../../src/repositories/participantesRepo.js';
import { criarSorteiosRepo } from '../../src/repositories/sorteiosRepo.js';
import { interpretarListaWhatsApp, separarJaCadastrados } from '../../src/domain/importacaoLista.js';
import { sortearEquipes } from '../../src/domain/sorteio.js';

const LISTA = `LISTA DO RACHA - DOMINGO 07:00

01 - Alisson
02 - Michel
03 - Lucas
04 - Cauan
05 - Caua Lima
06 - Werbesson
07 - VT
08 - Jadson
09 - Pedrin
10 - Breno
11 -
12 -`;

let store, sessoes, participantes, sorteios, sessao;
beforeEach(async () => {
  store = await bancoDeTeste();
  sessoes = criarSessoesRepo({ store });
  participantes = criarParticipantesRepo({ store });
  sorteios = criarSorteiosRepo({ store });
  sessao = await sessoes.criar({ dataReferencia: '2026-10-25' });
});

describe('importação da lista para a sessão', () => {
  it('importa os nomes sem nota, na ordem da lista, com envio enfileirado', async () => {
    const { jogadores } = interpretarListaWhatsApp(LISTA);
    const novos = await participantes.adicionarVarios(sessao.id, jogadores.map((j) => j.nome));
    expect(novos).toHaveLength(10);
    const lista = await participantes.listarPorSessao(sessao.id);
    expect(lista.map((p) => p.nome)).toEqual(jogadores.map((j) => j.nome));
    expect(lista.every((p) => p.nota === null)).toBe(true);
    const ops = await store.listar(STORES.OUTBOX);
    expect(ops.filter((o) => o.tabela === 'participantes')).toHaveLength(10);
    expect(ops.find((o) => o.tabela === 'participantes').dados).toMatchObject({ nota: null });
  });

  it('com jogadores já cadastrados: não duplica e preserva a nota existente', async () => {
    await participantes.adicionar(sessao.id, { nome: 'Alisson', nota: 9 });
    const { jogadores } = interpretarListaWhatsApp(LISTA);
    const existentes = await participantes.listarPorSessao(sessao.id);
    const { novos, jaCadastrados } = separarJaCadastrados(jogadores.map((j) => j.nome), existentes);
    expect(jaCadastrados.map((x) => x.nome)).toEqual(['Alisson']);
    await participantes.adicionarVarios(sessao.id, novos);
    const lista = await participantes.listarPorSessao(sessao.id);
    expect(lista).toHaveLength(10);
    expect(lista.find((p) => p.nome === 'Alisson').nota).toBe(9);
  });

  it('tudo ou nada: um nome repetido com o cadastro impede a importação inteira', async () => {
    await participantes.adicionar(sessao.id, { nome: 'Michel', nota: 7 });
    await expect(participantes.adicionarVarios(sessao.id, ['Ana', 'MICHEL'])).rejects.toMatchObject({
      errosPorIndice: [{ indice: 1, erro: expect.stringMatching(/já cadastrado/) }],
    });
    expect(await participantes.listarPorSessao(sessao.id)).toHaveLength(1);
  });

  it('cancelar (não confirmar) não altera nada', async () => {
    await participantes.adicionar(sessao.id, { nome: 'Michel', nota: 7 });
    interpretarListaWhatsApp(LISTA); // só leitura/prévia
    expect(await participantes.listarPorSessao(sessao.id)).toHaveLength(1);
    expect(await store.contar(STORES.OUTBOX)).toBe(2); // sessão + Michel
  });

  it('não importa em sessão encerrada', async () => {
    await sessoes.encerrar(sessao.id);
    await expect(participantes.adicionarVarios(sessao.id, ['Ana'])).rejects.toThrow(/encerrada/);
  });

  it('notas preenchidas depois → sorteio normal com a mesma lógica', async () => {
    const { jogadores } = interpretarListaWhatsApp(LISTA);
    await participantes.adicionarVarios(sessao.id, jogadores.map((j) => j.nome));
    let lista = await participantes.listarPorSessao(sessao.id);
    expect(() => sortearEquipes(lista, { jogadoresPorEquipe: 5 })).toThrow(/Sem nota/);

    const notas = [9, 8, 7, 7, 6, 6, 5, 5, 4, 3];
    for (const [i, p] of lista.entries()) await participantes.editar(p.id, { nome: p.nome, nota: notas[i] });
    lista = await participantes.listarPorSessao(sessao.id);
    const r = sortearEquipes(lista, { jogadoresPorEquipe: 5, semente: 1 });
    expect(r.amplitude).toBe(0); // 60 pontos → 30 / 30
    const d = await sorteios.confirmar(sessao.id, r);
    expect(d.equipes.flatMap((e) => e.jogadores)).toHaveLength(10);
  });
});
