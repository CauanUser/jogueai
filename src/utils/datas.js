/** Data local (do aparelho) no formato AAAA-MM-DD. */
export function dataLocalISO(agora = new Date()) {
  const a = agora.getFullYear();
  const m = String(agora.getMonth() + 1).padStart(2, '0');
  const d = String(agora.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
}

/** Verifica se é uma data de calendário válida no formato AAAA-MM-DD. */
export function ehDataISOValida(txt) {
  if (typeof txt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(txt)) return false;
  const [a, m, d] = txt.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "2026-10-18" → "dom., 18/10/2026" (sem deslocamento de fuso). */
export function formatarDataReferencia(txt) {
  if (!ehDataISOValida(txt)) return txt ?? '';
  const [a, m, d] = txt.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  const semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(dt);
  return `${semana} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

export function formatarHora(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

let ultimoInstante = 0;
/**
 * Timestamp ISO estritamente crescente neste aparelho: garante a ordem de
 * cadastro mesmo quando duas gravações acontecem no mesmo milissegundo.
 */
export function agoraMonotonicoISO(agora = Date.now()) {
  ultimoInstante = Math.max(agora, ultimoInstante + 1);
  return new Date(ultimoInstante).toISOString();
}
