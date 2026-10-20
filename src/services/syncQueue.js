// Fila de sincronização (outbox) com o Supabase.
//
// Garantias:
//  * Operações são enviadas na ordem em que foram feitas (seq crescente).
//  * Reenviar é seguro: upsert por ID e delete por ID são idempotentes.
//  * Falha transitória (sem rede, timeout, servidor fora): a operação continua
//    na fila e é reenviada com espera progressiva.
//  * Falha permanente (o servidor recusou): a operação fica marcada como "erro",
//    a fila PARA nela e o organizador é avisado. Nada é descartado em silêncio.

import { STORES } from './localStore.js';

export const ATRASOS_PADRAO_MS = [2000, 5000, 15000, 30000, 60000];

export class FilaSincronizacao {
  /**
   * @param {object} opts
   * @param {import('./localStore.js').LocalStore} opts.store
   * @param {{executar(op): Promise<{ok:boolean, transitorio?:boolean, mensagem?:string}>}} opts.remoto
   * @param {() => (true | string)} opts.podeSincronizar  true ou o motivo do bloqueio
   */
  constructor({ store, remoto, podeSincronizar, atrasos = ATRASOS_PADRAO_MS,
    agendar = (fn, ms) => setTimeout(fn, ms), cancelar = (t) => clearTimeout(t) }) {
    this.store = store;
    this.remoto = remoto;
    this.podeSincronizar = podeSincronizar;
    this.atrasos = atrasos;
    this.agendar = agendar;
    this.cancelar = cancelar;
    this._ouvintes = new Set();
    this._execucao = null;
    this._timer = null;
    this.estado = {
      pendentes: 0,
      erro: null,          // operação bloqueada por erro permanente
      falhaTransitoria: null,
      bloqueio: null,      // motivo pelo qual não está sincronizando
      sincronizando: false,
      ultimoSucessoEm: null,
    };
  }

  assinar(fn) {
    this._ouvintes.add(fn);
    fn(this.estado);
    return () => this._ouvintes.delete(fn);
  }

  _emitir(parcial) {
    this.estado = { ...this.estado, ...parcial };
    for (const fn of this._ouvintes) {
      try { fn(this.estado); } catch (e) { console.error(e); }
    }
  }

  async _operacoes() {
    const ops = await this.store.listar(STORES.OUTBOX);
    return ops.sort((a, b) => a.seq - b.seq);
  }

  /** Atualiza contadores sem tentar enviar. */
  async atualizarEstado() {
    const ops = await this._operacoes();
    this._emitir({ pendentes: ops.length, erro: ops.find((o) => o.status === 'erro') ?? null });
    return this.estado;
  }

  async registrosPendentes() {
    const ops = await this._operacoes();
    return new Set(ops.map((o) => o.registroId));
  }

  /** Processa a fila. Chamadas concorrentes reutilizam a mesma execução. */
  processar() {
    if (this._execucao) return this._execucao;
    this._execucao = this._processar().finally(() => {
      this._execucao = null;
    });
    return this._execucao;
  }

  async _processar() {
    if (this._timer) { this.cancelar(this._timer); this._timer = null; }
    const permitido = this.podeSincronizar();
    if (permitido !== true) {
      await this.atualizarEstado();
      this._emitir({ bloqueio: permitido || 'Sincronização indisponível.' });
      return this.estado;
    }
    this._emitir({ bloqueio: null, sincronizando: true });

    try {
      for (;;) {
        const ops = await this._operacoes();
        this._emitir({ pendentes: ops.length });
        const op = ops[0];
        if (!op) {
          this._emitir({ erro: null, falhaTransitoria: null });
          break;
        }
        if (op.status === 'erro') {
          this._emitir({ erro: op });
          break;
        }

        let res;
        try {
          res = await this.remoto.executar(op);
        } catch (e) {
          res = { ok: false, transitorio: true, mensagem: e?.message || 'Falha de comunicação.' };
        }

        if (res.ok) {
          await this.store.transacao([STORES.OUTBOX], (h) => h[STORES.OUTBOX].delete(op.seq));
          this._emitir({ ultimoSucessoEm: new Date().toISOString(), falhaTransitoria: null });
          continue;
        }

        const atualizada = {
          ...op,
          tentativas: op.tentativas + 1,
          ultimoErro: res.mensagem ?? 'Erro desconhecido.',
          status: res.transitorio ? 'pendente' : 'erro',
        };
        await this.store.transacao([STORES.OUTBOX], (h) => h[STORES.OUTBOX].put(atualizada));

        if (res.transitorio) {
          const atraso = this.atrasos[Math.min(atualizada.tentativas - 1, this.atrasos.length - 1)];
          this._emitir({ falhaTransitoria: { mensagem: atualizada.ultimoErro, proximaEmMs: atraso } });
          this._timer = this.agendar(() => { this._timer = null; this.processar(); }, atraso);
        } else {
          this._emitir({ erro: atualizada });
        }
        break;
      }
    } finally {
      this._emitir({ sincronizando: false });
    }
    return this.estado;
  }

  /** Recoloca uma operação com erro na fila e tenta de novo. */
  async tentarNovamente(seq) {
    const op = await this.store.obter(STORES.OUTBOX, seq);
    if (op) {
      await this.store.transacao([STORES.OUTBOX], (h) =>
        h[STORES.OUTBOX].put({ ...op, status: 'pendente', tentativas: 0 }));
    }
    return this.processar();
  }

  /** Descarta uma operação (decisão explícita do organizador). Os dados locais permanecem. */
  async descartar(seq) {
    await this.store.transacao([STORES.OUTBOX], (h) => h[STORES.OUTBOX].delete(seq));
    this._emitir({ erro: null });
    return this.processar();
  }
}
