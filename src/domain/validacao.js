// Regras de validação de participantes (espelham as restrições do banco).
export const NOME_MAX = 40;
export const NOTA_MIN = 1;
export const NOTA_MAX = 10;

/** Remove espaços extras e normaliza Unicode. */
export function normalizarNome(nome) {
  return String(nome ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Chave usada para detectar nomes repetidos (sem diferenciar maiúsculas). */
export function chaveNome(nome) {
  return normalizarNome(nome).toLocaleLowerCase('pt-BR');
}

export function validarNome(nome) {
  const n = normalizarNome(nome);
  if (!n) return 'Informe o nome do jogador.';
  if (n.length > NOME_MAX) return `O nome pode ter no máximo ${NOME_MAX} caracteres.`;
  return null;
}

export function validarNota(nota) {
  const n = typeof nota === 'string' && nota.trim() !== '' ? Number(nota) : nota;
  if (!Number.isInteger(n)) return 'Escolha uma nota de 1 a 10.';
  if (n < NOTA_MIN || n > NOTA_MAX) return `A nota deve estar entre ${NOTA_MIN} e ${NOTA_MAX}.`;
  return null;
}

/**
 * Valida um participante contra os já cadastrados na sessão.
 * @param {{nome:string, nota:number|string}} dados
 * @param {Array<{id:string, nome:string}>} existentes
 * @param {string|null} ignorarId  id do próprio participante (em edição)
 */
export function validarParticipante(dados, existentes = [], ignorarId = null) {
  const erros = {};
  const eNome = validarNome(dados?.nome);
  if (eNome) erros.nome = eNome;
  const eNota = validarNota(dados?.nota);
  if (eNota) erros.nota = eNota;

  const nome = normalizarNome(dados?.nome);
  if (!erros.nome) {
    const chave = chaveNome(nome);
    const repetido = existentes.find((p) => p.id !== ignorarId && chaveNome(p.nome) === chave);
    if (repetido) {
      erros.nome = `Já existe "${repetido.nome}" nesta sessão. Diferencie, por exemplo: "${repetido.nome} S."`;
    }
  }
  const ok = Object.keys(erros).length === 0;
  return { ok, erros, valor: ok ? { nome, nota: Number(dados.nota) } : null };
}
