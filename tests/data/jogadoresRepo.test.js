import { describe, it, expect, beforeEach } from 'vitest';
import { bancoDeTeste } from '../helpers.js';
import { criarJogadoresRepo } from '../../src/repositories/jogadoresRepo.js';
import { STORES } from '../../src/services/localStore.js';

let store, jogadores;
beforeEach(async () => {
  store = await bancoDeTeste();
  jogadores = criarJogadoresRepo({ store });
});

describe('banco permanente de jogadores', () => {
  it('cadastra jogador com nome normalizado e nível salvo', async () => {
    const p = await jogadores.adicionar({ nome: '  Ana   Paula ', nota: 8 });
    expect(p).toMatchObject({ nome: 'Ana Paula', nota: 8 });
    expect(await store.listar(STORES.JOGADORES)).toHaveLength(1);
  });

  it('não permite nomes repetidos ignorando maiúsculas', async () => {
    await jogadores.adicionar({ nome: 'Cauan', nota: 7 });
    await expect(jogadores.adicionar({ nome: 'CAUAN', nota: 5 })).rejects.toThrow(/já está cadastrado/i);
  });

  it('permite alterar manualmente o nível e o nome', async () => {
    const p = await jogadores.adicionar({ nome: 'Michel', nota: 6 });
    const atualizado = await jogadores.atualizar(p.id, { nome: 'Michel Silva', nota: 9 });
    expect(atualizado).toMatchObject({ nome: 'Michel Silva', nota: 9 });
  });

  it('remove do banco sem tocar nas sessões', async () => {
    const p = await jogadores.adicionar({ nome: 'Lucas', nota: 5 });
    await jogadores.remover(p.id);
    expect(await jogadores.listar()).toHaveLength(0);
  });

  it('ordena os jogadores alfabeticamente', async () => {
    await jogadores.adicionar({ nome: 'Michel', nota: 5 });
    await jogadores.adicionar({ nome: 'Alisson', nota: 8 });
    expect((await jogadores.listar()).map((p) => p.nome)).toEqual(['Alisson', 'Michel']);
  });
});
