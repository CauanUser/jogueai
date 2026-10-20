import { describe, it, expect } from 'vitest';
import { bancoDeTeste } from '../helpers.js';
import { STORES } from '../../src/services/localStore.js';
import { FilaSincronizacao } from '../../src/services/syncQueue.js';
import { baixarDoServidor } from '../../src/services/pull.js';
import { criarSessoesRepo } from '../../src/repositories/sessoesRepo.js';
import { descreverEstadoSync } from '../../src/components/indicadorSync.js';

function clienteComDados(tabelas) {
  return {
    from(t) {
      const q = { select: () => q, order: () => q, range: async (de, ate) => ({ data: (tabelas[t] ?? []).slice(de, ate + 1), error: null }) };
      return q;
    },
  };
}

describe('baixar dados do servidor', () => {
  it('recupera dados e não sobrescreve alterações locais pendentes', async () => {
    const store = await bancoDeTeste();
    const sessoes = criarSessoesRepo({ store });
    const local = await sessoes.criar({ dataReferencia: '2026-10-18' });
    const fila = new FilaSincronizacao({ store, remoto: null, podeSincronizar: () => 'off' });
    const client = clienteComDados({
      sessoes: [
        { id: local.id, data_referencia: '1999-01-01', status: 'encerrada', encerrada_em: 'x', created_at: 'a' },
        { id: 'antiga', data_referencia: '2026-10-11', status: 'encerrada', encerrada_em: 'x', created_at: 'a' },
      ],
      participantes: [{ id: 'p1', sessao_id: 'antiga', nome: 'Ana', nota: '8', created_at: 'a' }],
    });
    const r = await baixarDoServidor({ client, store, fila });
    expect(r).toMatchObject({ sessoes: 2, participantes: 1, gravados: 2 });
    expect((await sessoes.obter(local.id)).data_referencia).toBe('2026-10-18');
    expect(await sessoes.obter('antiga')).toBeTruthy();
    expect((await store.obter(STORES.PARTICIPANTES, 'p1')).nota).toBe(8);
  });

  it('pagina resultados grandes', async () => {
    const store = await bancoDeTeste();
    const fila = new FilaSincronizacao({ store, remoto: null, podeSincronizar: () => 'off' });
    const muitos = Array.from({ length: 2300 }, (_, i) => ({ id: `p${i}`, sessao_id: 's', nome: `J${i}`, nota: 5, created_at: 'a' }));
    const r = await baixarDoServidor({ client: clienteComDados({ sessoes: [], participantes: muitos }), store, fila });
    expect(r.participantes).toBe(2300);
  });
});

describe('indicador de sincronização', () => {
  const base = { pendentes: 0, erro: null, bloqueio: null, sincronizando: false, falhaTransitoria: null };
  it.each([
    [{ ...base }, false, 'Só no aparelho'],
    [{ ...base, erro: {} }, true, 'Erro ao sincronizar'],
    [{ ...base, pendentes: 2, falhaTransitoria: { mensagem: 'x' } }, true, 'Sem conexão · 2 pendente(s)'],
    [{ ...base, pendentes: 1 }, true, '1 pendente(s)'],
    [{ ...base }, true, 'Sincronizado'],
  ])('%o configurado=%s → %s', (estado, configurado, texto) => {
    expect(descreverEstadoSync(estado, { configurado }).texto).toBe(texto);
  });
});
