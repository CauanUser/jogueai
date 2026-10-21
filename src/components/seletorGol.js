import { h } from './dom.js';
import { abrirDialogo } from './dialogo.js';

/**
 * Pergunta quem marcou o gol.
 * Resolve { participanteId, tipo } | { remover: true } | undefined (cancelado).
 *
 * @param equipe     equipe que ganha o gol no placar ({ nome, cor })
 * @param doTime     jogadores da equipe que marcou (gol normal)
 * @param adversarios jogadores do outro time (gol contra)
 * @param atual      gol existente sendo corrigido (opcional)
 */
export function perguntarAutor({ equipe, doTime, adversarios, atual = null }) {
  const titulo = atual ? `Corrigir gol — ${equipe.nome}` : `Gol do ${equipe.nome}!`;
  return abrirDialogo((fechar) => {
    const marcado = (id, tipo) => atual && (atual.participante_id ?? null) === id && atual.tipo === tipo;
    const opcao = (texto, valor, extra = '') => h('button', {
      type: 'button',
      class: `opcao-autor ${extra}${marcado(valor.participanteId, valor.tipo) ? ' opcao-autor-atual' : ''}`,
      'aria-pressed': marcado(valor.participanteId, valor.tipo) ? 'true' : 'false',
      onClick: () => fechar(valor),
    }, texto);

    return h('div', { class: 'dialogo-corpo seletor-gol', style: `--cor-equipe: ${equipe.cor}` },
      h('h2', {}, titulo),
      h('p', { class: 'ajuda' }, 'Quem fez o gol?'),
      h('div', { class: 'grade-autores' },
        doTime.map((j) => opcao(j.nome, { participanteId: j.id, tipo: 'normal' })),
        opcao('Sem autor (não sei quem foi)', { participanteId: null, tipo: 'normal' }, 'opcao-autor-neutra')),
      adversarios.length
        ? h('details', { class: 'gol-contra', open: atual?.tipo === 'contra' },
          h('summary', {}, 'Foi gol contra? Escolha quem fez'),
          h('div', { class: 'grade-autores' },
            adversarios.map((j) => opcao(`${j.nome} (contra)`, { participanteId: j.id, tipo: 'contra' }, 'opcao-autor-contra'))))
        : null,
      h('div', { class: 'acoes acoes-coluna' },
        atual ? h('button', { type: 'button', class: 'btn btn-perigo-texto', onClick: () => fechar({ remover: true }) }, 'Remover este gol') : null,
        h('button', { type: 'button', class: 'btn btn-secundario', autofocus: true, onClick: () => fechar(undefined) }, 'Cancelar')));
  }, { rotulo: titulo });
}
