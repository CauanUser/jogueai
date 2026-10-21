import { h, icone } from '../components/dom.js';
import { toast } from '../components/toast.js';

export async function render(el, { id }, ctx) {
  const sessao = await ctx.sessoes.obter(id);
  if (!sessao) { ctx.navegar('/'); return; }
  const config = await ctx.store.obterMeta('sessao_config_' + id) ?? { modalidade: 'futebol', modo: 'racha' };
  const participantes = await ctx.store.listarPorIndice('participantes', 'sessao_id', id);
  const atual = await ctx.sorteios.atual(id);
  el.append(h('div', { class: 'cabecalho-pagina' },
    h('a', { class: 'btn-icone', href: '#/sessao/' + id, 'aria-label': 'Voltar' }, icone('voltar')),
    h('div', {}, h('h1', {}, 'Montar times manualmente'),
      h('p', { class: 'texto-suave' }, ({ futebol: '⚽ Futebol', basquete: '🏀 Basquete', volei: '🏐 Vôlei' })[config.modalidade] || 'Futebol'))));
  if (participantes.length < 2) {
    el.append(h('div', { class: 'cartao estado-vazio' }, h('p', {}, 'Cadastre pelo menos dois participantes antes de montar os times.')));
    return;
  }
  if (atual) {
    el.append(h('div', { class: 'cartao aviso' }, h('p', {}, 'Esta sessão já tem times confirmados. Para preservar o histórico e o rodízio, não substituí os times existentes automaticamente.')));
    el.append(h('a', { class: 'btn btn-primario', href: '#/sessao/' + id + '/equipes' }, 'Ver times atuais'));
    return;
  }
  const a = new Set();
  const b = new Set();
  const listaA = h('div', { class: 'lista-selecao-jogadores' });
  const listaB = h('div', { class: 'lista-selecao-jogadores' });
  const desenhar = () => {
    listaA.replaceChildren(...participantes.map(p => {
      const label = h('label', { class: 'selecao-jogador' });
      const input = h('input', { type: 'checkbox', checked: a.has(p.id) });
      input.addEventListener('change', () => { input.checked ? (a.add(p.id), b.delete(p.id)) : a.delete(p.id); desenhar(); });
      label.append(input, h('span', {}, p.nome));
      return label;
    }));
    listaB.replaceChildren(...participantes.map(p => {
      const label = h('label', { class: 'selecao-jogador' });
      const input = h('input', { type: 'checkbox', checked: b.has(p.id) });
      input.addEventListener('change', () => { input.checked ? (b.add(p.id), a.delete(p.id)) : b.delete(p.id); desenhar(); });
      label.append(input, h('span', {}, p.nome));
      return label;
    }));
    resumo.textContent = 'Time A: ' + a.size + ' · Time B: ' + b.size;
  };
  const resumo = h('p', { class: 'ajuda', 'aria-live': 'polite' });
  const nomeA = h('input', { class: 'campo', value: 'Time A', maxlength: 40, 'aria-label': 'Nome do Time A' });
  const nomeB = h('input', { class: 'campo', value: 'Time B', maxlength: 40, 'aria-label': 'Nome do Time B' });
  const erro = h('p', { class: 'erro-campo', 'aria-live': 'polite' });
  const salvar = h('button', { class: 'btn btn-primario btn-grande', type: 'button' }, 'Confirmar escalações');
  salvar.addEventListener('click', async () => {
    erro.textContent = '';
    if (!a.size || !b.size) { erro.textContent = 'Escolha pelo menos um jogador para cada time.'; return; }
    try {
      await ctx.sorteios.confirmar(id, { jogadoresPorEquipe: Math.max(a.size, b.size), qtdEquipes: 2, equipes: [
        { nome: nomeA.value.trim() || 'Time A', cor: '#BCF95E', participantes: [...a] },
        { nome: nomeB.value.trim() || 'Time B', cor: '#021A26', participantes: [...b] },
      ]});
      toast('Times manuais confirmados.');
      ctx.navegar('/sessao/' + id + '/equipes');
    } catch (e) { erro.textContent = e.message; }
  });
  el.append(h('p', { class: 'ajuda' }, 'Marque os jogadores de cada lado. Um jogador não pode ficar nos dois times.'),
    h('section', { class: 'cartao' }, h('h2', {}, 'Time A'), nomeA, listaA),
    h('section', { class: 'cartao' }, h('h2', {}, 'Time B'), nomeB, listaB),
    resumo, erro, salvar);
  desenhar();
}
