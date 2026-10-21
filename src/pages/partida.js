import { App } from '@capacitor/app';
import { h, icone, comBotaoOcupado } from '../components/dom.js';
import { confirmar } from '../components/dialogo.js';
import { toast } from '../components/toast.js';
import { apitar, prepararAudio, criarTelaAcesa } from '../components/alerta.js';
import { formatarTempo, formatarRestante } from '../domain/cronometro.js';
import { STATUS_PARTIDA, CONDICOES, situacaoTempo, avaliarEventoAutomatico, partidaAtiva } from '../domain/partida.js';

const TEXTO_STATUS = {
  configurada: 'Pronta para começar',
  em_andamento: 'Em andamento',
  pausada: 'Pausada',
  finalizada: 'Fim de jogo',
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

/** Placar da partida. Gols são registrados na próxima fase; até lá, 0 × 0. */
async function placarDaPartida() {
  return { a: 0, b: 0 };
}

export async function render(el, { id }, ctx) {
  let d = await ctx.partidas.detalhar(id);
  if (!d) {
    el.append(h('div', { class: 'estado-vazio' }, h('h1', {}, 'Partida não encontrada'),
      h('a', { class: 'btn btn-primario', href: '#/' }, 'Voltar ao início')));
    return;
  }
  const sessaoId = d.partida.sessao_id;
  const telaAcesa = criarTelaAcesa();
  let placar = await placarDaPartida(id);
  let processando = false;

  // Elementos fixos (atualizados a cada "tick", sem recriar a tela)
  const elTempo = h('div', { class: 'relogio', role: 'timer', 'aria-live': 'off' });
  const elRotuloTempo = h('div', { class: 'relogio-rotulo' });
  const elStatus = h('p', { class: 'status-partida', 'aria-live': 'polite' });
  const elControles = h('div', { class: 'controles-partida' });
  const elPlacar = h('div', { class: 'placar-numeros', 'aria-live': 'polite' });
  const elFim = h('div');

  const cabecalho = h('div', { class: 'cabecalho-pagina' },
    h('a', { class: 'btn-icone', href: `#/sessao/${sessaoId}/equipes`, 'aria-label': 'Voltar aos times' }, icone('voltar')),
    h('div', {}, h('h1', {}, `Partida nº ${d.partida.numero}`), h('p', { class: 'texto-suave' }, resumoRegras(d.partida))));

  const lado = (equipe, cls) => h('div', { class: `placar-lado ${cls}`, style: `--cor-equipe: ${equipe.cor}` },
    h('span', { class: 'equipe-cor', 'aria-hidden': 'true' }), h('span', { class: 'placar-nome' }, equipe.nome));
  const placarCartao = h('section', { class: 'cartao placar', 'aria-label': 'Placar' },
    h('div', { class: 'placar-linha' }, lado(d.equipeA, 'lado-a'), elPlacar, lado(d.equipeB, 'lado-b')),
    elTempo, elRotuloTempo, elStatus);

  const escalacao = (equipe, jogadores) => h('div', { class: 'escalacao', style: `--cor-equipe: ${equipe.cor}` },
    h('h3', {}, equipe.nome),
    h('ul', {}, jogadores.map((j) => h('li', {}, j.nome))));
  const escalacoes = h('details', { class: 'cartao escalacoes' },
    h('summary', {}, 'Escalações'),
    h('div', { class: 'escalacoes-grade' }, escalacao(d.equipeA, d.jogadoresA), escalacao(d.equipeB, d.jogadoresB)));

  el.append(cabecalho, placarCartao, elControles, elFim, escalacoes);

  // ---- Ações ----------------------------------------------------------
  const executar = (botao, acao, sucesso) => comBotaoOcupado(botao, async () => {
    try {
      await acao();
      d = await ctx.partidas.detalhar(id);
      if (sucesso) toast(sucesso, 'info');
      desenharControles();
      atualizar();
    } catch (e) { toast(e.message, 'erro'); }
  });

  function botao(texto, classe, aoClicar) {
    const b = h('button', { type: 'button', class: `btn ${classe}` }, texto);
    b.addEventListener('click', () => aoClicar(b));
    return b;
  }

  function desenharControles() {
    const p = d.partida;
    const s = situacaoTempo(p, Date.now());
    const itens = [];
    if (p.status === STATUS_PARTIDA.CONFIGURADA) {
      itens.push(botao('Iniciar partida', 'btn-primario btn-gigante', (b) => {
        prepararAudio();
        executar(b, () => ctx.partidas.iniciar(id));
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
          const ok = await confirmar({ titulo: 'Encerrar a partida agora?', mensagem: 'O cronômetro para e o placar atual fica como resultado.', textoConfirmar: 'Encerrar' });
          if (ok) executar(b, () => ctx.partidas.finalizar(id));
        }));
      }
      itens.push(botao('Cancelar partida', 'btn-perigo-texto', async (b) => {
        const ok = await confirmar({
          titulo: 'Cancelar esta partida?',
          mensagem: p.status === STATUS_PARTIDA.CONFIGURADA
            ? 'A partida será apagada.'
            : 'A partida fica registrada como cancelada e não conta para nada.',
          textoConfirmar: 'Cancelar partida', perigo: true,
        });
        if (!ok) return;
        await comBotaoOcupado(b, async () => {
          try {
            const r = await ctx.partidas.cancelar(id);
            toast('Partida cancelada.', 'info');
            if (!r) { ctx.navegar(`/sessao/${sessaoId}/equipes`); return; }
            d = await ctx.partidas.detalhar(id);
            desenharControles(); atualizar();
          } catch (e) { toast(e.message, 'erro'); }
        });
      }));
    }
    elControles.replaceChildren(...itens);

    if (p.status === STATUS_PARTIDA.FINALIZADA || p.status === STATUS_PARTIDA.CANCELADA) {
      const motivo = p.configuracao_extra?.motivo_fim;
      elFim.replaceChildren(h('section', { class: 'cartao fim-jogo' },
        h('h2', {}, p.status === STATUS_PARTIDA.CANCELADA ? 'Partida cancelada' : 'Fim de jogo'),
        p.status === STATUS_PARTIDA.FINALIZADA
          ? h('p', {}, `${d.equipeA.nome} ${placar.a} × ${placar.b} ${d.equipeB.nome}${motivo ? ` — ${MOTIVO_FIM[motivo] ?? motivo}` : ''}.`)
          : null,
        p.status === STATUS_PARTIDA.FINALIZADA
          ? h('p', { class: 'texto-suave' }, `Tempo jogado: ${formatarTempo(p.relogio_acumulado_ms)}.`)
          : null,
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
    // a gravação é feita pelo repositório, que garante processar uma única vez.
    if (!processando && avaliarEventoAutomatico(p, { agora, placarA: placar.a, placarB: placar.b })) {
      processando = true;
      ctx.partidas.aplicarEventoAutomatico(id, { agora, placarA: placar.a, placarB: placar.b })
        .then(async (r) => {
          d = await ctx.partidas.detalhar(id);
          if (r) {
            apitar();
            toast(r.evento.tipo === 'intervalo' ? 'Intervalo! O cronômetro foi pausado.' : `Fim de jogo — ${MOTIVO_FIM[r.evento.motivo]}.`, 'info', 5000);
          }
          desenharControles();
          atualizar();
        })
        .catch((e) => toast(e.message, 'erro'))
        .finally(() => { processando = false; });
    }
  }

  desenharControles();
  atualizar();
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
