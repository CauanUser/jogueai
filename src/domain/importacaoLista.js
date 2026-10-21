// Leitura da lista do racha copiada do WhatsApp.
//
// Formato esperado (o cabeçalho é opcional):
//
//   LISTA DO RACHA - DOMINGO 07:00
//
//   01 - Alisson
//   02 - Michel
//   10 -
//
// Regras:
//  * Linhas "NN - Nome" viram jogadores (o número só organiza a lista: é descartado).
//  * Linhas "NN -" (sem nome) são vagas livres.
//  * Texto sem número antes da primeira linha numerada é cabeçalho (ignorado).
//  * Qualquer outra linha é informada como "não reconhecida" — nunca vira jogador.
//  * Nomes repetidos na mesma lista entram uma única vez (os repetidos são avisados).

import { normalizarNome, chaveNome, validarNome } from './validacao.js';

// Aceita "-" e também "–"/"—" (o celular às vezes troca o hífen automaticamente).
const LINHA_NUMERADA = /^(\d{1,3})\s*[-–—]\s*(.*)$/;
// Textos que, no lugar do nome, significam vaga livre.
const MARCADORES_DE_VAGA = new Set(['', '-', '–', '—', '.', '...', '…', '_', 'vaga', 'livre', 'vago', 'aberto']);

/** Remove caracteres invisíveis e a formatação do WhatsApp (*negrito*, _itálico_, ~riscado~). */
function limparLinha(linha) {
  return String(linha)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '') // caracteres de largura zero
    .replace(/[\u00A0\u2007\u202F]/g, ' ') // espaços não separáveis
    .trim();
}

function limparNome(texto) {
  let t = texto.trim();
  // Remove marcadores de formatação que envolvem o nome inteiro: *Nome*, _Nome_, ~Nome~
  for (let i = 0; i < 3; i++) {
    const m = t.match(/^([*_~])(.+)\1$/);
    if (!m) break;
    t = m[2].trim();
  }
  return normalizarNome(t);
}

/**
 * @param {string} texto  conteúdo colado
 * @returns {{
 *   jogadores: Array<{nome: string, numero: number, linha: number}>,
 *   vagas: number, posicoes: number, cabecalho: string|null,
 *   repetidos: Array<{nome: string, linha: number}>,
 *   naoReconhecidas: Array<{linha: number, texto: string, motivo: string}>
 * }}
 */
export function interpretarListaWhatsApp(texto) {
  const resultado = { jogadores: [], vagas: 0, posicoes: 0, cabecalho: null, repetidos: [], naoReconhecidas: [] };
  const vistos = new Map(); // chave do nome -> jogador
  const linhas = String(texto ?? '').split(/\r\n|\r|\n/);
  let listaComecou = false;
  const cabecalho = [];

  linhas.forEach((bruta, i) => {
    const numeroLinha = i + 1;
    const linha = limparLinha(bruta);
    if (!linha) return;

    const m = linha.match(LINHA_NUMERADA);
    if (!m) {
      if (!listaComecou) { cabecalho.push(linha); return; }
      resultado.naoReconhecidas.push({ linha: numeroLinha, texto: linha, motivo: 'Fora do formato "número - nome".' });
      return;
    }

    listaComecou = true;
    resultado.posicoes++;
    const nome = limparNome(m[2]);

    if (MARCADORES_DE_VAGA.has(nome.toLocaleLowerCase('pt-BR'))) {
      resultado.vagas++;
      return;
    }
    if (/^[\d\s.,:/-]+$/.test(nome)) {
      resultado.naoReconhecidas.push({ linha: numeroLinha, texto: linha, motivo: 'O nome contém apenas números.' });
      return;
    }
    const erro = validarNome(nome);
    if (erro) {
      resultado.naoReconhecidas.push({ linha: numeroLinha, texto: linha, motivo: erro });
      return;
    }

    const chave = chaveNome(nome);
    if (vistos.has(chave)) {
      resultado.repetidos.push({ nome, linha: numeroLinha });
      return;
    }
    const jogador = { nome, numero: Number(m[1]), linha: numeroLinha };
    vistos.set(chave, jogador);
    resultado.jogadores.push(jogador);
  });

  resultado.cabecalho = cabecalho.length ? cabecalho.join(' ') : null;
  return resultado;
}

/**
 * Compara os nomes importados com os participantes já cadastrados na sessão.
 * Quem já existe NÃO é importado de novo (e o cadastro existente, com a nota, é preservado).
 */
export function separarJaCadastrados(nomes, existentes) {
  const chaves = new Map(existentes.map((p) => [chaveNome(p.nome), p]));
  const novos = [];
  const jaCadastrados = [];
  for (const nome of nomes) {
    const existente = chaves.get(chaveNome(nome));
    if (existente) jaCadastrados.push({ nome, existente });
    else novos.push(nome);
  }
  return { novos, jaCadastrados };
}

/**
 * Valida a lista final (depois de o organizador corrigir/remover nomes na prévia).
 * @returns {{ok: boolean, erros: Array<{indice: number, erro: string}>, nomes: string[]}}
 */
export function validarNomesParaImportar(nomes, existentes = []) {
  const erros = [];
  const usados = new Map(existentes.map((p) => [chaveNome(p.nome), `já cadastrado como "${p.nome}"`]));
  const limpos = nomes.map((n) => normalizarNome(n));
  limpos.forEach((nome, indice) => {
    const e = validarNome(nome);
    if (e) { erros.push({ indice, erro: e }); return; }
    const chave = chaveNome(nome);
    if (usados.has(chave)) { erros.push({ indice, erro: `Nome repetido (${usados.get(chave)}).` }); return; }
    usados.set(chave, 'aparece duas vezes nesta lista');
  });
  return { ok: erros.length === 0, erros, nomes: limpos };
}
