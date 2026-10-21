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

  it('o placar do encerramento vem dos gols gravados, não de um valor informado', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    expect(await partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 100_000, placarA: 2 })).toBeNull();
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

describe('gols da partida', () => {
  const ladoDe = async (p, lado) => (await partidas.detalhar(p.id))[lado === 'A' ? 'jogadoresA' : 'jogadoresB'];

  it('registra gol com minuto do cronômetro e enfileira para o servidor', async () => {
    const p = await criar();
    await expect(partidas.registrarGol(p.id, { lado: 'A' }, T0)).rejects.toThrow(/Inicie/);
    await partidas.iniciar(p.id, T0);
    const [autor] = await ladoDe(p, 'A');
    const r = await partidas.registrarGol(p.id, { lado: 'A', participanteId: autor.id }, T0 + 95_000);
    expect(r.encerrou).toBe(false);
    expect(r.gol).toMatchObject({ tempo_partida_segundos: 95, tipo: 'normal', equipe_id: p.equipe_a_id, participante_id: autor.id });
    expect(await partidas.placar(p.id)).toEqual({ a: 1, b: 0 });
    const op = (await store.listar(STORES.OUTBOX)).find((o) => o.tabela === 'gols');
    expect(op).toMatchObject({ acao: 'upsert', registroId: r.gol.id });
    expect(op.dados).not.toHaveProperty('updated_at');
  });

  it('gol contra conta para o adversário; autor errado é recusado', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    const [doA] = await ladoDe(p, 'A');
    await expect(partidas.registrarGol(p.id, { lado: 'B', participanteId: doA.id }, T0 + 1000)).rejects.toThrow(/Gol normal/);
    await partidas.registrarGol(p.id, { lado: 'B', participanteId: doA.id, tipo: 'contra' }, T0 + 1000);
    expect(await partidas.placar(p.id)).toEqual({ a: 0, b: 1 });
  });

  it('atingir o limite de gols encerra a partida no mesmo instante', async () => {
    const p = await criar(); // limite 2
    await partidas.iniciar(p.id, T0);
    await partidas.registrarGol(p.id, { lado: 'B' }, T0 + 60_000);
    const r = await partidas.registrarGol(p.id, { lado: 'B' }, T0 + 150_000);
    expect(r.encerrou).toBe(true);
    coerente(r.partida);
    expect(r.partida).toMatchObject({ status: 'finalizada', relogio_acumulado_ms: 150_000, ended_at: new Date(T0 + 150_000).toISOString() });
    expect(r.partida.configuracao_extra.motivo_fim).toBe('gols');
  });

  it('"só tempo" não encerra por gols', async () => {
    const p = await criar({ condicao_encerramento: 'tempo' });
    await partidas.iniciar(p.id, T0);
    for (let i = 0; i < 4; i++) expect((await partidas.registrarGol(p.id, { lado: 'A' }, T0 + i * 1000)).encerrou).toBe(false);
  });

  it('corrigir autor/tipo e remover gol', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    const [a1] = await ladoDe(p, 'A');
    const [b1] = await ladoDe(p, 'B');
    const { gol } = await partidas.registrarGol(p.id, { lado: 'A' }, T0 + 10_000);
    const ed = await partidas.editarGol(p.id, gol.id, { participanteId: a1.id, tipo: 'normal' });
    expect(ed).toMatchObject({ participante_id: a1.id, tempo_partida_segundos: 10 });
    await expect(partidas.editarGol(p.id, gol.id, { participanteId: b1.id, tipo: 'normal' })).rejects.toThrow(/Gol normal/);
    expect((await partidas.editarGol(p.id, gol.id, { participanteId: b1.id, tipo: 'contra' })).tipo).toBe('contra');
    expect(await partidas.removerGol(p.id, gol.id)).toEqual({ a: 0, b: 0 });
    expect(await partidas.gols(p.id)).toEqual([]);
    const ops = (await store.listar(STORES.OUTBOX)).filter((o) => o.tabela === 'gols');
    expect(ops.at(-1)).toMatchObject({ acao: 'delete', registroId: gol.id });
  });

  it('um gol por engano que encerrou o jogo pode ser desfeito e a partida volta', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    await partidas.registrarGol(p.id, { lado: 'A' }, T0 + 10_000);
    const { gol, encerrou } = await partidas.registrarGol(p.id, { lado: 'A' }, T0 + 20_000);
    expect(encerrou).toBe(true);
    await expect(partidas.voltarAoJogo(p.id)).rejects.toThrow(/limite de gols/);
    await partidas.removerGol(p.id, gol.id);
    const x = await partidas.voltarAoJogo(p.id);
    coerente(x);
    expect(x).toMatchObject({ status: 'pausada', ended_at: null, relogio_acumulado_ms: 20_000 });
    expect(x.configuracao_extra).not.toHaveProperty('motivo_fim');
    await partidas.retomar(p.id, T0 + 30_000);
    expect(partidas.decorrido(await partidas.obter(p.id), T0 + 40_000)).toBe(30_000);
  });
});

