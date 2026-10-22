import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { confirmar } from '../components/dialogo.js';
import { toast } from '../components/toast.js';
import { stepper } from '../components/stepper.js';
import { cartaoEquipe, cartaoAguardando } from '../components/cartaoEquipe.js';
import { calcularConfiguracao, sortearEquipes, MAX_EQUIPES, MAX_POR_EQUIPE } from '../domain/sorteio.js';
import { participantesEditaveis, temNota } from '../domain/sessao.js';
import { formatarDataReferencia } from '../utils/datas.js';

const PADRAO_POR_EQUIPE = 5;
const chaveRascunho = (id) => `rascunho_sorteio:${id}`;
const chaveGoleirosFixos = (id) => `goleiros_fixos:${id}`;

/** Rascunho só vale se a lista de participantes (ids e notas) não mudou. */
function assinatura(participantes) {
  return participantes.map((p) => `${p.id}:${p.nota}`).join('|');
}

export async function render(el, { id }, ctx) {
  const sessao = await ctx.sessoes.obter(id);
  if (!sessao) { ctx.navegar('/'); return; }

  const voltar = h('a', { class: 'btn-icone', href: `#/sessao/${id}`, 'aria-label': 'Voltar aos participantes' }, icone('voltar'));
  el.append(h('div', { class: 'cabecalho-pagina' }, voltar,
    h('div', {}, h('h1', {}, 'Sorteio'), h('p', { class: 'texto-suave' }, formatarDataReferencia(sessao.data_referencia)))));

  if (!participantesEditaveis(sessao)) {
    el.append(h('div', { class: 'cartao aviso' }, h('p', {}, 'Esta sessão está encerrada. Não é possível sortear novos times.'),
      h('a', { class: 'btn btn-secundario', href: `#/sessao/${id}/equipes` }, 'Ver times')));
    return;
  }

  const participantes = await ctx.participantes.listarPorSessao(id);
  const porId = new Map(participantes.map((p) => [p.id, p]));
  // Jogadores importados da lista podem ainda estar sem nota: o sorteio só libera com todas preenchidas.
  const semNota = participantes.filter((p) => !temNota(p));
  const anterior = await ctx.sorteios.atual(id);

  const estado = {
    porEquipe: anterior?.sorteio.jogadores_por_equipe ?? PADRAO_POR_EQUIPE,
    qtdEquipes: null, // null = automático
    modoEspera: 'ultimos',
    resultado: null,
    quantidadeGoleirosFixos: 0,
    goleiroEsquerdoId: '',
    goleiroDireitoId: '',
  };

  // Recupera a configuração salva de goleiros ao voltar para esta tela.
  const goleirosSalvos = await ctx.store.obterMeta(chaveGoleirosFixos(id));
  if (goleirosSalvos) {
    estado.quantidadeGoleirosFixos = [0, 1, 2].includes(goleirosSalvos.quantidade) ? goleirosSalvos.quantidade : 0;
    estado.goleiroEsquerdoId = participantes.some((p) => p.id === goleirosSalvos.goleiroEsquerdoId) ? goleirosSalvos.goleiroEsquerdoId : '';
    estado.goleiroDireitoId = participantes.some((p) => p.id === goleirosSalvos.goleiroDireitoId) ? goleirosSalvos.goleiroDireitoId : '';
    if (estado.quantidadeGoleirosFixos >= 1 && !estado.goleiroEsquerdoId) estado.quantidadeGoleirosFixos = 0;
    if (estado.quantidadeGoleirosFixos === 2 && (!estado.goleiroDireitoId || estado.goleiroDireitoId === estado.goleiroEsquerdoId)) estado.quantidadeGoleirosFixos = 1;
  }

  // Recupera um rascunho (sorteio feito e ainda não confirmado).
  const rascunho = await ctx.store.obterMeta(chaveRascunho(id));
  if (rascunho && rascunho.assinatura === assinatura(participantes)) Object.assign(estado, rascunho.estado);

  const salvarRascunho = () => ctx.store.definirMeta(chaveRascunho(id),
    estado.resultado ? { assinatura: assinatura(participantes), estado } : null);

  // Goleiros fixos são vinculados a lados físicos e não alteram o sorteio.
  const cfgGoleiros = h('fieldset', { class: 'grupo-radio' });
  const selQuantidadeGoleiros = h('select', { class: 'campo', 'aria-label': 'Quantidade de goleiros fixos' },
    h('option', { value: '0' }, 'Nenhum goleiro fixo'),
    h('option', { value: '1' }, '1 goleiro fixo'),
    h('option', { value: '2' }, '2 goleiros fixos'));
  const elGoleirosEscolha = h('div', { class: 'formulario' });
  function desenharGoleiros() {
    const itens = [];
    const criarSelect = (rotulo, selecionado, aoMudar) => {
      const sel = h('select', { class: 'campo', 'aria-label': rotulo },
        h('option', { value: '' }, 'Selecione o participante'),
        ...participantes.map((p) => h('option', { value: p.id }, p.nome)));
      sel.value = selecionado;
      sel.addEventListener('change', () => aoMudar(sel.value));
      return h('label', { class: 'rotulo-campo' }, rotulo, sel);
    };
    if (estado.quantidadeGoleirosFixos >= 1) itens.push(criarSelect('Goleiro fixo · lado esquerdo', estado.goleiroEsquerdoId, (v) => { estado.goleiroEsquerdoId = v; }));
    if (estado.quantidadeGoleirosFixos === 2) itens.push(criarSelect('Goleiro fixo · lado direito', estado.goleiroDireitoId, (v) => { estado.goleiroDireitoId = v; }));
    elGoleirosEscolha.replaceChildren(...itens);
  }
  selQuantidadeGoleiros.value = String(estado.quantidadeGoleirosFixos);
  selQuantidadeGoleiros.addEventListener('change', () => {
    estado.quantidadeGoleirosFixos = Number(selQuantidadeGoleiros.value);
    if (estado.quantidadeGoleirosFixos < 1) estado.goleiroEsquerdoId = '';
    if (estado.quantidadeGoleirosFixos < 2) estado.goleiroDireitoId = '';
    desenharGoleiros();
  });
  cfgGoleiros.append(h('legend', { class: 'rotulo-campo' }, 'Goleiros fixos (opcional)'),
    h('p', { class: 'ajuda' }, 'O goleiro permanece no mesmo lado físico da quadra. O sorteio dos times continua normal.'),
    selQuantidadeGoleiros, elGoleirosEscolha);
  desenharGoleiros();

  // ---- Configuração -------------------------------------------------
  const info = h('p', { class: 'resumo-config', 'aria-live': 'polite' });
  const erro = h('p', { class: 'erro-campo', 'aria-live': 'polite' });

  const stPorEquipe = stepper({
    id: 'por-equipe', rotulo: 'Jogadores por equipe', valor: estado.porEquipe, min: 1, max: MAX_POR_EQUIPE,
    aoMudar: (v) => { estado.porEquipe = v; estado.qtdEquipes = null; atualizarConfig(); },
  });
  const stEquipes = stepper({
    id: 'qtd-equipes', rotulo: 'Quantidade de equipes', valor: 2, min: 2, max: MAX_EQUIPES,
    aoMudar: (v) => { estado.qtdEquipes = v; atualizarConfig(); },
  });
  const btnAuto = h('button', { type: 'button', class: 'btn-link' }, 'Usar o máximo possível');
  btnAuto.addEventListener('click', () => { estado.qtdEquipes = null; atualizarConfig(); });

  const radio = (valor, texto, ajuda) => {
    const inp = h('input', { type: 'radio', name: 'modo-espera', value: valor, id: `modo-${valor}` });
    inp.checked = estado.modoEspera === valor;
    inp.addEventListener('change', () => { estado.modoEspera = valor; });
    return h('label', { class: 'opcao-radio', for: `modo-${valor}` }, inp,
      h('span', {}, h('strong', {}, texto), h('span', { class: 'texto-suave' }, ajuda)));
  };
  const blocoEspera = h('fieldset', { class: 'grupo-radio' },
    h('legend', { class: 'rotulo-campo' }, 'Se sobrarem jogadores, quem aguarda?'),
    radio('ultimos', 'Os últimos a chegar', 'pela ordem da lista de participantes'),
    radio('aleatorio', 'Sorteados ao acaso', 'qualquer participante pode ficar de fora'));

  const btnSortear = h('button', { class: 'btn btn-primario btn-grande', type: 'button' }, 'Sortear times');

  function atualizarConfig() {
    const cfg = calcularConfiguracao({ total: participantes.length, jogadoresPorEquipe: estado.porEquipe, qtdEquipes: estado.qtdEquipes });
    const auto = calcularConfiguracao({ total: participantes.length, jogadoresPorEquipe: estado.porEquipe });
    stEquipes.definir(estado.qtdEquipes ?? (auto.ok ? auto.qtdEquipes : 2));
    btnAuto.hidden = estado.qtdEquipes === null;
    if (cfg.ok) {
      erro.textContent = '';
      info.textContent = `${participantes.length} participantes → ${cfg.qtdEquipes} equipes de ${cfg.jogadoresPorEquipe}` +
        (cfg.aguardando ? ` · ${cfg.aguardando} aguardando` : ' · ninguém aguardando');
    } else {
      info.textContent = '';
      erro.textContent = cfg.erro;
    }
    blocoEspera.hidden = !cfg.ok || cfg.aguardando === 0;
    btnSortear.disabled = !cfg.ok || semNota.length > 0;
    return { ...cfg, ok: cfg.ok && semNota.length === 0 };
  }

  if (semNota.length) {
    el.append(h('div', { class: 'cartao aviso', role: 'alert' },
      h('p', {}, h('strong', {}, semNota.length === 1 ? '1 jogador está sem nota: ' : `${semNota.length} jogadores estão sem nota: `),
        semNota.map((p) => p.nome).join(', '), '.'),
      h('p', {}, 'Defina a nota de todos antes de sortear.'),
      h('a', { class: 'btn btn-primario', href: `#/sessao/${id}` }, 'Definir notas')));
  }

  el.append(h('section', { class: 'cartao formulario', 'aria-label': 'Configuração do sorteio' },
    stPorEquipe.el, stEquipes.el, btnAuto, info, erro, blocoEspera, cfgGoleiros, btnSortear));

  if (participantes.length < 2) {
    el.append(h('div', { class: 'estado-vazio estado-vazio-compacto' },
      h('p', {}, 'Adicione os participantes antes de sortear.'),
      h('a', { class: 'btn btn-secundario', href: `#/sessao/${id}` }, 'Adicionar participantes')));
  }

  // ---- Resultado ----------------------------------------------------
  const areaResultado = h('section', { class: 'resultado-sorteio', 'aria-live': 'polite', 'aria-label': 'Resultado do sorteio' });
  el.append(areaResultado);

  function desenharResultado() {
    const r = estado.resultado;
    if (!r) { areaResultado.replaceChildren(); return; }
    const equipes = r.equipes.map((e) => ({ ...e, jogadores: e.participantes.map((pid) => porId.get(pid)) }));
    const aguardando = r.aguardando.map((pid) => porId.get(pid));
    const btnDeNovo = h('button', { class: 'btn btn-secundario', type: 'button' }, 'Sortear de novo');
    btnDeNovo.addEventListener('click', () => sortear());
    const btnConfirmar = h('button', { class: 'btn btn-primario btn-grande', type: 'button' }, 'Confirmar times');
    btnConfirmar.addEventListener('click', () => comBotaoOcupado(btnConfirmar, confirmarTimes));

    areaResultado.replaceChildren(
      h('div', { class: `equilibrio ${r.amplitude <= 1 ? 'equilibrio-ok' : ''}` },
        h('strong', {}, r.amplitude === 0 ? 'Somas idênticas' : `Diferença entre as somas: ${r.amplitude}`),
        h('span', {}, ` · somas ${r.equipes.map((e) => e.soma).join(' / ')}`)),
      h('div', { class: 'grade-equipes' }, equipes.map(cartaoEquipe), cartaoAguardando(aguardando)),
      h('div', { class: 'acoes acoes-coluna' }, btnConfirmar, btnDeNovo));
  }

  function sortear() {
    const cfg = atualizarConfig();
    if (!cfg.ok) return;
    try {
      const r = sortearEquipes(participantes, {
        jogadoresPorEquipe: estado.porEquipe, qtdEquipes: estado.qtdEquipes, modoEspera: estado.modoEspera,
      });
      estado.resultado = r;
      salvarRascunho();
      desenharResultado();
      areaResultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      toast(e.message, 'erro');
    }
  }

  async function confirmarTimes() {
    if (anterior) {
      const ok = await confirmar({
        titulo: 'Substituir os times atuais?',
        mensagem: `Já existe o sorteio nº ${anterior.sorteio.numero}. Os novos times passam a valer para as próximas partidas; partidas já registradas mantêm as escalações antigas.`,
        textoConfirmar: 'Confirmar novos times',
      });
      if (!ok) return;
    }
    try {
      if (estado.quantidadeGoleirosFixos >= 1 && !participantes.some((p) => p.id === estado.goleiroEsquerdoId)) {
        toast('Escolha o goleiro fixo do lado esquerdo.', 'erro');
        return;
      }
      if (estado.quantidadeGoleirosFixos === 2 && (!participantes.some((p) => p.id === estado.goleiroDireitoId) || estado.goleiroDireitoId === estado.goleiroEsquerdoId)) {
        toast('Escolha um goleiro diferente para o lado direito.', 'erro');
        return;
      }
      await ctx.sorteios.confirmar(id, estado.resultado);
      await ctx.store.definirMeta(chaveGoleirosFixos(id), {
        quantidade: estado.quantidadeGoleirosFixos,
        goleiroEsquerdoId: estado.quantidadeGoleirosFixos >= 1 ? estado.goleiroEsquerdoId : null,
        goleiroDireitoId: estado.quantidadeGoleirosFixos === 2 ? estado.goleiroDireitoId : null,
      });
      await ctx.store.definirMeta(chaveRascunho(id), null);
      toast('Times confirmados!');
      ctx.navegar(`/sessao/${id}/equipes`);
    } catch (e) {
      toast(e.message, 'erro');
    }
  }

  btnSortear.addEventListener('click', sortear);
  atualizarConfig();
  desenharResultado();
}
