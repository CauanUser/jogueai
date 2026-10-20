import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { confirmar, abrirDialogo } from '../components/dialogo.js';
import { toast } from '../components/toast.js';
import { seletorNota } from '../components/seletorNota.js';
import { formatarDataReferencia } from '../utils/datas.js';
import { participantesEditaveis, resumoParticipantes, STATUS_SESSAO } from '../domain/sessao.js';
import { NOME_MAX } from '../domain/validacao.js';

const NOTA_INICIAL = 5;

/** Campos nome + nota reutilizados no cadastro e na edição. */
function camposParticipante({ prefixo, nome = '', nota = NOTA_INICIAL }) {
  const erroNome = h('p', { class: 'erro-campo', id: `${prefixo}-erro-nome`, 'aria-live': 'polite' });
  const erroNota = h('p', { class: 'erro-campo', id: `${prefixo}-erro-nota`, 'aria-live': 'polite' });
  const inputNome = h('input', {
    id: `${prefixo}-nome`, class: 'campo', type: 'text', value: nome, maxlength: String(NOME_MAX),
    autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done',
    'aria-describedby': `${prefixo}-erro-nome`,
  });
  const seletor = seletorNota({ valor: nota, idRotulo: `${prefixo}-rotulo-nota` });
  return {
    inputNome,
    seletor,
    el: [
      h('label', { for: `${prefixo}-nome`, class: 'rotulo-campo' }, 'Nome'),
      inputNome, erroNome,
      h('p', { id: `${prefixo}-rotulo-nota`, class: 'rotulo-campo' }, 'Nota de habilidade (1 a 10)'),
      seletor.el, erroNota,
    ],
    mostrarErros(erros = {}) {
      erroNome.textContent = erros.nome ?? '';
      erroNota.textContent = erros.nota ?? '';
      inputNome.toggleAttribute('aria-invalid', Boolean(erros.nome));
    },
    valores: () => ({ nome: inputNome.value, nota: seletor.valor() }),
  };
}

function editarParticipante(ctx, p) {
  return abrirDialogo((fechar) => {
    const campos = camposParticipante({ prefixo: 'editar', nome: p.nome, nota: p.nota });
    campos.inputNome.setAttribute('autofocus', '');
    const btnSalvar = h('button', { class: 'btn btn-primario', type: 'submit' }, 'Salvar');
    const form = h('form', { class: 'dialogo-corpo', novalidate: true },
      h('h2', {}, 'Editar participante'),
      campos.el,
      h('div', { class: 'acoes' },
        h('button', { class: 'btn btn-secundario', type: 'button', onClick: () => fechar(false) }, 'Cancelar'),
        btnSalvar));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      comBotaoOcupado(btnSalvar, async () => {
        try {
          await ctx.participantes.editar(p.id, campos.valores());
          fechar(true);
        } catch (e) {
          if (e.erros) campos.mostrarErros(e.erros);
          else toast(e.message, 'erro');
        }
      });
    });
    return form;
  }, { rotulo: 'Editar participante' });
}