describe('resultado: pênaltis e confirmação', () => {
  const empatada = async (cfg = {}) => {
    const p = await criar({ condicao_encerramento: 'tempo', ...cfg });
    await partidas.iniciar(p.id, T0);
    await partidas.registrarGol(p.id, { lado: 'A' }, T0 + 1000);
    await partidas.registrarGol(p.id, { lado: 'B' }, T0 + 2000);
    await partidas.aplicarEventoAutomatico(p.id, { agora: T0 + 480_000 });
    return p;
  };

  it('empate com pênaltis: exige a disputa antes de confirmar', async () => {
    const p = await empatada();
    await expect(partidas.confirmar(p.id)).rejects.toThrow(/pênaltis/);
    await expect(partidas.definirPenaltis(p.id, 3, 3)).rejects.toThrow(/vencedor/);
    await partidas.definirPenaltis(p.id, 4, 3);
    const c = await partidas.confirmar(p.id, T0 + 600_000);
    coerente(c);
    expect(c).toMatchObject({ status: 'confirmada', penaltis_a: 4, penaltis_b: 3, confirmed_at: new Date(T0 + 600_000).toISOString() });
  });

  it('sem empate não aceita pênaltis; empate "vale" confirma direto', async () => {
    const p = await empatada({ desempate: 'nenhum' });
    await expect(partidas.definirPenaltis(p.id, 4, 3)).rejects.toThrow(/empatada/);
    expect((await partidas.confirmar(p.id)).status).toBe('confirmada');
  });

  it('confirmada: gols travados até reabrir; reabrir permite corrigir', async () => {
    const p = await empatada();
    await partidas.definirPenaltis(p.id, 5, 4);
    await partidas.confirmar(p.id);
    const [g] = await partidas.gols(p.id);
    await expect(partidas.removerGol(p.id, g.id)).rejects.toThrow(/Reabra/);
    await expect(partidas.registrarGol(p.id, { lado: 'A' })).rejects.toThrow(/Reabra/);
    const r = await partidas.reabrir(p.id);
    coerente(r);
    expect(r.status).toBe('finalizada');
    // corrigir o placar para 2 x 1 tira os pênaltis, que deixam de fazer sentido
    await partidas.registrarGol(p.id, { lado: 'A' }, T0 + 700_000);
    const x = await partidas.obter(p.id);
    expect(x.penaltis_a).toBeNull();
    expect((await partidas.confirmar(p.id)).status).toBe('confirmada');
  });

  it('não confirma partida em andamento', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    await expect(partidas.confirmar(p.id)).rejects.toThrow(/confirmar/);
  });

  it('excluir a sessão remove os gols locais', async () => {
    const p = await criar();
    await partidas.iniciar(p.id, T0);
    await partidas.registrarGol(p.id, { lado: 'A' }, T0 + 1000);
    await sessoes.excluir(sessao.id);
    expect(await store.listar(STORES.GOLS)).toHaveLength(0);
  });
});
