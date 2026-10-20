import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bancoDeTeste } from '../helpers.js';
import { STORES } from '../../src/services/localStore.js';
import { FilaSincronizacao } from '../../src/services/syncQueue.js';
import { criarSessoesRepo } from '../../src/repositories/sessoesRepo.js';
import { criarParticipantesRepo } from '../../src/repositories/participantesRepo.js';

let store, sessoes, participantes, remoto, agendados, permitido;

function novaFila() {
  return new FilaSincronizacao({
    store,
    remoto,
    podeSincronizar: () => permitido,
    atrasos: [10, 20],
    agendar: (fn, ms) => { agendados.push({ fn, ms }); return agendados.length; },
    cancelar: () => {},
  });
}

beforeEach(async () => {
  store = await bancoDeTeste();
  sessoes = criarSessoesRepo({ store });
  participantes = criarParticipantesRepo({ store });
  agendados = [];
  permitido = true;
  remoto = { enviados: [], respostas: [], async executar(op) {
    this.enviados.push(op);
    return this.respostas.shift() ?? { ok: true };
  } };
});

describe('fila de sincronização', () => {
  it('envia na ordem e esvazia a fila', async () => {
    const s = await sessoes.criar({ dataReferencia: '2026-10-18' });
    await participantes.adicionar(s.id, { nome: 'Ana', nota: 8 });
    const fila = novaFila();
    const estado = await fila.processar();
    expect(remoto.enviados.map((o) => o.tabela)).toEqual(['sessoes', 'participantes']);
    expect(estado.pendentes).toBe(0);
    expect(await store.contar(STORES.OUTBOX)).toBe(0);
  });

  it('falha transitória mantém a operação e agenda nova tentativa', async () => {
    await sessoes.criar({ dataReferencia: '2026-10-18' });
    remoto.respostas.push({ ok: false, transitorio: true, mensagem: 'Sem conexão' });
    const fila = novaFila();
    const estado = await fila.processar();
    expect(estado.pendentes).toBe(1);
    expect(estado.falhaTransitoria.mensagem).toBe('Sem conexão');
    expect(agendados[0].ms).toBe(10);
    const [op] = await store.listar(STORES.OUTBOX);
    expect(op).toMatchObject({ tentativas: 1, status: 'pendente' });

    // a nova tentativa (rede de volta) envia e limpa a fila
    await agendados[0].fn();
    await fila.processar();
    expect(await store.contar(STORES.OUTBOX)).toBe(0);
    expect(remoto.enviados).toHaveLength(2);
    expect(remoto.enviados[0].registroId).toBe(remoto.enviados[1].registroId);
  });

  it('espera progressiva limitada ao último atraso', async () => {
    await sessoes.criar({ dataReferencia: '2026-10-18' });
    const fila = novaFila();
    for (let i = 0; i < 3; i++) {
      remoto.respostas.push({ ok: false, transitorio: true, mensagem: 'x' });
      await fila.processar();
    }
    expect(agendados.map((a) => a.ms)).toEqual([10, 20, 20]);
  });

  it('erro permanente bloqueia a fila sem descartar e preserva a ordem', async () => {
    const s = await sessoes.criar({ dataReferencia: '2026-10-18' });
    await participantes.adicionar(s.id, { nome: 'Ana', nota: 8 });
    remoto.respostas.push({ ok: false, transitorio: false, mensagem: 'Recusado' });
    const fila = novaFila();
    const estado = await fila.processar();
    expect(estado.erro).toMatchObject({ tabela: 'sessoes', status: 'erro', ultimoErro: 'Recusado' });
    expect(estado.pendentes).toBe(2);
    expect(remoto.enviados).toHaveLength(1); // não pulou para o participante

    await fila.processar(); // continua bloqueada
    expect(remoto.enviados).toHaveLength(1);

    await fila.tentarNovamente(estado.erro.seq);
    expect(remoto.enviados).toHaveLength(3);
    expect(await store.contar(STORES.OUTBOX)).toBe(0);
  });

  it('descartar é explícito e libera a fila', async () => {
    const s = await sessoes.criar({ dataReferencia: '2026-10-18' });
    await participantes.adicionar(s.id, { nome: 'Ana', nota: 8 });
    remoto.respostas.push({ ok: false, transitorio: false, mensagem: 'Recusado' });
    const fila = novaFila();
    const { erro } = await fila.processar();
    await fila.descartar(erro.seq);
    expect(await store.contar(STORES.OUTBOX)).toBe(0);
    expect((await sessoes.listar())).toHaveLength(1); // dado local preservado
  });

  it('exceção no envio é tratada como falha transitória', async () => {
    await sessoes.criar({ dataReferencia: '2026-10-18' });
    remoto.executar = vi.fn().mockRejectedValue(new Error('boom'));
    const estado = await novaFila().processar();
    expect(estado.pendentes).toBe(1);
    expect(estado.falhaTransitoria.mensagem).toBe('boom');
  });

  it('não envia quando bloqueada (sem login) e informa o motivo', async () => {
    await sessoes.criar({ dataReferencia: '2026-10-18' });
    permitido = 'Entre na conta do organizador para sincronizar.';
    const estado = await novaFila().processar();
    expect(remoto.enviados).toHaveLength(0);
    expect(estado.bloqueio).toMatch(/Entre/);
    expect(estado.pendentes).toBe(1);
  });

  it('chamadas simultâneas não enviam a mesma operação duas vezes', async () => {
    await sessoes.criar({ dataReferencia: '2026-10-18' });
    let liberar;
    remoto.executar = vi.fn(() => new Promise((r) => { liberar = () => r({ ok: true }); }));
    const fila = novaFila();
    const p1 = fila.processar();
    const p2 = fila.processar();
    expect(p1).toBe(p2);
    await vi.waitFor(() => expect(liberar).toBeTypeOf('function'));
    liberar();
    await p1;
    expect(remoto.executar).toHaveBeenCalledTimes(1);
  });

  it('notifica assinantes', async () => {
    await sessoes.criar({ dataReferencia: '2026-10-18' });
    const fila = novaFila();
    const estados = [];
    fila.assinar((e) => estados.push(e));
    await fila.processar();
    expect(estados.some((e) => e.sincronizando)).toBe(true);
    expect(estados.at(-1)).toMatchObject({ pendentes: 0, sincronizando: false });
  });
});
