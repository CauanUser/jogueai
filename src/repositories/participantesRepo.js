import { STORES, enfileirar } from '../services/localStore.js';
import { novoId } from '../utils/ids.js';
import { agoraMonotonicoISO } from '../utils/datas.js';
import { validarParticipante } from '../domain/validacao.js';
import { participantesEditaveis } from '../domain/sessao.js';
import { ErroDeNegocio } from './sessoesRepo.js';

export function payloadParticipante(p) {
  return { id: p.id, sessao_id: p.sessao_id, nome: p.nome, nota: p.nota, created_at: p.created_at };
}

const porChegada = (a, b) =>
  (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id);

export function criarParticipantesRepo({ store, aoGravar = () => {} }) {
  const exigirSessaoEditavel = async (sessaoId) => {
    const sessao = await store.obter(STORES.SESSOES, sessaoId);
    if (!sessao) throw new ErroDeNegocio('Sessão não encontrada.');
    if (!participantesEditaveis(sessao)) {
      throw new ErroDeNegocio('Esta sessão está encerrada; os participantes não podem ser alterados.');
    }
    return sessao;
  };

  const gravar = async (p) => {
    await store.transacao([STORES.PARTICIPANTES, STORES.OUTBOX], (h) => {
      h[STORES.PARTICIPANTES].put(p);
      enfileirar(h[STORES.OUTBOX], {
        tabela: 'participantes', acao: 'upsert', registroId: p.id, dados: payloadParticipante(p),
      });
    });
    aoGravar();
    return p;
  };

  const repo = {
    /** Participantes da sessão em ordem de chegada (ordem de cadastro). */
    async listarPorSessao(sessaoId) {
      const lista = await store.listarPorIndice(STORES.PARTICIPANTES, 'sessao_id', sessaoId);
      return lista.sort(porChegada);
    },

    async adicionar(sessaoId, dados) {
      await exigirSessaoEditavel(sessaoId);
      const existentes = await repo.listarPorSessao(sessaoId);
      const v = validarParticipante(dados, existentes);
      if (!v.ok) throw new ErroDeNegocio('Dados inválidos.', { erros: v.erros });
      const agora = agoraMonotonicoISO();
      return gravar({ id: novoId(), sessao_id: sessaoId, ...v.valor, created_at: agora, updated_at: agora });
    },

    async editar(id, dados) {
      const atual = await store.obter(STORES.PARTICIPANTES, id);
      if (!atual) throw new ErroDeNegocio('Participante não encontrado.');
      await exigirSessaoEditavel(atual.sessao_id);
      const existentes = await repo.listarPorSessao(atual.sessao_id);
      const v = validarParticipante(dados, existentes, id);
      if (!v.ok) throw new ErroDeNegocio('Dados inválidos.', { erros: v.erros });
      return gravar({ ...atual, ...v.valor, updated_at: new Date().toISOString() });
    },

    async remover(id) {
      const atual = await store.obter(STORES.PARTICIPANTES, id);
      if (!atual) return;
      await exigirSessaoEditavel(atual.sessao_id);
      await store.transacao([STORES.PARTICIPANTES, STORES.OUTBOX], (h) => {
        h[STORES.PARTICIPANTES].delete(id);
        enfileirar(h[STORES.OUTBOX], { tabela: 'participantes', acao: 'delete', registroId: id });
      });
      aoGravar();
    },
  };
  return repo;
}
