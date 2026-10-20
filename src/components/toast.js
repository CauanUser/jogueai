import { h } from './dom.js';

let regiao;

function obterRegiao() {
  if (!regiao) {
    regiao = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(regiao);
  }
  return regiao;
}

/** Mensagem temporária. tipo: 'sucesso' | 'erro' | 'info' */
export function toast(mensagem, tipo = 'sucesso', duracaoMs = tipo === 'erro' ? 6000 : 2500) {
  const el = h('div', { class: `toast toast-${tipo}` }, mensagem);
  if (tipo === 'erro') el.setAttribute('role', 'alert');
  // Uma mensagem por vez: não cobre a tela com avisos empilhados.
  obterRegiao().replaceChildren(el);
  setTimeout(() => {
    el.classList.add('saindo');
    setTimeout(() => el.remove(), 250);
  }, duracaoMs);
}
