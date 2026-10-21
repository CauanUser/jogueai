import { STORES, enfileirar } from '../services/localStore.js';
import { novoId } from '../utils/ids.js';
import { participantesEditaveis } from '../domain/sessao.js';
import { decorridoMs, iniciar as iniciarRelogio, pausar as pausarRelogio } from '../domain/cronometro.js';
import {
  STATUS_PARTIDA, LIMITES, validarConfiguracao, partidaAtiva, relogioDaPartida, avaliarEventoAutomatico,
} from '../domain/partida.js';
import { ErroDeNegocio } from './sessoesRepo.js';

const iso = (ms) => new Date(ms).toISOString();

const CAMPOS_PARTIDA = [
  'id', 'sessao_id', 'numero', 'equipe_a_id', 'equipe_b_id', 'status',
  'duracao_segundos', 'condicao_encerramento', 'limite_gols', 'acrescimos_segundos', 'intervalo_segundos',
  'desempate', 'configuracao_extra', 'relogio_acumulado_ms', 'relogio_retomado_em',
  'penaltis_a', 'penaltis_b', 'started_at', 'ended_at', 'confirmed_at', 'created_at',
];
export const payloadPartida = (p) => Object.fromEntries(CAMPOS_PARTIDA.map((c) => [c, p[c] ?? null]));
export const payloadEscalacao = (e) => ({
  id: e.id, sessao_id: e.sessao_id, partida_id: e.partida_id, participante_id: e.participante_id, lado: e.lado, created_at: e.created_at,
});

/** Aplica o relógio (acumulado + retomado) no formato gravado na partida. */
function comRelogio(p, relogio) {
  return {
    ...p,
    relogio_acumulado_ms: Math.round(relogio.acumuladoMs),
    relogio_retomado_em: relogio.retomadoEm === null ? null : iso(relogio.retomadoEm),
  };
}

