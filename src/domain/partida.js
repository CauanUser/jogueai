// Regras de uma partida: configuração, validação e encerramento automático.
import { decorridoMs, estaRodando, instanteQueAtinge } from './cronometro.js';

export const STATUS_PARTIDA = Object.freeze({
  CONFIGURADA: 'configurada',
  EM_ANDAMENTO: 'em_andamento',
  PAUSADA: 'pausada',
  FINALIZADA: 'finalizada',
  CONFIRMADA: 'confirmada',
  CANCELADA: 'cancelada',
});

export const CONDICOES = Object.freeze({
  PRIMEIRO: 'o_que_vier_primeiro',
  TEMPO: 'tempo',
  GOLS: 'gols',
});

/** Modelo inicial pedido: 8 min, 2 gols, o que vier primeiro, sem acréscimos/intervalo, pênaltis no empate. */
export const CONFIG_PADRAO = Object.freeze({
  duracao_segundos: 480,
  condicao_encerramento: CONDICOES.PRIMEIRO,
  limite_gols: 2,
  acrescimos_segundos: 0,
  intervalo_segundos: 0,
  desempate: 'penaltis',
});

export const LIMITES = Object.freeze({
  duracaoMin: 30, duracaoMax: 7200, golsMin: 1, golsMax: 99, acrescimosMax: 1800, intervaloMax: 3600,
});

const ativas = new Set([STATUS_PARTIDA.CONFIGURADA, STATUS_PARTIDA.EM_ANDAMENTO, STATUS_PARTIDA.PAUSADA]);
export const partidaAtiva = (p) => ativas.has(p?.status);
export const partidaRodando = (p) => p?.status === STATUS_PARTIDA.EM_ANDAMENTO;

/** Normaliza e valida a configuração (espelha as restrições do banco). */
export function validarConfiguracao(entrada) {
  const c = { ...CONFIG_PADRAO, ...entrada };
  const erros = {};
  const inteiro = (v) => Number.isInteger(Number(v)) && v !== '' && v !== null;
  c.duracao_segundos = Number(c.duracao_segundos);
  c.acrescimos_segundos = Number(c.acrescimos_segundos);
  c.intervalo_segundos = Number(c.intervalo_segundos);

  if (!inteiro(c.duracao_segundos) || c.duracao_segundos < LIMITES.duracaoMin || c.duracao_segundos > LIMITES.duracaoMax) {
    erros.duracao_segundos = 'A duração deve ficar entre 30 segundos e 120 minutos.';
  }
  if (!Object.values(CONDICOES).includes(c.condicao_encerramento)) {
    erros.condicao_encerramento = 'Escolha como a partida termina.';
  }
  if (c.condicao_encerramento === CONDICOES.TEMPO) {
    c.limite_gols = null;
  } else {
    c.limite_gols = Number(c.limite_gols);
    if (!inteiro(c.limite_gols) || c.limite_gols < LIMITES.golsMin || c.limite_gols > LIMITES.golsMax) {
      erros.limite_gols = 'O limite de gols deve ficar entre 1 e 99.';
    }
  }
  if (!inteiro(c.acrescimos_segundos) || c.acrescimos_segundos < 0 || c.acrescimos_segundos > LIMITES.acrescimosMax) {
    erros.acrescimos_segundos = 'Acréscimos entre 0 e 30 minutos.';
  }
  if (!inteiro(c.intervalo_segundos) || c.intervalo_segundos < 0 || c.intervalo_segundos > LIMITES.intervaloMax) {
    erros.intervalo_segundos = 'Intervalo entre 0 e 60 minutos.';
  }
  if (!['nenhum', 'penaltis'].includes(c.desempate)) erros.desempate = 'Escolha o tratamento de empate.';

  const ok = Object.keys(erros).length === 0;
  return {
    ok,
    erros,
    config: ok ? {
      duracao_segundos: c.duracao_segundos,
      condicao_encerramento: c.condicao_encerramento,
      limite_gols: c.limite_gols,
      acrescimos_segundos: c.acrescimos_segundos,
      intervalo_segundos: c.intervalo_segundos,
      desempate: c.desempate,
    } : null,
  };
}

