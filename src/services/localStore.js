// Armazenamento local no aparelho (IndexedDB).
// Toda gravação é feita primeiro aqui; a fila "outbox" guarda o que ainda
// precisa ser enviado ao Supabase. Registro + operação da fila são gravados
// na MESMA transação: ou os dois ficam salvos, ou nenhum.

export const NOME_BANCO = 'jogueai';
export const VERSAO_BANCO = 1;

export const STORES = Object.freeze({
  SESSOES: 'sessoes',
  PARTICIPANTES: 'participantes',
  OUTBOX: 'outbox',
  META: 'meta',
});

function promessa(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function abrirBanco({ nome = NOME_BANCO, idb = globalThis.indexedDB } = {}) {
  if (!idb) return Promise.reject(new Error('Armazenamento local indisponível neste aparelho.'));
  return new Promise((resolve, reject) => {
    const req = idb.open(nome, VERSAO_BANCO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.SESSOES)) {
        db.createObjectStore(STORES.SESSOES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.PARTICIPANTES)) {
        const s = db.createObjectStore(STORES.PARTICIPANTES, { keyPath: 'id' });
        s.createIndex('sessao_id', 'sessao_id');
      }
      if (!db.objectStoreNames.contains(STORES.OUTBOX)) {
        const s = db.createObjectStore(STORES.OUTBOX, { keyPath: 'seq', autoIncrement: true });
        s.createIndex('registro_id', 'registroId');
      }
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: 'chave' });
      }
    };
    req.onsuccess = () => resolve(new LocalStore(req.result));
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('O banco local está em uso por outra janela.'));
  });
}

export class LocalStore {
  constructor(db) {
    this.db = db;
  }

  async obter(store, chave) {
    const tx = this.db.transaction(store, 'readonly');
    return (await promessa(tx.objectStore(store).get(chave))) ?? null;
  }

  async listar(store) {
    const tx = this.db.transaction(store, 'readonly');
    return promessa(tx.objectStore(store).getAll());
  }

  async listarPorIndice(store, indice, valor) {
    const tx = this.db.transaction(store, 'readonly');
    return promessa(tx.objectStore(store).index(indice).getAll(valor));
  }

  async contar(store) {
    const tx = this.db.transaction(store, 'readonly');
    return promessa(tx.objectStore(store).count());
  }

  /**
   * Executa gravações atômicas. `fn` recebe um objeto { [store]: IDBObjectStore }
   * e deve apenas emitir as requisições (put/delete/add), sem aguardar promessas externas.
   */
  transacao(stores, fn) {
    return new Promise((resolve, reject) => {
      let resultado;
      const tx = this.db.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve(resultado);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Gravação local cancelada.'));
      try {
        const handles = Object.fromEntries(stores.map((s) => [s, tx.objectStore(s)]));
        resultado = fn(handles);
      } catch (e) {
        try { tx.abort(); } catch { /* já abortada */ }
        reject(e);
      }
    });
  }

  async obterMeta(chave) {
    return (await this.obter(STORES.META, chave))?.valor ?? null;
  }

  definirMeta(chave, valor) {
    return this.transacao([STORES.META], (h) => h[STORES.META].put({ chave, valor }));
  }
}

/** Adiciona uma operação à fila de envio (dentro de uma transação já aberta). */
export function enfileirar(outbox, { tabela, acao, registroId, dados = null }) {
  outbox.add({
    tabela,
    acao, // 'upsert' | 'delete'
    registroId,
    dados,
    criadoEm: new Date().toISOString(),
    tentativas: 0,
    status: 'pendente', // 'pendente' | 'erro'
    ultimoErro: null,
  });
}
