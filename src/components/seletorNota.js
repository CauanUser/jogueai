import { h } from './dom.js';
import { NOTA_MIN, NOTA_MAX } from '../domain/validacao.js';

/** Grade de botões 1–10 (alvos grandes, fáceis de tocar no campo). */
export function seletorNota({ valor = null, aoMudar = () => {}, idRotulo }) {
  let atual = valor;
  const grupo = h('div', { class: 'seletor-nota', role: 'radiogroup', 'aria-labelledby': idRotulo });
  const botoes = [];
  const marcar = (n) => {
    atual = n;
    botoes.forEach((b, i) => {
      const sel = i + NOTA_MIN === n;
      b.setAttribute('aria-checked', String(sel));
      b.tabIndex = sel || (n === null && i === 0) ? 0 : -1;
    });
  };
  for (let n = NOTA_MIN; n <= NOTA_MAX; n++) {
    const b = h('button', {
      type: 'button', role: 'radio', class: 'nota-opcao', 'aria-label': `Nota ${n}`,
      onClick: () => { marcar(n); aoMudar(n); },
      onKeydown: (e) => {
        const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const prox = Math.min(NOTA_MAX, Math.max(NOTA_MIN, (atual ?? NOTA_MIN) + d));
        marcar(prox); aoMudar(prox); botoes[prox - NOTA_MIN].focus();
      },
    }, String(n));
    botoes.push(b);
    grupo.append(b);
  }
  marcar(atual);
  return { el: grupo, valor: () => atual, definir: marcar };
}
