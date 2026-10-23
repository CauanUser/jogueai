import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { confirmar, abrirDialogo } from '../components/dialogo.js';
import { toast } from '../components/toast.js';
import { seletorNota } from '../components/seletorNota.js';
import { formatarDataReferencia } from '../utils/datas.js';
import { participantesEditaveis, resumoParticipantes, STATUS_SESSAO, temNota } from '../domain/sessao.js';
import { NOTA_MIN, NOTA_MAX } from '../domain/validacao.js';
import { NOME_MAX } from '../domain/validacao.js';

const NOTA_INICIAL = 5;

/** Campos nome + nota reutilizados no cadastro e na edição. */
function camposParticipante({ prefixo, nome = '', nota = NOTA_INICIAL, mostrarGoleiro = false, goleiro = false }) {
  const erroNome = h('p', { class: 'erro-campo', id: `${prefixo}-erro-nome`, 'aria-live': 'polite' });
  const erroNota = h('p', { class: 'erro-campo', id: `${prefixo}-erro-nota`, 'aria-live': 'polite' });
  const inputNome = h('input', {
    id: `${prefixo}-nome`, class: 'campo', type: 'text', value: nome, maxlength: String(NOME_MAX),
    autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done',
    'aria-describedby': `${prefixo}-erro-nome`,
  });
  const seletor = seletorNota({ valor: nota, idRotulo: `${prefixo}-rotulo-nota` });
  const inputGoleiro = mostrarGoleiro ? h('input', { id: `${prefixo}-goleiro`, type: 'checkbox', checked: Boolean(goleiro) }) : null;
  const campoGoleiro = mostrarGoleiro ? h('label', { class: 'opcao-goleiro', for: `${prefixo}-goleiro` }, inputGoleiro, ' É goleiro') : null;
  return {
    inputNome,
    seletor,
    el: [
      h('label', { for: `${prefixo}-nome`, class: 'rotulo-campo' }, 'Nome'),
      inputNome, erroNome,
      h('p', { id: `${prefixo}-rotulo-nota`, class: 'rotulo-campo' }, 'Nota de habilidade (1 a 10)'),
      seletor.el, erroNota,
      ...(campoGoleiro ? [campoGoleiro] : []),
    ],
    mostrarErros(erros = {}) {
      erroNome.textContent = erros.nome ?? '';
      erroNota.textContent = erros.nota ?? '';
      inputNome.toggleAttribute('aria-invalid', Boolean(erros.nome));
    },
    valores: () => ({ nome: inputNome.value, nota: seletor.valor(), ...(inputGoleiro ? { goleiro: inputGoleiro.checked } : {}) }),
  };
}

