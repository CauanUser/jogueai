import { abrirBanco } from '../src/services/localStore.js';

let n = 0;
export async function bancoDeTeste() {
  n += 1;
  return abrirBanco({ nome: `jogueai-teste-${Date.now()}-${n}` });
}
