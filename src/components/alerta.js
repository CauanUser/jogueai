// Aviso sonoro e vibração (fim de jogo, intervalo). Funciona sem plugins:
// usa a Web Audio API e a Vibration API do WebView, quando disponíveis.
let ctxAudio = null;

/** Deve ser chamado em um toque do usuário (ex.: "Iniciar") para liberar o áudio no Android. */
export function prepararAudio() {
  try {
    ctxAudio ??= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    if (ctxAudio.state === 'suspended') ctxAudio.resume();
  } catch { /* sem áudio */ }
}

export function apitar({ bipes = 3, duracao = 0.25, frequencia = 1800 } = {}) {
  try { globalThis.navigator?.vibrate?.([400, 150, 400, 150, 700]); } catch { /* sem vibração */ }
  try {
    prepararAudio();
    if (!ctxAudio) return;
    const t0 = ctxAudio.currentTime;
    for (let i = 0; i < bipes; i++) {
      const osc = ctxAudio.createOscillator();
      const ganho = ctxAudio.createGain();
      osc.type = 'square';
      osc.frequency.value = frequencia;
      ganho.gain.setValueAtTime(0.25, t0 + i * (duracao + 0.15));
      ganho.gain.setValueAtTime(0, t0 + i * (duracao + 0.15) + duracao);
      osc.connect(ganho).connect(ctxAudio.destination);
      osc.start(t0 + i * (duracao + 0.15));
      osc.stop(t0 + i * (duracao + 0.15) + duracao);
    }
  } catch { /* sem áudio */ }
}

/** Mantém a tela acesa durante a partida (quando o aparelho permite). */
export function criarTelaAcesa() {
  let trava = null;
  return {
    async ativar() {
      try { trava ??= await globalThis.navigator?.wakeLock?.request('screen'); } catch { trava = null; }
    },
    async desativar() {
      try { await trava?.release(); } catch { /* já liberada */ }
      trava = null;
    },
  };
}
