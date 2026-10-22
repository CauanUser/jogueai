import { App } from '@capacitor/app';
import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { confirmar } from '../components/dialogo.js';
import { toast } from '../components/toast.js';
import { stepper } from '../components/stepper.js';
import { perguntarAutor } from '../components/seletorGol.js';
import { apitar, prepararAudio, criarTelaAcesa } from '../components/alerta.js';
import { formatarTempo, formatarRestante } from '../domain/cronometro.js';
import { normalizarModalidade, regraDaModalidade, validarValor } from '../domain/modalidades.js';
import { STATUS_PARTIDA, CONDICOES, situacaoTempo, avaliarEventoAutomatico, partidaAtiva, tempoTotalMs } from '../domain/partida.js';
import {
  podeLancarGols, ladoDaEquipe, outroLado, precisaPenaltis, pendenciaParaConfirmar, vencedor, minutoDoGol,
} from '../domain/gols.js';

const TEXTO_STATUS = {
  configurada: 'Pronta para começar',
  em_andamento: 'Em andamento',
  pausada: 'Pausada',
  finalizada: 'Fim de jogo — falta confirmar o resultado',
  confirmada: 'Resultado confirmado',
  cancelada: 'Cancelada',
};
const MOTIVO_FIM = { tempo: 'acabou o tempo', gols: 'limite de gols atingido', manual: 'encerrada pelo organizador' };

function resumoRegras(p) {
  const partes = [];
  if (p.condicao_encerramento !== CONDICOES.GOLS) partes.push(formatarTempo(p.duracao_segundos * 1000));
  if (p.condicao_encerramento === CONDICOES.PRIMEIRO) partes.push(`até ${p.limite_gols} gols ou fim do tempo`);
  if (p.condicao_encerramento === CONDICOES.TEMPO) partes.push('só tempo');
  if (p.condicao_encerramento === CONDICOES.GOLS) partes.push(`até ${p.limite_gols} gols`);
  if (p.acrescimos_segundos) partes.push(`+${p.acrescimos_segundos / 60} min de acréscimos`);
  if (p.intervalo_segundos) partes.push(`intervalo de ${p.intervalo_segundos / 60} min`);
  partes.push(p.desempate === 'penaltis' ? 'empate: pênaltis' : 'empate vale');
  return partes.join(' · ');
}