export async function render(el, { id }, ctx) {
  const sessao = await ctx.sessoes.obter(id);
  if (!sessao) {
    el.append(h('div', { class: 'estado-vazio' },
      h('h1', {}, 'Sessão não encontrada'),
      h('p', {}, 'Ela pode ter sido excluída.'),
      h('a', { class: 'btn btn-primario', href: '#/' }, 'Voltar ao início')));
    return;
  }
  const editavel = participantesEditaveis(sessao);

  const cabecalho = h('div', { class: 'cabecalho-pagina' },
    h('a', { class: 'btn-icone', href: '#/', 'aria-label': 'Voltar ao início' }, icone('voltar')),
    h('div', {},
      h('h1', {}, 'Participantes'),
      h('p', { class: 'texto-suave' },
        formatarDataReferencia(sessao.data_referencia), ' · ',
        h('span', { class: `chip ${editavel ? 'chip-ok' : 'chip-neutro'}` },
          editavel ? 'Em andamento' : 'Encerrada'))));

  const resumo = h('p', { class: 'resumo', 'aria-live': 'polite' });
  const lista = h('ol', { class: 'lista lista-participantes' });
  const vazio = h('div', { class: 'estado-vazio estado-vazio-compacto' },
    h('p', {}, editavel
      ? 'Nenhum participante ainda. Adicione os jogadores presentes na ordem de chegada.'
      : 'Esta sessão não teve participantes cadastrados.'));

  async function atualizarLista() {
    const [participantes, pendentes, sorteioAtual] = await Promise.all([
      ctx.participantes.listarPorSessao(id),
      ctx.fila.registrosPendentes(),
      ctx.sorteios.atual(id),
    ]);
    // Em qual time (do sorteio atual) cada participante está.
    const timeDe = new Map();
    for (const e of sorteioAtual?.equipes ?? []) for (const j of e.jogadores) timeDe.set(j.id, e);
    atualizarAcoesSorteio(participantes.length, Boolean(sorteioAtual));
    const r = resumoParticipantes(participantes);
    resumo.textContent = r.total
      ? `${r.total} jogador(es) · soma das notas ${r.somaNotas} · média ${r.media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`
      : '';
    vazio.hidden = r.total > 0;
    lista.replaceChildren(...participantes.map((p, i) => {
      const acoes = editavel ? h('div', { class: 'item-acoes' },
        h('button', {
          class: 'btn-icone', type: 'button', 'aria-label': `Editar ${p.nome}`,
          onClick: async () => {
            if (await editarParticipante(ctx, p)) { toast('Participante atualizado.'); atualizarLista(); }
          },
        }, icone('editar')),
        h('button', {
          class: 'btn-icone btn-icone-perigo', type: 'button', 'aria-label': `Remover ${p.nome}`,
          onClick: async (ev) => {
            const botao = ev.currentTarget;
            await comBotaoOcupado(botao, async () => {
              const ok = await confirmar({
                titulo: `Remover ${p.nome}?`,
                mensagem: 'O participante sairá desta sessão.',
                textoConfirmar: 'Remover', perigo: true,
              });
              if (!ok) return;
              try {
                await ctx.participantes.remover(p.id);
                toast(`${p.nome} removido(a).`);
                atualizarLista();
              } catch (e) { toast(e.message, 'erro'); }
            });
          },
        }, icone('remover'))) : null;

      return h('li', { class: 'item-participante' },
        h('span', { class: 'ordem', 'aria-hidden': 'true' }, String(i + 1)),
        h('span', { class: 'item-nome' }, p.nome,
          timeDe.has(p.id)
            ? h('span', { class: 'chip-time', style: `--cor-equipe: ${timeDe.get(p.id).cor}` }, timeDe.get(p.id).nome)
            : null,
          pendentes.has(p.id) ? h('span', { class: 'pendente', title: 'Aguardando envio ao servidor' }, ' • pendente') : null),
        h('span', { class: 'nota', 'aria-label': `nota ${p.nota}` }, String(p.nota)),
        acoes);
    }));
  }

  el.append(cabecalho);

  if (editavel) {
    const campos = camposParticipante({ prefixo: 'novo' });
    const btnAdd = h('button', { class: 'btn btn-primario btn-grande', type: 'submit' }, icone('mais'), 'Adicionar');
    const form = h('form', { class: 'cartao formulario', novalidate: true, 'aria-label': 'Adicionar participante' },
      campos.el, btnAdd);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      comBotaoOcupado(btnAdd, async () => {
        try {
          const p = await ctx.participantes.adicionar(id, campos.valores());
          campos.mostrarErros({});
          campos.inputNome.value = '';
          campos.seletor.definir(NOTA_INICIAL);
          campos.inputNome.focus();
          toast(`${p.nome} adicionado(a).`);
          await atualizarLista();
        } catch (e) {
          if (e.erros) { campos.mostrarErros(e.erros); campos.inputNome.focus(); }
          else toast(e.message, 'erro');
        }
      });
    });
    el.append(form);
  }

  el.append(h('section', { 'aria-label': 'Lista de participantes' }, resumo, lista, vazio));

  // Próximo passo: sorteio / times
  const areaSorteio = h('section', { class: 'acoes acoes-coluna', 'aria-label': 'Times' });
  el.append(areaSorteio);
  function atualizarAcoesSorteio(total, temSorteio) {
    const itens = [];
    if (temSorteio) itens.push(h('a', { class: 'btn btn-primario btn-grande', href: `#/sessao/${id}/equipes` }, 'Ver times'));
    if (editavel && total >= 2) {
      itens.push(h('a', { class: `btn ${temSorteio ? 'btn-secundario' : 'btn-primario btn-grande'}`, href: `#/sessao/${id}/sorteio` },
        temSorteio ? 'Novo sorteio' : 'Sortear times'));
    }
    areaSorteio.replaceChildren(...itens);
  }

  // Ações da sessão
  const btnEstado = h('button', { class: 'btn btn-secundario', type: 'button' },
    sessao.status === STATUS_SESSAO.EM_ANDAMENTO ? 'Encerrar sessão' : 'Reabrir sessão');
  btnEstado.addEventListener('click', () => comBotaoOcupado(btnEstado, async () => {
    const encerrar = sessao.status === STATUS_SESSAO.EM_ANDAMENTO;
    const ok = await confirmar(encerrar
      ? { titulo: 'Encerrar a sessão?', mensagem: 'Depois de encerrada, os participantes não podem mais ser alterados. Os dados continuam no histórico.', textoConfirmar: 'Encerrar' }
      : { titulo: 'Reabrir a sessão?', mensagem: 'A sessão voltará a ficar em andamento.', textoConfirmar: 'Reabrir' });
    if (!ok) return;
    try {
      if (encerrar) await ctx.sessoes.encerrar(id); else await ctx.sessoes.reabrir(id);
      toast(encerrar ? 'Sessão encerrada.' : 'Sessão reaberta.');
      ctx.recarregar();
    } catch (e) { toast(e.message, 'erro'); }
  }));

  const btnExcluir = h('button', { class: 'btn btn-perigo-texto', type: 'button' }, 'Excluir sessão');
  btnExcluir.addEventListener('click', () => comBotaoOcupado(btnExcluir, async () => {
    const ok = await confirmar({
      titulo: 'Excluir esta sessão?',
      mensagem: 'A sessão e todos os seus participantes serão apagados do aparelho e do servidor. Esta ação não pode ser desfeita.',
      textoConfirmar: 'Excluir definitivamente', perigo: true,
    });
    if (!ok) return;
    try {
      await ctx.sessoes.excluir(id);
      toast('Sessão excluída.');
      ctx.navegar('/');
    } catch (e) { toast(e.message, 'erro'); }
  }));

  el.append(h('section', { class: 'acoes-sessao', 'aria-label': 'Ações da sessão' }, btnEstado, btnExcluir));

  await atualizarLista();
  // Atualiza os indicadores "pendente" quando a sincronização avança (com debounce).
  let t = null;
  const parar = ctx.fila.assinar(() => {
    clearTimeout(t);
    t = setTimeout(atualizarLista, 150);
  });
  return () => { clearTimeout(t); parar(); };
}
