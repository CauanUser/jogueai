import { h } from './dom.js';

/** Converte o estado da fila em um rótulo e uma cor. */
export function descreverEstadoSync(e, { configurado }) {
  if (!configurado) return { texto: 'Só no aparelho', tom: 'neutro' };
  if (e.erro) return { texto: 'Erro ao sincronizar', tom: 'erro' };
  if (e.bloqueio) return { texto: e.pendentes ? `${e.pendentes} pendente(s) · entrar` : 'Entrar p/ sincronizar', tom: 'alerta' };
  if (e.sincronizando) return { texto: 'Sincronizando…', tom: 'info' };
  if (e.falhaTransitoria) return { texto: `Sem conexão · ${e.pendentes} pendente(s)`, tom: 'alerta' };
  if (e.pendentes > 0) return { texto: `${e.pendentes} pendente(s)`, tom: 'alerta' };
  return { texto: 'Sincronizado', tom: 'ok' };
}

export function indicadorSync(ctx) {
  const el = h('a', { class: 'sync', href: '#/configuracoes', 'aria-live': 'polite' });
  ctx.fila.assinar((estado) => {
    const { texto, tom } = descreverEstadoSync(estado, { configurado: ctx.supabaseConfigurado });
    el.className = `sync sync-${tom}`;
    el.textContent = texto;
    el.setAttribute('aria-label', `Sincronização: ${texto}. Abrir configurações.`);
  });
  return el;
}
