// Gerador pseudoaleatório com semente (mulberry32): reprodutível nos testes,
// e semeado com crypto no uso real.
export function criarRng(semente = null) {
  let a = semente ?? (globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    : Math.floor(Math.random() * 2 ** 32));
  a >>>= 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function inteiroAleatorio(rng, max) {
  return Math.floor(rng() * max);
}

/** Fisher–Yates, retorna uma cópia embaralhada. */
export function embaralhar(lista, rng) {
  const c = [...lista];
  for (let i = c.length - 1; i > 0; i--) {
    const j = inteiroAleatorio(rng, i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}
