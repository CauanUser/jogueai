import { STORES, enfileirar } from '../services/localStore.js';
import { novoId } from '../utils/ids.js';
import { ErroDeNegocio } from './sessoesRepo.js';
import { vencedor } from '../domain/gols.js';
import { validarSubstituicao } from '../domain/rodizio.js';
import { payloadMembro } from './sorteiosRepo.js';

const isoAgora = () => new Date().toISOString();
const payloadEvento = (e) => ({
  id: e.id, sessao_id: e.sessao_id, partida_id: e.partida_id, sorteio_id: e.sorteio_id,
  equipe_id: e.equipe_id ?? null, participante_saiu_id: e.participante_saiu_id ?? null,
  participante_entrou_id: e.participante_entrou_id ?? null, tipo: e.tipo,
  formacao_antes: e.formacao_antes ?? null, formacao_depois: e.formacao_depois ?? null, created_at: e.created_at,
});

export function criarRodizioRepo({ store, sorteios, partidas, aoGravar = () => {} }) {
  async function eventosDaSessao(sessaoId) {
    return (await store.listarPorIndice(STORES.RODIZIO, 'sessao_id', sessaoId))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  async function estado(sessaoId, partidaId) {
    const partida = await partidas.obter(partidaId);
    if (!partida || partida.sessao_id !== sessaoId) throw new ErroDeNegocio('Partida não encontrada nesta sessão.');
    if (partida.status !== 'confirmada') throw new ErroDeNegocio('Confirme o resultado da partida antes de organizar o rodízio.');
    const pl = await partidas.placar(partidaId);
    const ladoVencedor = vencedor(partida, pl);
    if (ladoVencedor === 'empate') {
      throw new ErroDeNegocio('A partida terminou empatada. Registre uma disputa de pênaltis com vencedor antes do rodízio.');
    }
    const atual = await sorteios.atual(sessaoId);
    if (!atual) throw new ErroDeNegocio('Não há times confirmados nesta sessão.');
    const idVencedor = ladoVencedor === 'A' ? partida.equipe_a_id : partida.equipe_b_id;
    const idPerdedor = ladoVencedor === 'A' ? partida.equipe_b_id : partida.equipe_a_id;
    const equipeVencedora = atual.equipes.find((e) => e.id === idVencedor);
    const equipePerdedora = atual.equipes.find((e) => e.id === idPerdedor);
    if (!equipeVencedora || !equipePerdedora) {
      throw new ErroDeNegocio('As equipes desta partida não pertencem ao sorteio atual. Verifique se houve um novo sorteio.');
    }
    const participantes = await store.listarPorIndice(STORES.PARTICIPANTES, 'sessao_id', sessaoId);
    const ativos = new Set([...equipeVencedora.jogadores, ...equipePerdedora.jogadores].map((p) => p.id));
    const aguardando = participantes
      .filter((p) => !ativos.has(p.id))
      .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
    const eventos = await eventosDaSessao(sessaoId);
    const eventosPartida = eventos.filter((e) => e.partida_id === partidaId);
    const encerradoSemTroca = eventosPartida.some((e) => ['sem_substituicao', 'encerrado'].includes(e.tipo));
    return { partida, placar: pl, ladoVencedor, equipeVencedora, equipePerdedora, atual: { ...atual, aguardando }, eventos: eventosPartida, encerradoSemTroca };
  }

  return {
    estado,
    async historico(sessaoId) { return eventosDaSessao(sessaoId); },

    async substituir(sessaoId, partidaId, { participanteSaiId, participanteEntraId }) {
      const st = await estado(sessaoId, partidaId);
      if (st.encerradoSemTroca) throw new ErroDeNegocio('O rodízio desta partida já foi encerrado sem substituições.');
      const erro = validarSubstituicao({
        equipePerdedora: st.equipePerdedora,
        aguardando: st.atual.aguardando,
        participanteSaiId,
        participanteEntraId,
      });
      if (erro) throw new ErroDeNegocio(erro);

      const membros = await store.listarPorIndice(STORES.EQUIPE_PARTICIPANTES, 'sessao_id', sessaoId);
      const membroSai = membros.find((m) => m.sorteio_id === st.atual.sorteio.id && m.participante_id === participanteSaiId);
      const membroEntra = membros.find((m) => m.sorteio_id === st.atual.sorteio.id && m.participante_id === participanteEntraId);
      if (!membroSai || membroSai.equipe_id !== st.equipePerdedora.id || (membroEntra && membroEntra.equipe_id === st.equipePerdedora.id)) {
        throw new ErroDeNegocio('A formação mudou. Atualize a tela antes de confirmar a substituição.');
      }
      const agora = isoAgora();
      const novoMembro = {
        id: novoId(), sessao_id: sessaoId, sorteio_id: st.atual.sorteio.id,
        equipe_id: st.equipePerdedora.id, participante_id: participanteEntraId, created_at: agora,
      };
      const evento = {
        id: novoId(), sessao_id: sessaoId, partida_id: partidaId, sorteio_id: st.atual.sorteio.id,
        equipe_id: st.equipePerdedora.id, participante_saiu_id: participanteSaiId,
        participante_entrou_id: participanteEntraId, tipo: 'substituicao',
        formacao_antes: {
          vencedora: st.equipeVencedora.jogadores.map((p) => p.id),
          perdedora: st.equipePerdedora.jogadores.map((p) => p.id),
        },
        formacao_depois: {
          vencedora: st.equipeVencedora.jogadores.map((p) => p.id),
          perdedora: st.equipePerdedora.jogadores.map((p) => p.id === participanteSaiId ? participanteEntraId : p.id),
        },
        created_at: agora,
      };
      await store.transacao([STORES.EQUIPE_PARTICIPANTES, STORES.OUTBOX, STORES.RODIZIO], (h) => {
        h[STORES.EQUIPE_PARTICIPANTES].delete(membroSai.id);
        if (membroEntra) h[STORES.EQUIPE_PARTICIPANTES].delete(membroEntra.id);
        h[STORES.EQUIPE_PARTICIPANTES].put(novoMembro);
        h[STORES.RODIZIO].put(evento);
        enfileirar(h[STORES.OUTBOX], { tabela: 'equipe_participantes', acao: 'delete', registroId: membroSai.id });
        if (membroEntra) enfileirar(h[STORES.OUTBOX], { tabela: 'equipe_participantes', acao: 'delete', registroId: membroEntra.id });
        enfileirar(h[STORES.OUTBOX], { tabela: 'equipe_participantes', acao: 'upsert', registroId: novoMembro.id, dados: payloadMembro(novoMembro) });
        enfileirar(h[STORES.OUTBOX], { tabela: 'rodizio_eventos', acao: 'upsert', registroId: evento.id, dados: payloadEvento(evento) });
      });
      aoGravar();
      return evento;
    },

    async continuarSemSubstituicao(sessaoId, partidaId) {
      const st = await estado(sessaoId, partidaId);
      if (st.encerradoSemTroca) throw new ErroDeNegocio('O rodízio desta partida já foi concluído.');
      const tipo = st.eventos.some((e) => e.tipo === 'substituicao') ? 'encerrado' : 'sem_substituicao';
      const evento = {
        id: novoId(), sessao_id: sessaoId, partida_id: partidaId, sorteio_id: st.atual.sorteio.id,
        equipe_id: null, participante_saiu_id: null, participante_entrou_id: null,
        tipo, formacao_antes: null, formacao_depois: null, created_at: isoAgora(),
      };
      await store.transacao([STORES.RODIZIO, STORES.OUTBOX], (h) => {
        h[STORES.RODIZIO].put(evento);
        enfileirar(h[STORES.OUTBOX], { tabela: 'rodizio_eventos', acao: 'upsert', registroId: evento.id, dados: payloadEvento(evento) });
      });
      aoGravar();
      return evento;
    },
  };
}
