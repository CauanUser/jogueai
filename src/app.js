// Monta as dependências do aplicativo (injeção simples, facilita os testes).
import { abrirBanco } from './services/localStore.js';
import { config, supabaseConfigurado } from './services/config.js';
import { criarClienteSupabase } from './services/supabaseClient.js';
import { criarRemotoSupabase } from './services/remote.js';
import { criarAuth } from './services/auth.js';
import { FilaSincronizacao } from './services/syncQueue.js';
import { baixarDoServidor } from './services/pull.js';
import { criarSessoesRepo } from './repositories/sessoesRepo.js';
import { criarParticipantesRepo } from './repositories/participantesRepo.js';
import { criarSorteiosRepo } from './repositories/sorteiosRepo.js';
import { criarPartidasRepo } from './repositories/partidasRepo.js';
import { criarRodizioRepo } from './repositories/rodizioRepo.js';
import { criarJogadoresRepo } from './repositories/jogadoresRepo.js';

export async function criarApp() {
  const store = await abrirBanco();
  const client = criarClienteSupabase();
  const auth = criarAuth({ client, store });
  await auth.iniciar();

  const remoto = client ? criarRemotoSupabase(client, { timeoutMs: config.timeoutMs }) : null;
  const fila = new FilaSincronizacao({
    store,
    remoto,
    podeSincronizar: () => {
      if (!client) return 'Supabase não configurado: os dados ficam apenas neste aparelho.';
      if (!auth.usuario()) return 'Entre na conta do organizador para enviar os dados ao servidor.';
      if (!auth.vinculado()) return 'A conta conectada não é a vinculada a este aparelho.';
      return true;
    },
  });

  const aoGravar = () => { fila.processar(); };
  const sorteios = criarSorteiosRepo({ store, aoGravar });
  const partidas = criarPartidasRepo({ store, aoGravar });
  const ctx = {
    config,
    supabaseConfigurado: supabaseConfigurado(),
    store,
    client,
    auth,
    fila,
    sessoes: criarSessoesRepo({ store, aoGravar }),
    participantes: criarParticipantesRepo({ store, aoGravar }),
    jogadores: criarJogadoresRepo({ store }),
    sorteios,
    partidas,
    rodizio: criarRodizioRepo({ store, sorteios, partidas, aoGravar }),
    baixarDoServidor: () => baixarDoServidor({ client, store, fila }),
  };

  auth.assinar(() => fila.processar());
  globalThis.addEventListener?.('online', () => fila.processar());
  setInterval(() => { if (ctx.fila.estado.pendentes > 0) fila.processar(); }, 60_000);
  await fila.processar();
  return ctx;
}
