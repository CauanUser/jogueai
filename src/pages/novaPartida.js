import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { toast } from '../components/toast.js';
import { stepper } from '../components/stepper.js';
import { participantesEditaveis } from '../domain/sessao.js';
import { CONFIG_PADRAO, CONDICOES, LIMITES, validarConfiguracao, sugerirConfronto } from '../domain/partida.js';
import { formatarTempo } from '../domain/cronometro.js';
import { normalizarModalidade } from '../domain/modalidades.js';

export const META_PADRAO = 'partida_padrao';

const DURACOES_RAPIDAS = [5, 8, 10, 12, 15];

export async function lerPadrao(ctx) {
  const salvo = await ctx.store.obterMeta(META_PADRAO);
  const v = validarConfiguracao({ ...CONFIG_PADRAO, ...(salvo ?? {}) });
  return v.ok ? v.config : { ...CONFIG_PADRAO };
}

export async function render(el, { id }, ctx) {
  const sessao = await ctx.sessoes.obter(id);
  if (!sessao) { ctx.navegar('/'); return; }

  el.append(h('div', { class: 'cabecalho-pagina' },
    h('a', { class: 'btn-icone', href: `#/sessao/${id}/equipes`, 'aria-label': 'Voltar aos times' }, icone('voltar')),
    h('div', {}, h('h1', {}, 'Nova partida'))));

  if (!participantesEditaveis(sessao)) {
    el.append(h('div', { class: 'cartao aviso' }, h('p', {}, 'Esta sessão está encerrada.')));
    return;
  }
  const ativa = await ctx.partidas.ativa(id);
  if (ativa) {
    el.append(h('div', { class: 'cartao aviso', role: 'alert' },
      h('p', {}, `A partida nº ${ativa.numero} ainda não terminou. Encerre-a antes de começar outra.`),
      h('a', { class: 'btn btn-primario', href: `#/partida/${ativa.id}` }, 'Ir para a partida')));
    return;
  }
  const atual = await ctx.sorteios.atual(id);
  if (!atual || atual.equipes.length < 2) {
    el.append(h('div', { class: 'cartao estado-vazio' },
      h('p', {}, 'Confirme os times no sorteio antes de criar uma partida.'),
      h('a', { class: 'btn btn-primario', href: `#/sessao/${id}/sorteio` }, 'Sortear times')));
    return;
  }

  const partidasAnteriores = await ctx.partidas.listarPorSessao(id);
  const sessaoConfig = await ctx.store.obterMeta('sessao_config_' + id) ?? { modalidade: 'futebol' };
  const modalidade = normalizarModalidade(sessaoConfig.modalidade);
  const cfg = await lerPadrao(ctx);
  if (modalidade === 'basquete') { cfg.condicao_encerramento = CONDICOES.TEMPO; cfg.limite_gols = null; cfg.desempate = 'nenhum'; }
  if (modalidade === 'volei') { cfg.condicao_encerramento = CONDICOES.GOLS; cfg.limite_gols = 25; cfg.acrescimos_segundos = 0; cfg.intervalo_segundos = 0; cfg.desempate = 'nenhum'; }
  let selecionadas = sugerirConfronto(atual.equipes, partidasAnteriores);

  // ---- Equipes ------------------------------------------------------
  const grade = h('div', { class: 'escolha-equipes', role: 'group', 'aria-label': 'Equipes da partida' });
  const infoEquipes = h('p', { class: 'ajuda', 'aria-live': 'polite' });
  const desenharEquipes = () => {
    grade.replaceChildren(...atual.equipes.map((e) => {
      const pos = selecionadas.indexOf(e.id);
      const b = h('button', {
        type: 'button', class: 'equipe-opcao', style: `--cor-equipe: ${e.cor}`,
        'aria-pressed': String(pos >= 0),
      },
      h('span', { class: 'equipe-cor', 'aria-hidden': 'true' }),
      h('span', { class: 'equipe-opcao-nome' }, e.nome),
      h('span', { class: 'equipe-opcao-lado' }, pos === 0 ? 'Lado A' : pos === 1 ? 'Lado B' : 'Aguarda'));
      b.addEventListener('click', () => {
        if (pos >= 0) selecionadas = selecionadas.filter((x) => x !== e.id);
        else selecionadas = [...selecionadas, e.id].slice(-2);
        desenharEquipes();
      });
      return b;
    }));
    const nomes = (ids) => ids.map((x) => atual.equipes.find((e) => e.id === x)?.nome).join(' × ');
    const aguardam = atual.equipes.filter((e) => !selecionadas.includes(e.id)).map((e) => e.nome);
    infoEquipes.textContent = selecionadas.length === 2
      ? `${nomes(selecionadas)}${aguardam.length ? ` · aguardando: ${aguardam.join(', ')}` : ''}`
      : 'Toque em duas equipes para formar a partida.';
  };
  desenharEquipes();

  // ---- Regras -------------------------------------------------------
  const erros = h('p', { class: 'erro-campo', 'aria-live': 'polite' });
  const stDuracao = stepper({
    id: 'duracao', rotulo: 'Duração', valor: cfg.duracao_segundos, min: LIMITES.duracaoMin, max: LIMITES.duracaoMax,
    passo: 30, formatar: (s) => formatarTempo(s * 1000), aoMudar: (v) => { cfg.duracao_segundos = v; },
  });
  const rapidas = h('div', { class: 'chips-rapidos', role: 'group', 'aria-label': 'Durações rápidas' },
    DURACOES_RAPIDAS.map((m) => h('button', {
      type: 'button', class: 'chip-botao',
      onClick: () => { cfg.duracao_segundos = m * 60; stDuracao.definir(cfg.duracao_segundos); },
    }, `${m} min`)));

  const stGols = stepper({
    id: 'alvo-pontuacao', rotulo: modalidade === 'futebol' ? 'Gols necessários para encerrar' : 'Pontos necessários para encerrar', valor: cfg.limite_gols ?? (modalidade === 'basquete' ? 21 : 2), min: 1, max: 99,
    aoMudar: (v) => { cfg.limite_gols = v; },
  });
  const blocoGols = h('div', {}, stGols.el);
  if (modalidade === 'volei') blocoGols.hidden = true;

  const radio = (nome, valor, texto, atualValor, aoEscolher) => {
    const inp = h('input', { type: 'radio', name: nome, value: valor, id: `${nome}-${valor}` });
    inp.checked = atualValor === valor;
    inp.addEventListener('change', () => aoEscolher(valor));
    return h('label', { class: 'opcao-radio', for: `${nome}-${valor}` }, inp, h('span', {}, h('strong', {}, texto)));
  };
  const atualizarGols = () => { blocoGols.hidden = modalidade === 'volei' || cfg.condicao_encerramento === CONDICOES.TEMPO; };
  const escolherCondicao = (v) => {
    cfg.condicao_encerramento = v;
    if (v !== CONDICOES.TEMPO && !cfg.limite_gols) { cfg.limite_gols = modalidade === 'basquete' ? 21 : 2; stGols.definir(cfg.limite_gols); }
    atualizarGols();
  };
  const condPrimeiro = radio('condicao', CONDICOES.PRIMEIRO, modalidade === 'futebol' ? 'Ao atingir o limite de gols ou acabar o tempo' : 'Ao atingir o alvo de pontos ou acabar o tempo', cfg.condicao_encerramento, escolherCondicao);
  const condTempo = radio('condicao', CONDICOES.TEMPO, modalidade === 'volei' ? 'Melhor de 5 sets (25 pontos; set decisivo a 15)' : 'Somente ao acabar o tempo', cfg.condicao_encerramento, escolherCondicao);
  const condAlvo = radio('condicao', CONDICOES.GOLS, modalidade === 'futebol' ? 'Somente ao atingir o limite de gols' : 'Somente ao atingir o alvo de pontos', cfg.condicao_encerramento, escolherCondicao);
  if (modalidade === 'volei') { condPrimeiro.hidden = true; condAlvo.hidden = true; }
  const condicao = h('fieldset', { class: 'grupo-radio' }, h('legend', { class: 'rotulo-campo' }, 'Como a partida termina'), condPrimeiro, condTempo, condAlvo);
  atualizarGols();

  const minutos = (s) => (s === 0 ? 'Não' : `${s / 60} min`);
  const stAcrescimos = stepper({
    id: 'acrescimos', rotulo: 'Acréscimos', valor: cfg.acrescimos_segundos, min: 0, max: LIMITES.acrescimosMax,
    passo: 60, formatar: minutos, aoMudar: (v) => { cfg.acrescimos_segundos = v; },
  });
  const stIntervalo = stepper({
    id: 'intervalo', rotulo: 'Intervalo', valor: cfg.intervalo_segundos, min: 0, max: 1800,
    passo: 60, formatar: minutos, aoMudar: (v) => { cfg.intervalo_segundos = v; },
  });
  const empate = h('fieldset', { class: 'grupo-radio' },
    h('legend', { class: 'rotulo-campo' }, 'Empate no fim do tempo'),
    radio('desempate', 'penaltis', 'Disputa de pênaltis (registrada à mão)', cfg.desempate, (v) => { cfg.desempate = v; }),
    radio('desempate', 'nenhum', 'Fica empatado', cfg.desempate, (v) => { cfg.desempate = v; }));
  empate.hidden = modalidade !== 'futebol';

  const salvarPadrao = h('input', { type: 'checkbox', id: 'salvar-padrao' });
  const btnCriar = h('button', { class: 'btn btn-primario btn-grande', type: 'button' }, 'Criar partida');

  btnCriar.addEventListener('click', () => comBotaoOcupado(btnCriar, async () => {
    erros.textContent = '';
    if (selecionadas.length !== 2) { erros.textContent = 'Escolha as duas equipes da partida.'; return; }
    const v = validarConfiguracao(cfg);
    if (!v.ok) { erros.textContent = Object.values(v.erros).join(' '); return; }
    try {
      const p = await ctx.partidas.criar(id, { equipeAId: selecionadas[0], equipeBId: selecionadas[1], config: { ...v.config, modalidade } });
      if (salvarPadrao.checked) await ctx.store.definirMeta(META_PADRAO, v.config);
      toast(`Partida nº ${p.numero} criada.`);
      ctx.navegar(`/partida/${p.id}`);
    } catch (e) {
      erros.textContent = e.erros ? Object.values(e.erros).join(' ') : e.message;
    }
  }));

  el.append(
    h('section', { class: 'cartao', 'aria-labelledby': 'tit-equipes' },
      h('h2', { id: 'tit-equipes' }, 'Quem joga'), grade, infoEquipes),
    h('section', { class: 'cartao formulario', 'aria-labelledby': 'tit-regras' },
      h('h2', { id: 'tit-regras' }, 'Regras desta partida'),
      h('p', { class: 'ajuda' }, modalidade === 'futebol' ? 'Futebol: cada gol vale 1. Escolha alvo de gols, tempo ou o que acontecer primeiro.' : modalidade === 'basquete' ? 'Basquete: lance livre = 1, cesta comum = 2 e cesta de três = 3. Defina um alvo de pontos, o tempo ou ambos.' : 'Vôlei: pontos por rally, sets de 25 (set decisivo de 15), vantagem mínima de 2; vence quem ganhar 3 sets.'),
      modalidade !== 'volei' ? stDuracao.el : null, modalidade !== 'volei' ? rapidas : null, condicao, blocoGols, modalidade === 'futebol' ? stAcrescimos.el : null, modalidade === 'futebol' ? stIntervalo.el : null,
      modalidade === 'futebol' ? h('p', { class: 'ajuda' }, 'Com intervalo, o cronômetro pausa sozinho na metade do tempo.') : null,
      empate,
      h('label', { class: 'opcao-check', for: 'salvar-padrao' }, salvarPadrao,
        h('span', {}, 'Usar estas regras como padrão das próximas partidas'))),
    erros,
    btnCriar);
}
