import { describe, it, expect, beforeEach } from 'vitest';
import { bancoDeTeste } from '../helpers.js';
import { STORES, abrirBanco } from '../../src/services/localStore.js';
import { criarSessoesRepo } from '../../src/repositories/sessoesRepo.js';
import { criarParticipantesRepo } from '../../src/repositories/participantesRepo.js';
import { criarSorteiosRepo } from '../../src/repositories/sorteiosRepo.js';
import { sortearEquipes } from '../../src/domain/sorteio.js';

let store, sessoes, participantes, sorteios, sessao, lista;

beforeEach(async () => {
  store = await bancoDeTeste();
  sessoes = criarSessoesRepo({ store });
  participantes = criarParticipantesRepo({ store });
  sorteios = criarSorteiosRepo({ store });
  sessao = await sessoes.criar({ dataReferencia: '2026-10-18' });
  const notas = [9, 8, 7, 7, 6, 6, 5, 5, 4, 3, 2];
  for (const [i, nota] of notas.entries()) await participantes.adicionar(sessao.id, { nome: `J${i}`, nota });
  lista = await participantes.listarPorSessao(sessao.id);
});

const sortear = (ps = lista) => sortearEquipes(ps, { jogadoresPorEquipe: 5, semente: 1 });

describe('sorteios confirmados', () => {
  it('grava sorteio, equipes e composição e enfileira na ordem certa', async () => {
    const r = sortear();
    const d = await sorteios.confirmar(sessao.id, r);
    expect(d.sorteio.numero).toBe(1);
    expect(d.equipes).toHaveLength(2);
    expect(d.equipes.map((e) => e.nome)).toEqual(['Time A', 'Time B']);
    expect(d.equipes.every((e) => e.jogadores.length === 5)).toBe(true);
    expect(d.equipes.map((e) => e.soma)).toEqual(r.equipes.map((e) => e.soma));
    expect(d.aguardando.map((p) => p.nome)).toEqual(['J10']);

    const ops = (await store.listar(STORES.OUTBOX)).sort((a, b) => a.seq - b.seq).slice(-3);
    expect(ops.map((o) => o.tabela)).toEqual(['sorteios', 'equipes', 'equipe_participantes']);
    expect(ops[1].dados).toHaveLength(2);
    expect(ops[2].dados).toHaveLength(10);
    expect(ops.every((o) => o.registroId === d.sorteio.id)).toBe(true);
  });

  it('atual() devolve o sorteio mais recente e quem chegou depois aguarda', async () => {
    await sorteios.confirmar(sessao.id, sortear());
    await participantes.adicionar(sessao.id, { nome: 'Atrasado', nota: 6 });
    const d = await sorteios.atual(sessao.id);
    expect(d.aguardando.map((p) => p.nome)).toEqual(['J10', 'Atrasado']);
  });

  it('novo sorteio na mesma sessão preserva o anterior', async () => {
    const d1 = await sorteios.confirmar(sessao.id, sortear());
    await participantes.adicionar(sessao.id, { nome: 'Novo', nota: 6 });
    const todos = await participantes.listarPorSessao(sessao.id);
    const d2 = await sorteios.confirmar(sessao.id, sortearEquipes(todos, { jogadoresPorEquipe: 6, semente: 2 }));
    expect(d2.sorteio.numero).toBe(2);
    expect((await sorteios.atual(sessao.id)).sorteio.id).toBe(d2.sorteio.id);
    const antigo = await sorteios.detalhar(d1.sorteio);
    expect(antigo.equipes.flatMap((e) => e.jogadores)).toHaveLength(10);
  });

  it('trava nota e remoção de quem está em equipe, mas permite corrigir o nome', async () => {
    const d = await sorteios.confirmar(sessao.id, sortear());
    const p = d.equipes[0].jogadores[0];
    await expect(participantes.editar(p.id, { nome: p.nome, nota: p.nota === 10 ? 9 : p.nota + 1 }))
      .rejects.toMatchObject({ erros: { nota: expect.stringMatching(/não pode mudar/) } });
    await expect(participantes.remover(p.id)).rejects.toThrow(/time confirmado/);
    const renomeado = await participantes.editar(p.id, { nome: `${p.nome} Silva`, nota: p.nota });
    expect(renomeado.nome).toMatch(/Silva/);
    // quem está aguardando continua livre
    await participantes.remover(d.aguardando[0].id);
    expect(await participantes.emEquipe(p.id)).toBe(true);
  });

  it('recusa resultado com participante removido ou repetido', async () => {
    const r = sortear();
    await participantes.remover(r.aguardando[0]);
    const r2 = sortear(lista); // ainda contém o removido
    const comRemovido = { ...r2, equipes: r2.equipes.map((e, i) => (i === 0 ? { ...e, participantes: [...e.participantes.slice(1), r.aguardando[0]] } : e)) };
    await expect(sorteios.confirmar(sessao.id, comRemovido)).rejects.toThrow(/mudou/);
    const repetido = { ...r2, equipes: [r2.equipes[0], { ...r2.equipes[1], participantes: r2.equipes[0].participantes }] };
    await expect(sorteios.confirmar(sessao.id, repetido)).rejects.toThrow(/duas equipes/);
  });

  it('não confirma em sessão encerrada', async () => {
    await sessoes.encerrar(sessao.id);
    await expect(sorteios.confirmar(sessao.id, sortear())).rejects.toThrow(/encerrada/);
  });

  it('excluir a sessão remove sorteios e equipes locais', async () => {
    await sorteios.confirmar(sessao.id, sortear());
    await sessoes.excluir(sessao.id);
    for (const st of [STORES.SORTEIOS, STORES.EQUIPES, STORES.EQUIPE_PARTICIPANTES]) {
      expect(await store.listar(st)).toHaveLength(0);
    }
  });
});

describe('atualização do banco local', () => {
  it('versão 1 → 2 preserva dados existentes', async () => {
    const nome = `jogueai-upgrade-${Date.now()}`;
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(nome, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('sessoes', { keyPath: 'id' }).put({ id: 's1', data_referencia: '2026-10-11', status: 'encerrada' });
        db.createObjectStore('participantes', { keyPath: 'id' }).createIndex('sessao_id', 'sessao_id');
        db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }).createIndex('registro_id', 'registroId');
        db.createObjectStore('meta', { keyPath: 'chave' });
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    const st = await abrirBanco({ nome });
    expect(await st.obter(STORES.SESSOES, 's1')).toMatchObject({ status: 'encerrada' });
    expect(await st.listar(STORES.SORTEIOS)).toEqual([]);
  });
});
