import { STORES, enfileirar } from '../services/localStore.js';
import { novoId } from '../utils/ids.js';
import { ordenarSessoes, sessaoEmAndamento, verificarCriacaoSessao, STATUS_SESSAO } from '../domain/sessao.js';

/** Campos enviados ao servidor (o banco define owner_id e updated_at). */
export function payloadSessao(s) {
  return {
    id: s.id,
    data_referencia: s.data_referencia,
    status: s.status,
    encerrada_em: s.encerrada_em,
    created_at: s.created_at,
  };
}

export class ErroDeNegocio extends Error {
  constructor(mensagem, extras = {}) {
    super(mensagem);
    this.name = 'ErroDeNegocio';
    Object.assign(this, extras);
  }
}

export function criarSessoesRepo({ store, aoGravar = () => {} }) {
  const gravar = async (sessao) => {
    await store.transacao([STORES.SESSOES, STORES.OUTBOX], (h) => {
      h[STORES.SESSOES].put(sessao);
      enfileirar(h[STORES.OUTBOX], {
        tabela: 'sessoes', acao: 'upsert', registroId: sessao.id, dados: payloadSessao(sessao),
      });
    });
    aoGravar();
    return sessao;
  };

  const repo = {
    async listar() {
      return ordenarSessoes(await store.listar(STORES.SESSOES));
    },

    async obter(id) {
      return store.obter(STORES.SESSOES, id);
    },

    async emAndamento() {
      return sessaoEmAndamento(await store.listar(STORES.SESSOES));
    },

    async criar({ dataReferencia }) {
      const existentes = await store.listar(STORES.SESSOES);
      const v = verificarCriacaoSessao(existentes, dataReferencia);
      if (!v.ok) throw new ErroDeNegocio(v.erro, { sessaoAtiva: v.sessaoAtiva });
      const agora = new Date().toISOString();
      return gravar({
        id: novoId(),
        data_referencia: dataReferencia,
        status: STATUS_SESSAO.EM_ANDAMENTO,
        encerrada_em: null,
        created_at: agora,
        updated_at: agora,
      });
    },

    async encerrar(id) {
      const s = await repo.obter(id);
      if (!s) throw new ErroDeNegocio('Sessão não encontrada.');
      if (s.status === STATUS_SESSAO.ENCERRADA) return s;
      const agora = new Date().toISOString();
      return gravar({ ...s, status: STATUS_SESSAO.ENCERRADA, encerrada_em: agora, updated_at: agora });
    },

    async reabrir(id) {
      const s = await repo.obter(id);
      if (!s) throw new ErroDeNegocio('Sessão não encontrada.');
      if (s.status === STATUS_SESSAO.EM_ANDAMENTO) return s;
      const ativa = await repo.emAndamento();
      if (ativa) throw new ErroDeNegocio('Encerre a sessão em andamento antes de reabrir outra.');
      return gravar({ ...s, status: STATUS_SESSAO.EM_ANDAMENTO, encerrada_em: null, updated_at: new Date().toISOString() });
    },

    /** Exclui a sessão e tudo o que pertence a ela (no aparelho e no servidor). */
    async excluir(id) {
      const filhos = [STORES.PARTICIPANTES, STORES.SORTEIOS, STORES.EQUIPES, STORES.EQUIPE_PARTICIPANTES];
      const registros = await Promise.all(filhos.map((st) => store.listarPorIndice(st, 'sessao_id', id)));
      await store.transacao([STORES.SESSOES, ...filhos, STORES.OUTBOX], (h) => {
        filhos.forEach((st, i) => registros[i].forEach((r) => h[st].delete(r.id)));
        h[STORES.SESSOES].delete(id);
        enfileirar(h[STORES.OUTBOX], { tabela: 'sessoes', acao: 'delete', registroId: id });
      });
      aoGravar();
    },
  };
  return repo;
}
