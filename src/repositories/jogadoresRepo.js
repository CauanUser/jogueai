import { STORES } from '../services/localStore.js';
import { novoId } from '../utils/ids.js';
import { normalizarNome, chaveNome, validarNome, validarNota } from '../domain/validacao.js';

export function criarJogadoresRepo({ store }) {
  async function listar() {
    return (await store.listar(STORES.JOGADORES))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  return {
    listar,
    async adicionar({ nome, nota }) {
      nome = normalizarNome(nome);
      const erroNome = validarNome(nome);
      const erroNota = validarNota(nota);
      const existentes = await listar();
      if (erroNome || erroNota) throw new Error(erroNome || erroNota);
      if (existentes.some((p) => chaveNome(p.nome) === chaveNome(nome))) {
        throw new Error('Esse jogador já está cadastrado no banco.');
      }
      const jogador = { id: novoId(), nome, nota: Number(nota), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await store.transacao([STORES.JOGADORES], (h) => h[STORES.JOGADORES].add(jogador));
      return jogador;
    },
    async atualizar(id, dados) {
      const atual = await store.obter(STORES.JOGADORES, id);
      if (!atual) throw new Error('Jogador não encontrado.');
      const nome = normalizarNome(dados.nome ?? atual.nome);
      const nota = dados.nota === undefined ? atual.nota : Number(dados.nota);
      const erroNome = validarNome(nome);
      const erroNota = validarNota(nota);
      const existentes = await listar();
      if (erroNome || erroNota) throw new Error(erroNome || erroNota);
      if (existentes.some((p) => p.id !== id && chaveNome(p.nome) === chaveNome(nome))) {
        throw new Error('Já existe um jogador com esse nome.');
      }
      const atualizado = { ...atual, nome, nota, updated_at: new Date().toISOString() };
      await store.transacao([STORES.JOGADORES], (h) => h[STORES.JOGADORES].put(atualizado));
      return atualizado;
    },
    async remover(id) {
      await store.transacao([STORES.JOGADORES], (h) => h[STORES.JOGADORES].delete(id));
    },
  };
}
