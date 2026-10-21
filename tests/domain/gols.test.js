import { describe, it, expect } from 'vitest';
import {
  placar, validarGol, precisaPenaltis, validarPenaltis, pendenciaParaConfirmar, vencedor, minutoDoGol, ordenarGols,
} from '../../src/domain/gols.js';
import { CONFIG_PADRAO } from '../../src/domain/partida.js';

const p = (extra = {}) => ({
  ...CONFIG_PADRAO, id: 'p1', equipe_a_id: 'A1', equipe_b_id: 'B1', status: 'em_andamento', penaltis_a: null, penaltis_b: null, ...extra,
});
const esc = [{ participante_id: 'ana', lado: 'A' }, { participante_id: 'caio', lado: 'B' }];

describe('placar', () => {
  it('conta gols pela equipe beneficiada (gol contra soma para o adversário)', () => {
    const gols = [
      { partida_id: 'p1', equipe_id: 'A1', tipo: 'normal' },
      { partida_id: 'p1', equipe_id: 'B1', tipo: 'contra', participante_id: 'ana' },
      { partida_id: 'p1', equipe_id: 'B1', tipo: 'normal' },
      { partida_id: 'outra', equipe_id: 'A1', tipo: 'normal' },
    ];
    expect(placar(p(), gols)).toEqual({ a: 1, b: 2 });
    expect(placar(p(), [])).toEqual({ a: 0, b: 0 });
  });
});

describe('validação do gol (espelha o banco)', () => {
  it('gol normal: autor do time que marcou; gol contra: autor do adversário; sem autor é permitido', () => {
    expect(validarGol(p(), esc, { lado: 'A', participanteId: 'ana' })).toBeNull();
    expect(validarGol(p(), esc, { lado: 'A', participanteId: 'caio' })).toMatch(/Gol normal/);
    expect(validarGol(p(), esc, { lado: 'A', participanteId: 'caio', tipo: 'contra' })).toBeNull();
    expect(validarGol(p(), esc, { lado: 'B', participanteId: 'caio', tipo: 'contra' })).toMatch(/Gol contra/);
    expect(validarGol(p(), esc, { lado: 'B', participanteId: null })).toBeNull();
    expect(validarGol(p(), esc, { lado: 'B', participanteId: 'zé' })).toMatch(/não está escalado/);
    expect(validarGol(p(), esc, { lado: 'X' })).toMatch(/equipe/);
  });

  it('respeita o status da partida', () => {
    expect(validarGol(p({ status: 'configurada' }), esc, { lado: 'A' })).toMatch(/Inicie/);
    expect(validarGol(p({ status: 'pausada' }), esc, { lado: 'A' })).toBeNull();
    expect(validarGol(p({ status: 'finalizada' }), esc, { lado: 'A' })).toBeNull(); // correção antes de confirmar
    expect(validarGol(p({ status: 'confirmada' }), esc, { lado: 'A' })).toMatch(/Reabra/);
    expect(validarGol(p({ status: 'cancelada' }), esc, { lado: 'A' })).toMatch(/Reabra/);
  });
});

describe('pênaltis e confirmação', () => {
  it('pênaltis só no empate com desempate por pênaltis', () => {
    expect(precisaPenaltis(p(), { a: 1, b: 1 })).toBe(true);
    expect(precisaPenaltis(p(), { a: 2, b: 1 })).toBe(false);
    expect(precisaPenaltis(p({ desempate: 'nenhum' }), { a: 1, b: 1 })).toBe(false);
  });

  it('disputa precisa de vencedor e valores válidos', () => {
    expect(validarPenaltis(4, 3)).toBeNull();
    expect(validarPenaltis(3, 3)).toMatch(/vencedor/);
    expect(validarPenaltis(-1, 2)).toMatch(/0 a 99/);
    expect(validarPenaltis(1.5, 2)).toMatch(/0 a 99/);
  });

  it('pendências para confirmar', () => {
    const fim = p({ status: 'finalizada' });
    expect(pendenciaParaConfirmar(p(), { a: 2, b: 0 })).toMatch(/encerrada/);
    expect(pendenciaParaConfirmar(fim, { a: 2, b: 0 })).toBeNull();
    expect(pendenciaParaConfirmar(fim, { a: 1, b: 1 })).toMatch(/pênaltis/);
    expect(pendenciaParaConfirmar({ ...fim, penaltis_a: 5, penaltis_b: 4 }, { a: 1, b: 1 })).toBeNull();
    expect(pendenciaParaConfirmar({ ...fim, penaltis_a: 5, penaltis_b: 4 }, { a: 2, b: 1 })).toMatch(/Remova/);
    expect(pendenciaParaConfirmar({ ...fim, desempate: 'nenhum' }, { a: 0, b: 0 })).toBeNull();
  });

  it('vencedor considera os pênaltis', () => {
    expect(vencedor(p(), { a: 2, b: 1 })).toBe('A');
    expect(vencedor(p({ penaltis_a: 3, penaltis_b: 5 }), { a: 1, b: 1 })).toBe('B');
    expect(vencedor(p({ desempate: 'nenhum' }), { a: 1, b: 1 })).toBe('empate');
  });
});

describe('formatação', () => {
  it('minuto do gol e ordem cronológica', () => {
    expect(minutoDoGol(0)).toBe("1'");
    expect(minutoDoGol(59)).toBe("1'");
    expect(minutoDoGol(60)).toBe("2'");
    const ord = ordenarGols([
      { id: 'b', tempo_partida_segundos: 90, ocorrido_em: '2026-01-01T00:00:02Z' },
      { id: 'a', tempo_partida_segundos: 30, ocorrido_em: '2026-01-01T00:00:03Z' },
      { id: 'c', tempo_partida_segundos: 90, ocorrido_em: '2026-01-01T00:00:01Z' },
    ]);
    expect(ord.map((g) => g.id)).toEqual(['a', 'c', 'b']);
  });
});
