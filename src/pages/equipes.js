import { h, icone } from '../components/dom.js';
import { cartaoEquipe, cartaoAguardando } from '../components/cartaoEquipe.js';
import { participantesEditaveis } from '../domain/sessao.js';
import { avaliarSomas } from '../domain/sorteio.js';
import { formatarDataReferencia, formatarHora } from '../utils/datas.js';

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

  if (editavel) {
    el.append(h('div', { class: 'acoes acoes-coluna' },
      h('a', { class: 'btn btn-secundario', href: `#/sessao/${id}/sorteio` }, 'Fazer novo sorteio')));
    el.append(h('p', { class: 'ajuda' }, 'Chegou mais gente? Adicione em Participantes e faça um novo sorteio. Partidas já jogadas mantêm as escalações de quando aconteceram.'));
  }
}