export const terminaPorTempo = (c) => c.condicao_encerramento !== CONDICOES.GOLS;
export const terminaPorGols = (c) => c.condicao_encerramento !== CONDICOES.TEMPO && c.limite_gols !== null;

/** Tempo regulamentar + acréscimos, em ms. */
export const tempoTotalMs = (c) => (c.duracao_segundos + c.acrescimos_segundos) * 1000;
/** Momento do intervalo (metade do tempo regulamentar), ou null se desativado. */
export const metadeMs = (c) => (c.intervalo_segundos > 0 ? (c.duracao_segundos * 1000) / 2 : null);

export function relogioDaPartida(p) {
  return {
    acumuladoMs: Number(p.relogio_acumulado_ms ?? 0),
    retomadoEm: p.relogio_retomado_em ? Date.parse(p.relogio_retomado_em) : null,
  };
}

/** Situação atual do tempo da partida. */
export function situacaoTempo(p, agora) {
  const relogio = relogioDaPartida(p);
  const decorrido = decorridoMs(relogio, agora);
  const total = tempoTotalMs(p);
  const metade = metadeMs(p);
  const noIntervalo = metade !== null && !estaRodando(relogio) && relogio.acumuladoMs === metade &&
    p.status === STATUS_PARTIDA.PAUSADA;
  return {
    decorridoMs: decorrido,
    restanteMs: Math.max(0, total - decorrido),
    totalMs: total,
    porTempo: terminaPorTempo(p),
    noIntervalo,
    segundoTempo: metade !== null && decorrido >= metade,
    rodando: estaRodando(relogio),
  };
}

/**
 * O que deve acontecer automaticamente agora?
 *  - { tipo: 'encerrar', motivo: 'tempo' | 'gols', instante, decorridoMs }
 *  - { tipo: 'intervalo', instante, decorridoMs }
 *  - null
 * `instante` é o momento exato em que o evento aconteceu (mesmo que o app
 * tenha ficado fechado), para gravar ended_at corretamente.
 */
export function avaliarEventoAutomatico(p, { agora, placarA = 0, placarB = 0 }) {
  if (p.status !== STATUS_PARTIDA.EM_ANDAMENTO && p.status !== STATUS_PARTIDA.PAUSADA) return null;
  const relogio = relogioDaPartida(p);

  if (terminaPorGols(p) && (placarA >= p.limite_gols || placarB >= p.limite_gols)) {
    return { tipo: 'encerrar', motivo: 'gols', instante: agora, decorridoMs: decorridoMs(relogio, agora) };
  }
  if (!estaRodando(relogio)) return null;

  const metade = metadeMs(p);
  if (metade !== null && relogio.acumuladoMs < metade) {
    const quando = instanteQueAtinge(relogio, metade);
    if (agora >= quando) return { tipo: 'intervalo', instante: quando, decorridoMs: metade };
  }
  if (terminaPorTempo(p)) {
    const total = tempoTotalMs(p);
    const quando = instanteQueAtinge(relogio, total);
    if (agora >= quando) return { tipo: 'encerrar', motivo: 'tempo', instante: quando, decorridoMs: total };
  }
  return null;
}

/** Resultado de uma partida finalizada (sem considerar pênaltis, que entram na fase seguinte). */
export function resultado(placarA, placarB) {
  if (placarA > placarB) return 'A';
  if (placarB > placarA) return 'B';
  return 'empate';
}

/** Sugere as equipes da próxima partida: as que jogaram há mais tempo (ou nunca). */
export function sugerirConfronto(equipes, partidas) {
  const ultimaVez = new Map(equipes.map((e) => [e.id, -1]));
  for (const p of partidas) {
    if (p.status === STATUS_PARTIDA.CANCELADA) continue;
    for (const id of [p.equipe_a_id, p.equipe_b_id]) {
      if (ultimaVez.has(id)) ultimaVez.set(id, Math.max(ultimaVez.get(id), p.numero));
    }
  }
  const ordenadas = [...equipes].sort((a, b) => ultimaVez.get(a.id) - ultimaVez.get(b.id) || a.ordem - b.ordem);
  return ordenadas.slice(0, 2).map((e) => e.id);
}
