// Baixa do servidor os dados do organizador (útil após reinstalar o app).
// Registros com operações pendentes no aparelho NÃO são sobrescritos.
import { STORES } from './localStore.js';

const PAGINA = 1000;

async function buscarTodos(client, tabela, colunas) {
  const linhas = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await client
      .from(tabela).select(colunas).order('created_at').order('id').range(de, de + PAGINA - 1);
    if (error) throw new Error(`Falha ao baixar ${tabela}: ${error.message}`);
    linhas.push(...data);
    if (data.length < PAGINA) return linhas;
  }
}

export async function baixarDoServidor({ client, store, fila }) {
  if (!client) throw new Error('Supabase não configurado.');
  const [sessoes, participantes] = await Promise.all([
    buscarTodos(client, 'sessoes', 'id, data_referencia, status, encerrada_em, created_at, updated_at'),
    buscarTodos(client, 'participantes', 'id, sessao_id, nome, nota, created_at, updated_at'),
  ]);
  const pendentes = await fila.registrosPendentes();
  let gravados = 0;
  await store.transacao([STORES.SESSOES, STORES.PARTICIPANTES], (h) => {
    for (const s of sessoes) {
      if (!pendentes.has(s.id)) { h[STORES.SESSOES].put(s); gravados++; }
    }
    for (const p of participantes) {
      if (!pendentes.has(p.id)) { h[STORES.PARTICIPANTES].put({ ...p, nota: Number(p.nota) }); gravados++; }
    }
  });
  return { sessoes: sessoes.length, participantes: participantes.length, gravados };
}
