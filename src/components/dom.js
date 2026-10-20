// Pequeno auxiliar para criar elementos sem innerHTML (evita injeção de HTML
// a partir de nomes digitados pelo usuário).
export function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      el.className = v;
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'value') {
      el.value = v;
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  anexar(el, filhos);
  return el;
}

function anexar(el, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONES = {
  editar: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  remover: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  voltar: 'M15 5l-7 7 7 7',
  inicio: 'M3 11l9-7 9 7v9h-6v-6H9v6H3z',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.5-1.5L17 5l-3-1-1 2h-2L10 4 7 5l.5 2.3L6 9 4 8.7 3 11.7l2 1v.6l-2 1 1 3 2-.3 1.5 1.5L7 19l3 1 1-2h2l1 2 3-1-.5-2.3L18 15l2 .3 1-3z',
  mais: 'M12 5v14M5 12h14',
  bola: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7l3.5 2.5-1.3 4h-4.4l-1.3-4z',
};

export function icone(nome, rotulo) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icone');
  if (rotulo) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', rotulo);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONES[nome] ?? '');
  svg.append(p);
  return svg;
}

/** Executa uma ação assíncrona desabilitando o botão (evita toque duplo). */
export async function comBotaoOcupado(botao, acao) {
  if (botao.disabled) return undefined;
  botao.disabled = true;
  botao.setAttribute('aria-busy', 'true');
  try {
    return await acao();
  } finally {
    botao.disabled = false;
    botao.removeAttribute('aria-busy');
  }
}
