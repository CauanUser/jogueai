import { h, comBotaoOcupado } from '../components/dom.js';
import { toast } from '../components/toast.js';
import { dataLocalISO, formatarDataReferencia } from '../utils/datas.js';

export async function render(el, _params, ctx) {
  const ativa = await ctx.sessoes.emAndamento();
  el.append(h('h1', {}, 'Nova sessão esportiva'), h('p', { class: 'texto-suave' }, 'Escolha o esporte e como vai organizar os times.'));

  if (ativa) {
    el.append(h('div', { class: 'cartao aviso', role: 'alert' },
      h('p', {}, `Já existe uma sessão em andamento (${formatarDataReferencia(ativa.data_referencia)}). Encerre-a antes de criar outra.`),
      h('a', { class: 'btn btn-primario', href: `#/sessao/${ativa.id}` }, 'Abrir sessão em andamento')));
    return;
  }

  const erro = h('p', { class: 'erro-campo', id: 'erro-data', 'aria-live': 'polite' });
  let modalidade = 'futebol';
  let modo = 'racha';
  const criarOpcoes = (titulo, itens, atual, mudar) => {
    const grupo = h('div', { class: 'seletor-modalidade', role: 'group', 'aria-label': titulo });
    for (const [valor, nome, detalhe] of itens) {
      const botao = h('button', { type: 'button', class: 'cartao opcao-esporte', 'aria-pressed': String(valor === atual) },
        h('strong', {}, nome), h('span', { class: 'texto-suave' }, detalhe));
      botao.addEventListener('click', () => {
        mudar(valor);
        for (const item of grupo.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item.dataset.valor === valor));
      });
      botao.dataset.valor = valor;
      grupo.append(botao);
    }
    return grupo;
  };
  const esportes = criarOpcoes('Esporte', [
    ['futebol', '⚽ Futebol', 'Racha, sorteio e rodízio'],
    ['basquete', '🏀 Basquete', 'Partidas e placar por períodos'],
    ['volei', '🏐 Vôlei', 'Sets e pontuação por sets'],
  ], modalidade, (v) => { modalidade = v; });
  const modos = criarOpcoes('Modo', [
    ['racha', 'Racha de amigos', 'Sorteio de times e fila de espera'],
    ['partida', 'Partida com times definidos', 'Escalação manual, sem sorteio'],
  ], modo, (v) => { modo = v; });
  const data = h('input', {
    id: 'data', type: 'date', class: 'campo', required: true, value: dataLocalISO(),
    'aria-describedby': 'ajuda-data erro-data',
  });
  const btn = h('button', { class: 'btn btn-primario btn-grande', type: 'submit' }, 'Iniciar sessão');
  const form = h('form', { class: 'cartao formulario', novalidate: true },
    h('h2', {}, 'Esporte'), esportes,
    h('h2', {}, 'Como vai jogar?'), modos,
    h('label', { for: 'data', class: 'rotulo-campo' }, 'Data da sessão'),
    data,
    h('p', { class: 'ajuda', id: 'ajuda-data' }, 'Jogos depois da meia-noite continuam contando para esta sessão.'),
    erro,
    btn);

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    comBotaoOcupado(btn, async () => {
      erro.textContent = '';
      try {
        const s = await ctx.sessoes.criar({ dataReferencia: data.value });
        await ctx.store.definirMeta('sessao_config_' + s.id, { modalidade, modo });
        toast('Sessão iniciada. Marque quem veio hoje.');
        ctx.navegar(`/sessao/${s.id}`);
      } catch (e) {
        erro.textContent = e.message;
        data.setAttribute('aria-invalid', 'true');
      }
    });
  });
  el.append(form);
}
