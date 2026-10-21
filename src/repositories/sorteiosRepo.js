import { STORES, enfileirar } from '../services/localStore.js';
import { novoId } from '../utils/ids.js';
import { agoraMonotonicoISO } from '../utils/datas.js';
import { participantesEditaveis } from '../domain/sessao.js';
import { ErroDeNegocio } from './sessoesRepo.js';

export const payloadSorteio = (s) => ({
  id: s.id, sessao_id: s.sessao_id, numero: s.numero, jogadores_por_equipe: s.jogadores_por_equipe,
  qtd_equipes: s.qtd_equipes, confirmado_em: s.confirmado_em, created_at: s.created_at,
});
export const payloadEquipe = (e) => ({
  id: e.id, sessao_id: e.sessao_id, sorteio_id: e.sorteio_id, nome: e.nome, cor: e.cor, ordem: e.ordem, created_at: e.created_at,
});
export const payloadMembro = (m) => ({
  id: m.id, sessao_id: m.sessao_id, sorteio_id: m.sorteio_id, equipe_id: m.equipe_id,
  participante_id: m.participante_id, created_at: m.created_at,
});

export function criarSorteiosRepo({ store, aoGravar = () => {} }) {
  const repo = {
    async listarPorSessao(sessaoId) {
      const lista = await store.listarPorIndice(STORES.SORTEIOS, 'sessao_id', sessaoId);
      return lista.sort((a, b) => a.numero - b.numero);
    },

    /** IDs de participantes que já estão em alguma equipe confirmada da sessão. */
    async participantesEmEquipes(sessaoId) {
      const membros = await store.listarPorIndice(STORES.EQUIPE_PARTICIPANTES, 'sessao_id', sessaoId);
      return new Set(membros.map((m) => m.participante_id));
    },

    /**
     * Sorteio mais recente da sessão com suas equipes e a fila de espera
     * (participantes da sessão que não estão em nenhuma equipe desse sorteio).
     */
    async atual(sessaoId) {
      const sorteios = await repo.listarPorSessao(sessaoId);
      const sorteio = sorteios.at(-1);
      if (!sorteio) return null;
      return repo.detalhar(sorteio);
    },

    async detalhar(sorteio) {
      const [equipes, membros, participantes] = await Promise.all([
        store.listarPorIndice(STORES.EQUIPES, 'sessao_id', sorteio.sessao_id),
        store.listarPorIndice(STORES.EQUIPE_PARTICIPANTES, 'sessao_id', sorteio.sessao_id),
        store.listarPorIndice(STORES.PARTICIPANTES, 'sessao_id', sorteio.sessao_id),
      ]);
      const porId = new Map(participantes.map((p) => [p.id, p]));
      const doSorteio = membros.filter((m) => m.sorteio_id === sorteio.id);
      const emEquipe = new Set(doSorteio.map((m) => m.participante_id));
      const lista = equipes
        .filter((e) => e.sorteio_id === sorteio.id)
        .sort((a, b) => a.ordem - b.ordem)
        .map((e) => {
          const jogadores = doSorteio
            .filter((m) => m.equipe_id === e.id)
            .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
            .map((m) => porId.get(m.participante_id))
            .filter(Boolean);
          return { ...e, jogadores, soma: jogadores.reduce((s, p) => s + Number(p.nota), 0) };
        });
      const aguardando = participantes
        .filter((p) => !emEquipe.has(p.id))
        .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
      return { sorteio, equipes: lista, aguardando };
    },

    /** Aplica uma troca manual do rodízio na composição atual, sem refazer o sorteio. */
    async aplicarRodizio(sessaoId, { equipePerdedoraId, saiId, entraId }) {
      const atual = await repo.atual(sessaoId);
      if (!atual) throw new ErroDeNegocio('Não há times confirmados nesta sessão.');
      const { sorteio, equipes, aguardando } = atual;
      const perdedora = equipes.find((e) => e.id === equipePerdedoraId);
      if (!perdedora) throw new ErroDeNegocio('Equipe perdedora não encontrada.');
      if (!saiId || !entraId || saiId === entraId) throw new ErroDeNegocio('Selecione quem sai e quem entra.');
      if (!perdedora.jogadores.some((p) => p.id === saiId)) throw new ErroDeNegocio('O jogador que sai precisa estar na equipe perdedora.');
      if (!aguardando.some((p) => p.id === entraId)) throw new ErroDeNegocio('O jogador que entra precisa estar na fila de espera.');
      const membros = await store.listarPorIndice(STORES.EQUIPE_PARTICIPANTES, 'sessao_id', sessaoId);
      const membroSai = membros.find((m) => m.sorteio_id === sorteio.id && m.equipe_id === equipePerdedoraId && m.participante_id === saiId);
      if (!membroSai) throw new ErroDeNegocio('Não foi possível localizar o vínculo do jogador que sai.');
      const agora = agoraMonotonicoISO();
      const membroEntra = {
        id: novoId(), sessao_id: sessaoId, sorteio_id: sorteio.id,
        equipe_id: equipePerdedoraId, participante_id: entraId, created_at: agora,
      };
      await store.transacao([STORES.EQUIPE_PARTICIPANTES, STORES.OUTBOX], (h) => {
        h[STORES.EQUIPE_PARTICIPANTES].delete(membroSai.id);
        h[STORES.EQUIPE_PARTICIPANTES].put(membroEntra);
        enfileirar(h[STORES.OUTBOX], { tabela: 'equipe_participantes', acao: 'delete', registroId: membroSai.id });
        enfileirar(h[STORES.OUTBOX], { tabela: 'equipe_participantes', acao: 'upsert', registroId: membroEntra.id, dados: payloadMembro(membroEntra) });
      });
      aoGravar();
      return repo.detalhar(sorteio);
    },

    /**
     * Confirma o resultado de um sorteio: grava sorteio, equipes e composição
     * de uma vez (no aparelho) e enfileira o envio na ordem certa.
     * @param {string} sessaoId
     * @param {{equipes: Array<{nome, cor, participantes: string[]}>, jogadoresPorEquipe, qtdEquipes}} resultado
     */
    async confirmar(sessaoId, resultado) {
      const sessao = await store.obter(STORES.SESSOES, sessaoId);
      if (!sessao) throw new ErroDeNegocio('Sessão não encontrada.');
      if (!participantesEditaveis(sessao)) throw new ErroDeNegocio('A sessão está encerrada.');

      const participantes = await store.listarPorIndice(STORES.PARTICIPANTES, 'sessao_id', sessaoId);
      const validos = new Set(participantes.map((p) => p.id));
      const todos = resultado.equipes.flatMap((e) => e.participantes);
      if (todos.length === 0 || resultado.equipes.length < 2) throw new ErroDeNegocio('O sorteio precisa ter ao menos duas equipes.');
      if (new Set(todos).size !== todos.length) throw new ErroDeNegocio('Um participante aparece em duas equipes.');
      const ausente = todos.find((id) => !validos.has(id));
      if (ausente) throw new ErroDeNegocio('A lista de participantes mudou desde o sorteio. Sorteie novamente.');

      const anteriores = await repo.listarPorSessao(sessaoId);
      const agora = new Date().toISOString();
      const sorteio = {
        id: novoId(),
        sessao_id: sessaoId,
        numero: (anteriores.at(-1)?.numero ?? 0) + 1,
        jogadores_por_equipe: resultado.jogadoresPorEquipe,
        qtd_equipes: resultado.equipes.length,
        confirmado_em: agora,
        created_at: agora,
      };
      const equipes = resultado.equipes.map((e, i) => ({
        id: novoId(), sessao_id: sessaoId, sorteio_id: sorteio.id,
        nome: e.nome, cor: e.cor, ordem: i + 1, created_at: agora,
      }));
      const membros = resultado.equipes.flatMap((e, i) => e.participantes.map((pid) => ({
        id: novoId(), sessao_id: sessaoId, sorteio_id: sorteio.id, equipe_id: equipes[i].id,
        participante_id: pid, created_at: agoraMonotonicoISO(),
      })));

      await store.transacao(
        [STORES.SORTEIOS, STORES.EQUIPES, STORES.EQUIPE_PARTICIPANTES, STORES.OUTBOX],
        (h) => {
          h[STORES.SORTEIOS].put(sorteio);
          equipes.forEach((e) => h[STORES.EQUIPES].put(e));
          membros.forEach((m) => h[STORES.EQUIPE_PARTICIPANTES].put(m));
          const o = h[STORES.OUTBOX];
          enfileirar(o, { tabela: 'sorteios', acao: 'upsert', registroId: sorteio.id, dados: payloadSorteio(sorteio) });
          enfileirar(o, { tabela: 'equipes', acao: 'upsert', registroId: sorteio.id, dados: equipes.map(payloadEquipe) });
          enfileirar(o, { tabela: 'equipe_participantes', acao: 'upsert', registroId: sorteio.id, dados: membros.map(payloadMembro) });
        },
      );
      aoGravar();
      return repo.detalhar(sorteio);
    },
  };
  return repo;
}
