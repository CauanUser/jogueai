import { describe, it, expect, vi } from 'vitest';
import { classificarErro, criarRemotoSupabase } from '../../src/services/remote.js';

function clienteFalso(resposta) {
  const chamadas = [];
  const q = {
    upsert: (d, o) => { chamadas.push(['upsert', d, o]); return q; },
    delete: () => { chamadas.push(['delete']); return q; },
    eq: (c, v) => { chamadas.push(['eq', c, v]); return q; },
    abortSignal: (s) => { q.sinal = s; return typeof resposta === 'function' ? resposta(s) : Promise.resolve(resposta); },
  };
  return { chamadas, from: (t) => { chamadas.push(['from', t]); return q; } };
}

describe('classificação de erros', () => {
  it('rede/timeout são transitórios', () => {
    expect(classificarErro({ message: 'TypeError: Failed to fetch' }, 0).transitorio).toBe(true);
    expect(classificarErro({ message: 'AbortError' }, 0).transitorio).toBe(true);
    expect(classificarErro({ message: 'x' }, 503).transitorio).toBe(true);
    expect(classificarErro({ message: 'x' }, 429).transitorio).toBe(true);
    expect(classificarErro({ code: 'PGRST301', message: 'JWT expired' }, 401).transitorio).toBe(true);
  });

  it('recusas do banco são permanentes com mensagem compreensível', () => {
    const r = classificarErro({ code: '23505', message: 'duplicate key' }, 409);
    expect(r).toMatchObject({ ok: false, transitorio: false });
    expect(r.mensagem).toMatch(/duplicado/);
    expect(classificarErro({ code: '42501', message: 'rls' }, 403).mensagem).toMatch(/permissão/);
  });
});

describe('adaptador Supabase', () => {
  it('upsert por id (idempotente)', async () => {
    const c = clienteFalso({ error: null, status: 201 });
    const r = await criarRemotoSupabase(c).executar({ tabela: 'participantes', acao: 'upsert', registroId: '1', dados: { id: '1' } });
    expect(r.ok).toBe(true);
    expect(c.chamadas).toContainEqual(['upsert', { id: '1' }, { onConflict: 'id' }]);
  });

  it('delete por id', async () => {
    const c = clienteFalso({ error: null, status: 204 });
    await criarRemotoSupabase(c).executar({ tabela: 'sessoes', acao: 'delete', registroId: 'abc' });
    expect(c.chamadas).toContainEqual(['eq', 'id', 'abc']);
  });

  it('recusa tabela não suportada', async () => {
    const r = await criarRemotoSupabase(clienteFalso({})).executar({ tabela: 'gols', acao: 'upsert' });
    expect(r).toMatchObject({ ok: false, transitorio: false });
  });

  it('aborta por timeout e trata como transitório', async () => {
    vi.useFakeTimers();
    const c = clienteFalso((sinal) => new Promise((_, rej) => {
      sinal.addEventListener('abort', () => rej(new Error('AbortError: timeout')));
    }));
    const p = criarRemotoSupabase(c, { timeoutMs: 1000 }).executar({ tabela: 'sessoes', acao: 'upsert', registroId: '1', dados: {} });
    vi.advanceTimersByTime(1001);
    const r = await p;
    vi.useRealTimers();
    expect(r).toMatchObject({ ok: false, transitorio: true });
  });
});
