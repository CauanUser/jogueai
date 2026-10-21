import { describe, it, expect, beforeEach } from 'vitest';
import { bancoDeTeste } from '../helpers.js';
import { STORES } from '../../src/services/localStore.js';
import { criarSessoesRepo } from '../../src/repositories/sessoesRepo.js';
import { criarParticipantesRepo } from '../../src/repositories/participantesRepo.js';
import { criarSorteiosRepo } from '../../src/repositories/sorteiosRepo.js';
import { criarPartidasRepo } from '../../src/repositories/partidasRepo.js';
import { sortearEquipes } from '../../src/domain/sorteio.js';
import { CONFIG_PADRAO } from '../../src/domain/partida.js';

const T0 = Date.parse('2026-10-25T10:00:00.000Z');
let store, sessoes, partidas, sessao, equipes;

/** Verifica as mesmas restrições de coerência do banco (migração 0001). */
function coerente(p) {
  expect((p.status === 'em_andamento')).toBe(p.relogio_retomado_em !== null);
  expect((p.status === 'configurada')).toBe(p.started_at === null);
  if (['finalizada', 'confirmada'].includes(p.status)) expect(p.ended_at).not.toBeNull();
  expect(p.relogio_acumulado_ms).toBeGreaterThanOrEqual(0);
}

beforeEach(async () => {
  store = await bancoDeTeste();
  sessoes = criarSessoesRepo({ store });
  const participantes = criarParticipantesRepo({ store });
  const sorteios = criarSorteiosRepo({ store });
  partidas = criarPartidasRepo({ store });
  sessao = await sessoes.criar({ dataReferencia: '2026-10-25' });
  for (const [i, n] of [9, 8, 7, 7, 6, 6, 5, 5, 4, 3, 2, 8, 6, 5, 4].entries()) {
    await participantes.adicionar(sessao.id, { nome: `J${i}`, nota: n });
  }
  const lista = await participantes.listarPorSessao(sessao.id);
  const d = await sorteios.confirmar(sessao.id, sortearEquipes(lista, { jogadoresPorEquipe: 5, semente: 3 }));
  equipes = d.equipes;
});

const criar = (cfg = {}) => partidas.criar(sessao.id, { equipeAId: equipes[0].id, equipeBId: equipes[1].id, config: { ...CONFIG_PADRAO, ...cfg } });

describe('criação da partida', () => {
  it('congela a configuração e copia a escalação de cada lado', async () => {
    const p = await criar();
    coerente(p);
    expect(p).toMatchObject({ numero: 1, status: 'configurada', duracao_segundos: 480, limite_gols: 2 });
    const d = await partidas.detalhar(p.id);
    expect(d.jogadoresA.map((j) => j.id).sort()).toEqual(equipes[0].jogadores.map((j) => j.id).sort());
    expect(d.jogadoresB).toHaveLength(5);
    const ops = (await store.listar(STORES.OUTBOX)).sort((a, b) => a.seq - b.seq).slice(-2);
    expect(ops.map((o) => o.tabela)).toEqual(['partidas', 'partida_escalacoes']);
    expect(ops[1].dados).toHaveLength(10);
  });

  it('não permite duas partidas abertas, nem a mesma equipe dos dois lados', async () => {
    await criar();
    await expect(criar()).rejects.toThrow(/ainda não terminou/);
    await expect(partidas.criar(sessao.id, { equipeAId: equipes[2].id, equipeBId: equipes[2].id, config: CONFIG_PADRAO })).rejects.toThrow(/diferentes/);
  });

  it('rejeita configuração inválida', async () => {
    await expect(criar({ duracao_segundos: 5 })).rejects.toMatchObject({ erros: { duracao_segundos: expect.any(String) } });
  });

  it('configuração da partida não muda se o padrão mudar depois', async () => {
    const p = await criar({ duracao_segundos: 600 });
    expect((await partidas.obter(p.id)).duracao_segundos).toBe(600);
  });
});

