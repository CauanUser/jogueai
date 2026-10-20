import { describe, it, expect, vi } from 'vitest';
import { bancoDeTeste } from '../helpers.js';
import { criarAuth } from '../../src/services/auth.js';

function clienteAuth(usuarios) {
  let sessao = null;
  return {
    auth: {
      getSession: async () => ({ data: { session: sessao } }),
      onAuthStateChange: vi.fn(),
      signInWithPassword: async ({ email, password }) => {
        const u = usuarios[email];
        if (!u || u.senha !== password) return { data: {}, error: { message: 'Invalid login credentials' } };
        sessao = { user: { id: u.id, email } };
        return { data: { user: sessao.user }, error: null };
      },
      signOut: vi.fn(async () => { sessao = null; return { error: null }; }),
    },
  };
}

const USUARIOS = { 'a@x.com': { id: 'u1', senha: '123' }, 'b@x.com': { id: 'u2', senha: '456' } };

describe('autenticação do organizador', () => {
  it('vincula o aparelho à primeira conta e libera a sincronização', async () => {
    const store = await bancoDeTeste();
    const auth = criarAuth({ client: clienteAuth(USUARIOS), store });
    await auth.iniciar();
    expect(auth.vinculado()).toBe(false);
    await auth.entrar('a@x.com', '123');
    expect(auth.vinculado()).toBe(true);
    expect(await store.obterMeta('dono_id')).toBe('u1');
  });

  it('mensagem clara para senha errada', async () => {
    const store = await bancoDeTeste();
    const auth = criarAuth({ client: clienteAuth(USUARIOS), store });
    await auth.iniciar();
    await expect(auth.entrar('a@x.com', 'errada')).rejects.toThrow('E-mail ou senha incorretos.');
  });

  it('recusa outra conta em aparelho já vinculado', async () => {
    const store = await bancoDeTeste();
    await store.definirMeta('dono_id', 'u1');
    const client = clienteAuth(USUARIOS);
    const auth = criarAuth({ client, store });
    await auth.iniciar();
    await expect(auth.entrar('b@x.com', '456')).rejects.toThrow(/outra conta/);
    expect(client.auth.signOut).toHaveBeenCalled();
    expect(auth.vinculado()).toBe(false);
  });

  it('sem Supabase configurado, informa claramente', async () => {
    const store = await bancoDeTeste();
    const auth = criarAuth({ client: null, store });
    await auth.iniciar();
    await expect(auth.entrar('a@x.com', '1')).rejects.toThrow(/não configurado/);
  });
});
