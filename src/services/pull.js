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
  const [sessoes, participantes, sorteios, equipes, membros] = await Promise.all([
    buscarTodos(client, 'sessoes', 'id, data_referencia, status, encerrada_em, created_at, updated_at'),
    buscarTodos(client, 'participantes', 'id, sessao_id, nome, nota, created_at, updated_at'),
    buscarTodos(client, 'sorteios', 'id, sessao_id, numero, jogadores_por_equipe, qtd_equipes, confirmado_em, created_at'),
    buscarTodos(client, 'equipes', 'id, sessao_id, sorteio_id, nome, cor, ordem, created_at'),
    buscarTodos(client, 'equipe_participantes', 'id, sessao_id, sorteio_id, equipe_id, participante_id, created_at'),
  ]);
  const pendentes = await fila.registrosPendentes();
  let gravados = 0;
  const lotes = [
    [STORES.SESSOES, sessoes, (x) => x.id],
    [STORES.PARTICIPANTES, participantes.map((p) => ({ ...p, nota: p.nota === null ? null : Number(p.nota) })), (x) => x.id],
    // Sorteios e suas equipes são enviados juntos, identificados pelo id do sorteio.
    [STORES.SORTEIOS, sorteios, (x) => x.id],
    [STORES.EQUIPES, equipes, (x) => x.sorteio_id],
    [STORES.EQUIPE_PARTICIPANTES, membros, (x) => x.sorteio_id],
  ];
  await store.transacao(lotes.map(([nome]) => nome), (h) => {
    for (const [nome, linhas, chave] of lotes) {
      for (const linha of linhas) {
        if (!pendentes.has(chave(linha)) && !pendentes.has(linha.id)) { h[nome].put(linha); gravados++; }
      }
    }
  });
  return { sessoes: sessoes.length, participantes: participantes.length, sorteios: sorteios.length, gravados };
}