function editarParticipante(ctx, p, mostrarGoleiro = false) {
  return abrirDialogo((fechar) => {
    const campos = camposParticipante({ prefixo: 'editar', nome: p.nome, nota: p.nota, mostrarGoleiro, goleiro: p.goleiro });
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
  const configSessao = await ctx.store.obterMeta('sessao_config_' + id) ?? { modalidade: 'futebol', modo: 'racha' };
  const bancoJogadores = await ctx.jogadores.listar();
  const participantesIniciais = await ctx.participantes.listarPorSessao(id);

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

  const avisoNotas = h('p', { class: 'aviso-notas', role: 'status' });
  let atuais = [];

  function atualizarResumo() {
    const r = resumoParticipantes(atuais);
    resumo.textContent = r.total
      ? `${r.total} jogador(es) · soma das notas ${r.somaNotas} · média ${r.media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`
      : '';
    avisoNotas.hidden = r.semNota === 0;
    avisoNotas.textContent = r.semNota === 1
      ? '1 jogador ainda está sem nota. Escolha a nota na lista abaixo antes do sorteio.'
      : `${r.semNota} jogadores ainda estão sem nota. Escolha a nota de cada um na lista abaixo antes do sorteio.`;
  }

  /** Nota editável direto na lista (rápido para preencher vários jogadores importados). */
  function campoNota(p, travado) {
    const vazia = !temNota(p);
    if (!editavel || travado) {
      return h('span', { class: `nota ${vazia ? 'nota-vazia' : ''}`, 'aria-label': vazia ? 'sem nota' : `nota ${p.nota}` },
        vazia ? '—' : String(p.nota));
    }
    const opcoes = [h('option', { value: '', disabled: true }, 'Nota')];
    for (let n = NOTA_MIN; n <= NOTA_MAX; n++) opcoes.push(h('option', { value: String(n) }, String(n)));
    const sel = h('select', { class: `nota-select ${vazia ? 'nota-vazia' : ''}`, 'aria-label': `Nota de ${p.nome}` }, opcoes);
    sel.value = vazia ? '' : String(p.nota);
    sel.addEventListener('change', async () => {
      const nota = Number(sel.value);
      try {
        await ctx.participantes.editar(p.id, { nome: p.nome, nota });
        p.nota = nota;
        sel.classList.remove('nota-vazia');
        atualizarResumo();
      } catch (e) {
        toast(e.erros?.nota ?? e.message, 'erro');
        sel.value = temNota(p) ? String(p.nota) : '';
      }
    });
    return sel;
  }

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
    atuais = participantes;
    atualizarResumo();
    vazio.hidden = participantes.length > 0;
    lista.replaceChildren(...participantes.map((p, i) => {
      const acoes = editavel ? h('div', { class: 'item-acoes' },
        h('button', {
          class: 'btn-icone', type: 'button', 'aria-label': `Editar ${p.nome}`,
          onClick: async () => {
            if (await editarParticipante(ctx, p, configSessao.modalidade === 'futebol')) { toast('Participante atualizado.'); atualizarLista(); }
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
          configSessao.modalidade === 'futebol' && p.goleiro ? h('span', { class: 'chip chip-ok' }, 'Goleiro') : null,
          timeDe.has(p.id)
            ? h('span', { class: 'chip-time', style: `--cor-equipe: ${timeDe.get(p.id).cor}` }, timeDe.get(p.id).nome)
            : null,
          pendentes.has(p.id) ? h('span', { class: 'pendente', title: 'Aguardando envio ao servidor' }, ' • pendente') : null),
        campoNota(p, timeDe.has(p.id)),
        acoes);
    }));
  }

  el.append(cabecalho);

  // Na abertura de uma sessão, a primeira tarefa é marcar quem compareceu.
  const nomesJaNaSessao = new Set(participantesIniciais.map((p) => p.nome.trim().toLocaleLowerCase('pt-BR')));
  const selecionadosBanco = new Set();
  const listaBanco = h('div', { class: 'lista lista-jogadores-banco-presenca' });
  const btnConfirmarPresenca = h('button', { class: 'btn btn-primario btn-grande', type: 'button', disabled: true }, 'Confirmar presença (0)');
  const painelBanco = h('section', { class: 'cartao formulario', 'aria-label': 'Selecionar presença do banco de jogadores' },
    h('h2', {}, 'Quem veio hoje?'),
    h('p', { class: 'texto-suave' }, 'Marque apenas quem está presente neste racha. Os outros continuam salvos no banco para os próximos domingos.'),
    bancoJogadores.length ? listaBanco : h('div', { class: 'estado-vazio estado-vazio-compacto' },
      h('p', {}, 'Seu banco de jogadores está vazio. Cadastre os nomes uma vez para selecioná-los aqui.'),
      h('a', { class: 'btn btn-secundario', href: '#/jogadores' }, 'Abrir banco de jogadores')),
    btnConfirmarPresenca);
  const btnMostrarBanco = h('button', { class: 'btn btn-secundario btn-grande', type: 'button' }, 'Adicionar jogadores do banco');
  btnMostrarBanco.hidden = participantesIniciais.length === 0;
  painelBanco.hidden = participantesIniciais.length > 0;

  for (const jogador of bancoJogadores) {
    const chave = jogador.nome.trim().toLocaleLowerCase('pt-BR');
    const jaAdicionado = nomesJaNaSessao.has(chave);
    const check = h('input', { type: 'checkbox', value: jogador.id, disabled: jaAdicionado, 'aria-label': `Marcar presença de ${jogador.nome}` });
    check.addEventListener('change', () => {
      if (check.checked) selecionadosBanco.add(jogador.id);
      else selecionadosBanco.delete(jogador.id);
      btnConfirmarPresenca.textContent = `Confirmar presença (${selecionadosBanco.size})`;
      btnConfirmarPresenca.disabled = selecionadosBanco.size === 0;
    });
    listaBanco.append(h('label', { class: 'item-lista linha-jogador-banco' },
      check,
      h('span', { class: 'jogador-banco-info' },
        h('span', { class: 'item-titulo' }, jogador.nome),
        h('span', { class: 'item-sub' }, jaAdicionado ? 'Já está nesta sessão' : `Nível ${jogador.nota}/10`))));
  }

  btnMostrarBanco.addEventListener('click', () => { painelBanco.hidden = !painelBanco.hidden; });
  btnConfirmarPresenca.addEventListener('click', () => comBotaoOcupado(btnConfirmarPresenca, async () => {
    const atuaisBanco = await ctx.participantes.listarPorSessao(id);
    const nomesAtuais = new Set(atuaisBanco.map((p) => p.nome.trim().toLocaleLowerCase('pt-BR')));
    let adicionados = 0;
    let ignorados = 0;
    for (const jogador of bancoJogadores.filter((j) => selecionadosBanco.has(j.id))) {
      const chave = jogador.nome.trim().toLocaleLowerCase('pt-BR');
      if (nomesAtuais.has(chave)) { ignorados++; continue; }
      try {
        await ctx.participantes.adicionar(id, { nome: jogador.nome, nota: jogador.nota });
        nomesAtuais.add(chave);
        adicionados++;
      } catch (e) {
        toast(e.message, 'erro');
        return;
      }
    }
    selecionadosBanco.clear();
    listaBanco.querySelectorAll('input[type=checkbox]').forEach((check) => {
      if (nomesAtuais.has(bancoJogadores.find((j) => j.id === check.value)?.nome.trim().toLocaleLowerCase('pt-BR'))) {
        check.checked = false;
        check.disabled = true;
        const sub = check.closest('label')?.querySelector('.item-sub');
        if (sub) sub.textContent = 'Já está nesta sessão';
      }
    });
    btnConfirmarPresenca.textContent = 'Confirmar presença (0)';
    btnConfirmarPresenca.disabled = true;
    painelBanco.hidden = true;
    btnMostrarBanco.hidden = false;
    toast(`${adicionados} presente(s) adicionado(s)${ignorados ? `; ${ignorados} já estavam na sessão` : ''}.`);
    await atualizarLista();
  }));

  el.append(btnMostrarBanco, painelBanco);
  if (editavel && configSessao.modo === 'partida') el.append(h('a', { class: 'btn btn-primario btn-grande', href: '#/sessao/' + id + '/times-manuais' }, 'Montar times manualmente'));

  if (editavel) {
    const campos = camposParticipante({ prefixo: 'novo', mostrarGoleiro: configSessao.modalidade === 'futebol' });
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
          const checkGoleiro = form.querySelector(`#novo-goleiro`);
          if (checkGoleiro) checkGoleiro.checked = false;
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
    el.append(h('a', { class: 'btn btn-secundario btn-importar', href: `#/sessao/${id}/importar` },
      icone('lista'), 'Importar lista do WhatsApp'));
  }

  el.append(h('section', { 'aria-label': 'Lista de participantes' }, resumo, avisoNotas, lista, vazio));

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