export async function render(el, { id }, ctx) {
  let d = await ctx.partidas.detalhar(id);
  if (!d) {
    el.append(h('div', { class: 'estado-vazio' }, h('h1', {}, 'Partida não encontrada'),
      h('a', { class: 'btn btn-primario', href: '#/' }, 'Voltar ao início')));
    return;
  }
  const sessaoId = d.partida.sessao_id;
  const configSessao = await ctx.store.obterMeta('sessao_config_' + sessaoId) ?? { modalidade: 'futebol' };
  const modalidade = normalizarModalidade(configSessao.modalidade);
  const regraEsporte = regraDaModalidade(modalidade);
  const telaAcesa = criarTelaAcesa();
  let gols = await ctx.partidas.gols(id);
  let placar = await ctx.partidas.placar(id);
  let processando = false;
  const nomes = new Map([...d.jogadoresA, ...d.jogadoresB].map((j) => [j.id, j.nome]));

  // Elementos fixos (atualizados a cada "tick", sem recriar a tela)
  const elTempo = h('div', { class: 'relogio', role: 'timer', 'aria-live': 'off' });
  const elRotuloTempo = h('div', { class: 'relogio-rotulo' });
  const elStatus = h('p', { class: 'status-partida', 'aria-live': 'polite' });
  const elBotoesGol = h('div', { class: 'botoes-gol' });
  const elControles = h('div', { class: 'controles-partida' });
  const elPlacar = h('div', { class: 'placar-numeros', 'aria-live': 'polite' });
  const elPenaltisPlacar = h('div', { class: 'placar-penaltis' });
  const elGols = h('section', { class: 'cartao lista-gols-cartao', 'aria-labelledby': 'tit-gols' });
  const elFim = h('div');

  const cabecalho = h('div', { class: 'cabecalho-pagina' },
    h('a', { class: 'btn-icone', href: `#/sessao/${sessaoId}/equipes`, 'aria-label': 'Voltar aos times' }, icone('voltar')),
    h('div', {}, h('h1', {}, `Partida nº ${d.partida.numero}`), h('p', { class: 'texto-suave' }, resumoRegras(d.partida))));

  const lado = (equipe, cls) => h('div', { class: `placar-lado ${cls}`, style: `--cor-equipe: ${equipe.cor}` },
    h('span', { class: 'equipe-cor', 'aria-hidden': 'true' }), h('span', { class: 'placar-nome' }, equipe.nome));
  const placarCartao = h('section', { class: 'cartao placar', 'aria-label': 'Placar' },
    h('div', { class: 'placar-linha' }, lado(d.equipeA, 'lado-a'), elPlacar, lado(d.equipeB, 'lado-b')),
    elPenaltisPlacar, elTempo, elRotuloTempo, elStatus);

  const escalacao = (equipe, jogadores) => h('div', { class: 'escalacao', style: `--cor-equipe: ${equipe.cor}` },
    h('h3', {}, equipe.nome),
    h('ul', {}, jogadores.map((j) => h('li', {}, j.nome))));
  const escalacoes = h('details', { class: 'cartao escalacoes' },
    h('summary', {}, 'Escalações'),
    h('div', { class: 'escalacoes-grade' }, escalacao(d.equipeA, d.jogadoresA), escalacao(d.equipeB, d.jogadoresB)));

  el.append(cabecalho, placarCartao, elBotoesGol, elControles, elFim, elGols, escalacoes);

  // ---- Ações ----------------------------------------------------------
  const recarregar = async () => {
    d = await ctx.partidas.detalhar(id);
    gols = await ctx.partidas.gols(id);
    placar = await ctx.partidas.placar(id);
  };
  const redesenhar = () => { desenharControles(); desenharGols(); atualizar(); };

  const executar = (botao, acao, sucesso) => comBotaoOcupado(botao, async () => {
    try {
      await acao();
      await recarregar();
      if (sucesso) toast(sucesso, 'info');
      redesenhar();
    } catch (e) { toast(e.message, 'erro'); }
  });

  function botao(texto, classe, aoClicar) {
    const b = h('button', { type: 'button', class: `btn ${classe}` }, texto);
    b.addEventListener('click', () => aoClicar(b));
    return b;
  }

  const equipeDe = (l) => (l === 'A' ? d.equipeA : d.equipeB);
  const jogadoresDe = (l) => (l === 'A' ? d.jogadoresA : d.jogadoresB);

  // ---- Gols -----------------------------------------------------------
  async function marcarGol(ladoGol, b, valor = 1) {
    // No futebol registra autor/gol; nos demais esportes registra o valor do ponto.
    const momento = Date.now();
    let r = { participanteId: null, tipo: 'normal', valor };
    if (modalidade === 'futebol') {
      r = await perguntarAutor({ equipe: equipeDe(ladoGol), doTime: jogadoresDe(ladoGol), adversarios: jogadoresDe(outroLado(ladoGol)) });
      if (!r) return;
      r.valor = 1;
    } else if (validarValor(modalidade, valor)) {
      toast(validarValor(modalidade, valor), 'erro'); return;
    }
    await comBotaoOcupado(b, async () => {
      try {
        const res = await ctx.partidas.registrarGol(id, { lado: ladoGol, ...r }, momento);
        await recarregar();
        const autor = r.participanteId ? nomes.get(r.participanteId) : null;
        if (res.encerrou) {
          apitar();
          toast(`${modalidade === 'futebol' ? 'Gol' : 'Ponto'}${autor ? ` de ${autor}` : ''}! Fim de partida.`, 'info', 5000);
        } else {
          toast(`${modalidade === 'futebol' ? 'Gol' : 'Pontuação'} ${equipeDe(ladoGol).nome}${autor ? ` — ${autor}${r.tipo === 'contra' ? ' (contra)' : ''}` : ''}${modalidade === 'basquete' ? ` (+${valor})` : ''}. ${placar.a} × ${placar.b}`, 'info');
        }
        redesenhar();
      } catch (e) { toast(e.message, 'erro'); }
    });
  }

  async function corrigirGol(g) {
    const ladoGol = ladoDaEquipe(d.partida, g.equipe_id);
    const r = await perguntarAutor({
      equipe: equipeDe(ladoGol), doTime: jogadoresDe(ladoGol), adversarios: jogadoresDe(outroLado(ladoGol)), atual: g,
    });
    if (!r) return;
    try {
      if (r.remover) {
        const ok = await confirmar({ titulo: 'Remover este gol?', mensagem: 'O placar será recalculado.', textoConfirmar: 'Remover', perigo: true });
        if (!ok) return;
        await ctx.partidas.removerGol(id, g.id);
        toast('Gol removido.', 'info');
      } else {
        await ctx.partidas.editarGol(id, g.id, r);
        toast('Gol corrigido.', 'info');
      }
      await recarregar();
      redesenhar();
    } catch (e) { toast(e.message, 'erro'); }
  }

  function desenharGols() {
    const editavel = podeLancarGols(d.partida);
    const itens = gols.map((g) => {
      const equipe = g.equipe_id === d.partida.equipe_a_id ? d.equipeA : d.equipeB;
      const autor = g.participante_id ? (nomes.get(g.participante_id) ?? 'Jogador') : 'Sem autor';
      const conteudo = [
        h('span', { class: 'gol-minuto' }, minutoDoGol(g.tempo_partida_segundos)),
        h('span', { class: 'equipe-cor', 'aria-hidden': 'true' }),
        h('span', { class: 'gol-texto' },
          h('strong', {}, autor), g.tipo === 'contra' ? h('span', { class: 'chip chip-alerta' }, 'contra') : null,
          h('span', { class: 'item-sub' }, ` para ${equipe.nome}`)),
        editavel ? icone('editar') : null,
      ];
      return h('li', { style: `--cor-equipe: ${equipe.cor}` }, editavel
        ? h('button', { type: 'button', class: 'item-gol', 'aria-label': `Corrigir gol de ${autor}${g.tipo === 'contra' ? ' (contra)' : ''} para ${equipe.nome}, ${minutoDoGol(g.tempo_partida_segundos)}`, onClick: () => corrigirGol(g) }, conteudo)
        : h('div', { class: 'item-gol' }, conteudo));
    });
    elGols.hidden = gols.length === 0;
    elGols.replaceChildren(
      h('h2', { id: 'tit-gols' }, modalidade === 'futebol' ? 'Gols' : modalidade === 'basquete' ? 'Cestas e pontos' : 'Pontos do set'),
      editavel && modalidade === 'futebol' ? h('p', { class: 'ajuda' }, 'Toque em um gol para trocar o autor, marcar como contra ou remover.') : null,
      h('ol', { class: 'lista lista-gols' }, itens));

    elBotoesGol.replaceChildren(...(editavel
      ? ['A', 'B'].flatMap((l) => (modalidade === 'basquete' ? [1, 2, 3] : [1]).map((valor) => {
        const rotulo = modalidade === 'futebol' ? 'Gol' : modalidade === 'basquete' ? (valor === 1 ? 'Lance livre' : valor === 2 ? 'Cesta de 2' : 'Cesta de 3') : 'Ponto';
        const b = h('button', { type: 'button', class: 'btn btn-gol', style: `--cor-equipe: ${equipeDe(l).cor}` },
          icone('bola'), h('span', {}, `${rotulo} · ${equipeDe(l).nome}${modalidade === 'basquete' ? ` (+${valor})` : ''}`));
        b.addEventListener('click', () => marcarGol(l, b, valor));
        return b;
      }))
      : []));
    elBotoesGol.classList.toggle('botoes-gol-correcao', d.partida.status === STATUS_PARTIDA.FINALIZADA);
  }

  // ---- Controles e resultado ---------------------------------------------
  function cartaoResultado() {
    const p = d.partida;
    const motivo = p.configuracao_extra?.motivo_fim;
    const v = vencedor(p, placar);
    const textoVencedor = v === 'empate' ? 'Empate.' : `Vitória do ${equipeDe(v).nome}${p.penaltis_a !== null && placar.a === placar.b ? ' nos pênaltis' : ''}.`;
    const partes = [
      h('h2', {}, p.status === STATUS_PARTIDA.CONFIRMADA ? 'Resultado confirmado' : 'Fim de jogo'),
      h('p', { class: 'resultado-linha' }, `${d.equipeA.nome} ${placar.a} × ${placar.b} ${d.equipeB.nome}${motivo ? ` — ${MOTIVO_FIM[motivo] ?? motivo}` : ''}.`),
      h('p', { class: 'resultado-vencedor' }, textoVencedor),
      h('p', { class: 'texto-suave' }, `Tempo jogado: ${formatarTempo(p.relogio_acumulado_ms)}.`),
    ];

    if (p.status === STATUS_PARTIDA.FINALIZADA) {
      if (precisaPenaltis(p, placar)) {
        let pa = p.penaltis_a ?? 0;
        let pb = p.penaltis_b ?? 0;
        const stA = stepper({ id: 'pen-a', rotulo: `Pênaltis ${d.equipeA.nome}`, valor: pa, min: 0, max: 30, aoMudar: (x) => { pa = x; } });
        const stB = stepper({ id: 'pen-b', rotulo: `Pênaltis ${d.equipeB.nome}`, valor: pb, min: 0, max: 30, aoMudar: (x) => { pb = x; } });
        const salvar = botao(p.penaltis_a === null ? 'Salvar pênaltis' : 'Atualizar pênaltis', 'btn-secundario', (b) =>
          executar(b, () => ctx.partidas.definirPenaltis(id, pa, pb), 'Pênaltis registrados.'));
        partes.push(h('div', { class: 'penaltis' },
          h('h3', {}, 'Disputa de pênaltis'),
          h('p', { class: 'ajuda' }, 'Empatou no tempo normal. Informe quantos pênaltis cada equipe converteu. Pênaltis não contam na artilharia.'),
          h('div', { class: 'penaltis-grade' }, stA.el, stB.el),
          salvar));
      }
      const pendencia = pendenciaParaConfirmar(p, placar);
      const btnConfirmar = botao('Confirmar resultado', 'btn-primario btn-grande', async (b) => {
        const ok = await confirmar({
          titulo: 'Confirmar o resultado?',
          mensagem: `${d.equipeA.nome} ${placar.a} × ${placar.b} ${d.equipeB.nome}. ${textoVencedor} Depois de confirmado, os gols só mudam se você reabrir a partida.`,
          textoConfirmar: 'Confirmar',
        });
        if (ok) executar(b, () => ctx.partidas.confirmar(id), 'Resultado confirmado.');
      });
      if (pendencia) btnConfirmar.disabled = true;
      partes.push(pendencia ? h('p', { class: 'aviso-confirmacao', role: 'status' }, pendencia) : null, btnConfirmar);

      const sobraTempo = p.condicao_encerramento === CONDICOES.GOLS || p.relogio_acumulado_ms < tempoTotalMs(p);
      if (motivo !== 'tempo' && sobraTempo) {
        partes.push(botao('Voltar ao jogo (encerrou por engano)', 'btn-secundario', async (b) => {
          const ok = await confirmar({ titulo: 'Voltar ao jogo?', mensagem: 'A partida volta pausada, com o tempo que tinha. Toque em Retomar para continuar.', textoConfirmar: 'Voltar ao jogo' });
          if (ok) executar(b, () => ctx.partidas.voltarAoJogo(id), 'Partida reaberta. Toque em Retomar.');
        }));
      }
    } else if (p.status === STATUS_PARTIDA.CONFIRMADA) {
      partes.push(botao('Reabrir para corrigir', 'btn-secundario', async (b) => {
        const ok = await confirmar({ titulo: 'Reabrir o resultado?', mensagem: 'Você poderá corrigir gols e pênaltis. Depois, confirme de novo.', textoConfirmar: 'Reabrir' });
        if (ok) executar(b, () => ctx.partidas.reabrir(id), 'Resultado reaberto para correção.');
      }));
    }
    partes.push(h('div', { class: 'acoes acoes-coluna' },
      p.status === STATUS_PARTIDA.CONFIRMADA ? h('a', { class: 'btn btn-primario btn-grande', href: `#/sessao/${sessaoId}/rodizio` }, 'Fazer rodízio de jogadores') : null,
      h('a', { class: `btn ${p.status === STATUS_PARTIDA.CONFIRMADA ? 'btn-secundario' : 'btn-secundario'}`, href: `#/sessao/${sessaoId}/partida/nova` }, 'Próxima partida'),
      h('a', { class: 'btn btn-secundario', href: `#/sessao/${sessaoId}/equipes` }, 'Voltar aos times')));
    return h('section', { class: `cartao fim-jogo${p.status === STATUS_PARTIDA.CONFIRMADA ? ' fim-confirmado' : ''}` }, partes);
  }

  function desenharControles() {
    const p = d.partida;
    const s = situacaoTempo(p, Date.now());
    const itens = [];
    if (p.status === STATUS_PARTIDA.CONFIGURADA) {
      itens.push(botao('Iniciar partida', 'btn-primario btn-gigante', (b) => {
        prepararAudio();
        executar(b, () => ctx.partidas.iniciar(id), 'Apito! Partida iniciada.').then(() => {
          if (d.partida.status === STATUS_PARTIDA.EM_ANDAMENTO) apitar({ bipes: 1, duracao: 0.65, frequencia: 1450 });
        });
      }));
    }
    if (p.status === STATUS_PARTIDA.EM_ANDAMENTO) {
      itens.push(botao('Pausar', 'btn-secundario btn-gigante', (b) => executar(b, () => ctx.partidas.pausar(id))));
    }
    if (p.status === STATUS_PARTIDA.PAUSADA) {
      itens.push(botao(s.noIntervalo ? 'Começar 2º tempo' : 'Retomar', 'btn-primario btn-gigante', (b) => {
        prepararAudio();
        executar(b, () => ctx.partidas.retomar(id));
      }));
    }
    if (partidaAtiva(p)) {
      if (p.condicao_encerramento !== CONDICOES.GOLS) {
        itens.push(botao('+1 min de acréscimo', 'btn-secundario', (b) => executar(b, () => ctx.partidas.adicionarAcrescimo(id, 60), '1 minuto de acréscimo adicionado.')));
      }
      if (p.status !== STATUS_PARTIDA.CONFIGURADA) {
        itens.push(botao('Encerrar partida', 'btn-secundario', async (b) => {
          const ok = await confirmar({ titulo: 'Encerrar a partida agora?', mensagem: `O cronômetro para e o placar atual (${placar.a} × ${placar.b}) fica como resultado.`, textoConfirmar: 'Encerrar' });
          if (ok) executar(b, () => ctx.partidas.finalizar(id));
        }));
      }
      itens.push(botao('Cancelar partida', 'btn-perigo-texto', async (b) => {
        const ok = await confirmar({
          titulo: 'Cancelar esta partida?',
          mensagem: p.status === STATUS_PARTIDA.CONFIGURADA
            ? 'A partida será apagada.'
            : 'A partida fica registrada como cancelada e não conta para nada (nem os gols).',
          textoConfirmar: 'Cancelar partida', perigo: true,
        });
        if (!ok) return;
        await comBotaoOcupado(b, async () => {
          try {
            const r = await ctx.partidas.cancelar(id);
            toast('Partida cancelada.', 'info');
            if (!r) { ctx.navegar(`/sessao/${sessaoId}/equipes`); return; }
            await recarregar();
            redesenhar();
          } catch (e) { toast(e.message, 'erro'); }
        });
      }));
    }
    elControles.replaceChildren(...itens);

    if (p.status === STATUS_PARTIDA.FINALIZADA || p.status === STATUS_PARTIDA.CONFIRMADA) {
      elFim.replaceChildren(cartaoResultado());
    } else if (p.status === STATUS_PARTIDA.CANCELADA) {
      elFim.replaceChildren(h('section', { class: 'cartao fim-jogo' },
        h('h2', {}, 'Partida cancelada'),
        h('div', { class: 'acoes acoes-coluna' },
          h('a', { class: 'btn btn-primario btn-grande', href: `#/sessao/${sessaoId}/partida/nova` }, 'Próxima partida'),
          h('a', { class: 'btn btn-secundario', href: `#/sessao/${sessaoId}/equipes` }, 'Voltar aos times'))));
    } else {
      elFim.replaceChildren();
    }

    if (p.status === STATUS_PARTIDA.EM_ANDAMENTO) telaAcesa.ativar(); else telaAcesa.desativar();
  }

  // ---- Atualização do cronômetro ---------------------------------------
  function atualizar() {
    const p = d.partida;
    const agora = Date.now();
    const s = situacaoTempo(p, agora);
    elPlacar.textContent = `${placar.a} × ${placar.b}`;
    elPenaltisPlacar.textContent = p.penaltis_a !== null && p.penaltis_a !== undefined ? `pênaltis ${p.penaltis_a} × ${p.penaltis_b}` : '';
    if (s.porTempo) {
      elTempo.textContent = formatarRestante(s.restanteMs);
      elRotuloTempo.textContent = p.acrescimos_segundos
        ? `restante (inclui ${p.acrescimos_segundos / 60} min de acréscimo)` : 'restante';
    } else {
      elTempo.textContent = formatarTempo(s.decorridoMs);
      elRotuloTempo.textContent = 'tempo de jogo';
    }
    elTempo.classList.toggle('relogio-parado', !s.rodando);
    elTempo.classList.toggle('relogio-final', s.porTempo && s.rodando && s.restanteMs <= 60_000);
    let status = TEXTO_STATUS[p.status] ?? p.status;
    if (s.noIntervalo) status = `Intervalo — ${p.intervalo_segundos / 60} min`;
    else if (p.status === STATUS_PARTIDA.EM_ANDAMENTO && p.intervalo_segundos) status += s.segundoTempo ? ' · 2º tempo' : ' · 1º tempo';
    elStatus.textContent = status;

    // Evento automático (fim do tempo, intervalo): checagem barata a cada tick;
    // a gravação é feita pelo repositório, que confere o placar pelos gols e
    // garante processar uma única vez.
    if (!processando && avaliarEventoAutomatico(p, { agora, placarA: placar.a, placarB: placar.b })) {
      processando = true;
      ctx.partidas.aplicarEventoAutomatico(id, { agora })
        .then(async (r) => {
          await recarregar();
          if (r) {
            apitar();
            toast(r.evento.tipo === 'intervalo' ? 'Intervalo! O cronômetro foi pausado.' : `Fim de jogo — ${MOTIVO_FIM[r.evento.motivo]}.`, 'info', 5000);
          }
          redesenhar();
        })
        .catch((e) => toast(e.message, 'erro'))
        .finally(() => { processando = false; });
    }
  }

  redesenhar();
  const timer = setInterval(atualizar, 250);

  // Ao voltar do segundo plano / desbloquear a tela, recalcula na hora.
  const aoVoltar = () => { if (document.visibilityState === 'visible') { atualizar(); desenharControles(); } };
  document.addEventListener('visibilitychange', aoVoltar);
  let ouvinteApp = null;
  App.addListener('appStateChange', ({ isActive }) => { if (isActive) aoVoltar(); })
    .then((o) => { ouvinteApp = o; }).catch(() => {});

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', aoVoltar);
    ouvinteApp?.remove?.();
    telaAcesa.desativar();
  };
}
