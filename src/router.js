import * as inicio from './pages/inicio.js';
import * as novaSessao from './pages/novaSessao.js';
import * as participantes from './pages/participantes.js';
import * as configuracoes from './pages/configuracoes.js';
import * as sorteio from './pages/sorteio.js';
import * as equipes from './pages/equipes.js';
import * as importarLista from './pages/importarLista.js';
import * as novaPartida from './pages/novaPartida.js';
import * as partida from './pages/partida.js';
import * as rodizio from './pages/rodizio.js';

const ROTAS = [
  { padrao: /^\/$/, pagina: inicio, nav: 'inicio' },
  { padrao: /^\/sessao\/nova$/, pagina: novaSessao, nav: 'inicio' },
  { padrao: /^\/sessao\/([0-9a-f-]{36})$/i, pagina: participantes, nav: 'inicio', params: ['id'] },
  { padrao: /^\/sessao\/([0-9a-f-]{36})\/sorteio$/i, pagina: sorteio, nav: 'inicio', params: ['id'] },
  { padrao: /^\/sessao\/([0-9a-f-]{36})\/equipes$/i, pagina: equipes, nav: 'inicio', params: ['id'] },
  { padrao: /^\/sessao\/([0-9a-f-]{36})\/importar$/i, pagina: importarLista, nav: 'inicio', params: ['id'] },
  { padrao: /^\/sessao\/([0-9a-f-]{36})\/partida\/nova$/i, pagina: novaPartida, nav: 'inicio', params: ['id'] },
  { padrao: /^\/partida\/([0-9a-f-]{36})$/i, pagina: partida, nav: 'inicio', params: ['id'] },
  { padrao: /^\/sessao\/([0-9a-f-]{36})\/rodizio$/i, pagina: rodizio, nav: 'inicio', params: ['id'] },
  { padrao: /^\/configuracoes$/, pagina: configuracoes, nav: 'config' },
];

export function caminhoAtual() {
  const c = (globalThis.location.hash || '#/').slice(1);
  return c.startsWith('/') ? c : `/${c}`;
}

export function iniciarRoteador({ container, ctx, aoNavegar = () => {} }) {
  let limpeza = null;
  let geracao = 0;

  async function renderizar() {
    const caminho = caminhoAtual();
    const rota = ROTAS.find((r) => r.padrao.test(caminho));
    const minha = ++geracao;
    if (typeof limpeza === 'function') limpeza();
    limpeza = null;

    if (!rota) { ctx.navegar('/'); return; }
    const m = caminho.match(rota.padrao);
    const params = Object.fromEntries((rota.params ?? []).map((n, i) => [n, m[i + 1]]));
    aoNavegar(rota.nav);

    const destino = document.createElement('div');
    destino.className = 'pagina';
    try {
      const r = await rota.pagina.render(destino, params, ctx);
      if (minha !== geracao) { if (typeof r === 'function') r(); return; }
      limpeza = r;
      container.replaceChildren(destino);
      container.focus({ preventScroll: true });
      globalThis.scrollTo?.(0, 0);
    } catch (e) {
      console.error(e);
      if (minha !== geracao) return;
      const erro = document.createElement('div');
      erro.className = 'pagina';
      erro.innerHTML = '<div class="estado-vazio"><h2>Algo deu errado</h2><p></p></div>';
      erro.querySelector('p').textContent = e?.message ?? 'Erro inesperado ao abrir a tela.';
      container.replaceChildren(erro);
    }
  }

  ctx.navegar = (caminho) => {
    if (caminhoAtual() === caminho) renderizar();
    else globalThis.location.hash = `#${caminho}`;
  };
  ctx.recarregar = renderizar;
  globalThis.addEventListener('hashchange', renderizar);
  return renderizar();
}
