import { describe, it, expect } from 'vitest';
import { verificarCriacaoSessao, ordenarSessoes, resumoParticipantes, participantesEditaveis } from '../../src/domain/sessao.js';
import { dataLocalISO, ehDataISOValida, formatarDataReferencia, agoraMonotonicoISO } from '../../src/utils/datas.js';

describe('regras de sessão', () => {
  it('impede duas sessões em andamento', () => {
    const r = verificarCriacaoSessao([{ id: 'x', status: 'em_andamento' }], '2026-10-18');
    expect(r.ok).toBe(false);
    expect(r.sessaoAtiva.id).toBe('x');
  });

  it('permite nova sessão quando as anteriores estão encerradas', () => {
    expect(verificarCriacaoSessao([{ id: 'x', status: 'encerrada' }], '2026-10-18').ok).toBe(true);
  });

  it('rejeita data inválida', () => {
    expect(verificarCriacaoSessao([], '2026-02-30').ok).toBe(false);
    expect(verificarCriacaoSessao([], '18/10/2026').ok).toBe(false);
  });

  it('ordena da mais recente para a mais antiga', () => {
    const r = ordenarSessoes([
      { id: 'a', data_referencia: '2026-10-11', created_at: '1' },
      { id: 'b', data_referencia: '2026-10-18', created_at: '1' },
      { id: 'c', data_referencia: '2026-10-18', created_at: '2' },
    ]);
    expect(r.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });

  it('só permite editar participantes em sessão em andamento', () => {
    expect(participantesEditaveis({ status: 'em_andamento' })).toBe(true);
    expect(participantesEditaveis({ status: 'encerrada' })).toBe(false);
  });

  it('resume participantes', () => {
    expect(resumoParticipantes([{ nota: 7 }, { nota: 5 }])).toEqual({ total: 2, somaNotas: 12, media: 6 });
    expect(resumoParticipantes([]).media).toBe(0);
  });
});

describe('datas', () => {
  it('data local considera o fuso do aparelho, não UTC', () => {
    // 23:30 do dia 18 no horário local continua sendo dia 18
    expect(dataLocalISO(new Date(2026, 9, 18, 23, 30))).toBe('2026-10-18');
  });

  it('valida datas de calendário', () => {
    expect(ehDataISOValida('2024-02-29')).toBe(true);
    expect(ehDataISOValida('2026-02-29')).toBe(false);
  });

  it('formata data de referência sem deslocar o dia', () => {
    expect(formatarDataReferencia('2026-10-18')).toMatch(/18\/10\/2026/);
    expect(formatarDataReferencia('2026-10-18')).toMatch(/^dom/);
  });

  it('timestamps monotônicos nunca se repetem', () => {
    const t = 1_700_000_000_000;
    const a = agoraMonotonicoISO(t);
    const b = agoraMonotonicoISO(t);
    expect(b > a).toBe(true);
  });
});
