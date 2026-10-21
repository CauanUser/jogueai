import { ehDataISOValida } from '../utils/datas.js';

export const STATUS_SESSAO = Object.freeze({
  EM_ANDAMENTO: 'em_andamento',
  ENCERRADA: 'encerrada',
});

export function sessaoEmAndamento(sessoes) {
  return sessoes.find((s) => s.status === STATUS_SESSAO.EM_ANDAMENTO) ?? null;
}

/** Só pode existir uma sessão em andamento por vez. */
export function verificarCriacaoSessao(sessoes, dataReferencia) {
  if (!ehDataISOValida(dataReferencia)) {
    return { ok: false, erro: 'Informe uma data válida.' };
  }
  const ativa = sessaoEmAndamento(sessoes);
  if (ativa) {
    return {
      ok: false,
      erro: 'Já existe uma sessão em andamento. Encerre-a antes de criar outra.',
      sessaoAtiva: ativa,
    };
  }
  return { ok: true };
}

export function participantesEditaveis(sessao) {
  return sessao?.status === STATUS_SESSAO.EM_ANDAMENTO;
}

/** Mais recentes primeiro. */
export function ordenarSessoes(sessoes) {
  return [...sessoes].sort(
    (a, b) =>
      b.data_referencia.localeCompare(a.data_referencia) ||
      (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  );
}

/** Participante já tem nota válida (1 a 10)? Importados da lista começam sem nota. */
export function temNota(p) {
  return Number.isInteger(p?.nota) && p.nota >= 1 && p.nota <= 10;
}

export function resumoParticipantes(participantes) {
  const total = participantes.length;
  const avaliados = participantes.filter(temNota);
  const somaNotas = avaliados.reduce((s, p) => s + p.nota, 0);
  return {
    total,
    somaNotas,
    media: avaliados.length ? somaNotas / avaliados.length : 0,
    semNota: total - avaliados.length,
  };
}