export function criarPartidasRepo({ store, aoGravar = () => {} }) {
  // Alterações de uma mesma partida são executadas uma de cada vez: um toque
  // duplo, ou o "tick" do cronômetro junto com o retorno do app, nunca
  // processam o mesmo evento (ex.: fim do tempo) duas vezes.
  const filas = new Map();
  const emSerie = (id, fn) => {
    const anterior = filas.get(id) ?? Promise.resolve();
    const atual = anterior.catch(() => {}).then(fn);
    filas.set(id, atual);
    atual.finally(() => { if (filas.get(id) === atual) filas.delete(id); }).catch(() => {});
    return atual;
  };
  const gravar = async (p) => {
    const atualizada = { ...p, updated_at: new Date().toISOString() };
    await store.transacao([STORES.PARTIDAS, STORES.OUTBOX], (h) => {
      h[STORES.PARTIDAS].put(atualizada);
      enfileirar(h[STORES.OUTBOX], { tabela: 'partidas', acao: 'upsert', registroId: p.id, dados: payloadPartida(atualizada) });
    });
    aoGravar();
    return atualizada;
  };

  const exigir = async (id, statusPermitidos, acao) => {
    const p = await store.obter(STORES.PARTIDAS, id);
    if (!p) throw new ErroDeNegocio('Partida não encontrada.');
    if (!statusPermitidos.includes(p.status)) {
      throw new ErroDeNegocio(`Não é possível ${acao}: a partida está ${p.status.replace('_', ' ')}.`);
    }
    return p;
  };

  const repo = {
    async listarPorSessao(sessaoId) {
      const lista = await store.listarPorIndice(STORES.PARTIDAS, 'sessao_id', sessaoId);
      return lista.sort((a, b) => a.numero - b.numero);
    },

    async obter(id) {
      return store.obter(STORES.PARTIDAS, id);
    },

    /** Partida não terminada da sessão (só pode existir uma por vez). */
    async ativa(sessaoId) {
      return (await repo.listarPorSessao(sessaoId)).find(partidaAtiva) ?? null;
    },

    /** Partida com nomes/cores das equipes e escalações. */
    async detalhar(id) {
      const p = await store.obter(STORES.PARTIDAS, id);
      if (!p) return null;
      const [equipes, escalacoes, participantes] = await Promise.all([
        store.listarPorIndice(STORES.EQUIPES, 'sessao_id', p.sessao_id),
        store.listarPorIndice(STORES.PARTIDA_ESCALACOES, 'sessao_id', p.sessao_id),
        store.listarPorIndice(STORES.PARTICIPANTES, 'sessao_id', p.sessao_id),
      ]);
      const equipe = (eid) => equipes.find((e) => e.id === eid) ?? { id: eid, nome: 'Equipe', cor: '#999999' };
      const nomes = new Map(participantes.map((x) => [x.id, x]));
      const daPartida = escalacoes.filter((e) => e.partida_id === id)
        .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
      const lado = (l) => daPartida.filter((e) => e.lado === l).map((e) => nomes.get(e.participante_id)).filter(Boolean);
      return { partida: p, equipeA: equipe(p.equipe_a_id), equipeB: equipe(p.equipe_b_id), jogadoresA: lado('A'), jogadoresB: lado('B') };
    },

    /**
     * Cria a partida com a configuração congelada e a escalação de cada lado
     * copiada da composição atual das equipes.
     */
    async criar(sessaoId, { equipeAId, equipeBId, config }) {
      const sessao = await store.obter(STORES.SESSOES, sessaoId);
      if (!sessao) throw new ErroDeNegocio('Sessão não encontrada.');
      if (!participantesEditaveis(sessao)) throw new ErroDeNegocio('A sessão está encerrada.');
      if (!equipeAId || !equipeBId) throw new ErroDeNegocio('Escolha as duas equipes.');
      if (equipeAId === equipeBId) throw new ErroDeNegocio('Escolha duas equipes diferentes.');
      const ativa = await repo.ativa(sessaoId);
      if (ativa) throw new ErroDeNegocio(`A partida nº ${ativa.numero} ainda não terminou. Encerre-a antes de começar outra.`, { partidaAtiva: ativa });

      const v = validarConfiguracao(config);
      if (!v.ok) throw new ErroDeNegocio('Configuração inválida.', { erros: v.erros });

      const [equipes, membros, anteriores] = await Promise.all([
        store.listarPorIndice(STORES.EQUIPES, 'sessao_id', sessaoId),
        store.listarPorIndice(STORES.EQUIPE_PARTICIPANTES, 'sessao_id', sessaoId),
        repo.listarPorSessao(sessaoId),
      ]);
      for (const eid of [equipeAId, equipeBId]) {
        if (!equipes.some((e) => e.id === eid)) throw new ErroDeNegocio('Equipe não encontrada nesta sessão.');
      }
      const agora = new Date().toISOString();
      const partida = {
        id: novoId(),
        sessao_id: sessaoId,
        numero: (anteriores.at(-1)?.numero ?? 0) + 1,
        equipe_a_id: equipeAId,
        equipe_b_id: equipeBId,
        status: STATUS_PARTIDA.CONFIGURADA,
        ...v.config,
        configuracao_extra: {},
        relogio_acumulado_ms: 0,
        relogio_retomado_em: null,
        penaltis_a: null,
        penaltis_b: null,
        started_at: null,
        ended_at: null,
        confirmed_at: null,
        created_at: agora,
        updated_at: agora,
      };
      const escalacoes = membros
        .filter((m) => m.equipe_id === equipeAId || m.equipe_id === equipeBId)
        .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
        .map((m) => ({
          id: novoId(), sessao_id: sessaoId, partida_id: partida.id, participante_id: m.participante_id,
          lado: m.equipe_id === equipeAId ? 'A' : 'B', created_at: m.created_at ?? agora,
        }));

      await store.transacao([STORES.PARTIDAS, STORES.PARTIDA_ESCALACOES, STORES.OUTBOX], (h) => {
        h[STORES.PARTIDAS].put(partida);
        escalacoes.forEach((e) => h[STORES.PARTIDA_ESCALACOES].put(e));
        enfileirar(h[STORES.OUTBOX], { tabela: 'partidas', acao: 'upsert', registroId: partida.id, dados: payloadPartida(partida) });
        if (escalacoes.length) {
          enfileirar(h[STORES.OUTBOX], { tabela: 'partida_escalacoes', acao: 'upsert', registroId: partida.id, dados: escalacoes.map(payloadEscalacao) });
        }
      });
      aoGravar();
      return partida;
    },

    iniciar(id, agora = Date.now()) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.CONFIGURADA], 'iniciar');
        const r = iniciarRelogio(relogioDaPartida(p), agora);
        return gravar({ ...comRelogio(p, r), status: STATUS_PARTIDA.EM_ANDAMENTO, started_at: iso(agora) });
      });
    },

    pausar(id, agora = Date.now()) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.EM_ANDAMENTO], 'pausar');
        return gravar({ ...comRelogio(p, pausarRelogio(relogioDaPartida(p), agora)), status: STATUS_PARTIDA.PAUSADA });
      });
    },

    retomar(id, agora = Date.now()) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.PAUSADA], 'retomar');
        return gravar({ ...comRelogio(p, iniciarRelogio(relogioDaPartida(p), agora)), status: STATUS_PARTIDA.EM_ANDAMENTO });
      });
    },

    adicionarAcrescimo(id, segundos) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.CONFIGURADA, STATUS_PARTIDA.EM_ANDAMENTO, STATUS_PARTIDA.PAUSADA], 'dar acréscimo');
        const novo = Math.max(0, Math.min(LIMITES.acrescimosMax, p.acrescimos_segundos + segundos));
        if (novo === p.acrescimos_segundos) return p;
        return gravar({ ...p, acrescimos_segundos: novo });
      });
    },

    /** Encerra manualmente (o organizador apita o fim). */
    finalizar(id, agora = Date.now()) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.EM_ANDAMENTO, STATUS_PARTIDA.PAUSADA], 'encerrar');
        const r = pausarRelogio(relogioDaPartida(p), agora);
        return gravar({ ...comRelogio(p, r), status: STATUS_PARTIDA.FINALIZADA, ended_at: iso(agora), configuracao_extra: { ...p.configuracao_extra, motivo_fim: 'manual' } });
      });
    },

    /**
     * Aplica o evento automático devido (fim do tempo, limite de gols, intervalo).
     * Idempotente: relê a partida e só age se ainda for necessário — chamar duas
     * vezes (ex.: tick + retorno do app) não encerra duas vezes.
     * @returns {Promise<{evento, partida}|null>}
     */
    aplicarEventoAutomatico(id, { agora = Date.now(), placarA = 0, placarB = 0 } = {}) {
      return emSerie(id, async () => {
        const p = await store.obter(STORES.PARTIDAS, id);
        if (!p) return null;
        const evento = avaliarEventoAutomatico(p, { agora, placarA, placarB });
        if (!evento) return null;
        if (evento.tipo === 'intervalo') {
          const partida = await gravar({ ...comRelogio(p, { acumuladoMs: evento.decorridoMs, retomadoEm: null }), status: STATUS_PARTIDA.PAUSADA });
          return { evento, partida };
        }
        const relogio = evento.motivo === 'tempo'
          ? { acumuladoMs: evento.decorridoMs, retomadoEm: null }
          : pausarRelogio(relogioDaPartida(p), agora);
        const partida = await gravar({
          ...comRelogio(p, relogio),
          status: STATUS_PARTIDA.FINALIZADA,
          ended_at: iso(evento.instante),
          configuracao_extra: { ...p.configuracao_extra, motivo_fim: evento.motivo },
      });
      return { evento, partida };
      });
    },

    /**
     * Cancela a partida. Se nunca começou, é simplesmente excluída;
     * se já começou, fica registrada como cancelada (não conta para nada).
     */
    cancelar(id, agora = Date.now()) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.CONFIGURADA, STATUS_PARTIDA.EM_ANDAMENTO, STATUS_PARTIDA.PAUSADA], 'cancelar');
        if (p.status === STATUS_PARTIDA.CONFIGURADA) {
          const escalacoes = (await store.listarPorIndice(STORES.PARTIDA_ESCALACOES, 'sessao_id', p.sessao_id))
            .filter((e) => e.partida_id === id);
          await store.transacao([STORES.PARTIDAS, STORES.PARTIDA_ESCALACOES, STORES.OUTBOX], (h) => {
            escalacoes.forEach((e) => h[STORES.PARTIDA_ESCALACOES].delete(e.id));
            h[STORES.PARTIDAS].delete(id);
            enfileirar(h[STORES.OUTBOX], { tabela: 'partidas', acao: 'delete', registroId: id });
          });
          aoGravar();
          return null;
        }
        const r = pausarRelogio(relogioDaPartida(p), agora);
        return gravar({ ...comRelogio(p, r), status: STATUS_PARTIDA.CANCELADA });
      });
    },

    /** Tempo decorrido atual (ms). */
    decorrido(p, agora = Date.now()) {
      return decorridoMs(relogioDaPartida(p), agora);
    },
  };
  return repo;
}
