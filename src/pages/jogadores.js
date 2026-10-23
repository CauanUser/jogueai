import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { confirmar, abrirDialogo } from '../components/dialogo.js';
import { toast } from '../components/toast.js';
import { seletorNota } from '../components/seletorNota.js';

function dialogoEditar(ctx, jogador) {
  return abrirDialogo((fechar) => {
    const nome = h('input', { class: 'campo', value: jogador.nome, maxlength: '40', required: true, autocomplete: 'off', autocapitalize: 'words' });
    const nota = seletorNota({ valor: jogador.nota });
    const form = h('form', { class: 'dialogo-corpo' },
      h('h2', {}, 'Editar jogador'),
      h('label', { class: 'rotulo-campo' }, 'Nome', nome),
      h('p', { class: 'rotulo-campo' }, 'Nível de habilidade (1 a 10)'),
      nota.el,
      h('div', { class: 'acoes' },
        h('button', { class: 'btn btn-secundario', type: 'button', onClick: () => fechar(false) }, 'Cancelar'),
        h('button', { class: 'btn btn-primario', type: 'submit' }, 'Salvar')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await ctx.jogadores.atualizar(jogador.id, { nome: nome.value, nota: nota.valor() }); fechar(true); }
      catch (e) { toast(e.message, 'erro'); }
    });
    return form;
  }, { rotulo: 'Editar jogador cadastrado' });
}

export async function render(el, _params, ctx) {
  const [jogadores, sessao] = await Promise.all([ctx.jogadores.listar(), ctx.sessoes.emAndamento()]);
  const selecionados = new Set();
  el.append(h('div', { class: 'cabecalho-pagina' },
    h('a', { class: 'btn-icone', href: '#/', 'aria-label': 'Voltar ao início' }, icone('voltar')),
    h('div', {}, h('h1', {}, 'Banco de jogadores'),
      h('p', { class: 'texto-suave' }, 'Cadastre uma vez; os nomes e níveis ficam salvos neste aparelho.'))));

  const nome = h('input', { class: 'campo', type: 'text', maxlength: '40', required: true, placeholder: 'Nome do jogador', autocomplete: 'off', autocapitalize: 'words' });
  const nota = seletorNota({ valor: 5 });
  const btnAdd = h('button', { class: 'btn btn-primario btn-grande', type: 'submit' }, icone('mais'), 'Cadastrar jogador');
  const form = h('form', { class: 'cartao formulario', 'aria-label': 'Cadastrar jogador' },
    h('label', { class: 'rotulo-campo' }, 'Nome', nome),
    h('p', { class: 'rotulo-campo' }, 'Nível de habilidade (1 a 10)'),
    nota.el, btnAdd);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    comBotaoOcupado(btnAdd, async () => {
      try {
        const p = await ctx.jogadores.adicionar({ nome: nome.value, nota: nota.valor() });
        nome.value = '';
        nota.definir(5);
        toast(`${p.nome} cadastrado.`);
        ctx.recarregar();
      } catch (e) { toast(e.message, 'erro'); }
    });
  });
  el.append(form);

  const titulo = h('h2', { class: 'titulo-secao' }, `Jogadores cadastrados (${jogadores.length})`);
  const ajuda = h('p', { class: 'ajuda' }, sessao
    ? 'Marque quem está presente hoje e adicione à sessão atual.'
    : 'Para usar os jogadores em um racha, crie primeiro uma sessão.');
  const lista = h('ul', { class: 'lista' });
  const btnSelecionarTodos = h('button', { class: 'btn btn-secundario', type: 'button' }, 'Selecionar todos');
  const btnAdicionar = h('button', { class: 'btn btn-primario btn-grande', type: 'button', disabled: !sessao }, 'Adicionar selecionados ao racha');
  const resumo = h('p', { class: 'resumo', 'aria-live': 'polite' });
  function atualizarSelecao() {
    resumo.textContent = `${selecionados.size} selecionado(s)`;
    btnAdicionar.textContent = sessao ? `Adicionar ${selecionados.size} ao racha` : 'Nenhuma sessão em andamento';
    btnAdicionar.disabled = !sessao || selecionados.size === 0;
    btnSelecionarTodos.textContent = selecionados.size === jogadores.length && jogadores.length ? 'Desmarcar todos' : 'Selecionar todos';
  }
  btnSelecionarTodos.addEventListener('click', () => {
    if (selecionados.size === jogadores.length) selecionados.clear();
    else jogadores.forEach((p) => selecionados.add(p.id));
    lista.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = selecionados.has(c.value); });
    atualizarSelecao();
  });
  btnAdicionar.addEventListener('click', () => comBotaoOcupado(btnAdicionar, async () => {
    if (!sessao) return;
    const atuais = await ctx.participantes.listarPorSessao(sessao.id);
    const nomesAtuais = new Set(atuais.map((p) => p.nome.trim().toLocaleLowerCase('pt-BR')));
    let adicionados = 0;
    let ignorados = 0;
    for (const p of jogadores.filter((j) => selecionados.has(j.id))) {
      if (nomesAtuais.has(p.nome.trim().toLocaleLowerCase('pt-BR'))) { ignorados++; continue; }
      try {
        await ctx.participantes.adicionar(sessao.id, { nome: p.nome, nota: p.nota });
        nomesAtuais.add(p.nome.trim().toLocaleLowerCase('pt-BR'));
        adicionados++;
      } catch (e) { toast(e.message, 'erro'); return; }
    }
    toast(`${adicionados} jogador(es) adicionado(s)${ignorados ? `; ${ignorados} já estavam no racha` : ''}.`);
    ctx.navegar(`/sessao/${sessao.id}`);
  }));
  for (const p of jogadores) {
    const check = h('input', { type: 'checkbox', value: p.id, checked: false, 'aria-label': `Selecionar ${p.nome}` });
    check.addEventListener('change', () => { if (check.checked) selecionados.add(p.id); else selecionados.delete(p.id); atualizarSelecao(); });
    const editar = h('button', { class: 'btn-icone', type: 'button', 'aria-label': `Editar ${p.nome}` }, icone('editar'));
    editar.addEventListener('click', async () => { if (await dialogoEditar(ctx, p)) { toast('Jogador atualizado.'); ctx.recarregar(); } });
    const remover = h('button', { class: 'btn-icone btn-icone-perigo', type: 'button', 'aria-label': `Remover ${p.nome}` }, icone('remover'));
    remover.addEventListener('click', async () => {
      const ok = await confirmar({ titulo: `Remover ${p.nome} do banco?`, mensagem: 'Isso não apaga participações em rachas anteriores.', textoConfirmar: 'Remover', perigo: true });
      if (!ok) return;
      await ctx.jogadores.remover(p.id);
      toast('Jogador removido do banco.');
      ctx.recarregar();
    });
    lista.append(h('li', { class: 'item-lista' },
      h('div', { class: 'linha-jogador-banco' },
        check,
        h('div', { class: 'jogador-banco-info' }, h('span', { class: 'item-titulo' }, p.nome), h('span', { class: 'item-sub' }, `Nível ${p.nota}/10`)),
        editar, remover)));
  }
  if (!jogadores.length) lista.append(h('li', { class: 'estado-vazio estado-vazio-compacto' }, 'Nenhum jogador cadastrado ainda.'));
  el.append(titulo, ajuda, h('div', { class: 'acoes acoes-coluna' }, btnSelecionarTodos, resumo, btnAdicionar), lista);
  atualizarSelecao();
}
