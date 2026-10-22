// Gols, placar, pênaltis e resultado de uma partida.
// O placar NUNCA é armazenado: é sempre a contagem dos eventos de gol.
import { STATUS_PARTIDA } from './partida.js';

export const TIPO_GOL = Object.freeze({ NORMAL: 'normal', CONTRA: 'contra' });

/** Status em que gols podem ser lançados/corrigidos (espelha o banco). */
const PODE_LANCAR = new Set([STATUS_PARTIDA.EM_ANDAMENTO, STATUS_PARTIDA.PAUSADA, STATUS_PARTIDA.FINALIZADA]);
export const podeLancarGols = (p) => PODE_LANCAR.has(p?.status);

export const ladoDaEquipe = (p, equipeId) =>
  (equipeId === p.equipe_a_id ? 'A' : equipeId === p.equipe_b_id ? 'B' : null);
export const equipeDoLado = (p, lado) => (lado === 'A' ? p.equipe_a_id : lado === 'B' ? p.equipe_b_id : null);
export const outroLado = (lado) => (lado === 'A' ? 'B' : 'A');

/** Placar { a, b } a partir dos gols da partida. */
export function placar(p, gols) {
  let a = 0; let b = 0;
  for (const g of gols) {
    if (g.partida_id !== undefined && g.partida_id !== p.id) continue;
    if (g.equipe_id === p.equipe_a_id) a += Number(g.valor ?? 1);
    else if (g.equipe_id === p.equipe_b_id) b += Number(g.valor ?? 1);
  }
  return { a, b };
}

/**
 * Valida um gol com as mesmas regras do banco (trigger tg_validar_gol).
 * @param escalacoes lista { participante_id, lado }
 * @param gol { lado (beneficiado), participanteId|null, tipo }
 */
export function validarGol(p, escalacoes, { lado, participanteId = null, tipo = TIPO_GOL.NORMAL }) {
  if (!podeLancarGols(p)) {
    if (p?.status === STATUS_PARTIDA.CONFIGURADA) return 'Inicie a partida antes de marcar gols.';
    return 'O resultado desta partida já foi fechado. Reabra-a para corrigir os gols.';
  }
  if (lado !== 'A' && lado !== 'B') return 'Escolha a equipe que fez o gol.';
  if (!Object.values(TIPO_GOL).includes(tipo)) return 'Tipo de gol inválido.';
  if (participanteId) {
    const esc = escalacoes.find((e) => e.participante_id === participanteId);
    if (!esc) return 'Este jogador não está escalado nesta partida.';
    if (tipo === TIPO_GOL.NORMAL && esc.lado !== lado) return 'Gol normal: o autor precisa jogar pela equipe que marcou.';
    if (tipo === TIPO_GOL.CONTRA && esc.lado === lado) return 'Gol contra: o autor precisa ser do time adversário.';
  }
  return null;
}

/** Empate no tempo normal que precisa (e pode) ir para os pênaltis? */
export function precisaPenaltis(p, pl) {
  return p.desempate === 'penaltis' && pl.a === pl.b;
}

export function validarPenaltis(a, b) {
  const ok = (v) => Number.isInteger(v) && v >= 0 && v <= 99;
  if (!ok(a) || !ok(b)) return 'Informe os pênaltis convertidos de cada equipe (0 a 99).';
  if (a === b) return 'A disputa de pênaltis precisa ter um vencedor.';
  return null;
}

/** O que falta para confirmar o resultado (null = pode confirmar). */
export function pendenciaParaConfirmar(p, pl) {
  if (p.status !== STATUS_PARTIDA.FINALIZADA) return 'Só é possível confirmar uma partida encerrada.';
  if (precisaPenaltis(p, pl)) {
    if (p.penaltis_a === null || p.penaltis_a === undefined) return 'Empate: registre a disputa de pênaltis antes de confirmar.';
    return validarPenaltis(p.penaltis_a, p.penaltis_b);
  }
  if (p.penaltis_a !== null && p.penaltis_a !== undefined) return 'Sem empate, a partida não tem pênaltis. Remova a disputa registrada.';
  return null;
}

/** Vencedor: 'A' | 'B' | 'empate', considerando os pênaltis quando houver. */
export function vencedor(p, pl) {
  if (pl.a !== pl.b) return pl.a > pl.b ? 'A' : 'B';
  if (p.penaltis_a !== null && p.penaltis_a !== undefined && p.penaltis_a !== p.penaltis_b) {
    return p.penaltis_a > p.penaltis_b ? 'A' : 'B';
  }
  return 'empate';
}

/** "3'" a partir dos segundos de jogo (minuto em andamento, como no futebol). */
export function minutoDoGol(segundos) {
  return `${Math.floor(Math.max(0, segundos) / 60) + 1}'`;
}

/** Gols em ordem cronológica de jogo (desempate pela hora do lançamento). */
export function ordenarGols(gols) {
  return [...gols].sort((x, y) => x.tempo_partida_segundos - y.tempo_partida_segundos ||
    String(x.ocorrido_em).localeCompare(String(y.ocorrido_em)) || String(x.created_at).localeCompare(String(y.created_at)));
}
