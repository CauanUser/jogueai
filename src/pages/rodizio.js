import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { confirmar } from '../components/dialogo.js';
import { toast } from '../components/toast.js';

export async function render(el, { id, partidaId }, ctx) {
  let estado;
  try {
    estado = await ctx.rodizio.estado(id, partidaId);
  } catch (e) {
    el.append(
      h('div', { class: 'cabecalho-pagina' },
        h('a', { class: 'btn-icone', href: `#/sessao/${id}/equipes`, 'aria-label': 'Voltar aos times' }, icone('voltar')),
        h('div', {}, h('h1', {}, 'Rodízio de jogadores'))),
      h('section', { class: 'cartao aviso', role: 'alert' }, h('p', {}, e.message)),
      h('a', { class: 'btn btn-secundario', href: `#/sessao/${id}/equipes` }, 'Voltar aos times'));
    return;
  }

  let saiId = '';
  let entraId = '';
  const configGoleiros = await ctx.store.obterMeta(`goleiros_fixos:${id}`);
  const participantesSessao = await ctx.participantes.listarPorSessao(id);
  const nomeParticipante = new Map(participantesSessao.map((p) => [p.id, p.nome]));
  const nomePorId = new Map([...estado.atual.equipes.flatMap((e) => e.jogadores), ...estado.atual.aguardando].map((p) => [p.id, p.nome]));
  const titulo = h('h1', {}, 'Rodízio de jogadores');
  const nomeEquipeA = estado.atual.equipes.find((e) => e.id === estado.partida.equipe_a_id)?.nome ?? 'Time A';
  const nomeEquipeB = estado.atual.equipes.find((e) => e.id === estado.partida.equipe_b_id)?.nome ?? 'Time B';
  // Preserve the A/B physical-side order when preparing the next match.
  // The winning team may be A or B; always putting the winner first would swap sides.
  const proximaEquipeAId = estado.ladoVencedor === 'A' ? estado.equipeVencedora.id : estado.equipePerdedora.id;
  const proximaEquipeBId = estado.ladoVencedor === 'B' ? estado.equipeVencedora.id : estado.equipePerdedora.id;
  const resultado = h('p', { class: 'resultado-linha' },
    `Partida nº ${estado.partida.numero}: ${nomeEquipeA} ${estado.placar.a} × ${estado.placar.b} ${nomeEquipeB}. ${estado.equipeVencedora.nome} venceu.`,
    estado.partida.penaltis_a !== null && estado.partida.penaltis_a !== undefined
      ? h('span', { class: 'item-sub' }, ` Pênaltis: ${estado.partida.penaltis_a} × ${estado.partida.penaltis_b}.`)
      : null);
  const resumo = h('p', { class: 'resultado-vencedor' }, `${estado.equipeVencedora.nome} permanece em campo.`);
  const elGoleiros = h('section', { class: 'cartao' });
  function desenharGoleirosFixos() {
    const cfg = configGoleiros;
    if (!cfg || !cfg.quantidade) {
      elGoleiros.hidden = true;
      elGoleiros.replaceChildren();
      return;
    }
    elGoleiros.hidden = false;
    const itens = [h('h2', {}, 'Goleiros fixos por lado')];
    if (cfg.quantidade >= 1) itens.push(h('p', {}, `Lado esquerdo (A) · ${nomeParticipante.get(cfg.goleiroEsquerdoId) ?? 'Goleiro não encontrado'} · permanece no lado físico esquerdo.`));
    if (cfg.quantidade === 2) itens.push(h('p', {}, `Lado direito (B) · ${nomeParticipante.get(cfg.goleiroDireitoId) ?? 'Goleiro não encontrado'} · permanece no lado físico direito.`));
    itens.push(h('p', { class: 'ajuda' }, 'A ordem A/B é mantida ao preparar a próxima partida: o goleiro continua no mesmo lado físico, mesmo quando o vencedor está no lado B.'));
    elGoleiros.replaceChildren(...itens);
  }
  const elTimes = h('div');
  const elFila = h('div');
  const elSelecao = h('section', { class: 'cartao formulario' });
  const elHistorico = h('section', { class: 'cartao' });
  const elAcoes = h('div', { class: 'acoes acoes-coluna' });

  function cartaoEquipe(equipe, destaque = false) {
    return h('section', { class: `cartao rodizio-equipe${destaque ? ' rodizio-perdedora' : ''}`, style: `--cor-equipe: ${equipe.cor}` },
      h('h2', {}, equipe.nome, destaque ? ' · recebe substituições' : ' · permanece'),
      h('ul', { class: 'lista' }, equipe.jogadores.map((p) => h('li', { class: 'item-lista' },
        h('span', { class: 'item-titulo' }, p.nome)))));
  }

  function desenhar() {
    elTimes.replaceChildren(cartaoEquipe(estado.equipeVencedora), cartaoEquipe(estado.equipePerdedora, true));
    elFila.replaceChildren(
      h('h2', {}, `Fila de espera · ${estado.atual.aguardando.length}`),
      estado.atual.aguardando.length
        ? h('ul', { class: 'lista' }, estado.atual.aguardando.map((p, i) => h('li', { class: 'item-lista' },
          h('span', { class: 'item-titulo' }, p.nome),
          h('span', { class: 'item-sub' }, `Posição ${i + 1}`))))
        : h('p', { class: 'ajuda' }, 'Não há jogadores aguardando fora dos dois times desta partida.'));
    const opcoesSai = [h('option', { value: '' }, 'Selecione quem sai'), ...estado.equipePerdedora.jogadores.map((p) => h('option', { value: p.id }, p.nome))];
    const opcoesEntra = [h('option', { value: '' }, 'Selecione quem entra'), ...estado.atual.aguardando.map((p) => h('option', { value: p.id }, p.nome))];
    const selSai = h('select', { class: 'campo', 'aria-label': 'Jogador que sairá' }, opcoesSai);
    const selEntra = h('select', { class: 'campo', 'aria-label': 'Jogador que entrará' }, opcoesEntra);
    selSai.value = saiId;
    selEntra.value = entraId;
    selSai.addEventListener('change', () => { saiId = selSai.value; atualizarResumo(); });
    selEntra.addEventListener('change', () => { entraId = selEntra.value; atualizarResumo(); });
    const previa = h('div', { class: 'rodizio-previa', 'aria-live': 'polite' });
    function atualizarResumo() {
      const sai = nomePorId.get(saiId) ?? '—';
      const entra = nomePorId.get(entraId) ?? '—';
      previa.replaceChildren(
        h('h3', {}, 'Prévia da substituição'),
        h('p', {}, `Sai: ${sai}`),
        h('p', {}, `Entra: ${entra}`),
        h('p', { class: 'ajuda' }, 'A alteração só será aplicada depois da confirmação.'));
    }
    atualizarResumo();
    const btnConfirmar = h('button', { class: 'btn btn-primario btn-grande', type: 'button' }, 'Confirmar substituição');
    btnConfirmar.addEventListener('click', () => comBotaoOcupado(btnConfirmar, async () => {
      const ok = await confirmar({
        titulo: 'Confirmar substituição?',
        mensagem: `Sai ${nomePorId.get(saiId) ?? '—'} e entra ${nomePorId.get(entraId) ?? '—'} no ${estado.equipePerdedora.nome}. A formação será atualizada e o jogador substituído irá para a fila.`,
        textoConfirmar: 'Confirmar substituição',
      });
      if (!ok) return;
      try {
        await ctx.rodizio.substituir(id, partidaId, { participanteSaiId: saiId, participanteEntraId: entraId });
        toast('Substituição registrada.');
        ctx.navegar(`/sessao/${id}/rodizio/${partidaId}`);
      } catch (e) { toast(e.message, 'erro'); }
    }));
    btnConfirmar.disabled = estado.encerradoSemTroca || !estado.atual.aguardando.length || !estado.equipePerdedora.jogadores.length;
    elSelecao.replaceChildren(
      h('h2', {}, 'Escolha manualmente'),
      h('p', { class: 'ajuda' }, `O organizador decide quem sai do ${estado.equipePerdedora.nome} e quem entra. O vencedor não será alterado.`),
      h('label', { class: 'rotulo-campo' }, 'Quem vai sair?'), selSai,
      h('label', { class: 'rotulo-campo' }, 'Quem vai entrar?'), selEntra,
      previa, btnConfirmar);
    const historicoItens = estado.eventos.filter((e) => e.tipo === 'substituicao').map((e) =>
      h('li', { class: 'item-lista' },
        h('span', { class: 'item-titulo' }, `${nomePorId.get(e.participante_entrou_id) ?? 'Jogador'} entrou${e.corrigida ? ' · corrigida' : ''}`),
        h('span', { class: 'item-sub' }, `${nomePorId.get(e.participante_saiu_id) ?? 'Jogador'} saiu · ${new Date(e.corrigida_em ?? e.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`)));
    const btnCorrigir = h('button', { class: 'btn btn-secundario', type: 'button' }, 'Corrigir última substituição');
    btnCorrigir.hidden = !estado.eventos.some((e) => e.tipo === 'substituicao' && !e.corrigida);
    btnCorrigir.addEventListener('click', () => comBotaoOcupado(btnCorrigir, async () => {
      const ok = await confirmar({
        titulo: 'Desfazer a última substituição?',
        mensagem: 'O jogador que saiu voltará para o time perdedor. O jogador que entrou voltará à fila ou à equipe de origem, se tinha uma.',
        textoConfirmar: 'Desfazer substituição',
      });
      if (!ok) return;
      try {
        await ctx.rodizio.corrigirUltima(id, partidaId);
        toast('Substituição corrigida.');
        ctx.navegar(`/sessao/${id}/rodizio/${partidaId}`);
      } catch (e) { toast(e.message, 'erro'); }
    }));
    elHistorico.replaceChildren(h('h2', {}, 'Substituições desta partida'),
      historicoItens.length ? h('ul', { class: 'lista' }, historicoItens) : h('p', { class: 'ajuda' }, 'Nenhuma substituição registrada ainda.'),
      btnCorrigir);
    const btnEncerrar = h('button', { class: 'btn btn-secundario btn-grande', type: 'button' },
      estado.encerradoSemTroca ? 'Rodízio concluído' : estado.eventos.some((e) => e.tipo === 'substituicao') ? 'Concluir rodízio' : 'Continuar sem substituições');
    btnEncerrar.disabled = estado.encerradoSemTroca;
    btnEncerrar.addEventListener('click', () => comBotaoOcupado(btnEncerrar, async () => {
      const ok = await confirmar({
        titulo: 'Concluir o rodízio?',
        mensagem: 'A formação atual será mantida para a próxima partida. O cronômetro não será iniciado.',
        textoConfirmar: 'Concluir',
      });
      if (!ok) return;
      try {
        await ctx.rodizio.continuarSemSubstituicao(id, partidaId);
        toast('Rodízio concluído. A próxima partida não foi iniciada.');
        ctx.navegar(`/sessao/${id}/rodizio/${partidaId}`);
      } catch (e) { toast(e.message, 'erro'); }
    }));
    elAcoes.replaceChildren(
      btnEncerrar,
      h('a', { class: 'btn btn-primario btn-grande', href: `#/sessao/${id}/partida/nova/${proximaEquipeAId}/${proximaEquipeBId}` }, 'Preparar próxima partida'),
      h('a', { class: 'btn btn-secundario', href: `#/sessao/${id}/equipes` }, 'Voltar aos times'));
  }

  el.append(
    h('div', { class: 'cabecalho-pagina' },
      h('a', { class: 'btn-icone', href: `#/sessao/${id}/equipes`, 'aria-label': 'Voltar aos times' }, icone('voltar')),
      h('div', {}, titulo)),
    h('section', { class: 'cartao fim-jogo' }, resultado, resumo),
    elTimes,
    elGoleiros,
    h('section', { class: 'cartao rodizio-fila' }, elFila),
    elSelecao,
    elHistorico,
    elAcoes);
  desenhar();
  desenharGoleirosFixos();
}
