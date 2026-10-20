import { describe, it, expect, beforeEach } from 'vitest';
import { bancoDeTeste } from '../helpers.js';
import { STORES, abrirBanco } from '../../src/services/localStore.js';
import { criarSessoesRepo } from '../../src/repositories/sessoesRepo.js';
import { criarParticipantesRepo } from '../../src/repositories/participantesRepo.js';

let store, sessoes, participantes, gravacoes;

beforeEach(async () => {
  store = await bancoDeTeste();
  gravacoes = 0;
  const aoGravar = () => { gravacoes += 1; };
  sessoes = criarSessoesRepo({ store, aoGravar });
  participantes = criarParticipantesRepo({ store, aoGravar });
});

const outbox = async () => (await store.listar(STORES.OUTBOX)).sort((a, b) => a.seq - b.seq);

describe('sessões', () => {
  it('cria sessão e enfileira o envio na mesma gravação', async () => {
    const s = await sessoes.criar({ dataReferencia: '2026-10-18' });
    expect(s.status).toBe('em_andamento');
    const ops = await outbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ tabela: 'sessoes', acao: 'upsert', registroId: s.id, status: 'pendente' });
    expect(ops[0].dados).not.toHaveProperty('owner_id');
    expect(gravacoes).toBe(1);
  });

  it('não cria sessão duplicada enquanto houver uma em andamento', async () => {
    await sessoes.criar({ dataReferencia: '2026-10-18' });
    await expect(sessoes.criar({ dataReferencia: '2026-10-18' })).rejects.toThrow(/em andamento/);
    expect(await sessoes.listar()).toHaveLength(1);
  });

  it('encerra e permite nova sessão sem apagar o histórico', async () => {
    const s1 = await sessoes.criar({ dataReferencia: '2026-10-11' });
    await sessoes.encerrar(s1.id);
    const s2 = await sessoes.criar({ dataReferencia: '2026-10-18' });
    const lista = await sessoes.listar();
    expect(lista.map((s) => s.id)).toEqual([s2.id, s1.id]);
    expect(lista[1].encerrada_em).toBeTruthy();
  });

  it('reabrir só é possível sem outra sessão ativa', async () => {
    const s1 = await sessoes.criar({ dataReferencia: '2026-10-11' });
    await sessoes.encerrar(s1.id);
    await sessoes.criar({ dataReferencia: '2026-10-18' });
    await expect(sessoes.reabrir(s1.id)).rejects.toThrow(/Encerre/);
  });

  it('excluir remove participantes locais e enfileira exclusão no servidor', async () => {
    const s = await sessoes.criar({ dataReferencia: '2026-10-18' });
    await participantes.adicionar(s.id, { nome: 'Ana', nota: 8 });
    await sessoes.excluir(s.id);
    expect(await sessoes.listar()).toHaveLength(0);
    expect(await store.listar(STORES.PARTICIPANTES)).toHaveLength(0);
    const ops = await outbox();
    expect(ops.at(-1)).toMatchObject({ tabela: 'sessoes', acao: 'delete', registroId: s.id });
  });
});

describe('participantes', () => {
  let sessao;
  beforeEach(async () => {
    sessao = await sessoes.criar({ dataReferencia: '2026-10-18' });
  });

  it('adiciona, edita e remove com operações enfileiradas em ordem', async () => {
    const p = await participantes.adicionar(sessao.id, { nome: '  Ana ', nota: 8 });
    expect(p).toMatchObject({ nome: 'Ana', nota: 8, sessao_id: sessao.id });
    await participantes.editar(p.id, { nome: 'Ana Paula', nota: 9 });
    await participantes.remover(p.id);
    const ops = (await outbox()).filter((o) => o.tabela === 'participantes');
    expect(ops.map((o) => o.acao)).toEqual(['upsert', 'upsert', 'delete']);
    expect(ops[1].dados).toMatchObject({ nome: 'Ana Paula', nota: 9 });
    expect(await participantes.listarPorSessao(sessao.id)).toHaveLength(0);
  });

  it('mantém a ordem de chegada', async () => {
    for (const nome of ['Ana', 'Bruno', 'Caio', 'Duda']) {
      await participantes.adicionar(sessao.id, { nome, nota: 5 });
    }
    const lista = await participantes.listarPorSessao(sessao.id);
    expect(lista.map((p) => p.nome)).toEqual(['Ana', 'Bruno', 'Caio', 'Duda']);
  });

  it('rejeita nota fora do intervalo e nome duplicado', async () => {
    await participantes.adicionar(sessao.id, { nome: 'João', nota: 7 });
    await expect(participantes.adicionar(sessao.id, { nome: 'Pedro', nota: 11 }))
      .rejects.toMatchObject({ erros: { nota: expect.any(String) } });
    await expect(participantes.adicionar(sessao.id, { nome: 'JOÃO', nota: 5 }))
      .rejects.toMatchObject({ erros: { nome: expect.stringMatching(/Já existe/) } });
    expect(await participantes.listarPorSessao(sessao.id)).toHaveLength(1);
  });

  it('não altera participantes de sessão encerrada', async () => {
    const p = await participantes.adicionar(sessao.id, { nome: 'Ana', nota: 8 });
    await sessoes.encerrar(sessao.id);
    await expect(participantes.adicionar(sessao.id, { nome: 'Bia', nota: 5 })).rejects.toThrow(/encerrada/);
    await expect(participantes.editar(p.id, { nome: 'Ana', nota: 2 })).rejects.toThrow(/encerrada/);
    await expect(participantes.remover(p.id)).rejects.toThrow(/encerrada/);
  });

  it('sessões diferentes têm participantes independentes (mesmo nome permitido)', async () => {
    await participantes.adicionar(sessao.id, { nome: 'Ana', nota: 8 });
    await sessoes.encerrar(sessao.id);
    const s2 = await sessoes.criar({ dataReferencia: '2026-10-25' });
    await participantes.adicionar(s2.id, { nome: 'Ana', nota: 6 });
    expect((await participantes.listarPorSessao(sessao.id))[0].nota).toBe(8);
    expect((await participantes.listarPorSessao(s2.id))[0].nota).toBe(6);
  });
});

describe('persistência após reinicialização', () => {
  it('dados e fila continuam após fechar e reabrir o banco', async () => {
    const nome = `jogueai-reinicio-${Date.now()}`;
    let st = await abrirBanco({ nome });
    const repoS = criarSessoesRepo({ store: st });
    const s = await repoS.criar({ dataReferencia: '2026-10-18' });
    await criarParticipantesRepo({ store: st }).adicionar(s.id, { nome: 'Ana', nota: 8 });
    st.db.close();

    st = await abrirBanco({ nome });
    expect((await criarSessoesRepo({ store: st }).emAndamento()).id).toBe(s.id);
    expect(await criarParticipantesRepo({ store: st }).listarPorSessao(s.id)).toHaveLength(1);
    expect(await st.contar(STORES.OUTBOX)).toBe(2);
  });
});
