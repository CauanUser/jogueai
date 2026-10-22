import { STORES, enfileirar } from '../services/localStore.js';
import { novoId } from '../utils/ids.js';
import { participantesEditaveis } from '../domain/sessao.js';
import { decorridoMs, iniciar as iniciarRelogio, pausar as pausarRelogio } from '../domain/cronometro.js';
import {
  STATUS_PARTIDA, LIMITES, validarConfiguracao, partidaAtiva, relogioDaPartida, avaliarEventoAutomatico,
} from '../domain/partida.js';
import { ErroDeNegocio } from './sessoesRepo.js';
import {
  TIPO_GOL, placar as calcularPlacar, validarGol, equipeDoLado, ladoDaEquipe, ordenarGols,
  precisaPenaltis, validarPenaltis, pendenciaParaConfirmar,
} from '../domain/gols.js';

const iso = (ms) => new Date(ms).toISOString();

const CAMPOS_PARTIDA = [
  'id', 'sessao_id', 'numero', 'equipe_a_id', 'equipe_b_id', 'status',
  'duracao_segundos', 'condicao_encerramento', 'limite_gols', 'acrescimos_segundos', 'intervalo_segundos',
  'desempate', 'configuracao_extra', 'relogio_acumulado_ms', 'relogio_retomado_em',
  'penaltis_a', 'penaltis_b', 'started_at', 'ended_at', 'confirmed_at', 'created_at',
];
export const payloadPartida = (p) => Object.fromEntries(CAMPOS_PARTIDA.map((c) => [c, p[c] ?? null]));
export const payloadGol = (g) => ({
  id: g.id, sessao_id: g.sessao_id, partida_id: g.partida_id, equipe_id: g.equipe_id,
  participante_id: g.participante_id ?? null, tipo: g.tipo, valor: g.valor ?? 1, set_numero: g.set_numero ?? 1, tempo_partida_segundos: g.tempo_partida_segundos,
  ocorrido_em: g.ocorrido_em, created_at: g.created_at,
});
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

  const golsDaPartida = async (p) => (await store.listarPorIndice(STORES.GOLS, 'sessao_id', p.sessao_id))
    .filter((g) => g.partida_id === p.id);
  const escalacoesDaPartida = async (p) => (await store.listarPorIndice(STORES.PARTIDA_ESCALACOES, 'sessao_id', p.sessao_id))
    .filter((e) => e.partida_id === p.id);

  /** Se o placar deixou de estar empatado, a disputa de pênaltis registrada perde o sentido. */
  const ajustarPenaltis = (p, pl) => (p.penaltis_a !== null && p.penaltis_a !== undefined && !precisaPenaltis(p, pl)
    ? gravar({ ...p, penaltis_a: null, penaltis_b: null })
    : p);

  /** Grava a partida encerrada por um evento automático. */
  const encerrarPorEvento = (p, evento, agora) => {
    const relogio = evento.motivo === 'tempo'
      ? { acumuladoMs: evento.decorridoMs, retomadoEm: null }
      : pausarRelogio(relogioDaPartida(p), agora);
    return gravar({
      ...comRelogio(p, relogio),
      status: STATUS_PARTIDA.FINALIZADA,
      ended_at: iso(evento.instante),
      configuracao_extra: { ...p.configuracao_extra, motivo_fim: evento.motivo },
    });
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
        configuracao_extra: { modalidade: config.modalidade ?? 'futebol', sets_a: 0, sets_b: 0, set_atual: 1 },
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
    aplicarEventoAutomatico(id, { agora = Date.now() } = {}) {
      return emSerie(id, async () => {
        const p = await store.obter(STORES.PARTIDAS, id);
        if (!p) return null;
        // O placar vem sempre dos gols gravados (nunca de um valor informado pela tela).
        const pl = calcularPlacar(p, await golsDaPartida(p));
        const evento = avaliarEventoAutomatico(p, { agora, placarA: pl.a, placarB: pl.b });
        if (!evento) return null;
        if (evento.tipo === 'intervalo') {
          const partida = await gravar({ ...comRelogio(p, { acumuladoMs: evento.decorridoMs, retomadoEm: null }), status: STATUS_PARTIDA.PAUSADA });
          return { evento, partida };
        }
        return { evento, partida: await encerrarPorEvento(p, evento, agora) };
      });
    },

    // ---- Gols ------------------------------------------------------------

    async gols(id) {
      const p = await store.obter(STORES.PARTIDAS, id);
      return p ? ordenarGols(await golsDaPartida(p)) : [];
    },

    async placar(id) {
      const p = await store.obter(STORES.PARTIDAS, id);
      return p ? calcularPlacar(p, await golsDaPartida(p)) : { a: 0, b: 0 };
    },

    /**
     * Registra um gol. `lado` é a equipe que ganha o gol no placar; em gol contra,
     * o autor é do time adversário. O minuto vem do cronômetro da partida.
     * Se o gol atingir o limite, a partida é encerrada na mesma operação.
     * @returns {Promise<{gol, partida, encerrou: boolean}>}
     */
    registrarGol(id, { lado, participanteId = null, tipo = TIPO_GOL.NORMAL, valor = 1 }, agora = Date.now()) {
      return emSerie(id, async () => {
        const p = await store.obter(STORES.PARTIDAS, id);
        if (!p) throw new ErroDeNegocio('Partida não encontrada.');
        const erro = validarGol(p, await escalacoesDaPartida(p), { lado, participanteId, tipo });
        if (erro) throw new ErroDeNegocio(erro);
        const momento = iso(agora);
        const gol = {
          id: novoId(),
          sessao_id: p.sessao_id,
          partida_id: p.id,
          equipe_id: equipeDoLado(p, lado),
          participante_id: participanteId || null,
          tipo,
          valor: Number(valor) || 1,
          tempo_partida_segundos: Math.min(86400, Math.floor(decorridoMs(relogioDaPartida(p), agora) / 1000)),
          ocorrido_em: momento,
          created_at: momento,
          updated_at: momento,
        };
        await store.transacao([STORES.GOLS, STORES.OUTBOX], (h) => {
          h[STORES.GOLS].put(gol);
          enfileirar(h[STORES.OUTBOX], { tabela: 'gols', acao: 'upsert', registroId: gol.id, dados: payloadGol(gol) });
        });
        aoGravar();
        let partida = p;
        let encerrou = false;
        const pl = calcularPlacar(p, await golsDaPartida(p));
        const evento = avaliarEventoAutomatico(p, { agora, placarA: pl.a, placarB: pl.b });
        if (evento?.tipo === 'encerrar') {
          partida = await encerrarPorEvento(p, evento, agora);
          encerrou = true;
        } else {
          partida = await ajustarPenaltis(p, pl);
        }
        return { gol, partida, encerrou, placar: pl };
      });
    },

    /** Corrige o autor e/ou o tipo de um gol (a equipe beneficiada e o minuto ficam). */
    editarGol(id, golId, { participanteId = null, tipo }) {
      return emSerie(id, async () => {
        const p = await store.obter(STORES.PARTIDAS, id);
        const g = await store.obter(STORES.GOLS, golId);
        if (!p || !g || g.partida_id !== id) throw new ErroDeNegocio('Gol não encontrado.');
        const lado = ladoDaEquipe(p, g.equipe_id);
        const erro = validarGol(p, await escalacoesDaPartida(p), { lado, participanteId, tipo: tipo ?? g.tipo });
        if (erro) throw new ErroDeNegocio(erro);
        const novo = { ...g, participante_id: participanteId || null, tipo: tipo ?? g.tipo, updated_at: new Date().toISOString() };
        await store.transacao([STORES.GOLS, STORES.OUTBOX], (h) => {
          h[STORES.GOLS].put(novo);
          enfileirar(h[STORES.OUTBOX], { tabela: 'gols', acao: 'upsert', registroId: g.id, dados: payloadGol(novo) });
        });
        aoGravar();
        return novo;
      });
    },

    /** Remove um gol lançado por engano. */
    removerGol(id, golId) {
      return emSerie(id, async () => {
        const p = await store.obter(STORES.PARTIDAS, id);
        const g = await store.obter(STORES.GOLS, golId);
        if (!p || !g || g.partida_id !== id) throw new ErroDeNegocio('Gol não encontrado.');
        const erro = validarGol(p, [], { lado: ladoDaEquipe(p, g.equipe_id) });
        if (erro) throw new ErroDeNegocio(erro);
        await store.transacao([STORES.GOLS, STORES.OUTBOX], (h) => {
          h[STORES.GOLS].delete(golId);
          enfileirar(h[STORES.OUTBOX], { tabela: 'gols', acao: 'delete', registroId: golId });
        });
        aoGravar();
        const pl = calcularPlacar(p, await golsDaPartida(p));
        await ajustarPenaltis(p, pl);
        return pl;
      });
    },

    // ---- Resultado -------------------------------------------------------

    /** Registra (ou limpa, com null) a disputa de pênaltis de uma partida empatada. */
    definirPenaltis(id, a, b) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.FINALIZADA], 'registrar pênaltis');
        if (a === null && b === null) return gravar({ ...p, penaltis_a: null, penaltis_b: null });
        const pl = calcularPlacar(p, await golsDaPartida(p));
        if (!precisaPenaltis(p, pl)) throw new ErroDeNegocio('Pênaltis só valem para partida empatada com desempate por pênaltis.');
        const erro = validarPenaltis(a, b);
        if (erro) throw new ErroDeNegocio(erro);
        return gravar({ ...p, penaltis_a: a, penaltis_b: b });
      });
    },

    /** Fecha o resultado. Depois disso os gols só mudam se a partida for reaberta. */
    confirmar(id, agora = Date.now()) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.FINALIZADA], 'confirmar');
        const pendencia = pendenciaParaConfirmar(p, calcularPlacar(p, await golsDaPartida(p)));
        if (pendencia) throw new ErroDeNegocio(pendencia);
        return gravar({ ...p, status: STATUS_PARTIDA.CONFIRMADA, confirmed_at: iso(agora) });
      });
    },

    /** Reabre um resultado confirmado para correção (volta a "encerrada"). */
    reabrir(id) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.CONFIRMADA], 'reabrir');
        return gravar({ ...p, status: STATUS_PARTIDA.FINALIZADA, confirmed_at: null });
      });
    },

    /**
     * Desfaz um encerramento (ex.: gol lançado por engano encerrou o jogo).
     * A partida volta pausada, com o tempo que tinha, e pode ser retomada.
     */
    voltarAoJogo(id) {
      return emSerie(id, async () => {
        const p = await exigir(id, [STATUS_PARTIDA.FINALIZADA], 'voltar ao jogo');
        const pl = calcularPlacar(p, await golsDaPartida(p));
        const limite = p.condicao_encerramento !== 'tempo' && p.limite_gols !== null;
        if (limite && (pl.a >= p.limite_gols || pl.b >= p.limite_gols)) {
          throw new ErroDeNegocio('O placar já atingiu o limite de gols. Corrija os gols antes de voltar ao jogo.');
        }
        const total = (p.duracao_segundos + p.acrescimos_segundos) * 1000;
        if (p.condicao_encerramento !== 'gols' && p.relogio_acumulado_ms >= total) {
          throw new ErroDeNegocio('O tempo da partida já acabou; não dá para voltar ao jogo.');
        }
        const { motivo_fim: _m, ...extra } = p.configuracao_extra ?? {};
        return gravar({ ...p, status: STATUS_PARTIDA.PAUSADA, ended_at: null, penaltis_a: null, penaltis_b: null, configuracao_extra: extra });
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
