import { h } from './dom.js';

/**
 * Cartão de uma equipe. `jogadores`: [{id, nome, nota}]
 */
export function cartaoEquipe({ nome, cor, jogadores, soma, goleiroId = null }) {
  return h('section', { class: 'equipe', style: `--cor-equipe: ${cor}`, 'aria-label': `${nome}, soma ${soma}` },
    h('header', { class: 'equipe-topo' },
      h('span', { class: 'equipe-cor', 'aria-hidden': 'true' }),
      h('h3', {}, nome),
      h('span', { class: 'equipe-soma', title: 'Soma das notas' }, `Σ ${soma}`)),
    h('ul', { class: 'equipe-jogadores' },
      jogadores.map((p) => h('li', {},
        h('span', {}, p.id === goleiroId ? `${p.nome} (goleiro)` : p.nome),
        h('span', { class: 'nota nota-pequena', 'aria-label': `nota ${p.nota}` }, String(p.nota))))));
}

export function cartaoAguardando(jogadores) {
  if (!jogadores.length) return null;
  return h('section', { class: 'equipe equipe-espera', 'aria-label': 'Aguardando equipe' },
    h('header', { class: 'equipe-topo' },
      h('h3', {}, 'Aguardando equipe'),
      h('span', { class: 'equipe-soma' }, String(jogadores.length))),
    h('ul', { class: 'equipe-jogadores' },
      jogadores.map((p) => h('li', {},
        h('span', {}, p.nome),
        h('span', { class: 'nota nota-pequena', 'aria-label': `nota ${p.nota}` }, String(p.nota))))));
}