describe('cronômetro da partida', () => {
  it('iniciar, pausar e retomar gravam instantes coerentes', async () => {
    const p = await criar();
    let x = await partidas.iniciar(p.id, T0);
    coerente(x);
    expect(x.status).toBe('em_andamento');
    expect(partidas.decorrido(x, T0 + 60_000)).toBe(60_000);
    x = await partidas.pausar(p.id, T0 + 60_000);
    coerente(x);
    expect(x.relogio_acumulado_ms).toBe(60_000);
    expect(partidas.decorrido(x, T0 + 999_999)).toBe(60_000);
    x = await partidas.retomar(p.id, T0 + 120_000);
    expect(partidas.decorrido(x, T0 + 150_000)).toBe(90_000);
  });

  it('ações fora de ordem são recusadas com mensagem clara', async () => {
    const p = await criar();
    await expect(partidas.pausar(p.id, T0)).rejects.toThrow(/Não é possível pausar/);
    await partidas.iniciar(p.id, T0);
    await expect(partidas.iniciar(p.id, T0)).rejects.toThrow(/iniciar/);
  });

  it('o estado do relógio sobrevive a "fechar e reabrir" (novo repositório, mesmo banco)', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    const outro = criarPartidasRepo({ store });
    const x = await outro.obter(p.id);
    expect(outro.decorrido(x, T0 + 200_000)).toBe(200_000);
  });

  it('acréscimos', async () => {
    const p = await criar();
    expect((await partidas.adicionarAcrescimo(p.id, 60)).acrescimos_segundos).toBe(60);
    expect((await partidas.adicionarAcrescimo(p.id, -120)).acrescimos_segundos).toBe(0);
  });
});

describe('encerramento', () => {
  it('automático por tempo: registra o fim no instante exato, mesmo com o app fechado', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    expect(await partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 479_000 })).toBeNull();
    const r = await partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 3_600_000 });
    expect(r.evento).toMatchObject({ tipo: 'encerrar', motivo: 'tempo' });
    coerente(r.partida);
    expect(r.partida.status).toBe('finalizada');
    expect(r.partida.ended_at).toBe(new Date(T0 + 480_000).toISOString());
    expect(r.partida.relogio_acumulado_ms).toBe(480_000);
    expect(r.partida.configuracao_extra.motivo_fim).toBe('tempo');
  });

  it('não processa o mesmo encerramento duas vezes', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    const [a, b] = await Promise.all([
      partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 500_000 }),
      partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 500_000 }),
    ]);
    expect([a, b].filter(Boolean).length).toBe(1); // só um dos dois processa o fim
    expect(await partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 900_000 })).toBeNull();
    const fins = (await store.listar(STORES.OUTBOX)).filter((o) => o.tabela === 'partidas' && o.dados?.status === 'finalizada');
    expect(new Set(fins.map((o) => o.dados.ended_at)).size).toBe(1);
  });

  it('automático por limite de gols (placar informado)', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    const r = await partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 100_000, placarA: 2 });
    expect(r.evento.motivo).toBe('gols');
    expect(r.partida.relogio_acumulado_ms).toBe(100_000);
  });

  it('intervalo: pausa automática na metade e depois segue até o fim', async () => {
    const p = await criar({ duracao_segundos: 600, intervalo_segundos: 300 });
    await partidas.iniciar(p.id, T0);
    const r = await partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 400_000 });
    expect(r.evento.tipo).toBe('intervalo');
    expect(r.partida).toMatchObject({ status: 'pausada', relogio_acumulado_ms: 300_000 });
    await partidas.retomar(p.id, T0 + 700_000);
    expect(await partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 800_000 })).toBeNull();
    const fim = await partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 1_000_000 });
    expect(fim.partida.ended_at).toBe(new Date(T0 + 1_000_000).toISOString());
  });

  it('encerrar manualmente', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    const x = await partidas.finalizar(p.id, T0 + 200_000);
    coerente(x);
    expect(x).toMatchObject({ status: 'finalizada', relogio_acumulado_ms: 200_000 });
    expect(await partidas.ativa(sessao.id)).toBeNull();
    // agora pode criar a próxima
    expect((await criar()).numero).toBe(2);
  });

  it('cancelar antes de começar exclui; depois de começar fica como cancelada', async () => {
    const p = await criar();
    expect(await partidas.cancelar(p.id)).toBeNull();
    expect(await partidas.obter(p.id)).toBeNull();
    expect((await store.listar(STORES.PARTIDA_ESCALACOES))).toHaveLength(0);
    const q = await criar();
    await partidas.iniciar(q.id, T0);
    const c = await partidas.cancelar(q.id, T0 + 1000);
    coerente(c);
    expect(c.status).toBe('cancelada');
  });

  it('excluir a sessão remove partidas e escalações locais', async () => {
    await criar();
    await sessoes.excluir(sessao.id);
    expect(await store.listar(STORES.PARTIDAS)).toHaveLength(0);
    expect(await store.listar(STORES.PARTIDA_ESCALACOES)).toHaveLength(0);
  });
});
