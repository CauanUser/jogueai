// Adaptador que envia operações da fila ao Supabase, com timeout.

const TABELAS_PERMITIDAS = new Set(['sessoes', 'participantes']);

const MENSAGENS_PG = {
  '23505': 'O servidor recusou um registro duplicado (por exemplo, nome repetido na sessão).',
  '23514': 'O servidor recusou os dados por violarem uma regra',
  '23503': 'O servidor não encontrou um registro relacionado (ex.: a sessão ainda não existe lá).',
  '42501': 'Sem permissão no servidor. Verifique se a conta conectada é a do organizador.',
  '22P02': 'O servidor recusou um valor em formato inválido.',
};

function ehFalhaDeRede(error) {
  const m = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
  return m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed') ||
    m.includes('abort') || m.includes('timeout') || m.includes('load failed') || m.includes('fetch failed');
}

/** Classifica um erro do PostgREST/Supabase em transitório ou permanente. */
export function classificarErro(error, status) {
  if (!status || status === 0 || ehFalhaDeRede(error)) {
    return { ok: false, transitorio: true, mensagem: 'Sem conexão com o servidor. Os dados estão salvos no aparelho e serão enviados depois.' };
  }
  if (status >= 500 || status === 408 || status === 429) {
    return { ok: false, transitorio: true, mensagem: `Servidor indisponível no momento (HTTP ${status}). Nova tentativa em breve.` };
  }
  if (status === 401 || error?.code === 'PGRST301' || error?.code === 'PGRST303') {
    return { ok: false, transitorio: true, mensagem: 'Login expirado ou ausente. Entre novamente em Configurações.' };
  }
  const base = MENSAGENS_PG[error?.code];
  const detalhe = error?.message ? ` Detalhe: ${error.message}` : '';
  return {
    ok: false,
    transitorio: false,
    mensagem: base ? `${base}.${detalhe}`.replace('..', '.') : `O servidor recusou a operação (HTTP ${status}).${detalhe}`,
  };
}

export function criarRemotoSupabase(client, { timeoutMs = 15000 } = {}) {
  return {
    async executar(op) {
      if (!TABELAS_PERMITIDAS.has(op.tabela)) {
        return { ok: false, transitorio: false, mensagem: `Tabela não suportada: ${op.tabela}` };
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        let q;
        if (op.acao === 'upsert') {
          q = client.from(op.tabela).upsert(op.dados, { onConflict: 'id' });
        } else if (op.acao === 'delete') {
          q = client.from(op.tabela).delete().eq('id', op.registroId);
        } else {
          return { ok: false, transitorio: false, mensagem: `Ação desconhecida: ${op.acao}` };
        }
        const { error, status } = await q.abortSignal(ctrl.signal);
        if (!error) return { ok: true };
        return classificarErro(error, status);
      } catch (e) {
        return classificarErro(e, 0);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
