import { h } from './dom.js';

/**
 * Abre um diálogo modal. `montar(fechar)` devolve o conteúdo.
 * Retorna uma Promise com o valor passado a fechar(valor).
 */
export function abrirDialogo(montar, { rotulo = 'Diálogo' } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialogo', 'aria-label': rotulo });
    let valor;
    const fechar = (v) => { valor = v; dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(valor); });
    dlg.addEventListener('cancel', () => { valor = undefined; });
    dlg.append(montar(fechar));
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('[autofocus]')?.focus();
  });
}

/** Confirmação para ações importantes/destrutivas. Resolve true/false. */
export async function confirmar({ titulo, mensagem, textoConfirmar = 'Confirmar', perigo = false }) {
  const r = await abrirDialogo((fechar) =>
    h('div', { class: 'dialogo-corpo' },
      h('h2', {}, titulo),
      mensagem ? h('p', {}, mensagem) : null,
      h('div', { class: 'acoes' },
        h('button', { class: 'btn btn-secundario', type: 'button', autofocus: true, onClick: () => fechar(false) }, 'Cancelar'),
        h('button', { class: `btn ${perigo ? 'btn-perigo' : 'btn-primario'}`, type: 'button', onClick: () => fechar(true) }, textoConfirmar),
      ),
    ), { rotulo: titulo });
  return r === true;
}
