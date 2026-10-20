import { h } from './dom.js';

/** Controle numérico com botões grandes de − e +. */
export function stepper({ id, rotulo, valor, min, max, aoMudar }) {
  let atual = valor;
  const saida = h('output', { id: `${id}-valor`, class: 'stepper-valor', 'aria-live': 'polite' }, String(valor));
  const menos = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Diminuir ${rotulo}` }, '−');
  const mais = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Aumentar ${rotulo}` }, '+');
  const atualizar = () => {
    saida.textContent = String(atual);
    menos.disabled = atual <= min;
    mais.disabled = atual >= max;
  };
  menos.addEventListener('click', () => { if (atual > min) { atual--; atualizar(); aoMudar(atual); } });
  mais.addEventListener('click', () => { if (atual < max) { atual++; atualizar(); aoMudar(atual); } });
  atualizar();
  const el = h('div', { class: 'stepper', role: 'group', 'aria-labelledby': `${id}-rotulo` },
    h('span', { id: `${id}-rotulo`, class: 'rotulo-campo' }, rotulo),
    h('div', { class: 'stepper-controles' }, menos, saida, mais));
  return { el, definir: (v) => { atual = v; atualizar(); } };
}
