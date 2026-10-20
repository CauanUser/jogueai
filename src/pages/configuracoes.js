import { h, comBotaoOcupado } from '../components/dom.js';
import { confirmar } from '../components/dialogo.js';
import { toast } from '../components/toast.js';
import { formatarHora } from '../utils/datas.js';
import { STORES } from '../services/localStore.js';

const NOMES_TABELA = { sessoes: 'Sessão', participantes: 'Participante', sorteios: 'Sorteio', equipes: 'Equipes do sorteio', equipe_participantes: 'Jogadores dos times' };
const NOMES_ACAO = { upsert: 'salvar', delete: 'excluir' };

function descreverOperacao(op) {
  const alvo = op.dados?.nome ? ` "${op.dados.nome}"` : op.dados?.data_referencia ? ` de ${op.dados.data_referencia}` : '';
  return `${NOMES_TABELA[op.tabela] ?? op.tabela}${alvo}: ${NOMES_ACAO[op.acao] ?? op.acao}`;
}

function secaoConta(ctx) {
  const sec = h('section', { class: 'cartao', 'aria-labelledby': 'tit-conta' },
    h('h2', { id: 'tit-conta' }, 'Conta do organizador'));

  if (!ctx.supabaseConfigurado) {
    sec.append(h('p', {}, 'Este aplicativo foi gerado sem a configuração do Supabase. Tudo funciona e fica salvo neste aparelho, mas nada é enviado ao servidor.'),
      h('p', { class: 'texto-suave' }, 'Para ativar, defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY e gere o aplicativo novamente (veja o README).'));
    return sec;
  }

  const usuario = ctx.auth.usuario();
  if (usuario) {
    const btnSair = h('button', { class: 'btn btn-secundario', type: 'button' }, 'Sair da conta');
    btnSair.addEventListener('click', () => comBotaoOcupado(btnSair, async () => {
      const pend = ctx.fila.estado.pendentes;
      const ok = await confirmar({
        titulo: 'Sair da conta?',
        mensagem: pend
          ? `Há ${pend} alteração(ões) ainda não enviada(s). Elas continuam salvas no aparelho e serão enviadas quando você entrar novamente.`
          : 'Os dados continuam salvos no aparelho.',
        textoConfirmar: 'Sair',
      });
      if (!ok) return;
      await ctx.auth.sair();
      toast('Você saiu da conta.');
      ctx.recarregar();
    }));
    sec.append(h('p', {}, 'Conectado como ', h('strong', {}, usuario.email ?? usuario.id)));
    if (!ctx.auth.vinculado()) {
      sec.append(h('p', { class: 'erro-campo' }, 'Esta conta não é a vinculada ao aparelho. A sincronização está suspensa.'));
    }
    sec.append(btnSair);
    return sec;
  }

  const erro = h('p', { class: 'erro-campo', 'aria-live': 'polite' });
  const email = h('input', { id: 'email', class: 'campo', type: 'email', autocomplete: 'username', inputmode: 'email', required: true });
  const senha = h('input', { id: 'senha', class: 'campo', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn btn-primario btn-grande', type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'formulario', novalidate: true },
    h('p', { class: 'texto-suave' }, 'Entre com a conta do organizador para guardar os dados também na nuvem. Sem entrar, tudo continua salvo neste aparelho.'),
    h('label', { for: 'email', class: 'rotulo-campo' }, 'E-mail'), email,
    h('label', { for: 'senha', class: 'rotulo-campo' }, 'Senha'), senha,
    erro, btn);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    comBotaoOcupado(btn, async () => {
      erro.textContent = '';
      try {
        await ctx.auth.entrar(email.value, senha.value);
        senha.value = '';
        toast('Conta conectada.');
        const locais = await ctx.store.contar(STORES.SESSOES);
        if (locais === 0) {
          try {
            const r = await ctx.baixarDoServidor();
            if (r.sessoes) toast(`${r.sessoes} sessão(ões) recuperada(s) do servidor.`);
          } catch (e) { toast(e.message, 'erro'); }
        }
        await ctx.fila.processar();
        ctx.recarregar();
      } catch (e) {
        erro.textContent = e.message;
      }
    });
  });
  sec.append(form);
  return sec;
}

