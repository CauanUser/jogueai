import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { toast } from '../components/toast.js';
import { participantesEditaveis } from '../domain/sessao.js';
import { NOME_MAX } from '../domain/validacao.js';
import { interpretarListaWhatsApp, separarJaCadastrados, validarNomesParaImportar } from '../domain/importacaoLista.js';
import { formatarDataReferencia } from '../utils/datas.js';

const chaveRascunho = (id) => `rascunho_importacao:${id}`;
const EXEMPLO = 'LISTA DO RACHA - DOMINGO 07:00\n\n01 - Alisson\n02 - Michel\n03 -';

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export async function render(el, { id }, ctx) {
  const sessao = await ctx.sessoes.obter(id);
  if (!sessao) { ctx.navegar('/'); return; }
  const voltarPara = `/sessao/${id}`;

  el.append(h('div', { class: 'cabecalho-pagina' },
    h('a', { class: 'btn-icone', href: `#${voltarPara}`, 'aria-label': 'Voltar aos participantes' }, icone('voltar')),
    h('div', {}, h('h1', {}, 'Importar lista'), h('p', { class: 'texto-suave' }, formatarDataReferencia(sessao.data_referencia)))));

  if (!participantesEditaveis(sessao)) {
    el.append(h('div', { class: 'cartao aviso' }, h('p', {}, 'Esta sessão está encerrada. Não é possível importar jogadores.')));
    return;
  }

  const area = h('div');
  el.append(area);

  // O texto colado fica salvo no aparelho: se o Android fechar o app enquanto
  // você copia a lista no WhatsApp, ele continua aqui quando voltar.
  let texto = (await ctx.store.obterMeta(chaveRascunho(id))) ?? '';
  let timerRascunho = null;
  let rascunhoPendente = null;
  const gravarRascunho = () => {
    clearTimeout(timerRascunho);
    timerRascunho = null;
    if (rascunhoPendente === null) return undefined;
    const valor = rascunhoPendente;
    rascunhoPendente = null;
    return ctx.store.definirMeta(chaveRascunho(id), valor || null);
  };
  const salvarRascunho = (valor) => {
    rascunhoPendente = valor;
    clearTimeout(timerRascunho);
    timerRascunho = setTimeout(gravarRascunho, 300);
  };
  const descartarRascunho = () => {
    clearTimeout(timerRascunho);
    rascunhoPendente = null;
    return ctx.store.definirMeta(chaveRascunho(id), null);
  };

  const cancelar = async () => {
    await descartarRascunho();
    toast('Importação cancelada. Nada foi alterado.', 'info');
    ctx.navegar(voltarPara);
  };

  // ---- Etapa 1: colar a lista ----------------------------------------
  function etapaColar() {
    const erro = h('p', { class: 'erro-campo', 'aria-live': 'polite' });
    const campo = h('textarea', {
      id: 'lista-whatsapp', class: 'campo campo-lista', rows: '12', spellcheck: 'false',
      autocapitalize: 'off', autocomplete: 'off', placeholder: EXEMPLO, 'aria-describedby': 'ajuda-lista',
    });
    campo.value = texto;
    campo.addEventListener('input', () => { texto = campo.value; erro.textContent = ''; salvarRascunho(texto); });

    const btnLer = h('button', { class: 'btn btn-primario btn-grande', type: 'submit' }, 'Ler lista');
    const podeColar = Boolean(globalThis.navigator?.clipboard?.readText);
    const btnColar = podeColar ? h('button', { class: 'btn btn-secundario', type: 'button' }, 'Colar da área de transferência') : null;
    btnColar?.addEventListener('click', async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (!t) { toast('A área de transferência está vazia.', 'info'); return; }
        campo.value = t; texto = t; salvarRascunho(t);
      } catch {
        toast('Não foi possível ler a área de transferência. Toque e segure no campo e escolha "Colar".', 'info');
        campo.focus();
      }
    });

    const form = h('form', { class: 'cartao formulario', novalidate: true },
      h('label', { for: 'lista-whatsapp', class: 'rotulo-campo' }, 'Cole aqui a lista do grupo'),
      h('p', { class: 'ajuda', id: 'ajuda-lista' },
        'No WhatsApp, toque e segure na mensagem da lista e escolha "Copiar". Depois volte aqui e cole. ',
        'Linhas como "10 -" (sem nome) são vagas livres e não viram jogadores.'),
      campo, erro, btnColar, btnLer,
      h('button', { class: 'btn btn-perigo-texto', type: 'button', onClick: cancelar }, 'Cancelar'));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const r = interpretarListaWhatsApp(campo.value);
      if (r.posicoes === 0) {
        erro.textContent = 'Nenhuma linha no formato "01 - Nome" foi encontrada. Confira se colou a lista inteira.';
        campo.focus();
        return;
      }
      await etapaPrevia(r);
    });

    area.replaceChildren(form);
    if (!texto) campo.focus();
  }

  // ---- Etapa 2: prévia e confirmação -------------------------------------
  async function etapaPrevia(r) {
    const existentes = await ctx.participantes.listarPorSessao(id);
    const { novos, jaCadastrados } = separarJaCadastrados(r.jogadores.map((j) => j.nome), existentes);

    const resumo = h('div', { class: 'resumo-importacao' },
      h('span', { class: 'chip chip-ok' }, plural(r.jogadores.length, 'jogador encontrado', 'jogadores encontrados')),
      h('span', { class: 'chip chip-neutro' }, plural(r.vagas, 'vaga livre', 'vagas livres')),
      h('span', { class: 'chip chip-neutro' }, plural(r.posicoes, 'posição na lista', 'posições na lista')));

    const avisos = [];
    if (jaCadastrados.length) {
      avisos.push(h('div', { class: 'aviso-importacao' },
        h('strong', {}, 'Já cadastrados nesta sessão (não serão duplicados; a nota atual é mantida): '),
        jaCadastrados.map((x) => x.existente.nome).join(', ')));
    }
    if (r.repetidos.length) {
      avisos.push(h('div', { class: 'aviso-importacao' },
        h('strong', {}, 'Repetidos na lista (entram uma vez só): '),
        r.repetidos.map((x) => `${x.nome} (linha ${x.linha})`).join(', ')));
    }
    if (r.naoReconhecidas.length) {
      avisos.push(h('div', { class: 'aviso-importacao aviso-importacao-erro' },
        h('strong', {}, 'Linhas não reconhecidas (foram ignoradas):'),
        h('ul', {}, r.naoReconhecidas.map((x) => h('li', {}, `Linha ${x.linha}: "${x.texto}" — ${x.motivo}`)))));
    }

    const lista = h('ol', { class: 'lista lista-importacao', 'aria-label': 'Jogadores que serão adicionados' });
    const btnConfirmar = h('button', { class: 'btn btn-primario btn-grande', type: 'button' });
    const vazio = h('p', { class: 'estado-vazio estado-vazio-compacto' }, 'Nenhum jogador novo para adicionar.');

    const atualizarContagem = () => {
      const n = lista.children.length;
      btnConfirmar.textContent = n ? `Adicionar ${plural(n, 'jogador', 'jogadores')}` : 'Nada para adicionar';
      btnConfirmar.disabled = n === 0;
      vazio.hidden = n > 0;
    };

    const linhaJogador = (nome) => {
      const erro = h('p', { class: 'erro-campo' });
      const input = h('input', {
        class: 'campo campo-compacto', type: 'text', value: nome, maxlength: String(NOME_MAX),
        autocapitalize: 'words', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Nome do jogador',
      });
      input.addEventListener('input', () => { erro.textContent = ''; input.removeAttribute('aria-invalid'); });
      const li = h('li', { class: 'item-importacao' },
        h('div', { class: 'item-importacao-linha' },
          input,
          h('button', {
            class: 'btn-icone btn-icone-perigo', type: 'button', 'aria-label': `Remover ${nome} da importação`,
            onClick: () => { li.remove(); atualizarContagem(); },
          }, icone('remover'))),
        erro);
      li.mostrarErro = (msg) => { erro.textContent = msg; input.setAttribute('aria-invalid', 'true'); };
      li.valor = () => input.value;
      return li;
    };
    novos.forEach((nome) => lista.append(linhaJogador(nome)));
    atualizarContagem();

    btnConfirmar.addEventListener('click', () => comBotaoOcupado(btnConfirmar, async () => {
      const itens = [...lista.children];
      const atuais = await ctx.participantes.listarPorSessao(id);
      const v = validarNomesParaImportar(itens.map((li) => li.valor()), atuais);
      if (!v.ok) {
        v.erros.forEach(({ indice, erro }) => itens[indice].mostrarErro(erro));
        toast('Corrija os nomes destacados antes de confirmar.', 'erro');
        return;
      }
      try {
        const adicionados = await ctx.participantes.adicionarVarios(id, v.nomes);
        await descartarRascunho();
        toast(`${plural(adicionados.length, 'jogador adicionado', 'jogadores adicionados')}. Agora escolha a nota de cada um.`);
        ctx.navegar(voltarPara);
      } catch (e) {
        if (e.errosPorIndice) e.errosPorIndice.forEach(({ indice, erro }) => itens[indice]?.mostrarErro(erro));
        toast(e.message, 'erro');
      }
    }));

    area.replaceChildren(
      h('section', { class: 'cartao', 'aria-labelledby': 'tit-previa' },
        h('h2', { id: 'tit-previa' }, 'Confira os jogadores'),
        resumo, avisos,
        h('p', { class: 'ajuda' }, 'Corrija um nome tocando nele ou remova com a lixeira. As notas você escolhe depois, na lista de participantes.'),
        lista, vazio),
      h('div', { class: 'acoes acoes-coluna' },
        btnConfirmar,
        h('button', { class: 'btn btn-secundario', type: 'button', onClick: etapaColar }, 'Voltar e colar outra lista'),
        h('button', { class: 'btn btn-perigo-texto', type: 'button', onClick: cancelar }, 'Cancelar importação')));
    globalThis.scrollTo?.(0, 0);
  }

  etapaColar();
  // Ao sair da tela, grava o que ainda estava aguardando.
  return () => { gravarRascunho(); };
}
