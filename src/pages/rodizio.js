import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { confirmar } from '../components/dialogo.js';
import { toast } from '../components/toast.js';
import { vencedor, placar as calcularPlacar } from '../domain/gols.js';
import { STATUS_PARTIDA } from '../domain/partida.js';
import { STORES } from '../services/localStore.js';

const chaveHistorico = (sessaoId) => `rodizio_historico_${sessaoId}`;

export async function render(el, { id: sessaoId }, ctx) {
  const sessao = await ctx.sessoes.obter(sessaoId);
  if (!sessao) { ctx.navegar('/'); return; }
  const atual = await ctx.sorteios.atual(sessaoId);
  if (!atual) {
    el.append(h('div', { class: 'estado-vazio' }, h('h1', {}, 'Rodízio de jogadores'),
      h('p', {}, 'Primeiro, faça e confirme o sorteio dos times.'),
      h('a', { class: 'btn btn-primario', href: `#/sessao/${sessaoId}/sorteio` }, 'Ir para o sorteio')));
    return;
  }

  const partidas = await ctx.partidas.listarPorSessao(sessaoId);
  const ultima = [...partidas].reverse().find((p) => p.status === STATUS_PARTIDA.CONFIRMADA);
  const historico = await ctx.store.obterMeta(chaveHistorico(sessaoId)) ?? [];
  const cabecalho = h('div', { class: 'cabecalho-pagina' },
    h('a', { class: 'btn-icone', href: `#/sessao/${sessaoId}/equipes`, 'aria-label': 'Voltar aos times' }, icone('voltar')),
    h('div', {}, h('h1', {}, 'Rodízio de jogadores'), h('p', { class: 'texto-suave' }, 'O vencedor continua. O perdedor recebe a troca. Você decide manualmente.')));
  el.append(cabecalho);

  if (!ultima) {
    el.append(h('section', { class: 'cartao estado-vazio' },
      h('h2', {}, 'Aguardando resultado confirmado'),
      h('p', {}, 'O rodízio só é liberado depois de confirmar o resultado da partida. Empates precisam ser decididos nos pênaltis quando essa regra estiver ativa.'),
      h('a', { class: 'btn btn-primario', href: `#/sessao/${sessaoId}/equipes` }, 'Voltar aos times')));
    renderHistorico();
    return;
  }

  const detalhe = await ctx.partidas.detalhar(ultima.id);
  const pl = await ctx.partidas.placar(ultima.id);
  const v = vencedor(ultima, pl);
  if (v === 'empate') {
    el.append(h('section', { class: 'cartao aviso-confirmacao' },
      h('h2', {}, 'Resultado empatado'),
      h('p', {}, 'Não há vencedor definido. Registre os pênaltis na partida e confirme o resultado antes de fazer o rodízio.'),
      h('a', { class: 'btn btn-primario', href: `#/partida/${ultima.id}` }, 'Resolver resultado')));
    renderHistorico();
    return;
  }

  const equipeVencedora = v === 'A' ? detalhe.equipeA : detalhe.equipeB;
  const equipePerdedora = v === 'A' ? detalhe.equipeB : detalhe.equipeA;
  const { equipes, aguardando } = atual;
  const vencedoraAtual = equipes.find((e) => e.id === equipeVencedora.id);
  const perdedoraAtual = equipes.find((e) => e.id === equipePerdedora.id);
  const jogadoresVencedor = vencedoraAtual?.jogadores ?? [];
  const jogadoresPerdedor = perdedoraAtual?.jogadores ?? [];
  const fila = [...aguardando];
  let saidaId = '';
  let entradaId = '';

  const listaVencedor = h('ul', { class: 'lista' }, jogadoresVencedor.map((p) =>
    h('li', {}, h('div', { class: 'item-lista' }, h('span', { class: 'item-titulo' }, p.nome), h('span', { class: 'chip' }, 'Continua')))));
  const listaPerdedor = h('ul', { class: 'lista' }, jogadoresPerdedor.map((p) =>
    h('li', {}, h('div', { class: 'item-lista' }, h('span', { class: 'item-titulo' }, p.nome), h('span', { class: 'item-sub' }, 'Pode ser escolhido para sair')))));
  const filaEl = h('ul', { class: 'lista' }, fila.length ? fila.map((p, i) =>
    h('li', {}, h('div', { class: 'item-lista' }, h('span', { class: 'item-titulo' }, `${i + 1}. ${p.nome}`), h('span', { class: 'item-sub' }, 'Fila de espera'))))
    : [h('li', {}, h('p', { class: 'texto-suave' }, 'Fila vazia: adicione participantes para fazer uma substituição.'))]);

  const saida = h('select', { class: 'campo', 'aria-label': 'Jogador que vai sair' },
    h('option', { value: '' }, 'Escolha quem sai'),
    jogadoresPerdedor.map((p) => h('option', { value: p.id }, p.nome)));
  const entrada = h('select', { class: 'campo', 'aria-label': 'Jogador que vai entrar' },
    h('option', { value: '' }, 'Escolha quem entra'),
    fila.map((p) => h('option', { value: p.id }, p.nome)));
  saida.addEventListener('change', () => { saidaId = saida.value; });
  entrada.addEventListener('change', () => { entradaId = entrada.value; });

  const salvar = h('button', { type: 'button', class: 'btn btn-primario btn-grande' }, 'Confirmar substituição');
  salvar.addEventListener('click', () => comBotaoOcupado(salvar, async () => {
    if (!saidaId || !entradaId) { toast('Escolha quem sai e quem entra.', 'erro'); return; }
    const nomeSai = jogadoresPerdedor.find((p) => p.id === saidaId)?.nome;
    const nomeEntra = fila.find((p) => p.id === entradaId)?.nome;
    const ok = await confirmar({ titulo: 'Confirmar substituição?', mensagem: `${nomeSai} sai do ${equipePerdedora.nome} e vai para a fila. ${nomeEntra} entra no ${equipePerdedora.nome}. O ${equipeVencedora.nome} continua como está.`, textoConfirmar: 'Confirmar troca' });
    if (!ok) return;
    try {
      await ctx.sorteios.aplicarRodizio(sessaoId, { equipePerdedoraId: perdedoraAtual.id, saiId: saidaId, entraId: entradaId });
      const eventos = await ctx.store.obterMeta(chaveHistorico(sessaoId)) ?? [];
      eventos.unshift({ id: `${Date.now()}-${saidaId}`, partida: ultima.numero, vencedor: equipeVencedora.nome, perdedor: equipePerdedora.nome, saiu: nomeSai, entrou: nomeEntra, em: new Date().toISOString() });
      await ctx.store.definirMeta(chaveHistorico(sessaoId), eventos.slice(0, 100));
      toast('Rodízio confirmado. A fila e os times foram atualizados.');
      ctx.navegar(`/sessao/${sessaoId}/rodizio`);
    } catch (e) { toast(e.message, 'erro'); }
  }));

  const semTroca = h('button', { type: 'button', class: 'btn btn-secundario btn-grande' }, 'Continuar sem substituição');
  semTroca.addEventListener('click', async () => {
    const ok = await confirmar({ titulo: 'Continuar sem substituição?', mensagem: 'Os times e a fila permanecerão como estão. Você poderá preparar a próxima partida.', textoConfirmar: 'Continuar sem troca' });
    if (ok) ctx.navegar(`/sessao/${sessaoId}/equipes`);
  });

  el.append(
    h('section', { class: 'cartao cartao-destaque' },
      h('p', { class: 'rotulo' }, `Resultado confirmado · Partida nº ${ultima.numero}`),
      h('h2', {}, `${detalhe.equipeA.nome} ${pl.a} × ${pl.b} ${detalhe.equipeB.nome}`),
      h('p', { class: 'resultado-vencedor' }, `Vencedor: ${equipeVencedora.nome}`),
      h('p', { class: 'texto-suave' }, `O ${equipeVencedora.nome} permanece. As substituições acontecem apenas no ${equipePerdedora.nome}.`)),
    h('section', { class: 'cartao' }, h('h2', {}, `🏆 ${equipeVencedora.nome} — continua`), listaVencedor),
    h('section', { class: 'cartao' }, h('h2', {}, `🔄 ${equipePerdedora.nome} — rodízio`), listaPerdedor),
    h('section', { class: 'cartao' }, h('h2', {}, `Fila de espera (${fila.length})`), filaEl),
    h('section', { class: 'cartao' },
      h('h2', {}, 'Escolher substituição'),
      h('p', { class: 'ajuda' }, 'O app não escolhe nem troca ninguém sozinho. Selecione a saída e a entrada, confira o resumo e confirme.'),
      h('label', { class: 'campo-grupo' }, h('span', {}, 'Quem sai do time perdedor?'), saida),
      h('label', { class: 'campo-grupo' }, h('span', {}, 'Quem entra da fila?'), entrada),
      h('div', { class: 'acoes acoes-coluna' }, salvar, semTroca),
      h('a', { class: 'btn btn-secundario', href: `#/sessao/${sessaoId}/partida/nova` }, 'Preparar próxima partida')));
  renderHistorico();

  function renderHistorico() {
    const itens = historico.map((item) => h('li', {}, h('div', { class: 'item-lista' },
      h('span', { class: 'item-titulo' }, `Partida ${item.partida}: ${item.saiu} ↔ ${item.entrou}`),
      h('span', { class: 'item-sub' }, `${item.vencedor} continua · ${new Date(item.em).toLocaleString('pt-BR')}`))));
    el.append(h('section', { class: 'cartao' }, h('h2', {}, 'Histórico do rodízio'),
      itens.length ? h('ul', { class: 'lista' }, itens) : h('p', { class: 'texto-suave' }, 'As substituições confirmadas aparecerão aqui.')));
  }
}
