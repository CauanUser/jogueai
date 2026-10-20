import { h, comBotaoOcupado } from '../components/dom.js';
import { toast } from '../components/toast.js';
import { dataLocalISO, formatarDataReferencia } from '../utils/datas.js';

export async function render(el, _params, ctx) {
  const ativa = await ctx.sessoes.emAndamento();
  el.append(h('h1', {}, 'Nova sessão de racha'));

  if (ativa) {
    el.append(h('div', { class: 'cartao aviso', role: 'alert' },
      h('p', {}, `Já existe uma sessão em andamento (${formatarDataReferencia(ativa.data_referencia)}). Encerre-a antes de criar outra.`),
      h('a', { class: 'btn btn-primario', href: `#/sessao/${ativa.id}` }, 'Abrir sessão em andamento')));
    return;
  }

  const erro = h('p', { class: 'erro-campo', id: 'erro-data', 'aria-live': 'polite' });
  const data = h('input', {
    id: 'data', type: 'date', class: 'campo', required: true, value: dataLocalISO(),
    'aria-describedby': 'ajuda-data erro-data',
  });
  const btn = h('button', { class: 'btn btn-primario btn-grande', type: 'submit' }, 'Criar sessão');
  const form = h('form', { class: 'cartao formulario', novalidate: true },
    h('label', { for: 'data', class: 'rotulo-campo' }, 'Data do racha'),
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
        toast('Sessão criada. Adicione os participantes.');
        ctx.navegar(`/sessao/${s.id}`);
      } catch (e) {
        erro.textContent = e.message;
        data.setAttribute('aria-invalid', 'true');
      }
    });
  });
  el.append(form);
}