function secaoSync(ctx) {
  const corpo = h('div', { 'aria-live': 'polite' });
  const btnSync = h('button', { class: 'btn btn-primario', type: 'button' }, 'Sincronizar agora');
  btnSync.addEventListener('click', () => comBotaoOcupado(btnSync, async () => {
    const e = await ctx.fila.processar();
    if (e.erro) toast('Uma alteração foi recusada pelo servidor. Veja os detalhes abaixo.', 'erro');
    else if (e.bloqueio) toast(e.bloqueio, 'info');
    else if (e.falhaTransitoria) toast(e.falhaTransitoria.mensagem, 'erro');
    else toast('Tudo sincronizado.');
  }));

  const btnBaixar = h('button', { class: 'btn btn-secundario', type: 'button' }, 'Baixar dados do servidor');
  btnBaixar.addEventListener('click', () => comBotaoOcupado(btnBaixar, async () => {
    try {
      const r = await ctx.baixarDoServidor();
      toast(`Recebidos: ${r.sessoes} sessão(ões) e ${r.participantes} participante(s).`);
    } catch (e) { toast(e.message, 'erro'); }
  }));

  const sec = h('section', { class: 'cartao', 'aria-labelledby': 'tit-sync' },
    h('h2', { id: 'tit-sync' }, 'Sincronização'), corpo,
    h('div', { class: 'acoes acoes-coluna' }, btnSync, ctx.auth.vinculado() ? btnBaixar : null));

  const desenhar = (e) => {
    const linhas = [];
    if (!ctx.supabaseConfigurado) linhas.push(h('p', {}, 'Desativada: os dados ficam apenas neste aparelho.'));
    else if (e.bloqueio) linhas.push(h('p', {}, e.bloqueio));
    linhas.push(h('p', {}, e.pendentes
      ? `${e.pendentes} alteração(ões) aguardando envio. Elas estão salvas no aparelho.`
      : 'Nenhuma alteração pendente.'));
    if (e.ultimoSucessoEm) linhas.push(h('p', { class: 'texto-suave' }, `Último envio bem-sucedido às ${formatarHora(e.ultimoSucessoEm)}.`));
    if (e.falhaTransitoria && !e.erro) {
      linhas.push(h('p', { class: 'aviso-texto' }, `${e.falhaTransitoria.mensagem}`));
    }
    if (e.erro) {
      const op = e.erro;
      const tentar = h('button', { class: 'btn btn-primario', type: 'button' }, 'Tentar novamente');
      tentar.addEventListener('click', () => comBotaoOcupado(tentar, () => ctx.fila.tentarNovamente(op.seq)));
      const descartar = h('button', { class: 'btn btn-perigo-texto', type: 'button' }, 'Descartar esta alteração');
      descartar.addEventListener('click', () => comBotaoOcupado(descartar, async () => {
        const ok = await confirmar({
          titulo: 'Descartar a alteração?',
          mensagem: 'Ela continuará no aparelho, mas NÃO será enviada ao servidor. Use apenas se tiver certeza de que ela está incorreta.',
          textoConfirmar: 'Descartar', perigo: true,
        });
        if (ok) { await ctx.fila.descartar(op.seq); toast('Alteração descartada.', 'info'); }
      }));
      linhas.push(h('div', { class: 'cartao-erro', role: 'alert' },
        h('p', {}, h('strong', {}, 'O servidor recusou: '), descreverOperacao(op)),
        h('p', {}, op.ultimoErro),
        h('p', { class: 'texto-suave' }, 'As alterações seguintes aguardam esta ser resolvida, para manter a ordem.'),
        h('div', { class: 'acoes' }, tentar, descartar)));
    }
    corpo.replaceChildren(...linhas);
  };
  const parar = ctx.fila.assinar(desenhar);
  return { sec, parar };
}

export async function render(el, _params, ctx) {
  await ctx.fila.atualizarEstado();
  el.append(h('h1', {}, 'Configurações'));
  el.append(secaoConta(ctx));
  const sync = secaoSync(ctx);
  el.append(sync.sec);
  el.append(h('section', { class: 'cartao', 'aria-labelledby': 'tit-sobre' },
    h('h2', { id: 'tit-sobre' }, 'Sobre'),
    h('p', {}, h('strong', {}, 'JogueAI'), ` versão ${ctx.config.versao}`),
    h('p', { class: 'texto-suave' }, 'Times equilibrados. Jogos melhores.')));
  return sync.parar;
}
