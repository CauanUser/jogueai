import './styles/main.css';
import { App } from '@capacitor/app';
import { criarApp } from './app.js';
import { iniciarRoteador, caminhoAtual } from './router.js';
import { h, icone } from './components/dom.js';
import { indicadorSync } from './components/indicadorSync.js';

function montarCasca(ctx) {
  const conteudo = h('main', { id: 'conteudo', tabindex: '-1' });
  const itensNav = {
    inicio: h('a', { href: '#/', class: 'nav-item' }, icone('inicio'), h('span', {}, 'Início')),
    config: h('a', { href: '#/configuracoes', class: 'nav-item' }, icone('config'), h('span', {}, 'Configurações')),
  };
  const casca = h('div', { class: 'casca' },
    h('header', { class: 'topo' },
      h('a', { href: '#/', class: 'marca', 'aria-label': 'JogueAI, início' },
        h('img', { src: '/LogoTelaInicialAbertura.jpeg', alt: 'JogueAI', class: 'marca-logo' })),
      indicadorSync(ctx),
    ),
    conteudo,
    h('nav', { class: 'nav-inferior', 'aria-label': 'Navegação principal' }, Object.values(itensNav)),
  );
  const marcarNav = (ativo) => {
    for (const [k, el] of Object.entries(itensNav)) {
      if (k === ativo) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
  };
  return { casca, conteudo, marcarNav };
}

async function iniciar() {
  const raiz = document.getElementById('app');
  try {
    const ctx = await criarApp();
    const { casca, conteudo, marcarNav } = montarCasca(ctx);
    raiz.replaceChildren(casca);
    await iniciarRoteador({ container: conteudo, ctx, aoNavegar: marcarNav });

    // Integração Android: voltar e retorno do segundo plano.
    App.addListener('backButton', () => {
      if (document.querySelector('dialog[open]')) return; // o diálogo trata o "voltar"
      if (caminhoAtual() !== '/') globalThis.history.back();
      else App.exitApp();
    }).catch(() => {});
    App.addListener('appStateChange', ({ isActive }) => {
      if (!ctx.client) return;
      if (isActive) { ctx.client.auth.startAutoRefresh(); ctx.fila.processar(); }
      else ctx.client.auth.stopAutoRefresh();
    }).catch(() => {});
  } catch (e) {
    console.error(e);
    raiz.replaceChildren(h('div', { class: 'erro-fatal' },
      h('h1', {}, 'Não foi possível iniciar o JogueAI'),
      h('p', {}, e?.message ?? String(e)),
      h('button', { class: 'btn btn-primario', onClick: () => location.reload() }, 'Tentar novamente')));
  }
}

iniciar();
