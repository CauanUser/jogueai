import { h, icone } from '../components/dom.js';
import { cartaoEquipe, cartaoAguardando } from '../components/cartaoEquipe.js';
import { participantesEditaveis } from '../domain/sessao.js';
import { avaliarSomas } from '../domain/sorteio.js';
import { formatarDataReferencia, formatarHora } from '../utils/datas.js';
import { partidaAtiva } from '../domain/partida.js';

const STATUS_CURTO = { configurada: 'a começar', em_andamento: 'em andamento', pausada: 'pausada', finalizada: 'encerrada', confirmada: 'confirmada', cancelada: 'cancelada' };

export async function render(el, { id }, ctx) {
  const sessao = await ctx.sessoes.obter(id);
  if (!sessao) { ctx.navegar('/'); return; }
  const editavel = participantesEditaveis(sessao);
  const atual = await ctx.sorteios.atual(id);

  el.append(h('div', { class: 'cabecalho-pagina' },
    h('a', { class: 'btn-icone', href: `#/sessao/${id}`, 'aria-label': 'Voltar aos participantes' }, icone('voltar')),
    h('div', {}, h('h1', {}, 'Times'), h('p', { class: 'texto-suave' }, formatarDataReferencia(sessao.data_referencia)))));

  if (!atual) {
    el.append(h('div', { class: 'cartao estado-vazio' },
      h('h2', {}, 'Nenhum time confirmado'),
      h('p', {}, 'Faça o sorteio para montar times equilibrados.'),
      editavel ? h('a', { class: 'btn btn-primario btn-grande', href: `#/sessao/${id}/sorteio` }, 'Sortear times') : null));
    return;
  }

  const { sorteio, equipes, aguardando } = atual;
  const { amplitude } = avaliarSomas(equipes.map((e) => e.soma));
  const pendentes = await ctx.fila.registrosPendentes();

  el.append(h('p', { class: 'texto-suave' },
    `Sorteio nº ${sorteio.numero} · confirmado às ${formatarHora(sorteio.confirmado_em)} · diferença entre as somas: ${amplitude}`,
    pendentes.has(sorteio.id) ? h('span', { class: 'pendente' }, ' • pendente') : null));

  el.append(h('div', { class: 'grade-equipes' }, equipes.map(cartaoEquipe), cartaoAguardando(aguardando)));

  // Partidas da sessão
  const partidas = await ctx.partidas.listarPorSessao(id);
  const ativa = partidas.find(partidaAtiva);
  const nomeEquipe = new Map((await ctx.store.listarPorIndice('equipes', 'sessao_id', id)).map((e) => [e.id, e.nome]));
  if (editavel) {
    el.append(h('div', { class: 'acoes acoes-coluna' },
      ativa
        ? h('a', { class: 'btn btn-primario btn-grande', href: `#/partida/${ativa.id}` }, `Ir para a partida nº ${ativa.numero}`)
        : h('a', { class: 'btn btn-primario btn-grande', href: `#/sessao/${id}/partida/nova` }, 'Nova partida')));
  }
  if (partidas.length) {
    el.append(h('section', { 'aria-labelledby': 'tit-partidas' },
      h('h2', { id: 'tit-partidas', class: 'titulo-secao' }, 'Partidas'),
      h('ul', { class: 'lista', role: 'list' }, [...partidas].reverse().map((p) => h('li', {},
        h('a', { class: 'item-lista', href: `#/partida/${p.id}` },
          h('span', { class: 'item-titulo' }, `${p.numero}. ${nomeEquipe.get(p.equipe_a_id) ?? 'Equipe'} × ${nomeEquipe.get(p.equipe_b_id) ?? 'Equipe'}`),
          h('span', { class: 'item-sub' }, STATUS_CURTO[p.status] ?? p.status)))))));
  }

  if (editavel) {
    el.append(h('div', { class: 'acoes acoes-coluna' },
      h('a', { class: 'btn btn-secundario', href: `#/sessao/${id}/sorteio` }, 'Fazer novo sorteio')));
    el.append(h('p', { class: 'ajuda' }, 'Chegou mais gente? Adicione em Participantes e faça um novo sorteio. Partidas já jogadas mantêm as escalações de quando aconteceram.'));
  }
}
