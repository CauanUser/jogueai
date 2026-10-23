import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { confirmar } from '../components/dialogo.js';
import { toast } from '../components/toast.js';
import { formatarDataReferencia } from '../utils/datas.js';
import { STATUS_SESSAO } from '../domain/sessao.js';
import { STORES } from '../services/localStore.js';

export async function render(el, _params, ctx) {
  const [sessoes, todosParticipantes] = await Promise.all([
    ctx.sessoes.listar(),
    ctx.store.listar(STORES.PARTICIPANTES),
  ]);
  const contagem = new Map();
  for (const p of todosParticipantes) contagem.set(p.sessao_id, (contagem.get(p.sessao_id) ?? 0) + 1);

  const ativa = sessoes.find((s) => s.status === STATUS_SESSAO.EM_ANDAMENTO);
  const sorteioAtivo = ativa ? await ctx.sorteios.atual(ativa.id) : null;
  let partidaEmCurso = ativa ? await ctx.partidas.ativa(ativa.id) : null;
  if (partidaEmCurso) {
    // Se o tempo acabou com o app fechado, registra o fim agora (no instante correto).
    await ctx.partidas.aplicarEventoAutomatico(partidaEmCurso.id).catch(() => null);
    partidaEmCurso = await ctx.partidas.ativa(ativa.id);
  }
  const anteriores = sessoes.filter((s) => s !== ativa);

  el.append(h('section', { class: 'boas-vindas' },
    h('h1', {}, 'JogueAI'),
    h('p', { class: 'slogan' }, 'Times equilibrados. Jogos melhores.')));

  el.append(h('section', { class: 'cartao' },
    h('h2', {}, 'Banco de jogadores'),
    h('p', {}, 'Salve os nomes e níveis para os próximos rachas.'),
    h('a', { class: 'btn btn-secundario btn-grande', href: '#/jogadores' }, 'Gerenciar jogadores')));

  if (ativa) {
    const n = contagem.get(ativa.id) ?? 0;
    const btnEncerrar = h('button', { class: 'btn btn-secundario', type: 'button' }, 'Encerrar sessão');
    btnEncerrar.addEventListener('click', () => comBotaoOcupado(btnEncerrar, async () => {
      const ok = await confirmar({
        titulo: 'Encerrar a sessão?',
        mensagem: 'Os dados ficam guardados no histórico. Depois de encerrada, os participantes não podem mais ser alterados.',
        textoConfirmar: 'Encerrar',
      });
      if (!ok) return;
      try {
        await ctx.sessoes.encerrar(ativa.id);
        toast('Sessão encerrada.');
        ctx.recarregar();
      } catch (e) { toast(e.message, 'erro'); }
    }));

    el.append(h('section', { class: 'cartao cartao-destaque', 'aria-labelledby': 'tit-ativa' },
      h('p', { class: 'rotulo' }, 'Sessão em andamento'),
      h('h2', { id: 'tit-ativa' }, formatarDataReferencia(ativa.data_referencia)),
      h('p', {}, n === 1 ? '1 participante' : `${n} participantes`),
      h('div', { class: 'acoes acoes-coluna' },
        partidaEmCurso
          ? h('a', { class: 'btn btn-primario btn-grande btn-partida', href: `#/partida/${partidaEmCurso.id}` }, `Partida nº ${partidaEmCurso.numero} em andamento`)
          : null,
        sorteioAtivo
          ? h('a', { class: `btn ${partidaEmCurso ? 'btn-secundario' : 'btn-primario btn-grande'}`, href: `#/sessao/${ativa.id}/equipes` }, 'Times e partidas')
          : null,
        h('a', { class: `btn ${sorteioAtivo ? 'btn-secundario' : 'btn-primario btn-grande'}`, href: `#/sessao/${ativa.id}` }, 'Participantes'),
        btnEncerrar)));
  } else {
    el.append(h('section', { class: 'cartao estado-vazio' },
      h('h2', {}, 'Nenhuma sessão em andamento'),
      h('p', {}, 'Comece o racha de hoje criando uma sessão e adicionando quem está presente.'),
      h('a', { class: 'btn btn-primario btn-grande', href: '#/sessao/nova' }, icone('mais'), 'Nova sessão de racha')));
  }

  const lista = h('ul', { class: 'lista', role: 'list' });
  for (const s of anteriores) {
    const n = contagem.get(s.id) ?? 0;
    lista.append(h('li', {},
      h('a', { class: 'item-lista', href: `#/sessao/${s.id}` },
        h('span', { class: 'item-titulo' }, formatarDataReferencia(s.data_referencia)),
        h('span', { class: 'item-sub' }, `${n} participante(s) · encerrada`))));
  }
  el.append(h('section', { 'aria-labelledby': 'tit-anteriores' },
    h('h2', { id: 'tit-anteriores', class: 'titulo-secao' }, 'Sessões anteriores'),
    anteriores.length ? lista : h('p', { class: 'texto-suave' }, 'As sessões encerradas aparecerão aqui.')));
}
