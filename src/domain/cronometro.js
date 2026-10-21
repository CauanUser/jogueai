// Cronômetro baseado em instantes (timestamps), não em contagem de "ticks".
//
// Estado persistido:
//   acumuladoMs  — tempo já jogado até a última pausa
//   retomadoEm   — instante (ms) em que o relógio voltou a correr; null = parado
//
// decorrido = acumuladoMs + (agora - retomadoEm)
//
// Como só instantes são gravados, o tempo continua certo com a tela
// bloqueada, o app em segundo plano, a interface recriada ou o app reaberto.

export function criarRelogio() {
  return { acumuladoMs: 0, retomadoEm: null };
}

export function estaRodando(relogio) {
  return relogio.retomadoEm !== null && relogio.retomadoEm !== undefined;
}

export function decorridoMs(relogio, agora) {
  const extra = estaRodando(relogio) ? Math.max(0, agora - relogio.retomadoEm) : 0;
  return relogio.acumuladoMs + extra;
}

export function iniciar(relogio, agora) {
  if (estaRodando(relogio)) return relogio;
  return { acumuladoMs: relogio.acumuladoMs, retomadoEm: agora };
}

export const retomar = iniciar;

export function pausar(relogio, agora) {
  if (!estaRodando(relogio)) return relogio;
  return { acumuladoMs: decorridoMs(relogio, agora), retomadoEm: null };
}

/** Para o relógio exatamente em `limiteMs` (ex.: fim do tempo), sem passar do limite. */
export function pararEm(relogio, limiteMs) {
  return { acumuladoMs: Math.max(0, limiteMs), retomadoEm: null };
}

/**
 * Instante (ms) em que o relógio vai atingir `alvoMs` de tempo decorrido,
 * ou null se estiver parado. Usado para saber QUANDO o tempo acabou, mesmo
 * que o app só seja reaberto depois.
 */
export function instanteQueAtinge(relogio, alvoMs) {
  if (!estaRodando(relogio)) return null;
  return relogio.retomadoEm + Math.max(0, alvoMs - relogio.acumuladoMs);
}

/** 65000 → "01:05"; 3605000 → "60:05". Valores negativos viram 00:00. */
export function formatarTempo(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60);
  const seg = total % 60;
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
}

/** Arredonda para cima: o placar mostra 00:01 até o último segundo acabar. */
export function formatarRestante(ms) {
  return formatarTempo(Math.ceil(Math.max(0, ms) / 1000) * 1000);
}
