import { h, icone } from '../components/dom.js';
import { cartaoEquipe, cartaoAguardando } from '../components/cartaoEquipe.js';
import { participantesEditaveis } from '../domain/sessao.js';
import { avaliarSomas } from '../domain/sorteio.js';
import { formatarDataReferencia, formatarHora } from '../utils/datas.js';
import { partidaAtiva } from '../domain/partida.js';
import { toast } from '../components/toast.js';

const chaveGoleirosFixos = (id) => `goleiros_fixos:${id}`;
const chaveGoleirosEquipe = (id) => `goleiros_por_equipe:${id}`;

const STATUS_CURTO = { configurada: 'a começar', em_andamento: 'em andamento', pausada: 'pausada', finalizada: 'encerrada · falta confirmar', confirmada: 'resultado confirmado', cancelada: 'cancelada' };

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

  const participantes = await ctx.participantes.listarPorSessao(id);
  const cfgFixos = await ctx.store.obterMeta(chaveGoleirosFixos(id));
  const idsFixos = new Set([
    ...(cfgFixos?.quantidade >= 1 && cfgFixos.goleiroEsquerdoId ? [cfgFixos.goleiroEsquerdoId] : []),
    ...(cfgFixos?.quantidade === 2 && cfgFixos.goleiroDireitoId ? [cfgFixos.goleiroDireitoId] : []),
  ]);
  const metaGoleiros = await ctx.store.obterMeta(chaveGoleirosEquipe(id)) ?? {};
  const goleiros = {};
  for (const equipe of equipes) {
    const fixoNoTime = equipe.jogadores.find((p) => idsFixos.has(p.id));
    const salvo = equipe.jogadores.find((p) => p.id === metaGoleiros[equipe.id]);
    goleiros[equipe.id] = fixoNoTime?.id ?? salvo?.id ?? '';
  }

  const gradeEquipes = h('div', { class: 'grade-equipes' });
  const areaGoleiros = h('section', { class: 'cartao formulario', 'aria-label': 'Escolher goleiros' });
  async function salvarGoleiros() {
    await ctx.store.definirMeta(chaveGoleirosEquipe(id), goleiros);
  }
  function desenharEquipesComGoleiros() {
    const controles = equipes.map((equipe) => {
      const fixoNoTime = equipe.jogadores.find((p) => idsFixos.has(p.id));
      const select = h('select', { class: 'campo', 'aria-label': `Goleiro do ${equipe.nome}`, disabled: Boolean(fixoNoTime) || !editavel },
        h('option', { value: '' }, 'Escolher goleiro'),
        ...equipe.jogadores.map((p) => h('option', { value: p.id }, p.nome)));
      select.value = goleiros[equipe.id] ?? '';
      select.addEventListener('change', async () => {
        goleiros[equipe.id] = select.value;
        try { await salvarGoleiros(); desenharEquipesComGoleiros(); }
        catch (e) { toast(e.message, 'erro'); }
      });
      const btnSorteio = h('button', { type: 'button', class: 'btn btn-secundario', disabled: Boolean(fixoNoTime) || !editavel }, 'Sortear goleiro');
      btnSorteio.addEventListener('click', async () => {
        const opcoes = equipe.jogadores.filter((p) => p.id !== goleiros[equipe.id]);
        if (!opcoes.length) { toast('Não há outro jogador disponível para sortear.', 'erro'); return; }
        const escolhido = opcoes[Math.floor(Math.random() * opcoes.length)];
        goleiros[equipe.id] = escolhido.id;
        try { await salvarGoleiros(); desenharEquipesComGoleiros(); toast(`${escolhido.nome} será o goleiro do ${equipe.nome}.`); }
        catch (e) { toast(e.message, 'erro'); }
      });
      return h('div', { class: 'formulario' },
        h('label', { class: 'rotulo-campo' }, `${equipe.nome}${fixoNoTime ? ' · goleiro fixo' : ''}`, select),
        fixoNoTime ? h('p', { class: 'ajuda' }, `${fixoNoTime.nome} foi definido como goleiro fixo no cadastro do sorteio.`) : btnSorteio);
    });
    areaGoleiros.replaceChildren(
      h('h2', {}, 'Goleiros dos times'),
      h('p', { class: 'ajuda' }, 'Os goleiros fixos são identificados automaticamente. Para os outros times, escolha um jogador ou sorteie um goleiro.'),
      ...controles);
    gradeEquipes.replaceChildren(...equipes.map((e) => cartaoEquipe({ ...e, goleiroId: goleiros[e.id] })), cartaoAguardando(aguardando));
  }
  desenharEquipesComGoleiros();
  el.append(areaGoleiros, gradeEquipes);

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
