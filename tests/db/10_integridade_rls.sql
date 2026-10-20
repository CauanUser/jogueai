-- Testes de integridade, regras de negócio e políticas de acesso (RLS).
-- Executados por scripts/test-db.sh após aplicar as migrações.
\set QUIET on
\o /dev/null
reset role;

create schema teste;
grant usage on schema teste to anon, authenticated;

create function teste.deve_falhar(p_sql text, p_codigo text, p_msg text)
returns void language plpgsql as $$
declare
  v_executou boolean := false;
begin
  begin
    execute p_sql;
    v_executou := true;
  exception when others then
    if sqlstate <> p_codigo then
      raise exception 'FALHOU [%]: esperado código %, obtido % (%)', p_msg, p_codigo, sqlstate, sqlerrm;
    end if;
  end;
  if v_executou then
    raise exception 'FALHOU [%]: o comando deveria ter falhado: %', p_msg, p_sql;
  end if;
end;
$$;

create function teste.igual(p_obtido anyelement, p_esperado anyelement, p_msg text)
returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU [%]: esperado %, obtido %', p_msg, p_esperado, p_obtido;
  end if;
end;
$$;
grant execute on all functions in schema teste to anon, authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'org1@teste'),
  ('22222222-2222-2222-2222-222222222222', 'org2@teste');

-- ====================================================================
-- 1. Papel anônimo não acessa nada
-- ====================================================================
set role anon;
select teste.deve_falhar('select * from public.sessoes', '42501', 'anon lê sessoes');
select teste.deve_falhar($q$insert into public.sessoes (data_referencia) values ('2026-10-18')$q$, '42501', 'anon insere sessão');
select teste.deve_falhar('select * from public.v_artilharia', '42501', 'anon lê artilharia');
reset role;

-- ====================================================================
-- 2. Organizador 1: sessão e participantes
-- ====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

insert into public.sessoes (id, data_referencia)
values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-11');

select teste.deve_falhar(
  $q$insert into public.sessoes (data_referencia) values ('2026-10-11')$q$,
  '23505', 'segunda sessão em andamento é bloqueada');

insert into public.participantes (id, sessao_id, nome, nota) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'João', 7);

select teste.deve_falhar(
  $q$insert into public.participantes (sessao_id, nome, nota) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pedro', 11)$q$,
  '23514', 'nota 11 rejeitada');
select teste.deve_falhar(
  $q$insert into public.participantes (sessao_id, nome, nota) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pedro', 0)$q$,
  '23514', 'nota 0 rejeitada');
select teste.deve_falhar(
  $q$insert into public.participantes (sessao_id, nome, nota) values ('aaaaaaaa-0000-0000-0000-000000000001', 'joão', 5)$q$,
  '23505', 'nome duplicado (sem diferenciar maiúsculas) rejeitado');
select teste.deve_falhar(
  $q$insert into public.participantes (sessao_id, nome, nota) values ('aaaaaaaa-0000-0000-0000-000000000001', ' Ana ', 5)$q$,
  '23514', 'nome com espaços nas pontas rejeitado');
select teste.deve_falhar(
  $q$insert into public.participantes (sessao_id, nome, nota) values ('aaaaaaaa-0000-0000-0000-000000000001', '', 5)$q$,
  '23514', 'nome vazio rejeitado');
select teste.deve_falhar(
  $q$insert into public.participantes (sessao_id, nome, nota) values ('aaaaaaaa-0000-0000-0000-0000000000ff', 'Zé', 5)$q$,
  '23503', 'participante em sessão inexistente rejeitado');

-- Reenvio idempotente (mesmo ID) não duplica
insert into public.participantes (id, sessao_id, nome, nota)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'João', 7)
on conflict (id) do nothing;
select teste.igual((select count(*) from public.participantes)::int, 1, 'reenvio não duplica');

-- Upsert atualiza nota (antes da confirmação dos times)
insert into public.participantes (id, sessao_id, nome, nota)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'João', 8)
on conflict (id) do update set nome = excluded.nome, nota = excluded.nota;
select teste.igual((select nota from public.participantes where nome = 'João')::int, 8, 'upsert atualiza nota');

-- Não é possível trocar o dono nem mover para outra sessão
select teste.deve_falhar(
  $q$update public.participantes set owner_id = '22222222-2222-2222-2222-222222222222'$q$,
  '23514', 'trocar dono bloqueado');

-- Encerrar sessão exige encerrada_em (coerência)
select teste.deve_falhar(
  $q$update public.sessoes set status = 'encerrada' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$,
  '23514', 'encerrar sem encerrada_em rejeitado');
update public.sessoes set status = 'encerrada', encerrada_em = now()
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select teste.deve_falhar(
  $q$insert into public.participantes (sessao_id, nome, nota) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Tardio', 5)$q$,
  '23514', 'sessão encerrada não aceita participantes');
select teste.deve_falhar(
  $q$delete from public.participantes where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$,
  '23514', 'sessão encerrada não permite remover participantes');

-- Nova sessão depois de encerrar a anterior: permitido, histórico preservado
insert into public.sessoes (id, data_referencia)
values ('aaaaaaaa-0000-0000-0000-000000000002', '2026-10-18');
select teste.igual((select count(*) from public.sessoes)::int, 2, 'histórico preservado');

select teste.deve_falhar(
  $q$update public.participantes set sessao_id = 'aaaaaaaa-0000-0000-0000-000000000002' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$,
  '23514', 'mover participante de sessão bloqueado');
reset role;

-- ====================================================================
-- 3. Organizador 2 não vê nem altera dados do organizador 1
-- ====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

select teste.igual((select count(*) from public.sessoes)::int, 0, 'org2 não vê sessões do org1');
select teste.igual((select count(*) from public.participantes)::int, 0, 'org2 não vê participantes do org1');

select teste.deve_falhar(
  $q$insert into public.participantes (sessao_id, nome, nota) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Invasor', 5)$q$,
  '23503', 'org2 não insere em sessão do org1');
select teste.deve_falhar(
  $q$insert into public.participantes (owner_id, sessao_id, nome, nota) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'Invasor', 5)$q$,
  '42501', 'org2 não se passa pelo org1');

with alterados as (update public.sessoes set status = 'encerrada', encerrada_em = now() returning 1)
select teste.igual((select count(*) from alterados)::int, 0, 'org2 não altera sessões do org1');
with apagados as (delete from public.sessoes returning 1)
select teste.igual((select count(*) from apagados)::int, 0, 'org2 não apaga sessões do org1');

-- org2 tem sua própria sessão em andamento (índice é por organizador)
insert into public.sessoes (data_referencia) values ('2026-10-18');
reset role;

-- ====================================================================
-- 4. Fluxo completo: times, partida, gols, artilharia
-- ====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

\set S '''aaaaaaaa-0000-0000-0000-000000000002'''
insert into public.participantes (id, sessao_id, nome, nota) values
  ('cccccccc-0000-0000-0000-000000000001', :S, 'Ana',   9),
  ('cccccccc-0000-0000-0000-000000000002', :S, 'Bruno', 6),
  ('cccccccc-0000-0000-0000-000000000003', :S, 'Caio',  8),
  ('cccccccc-0000-0000-0000-000000000004', :S, 'Duda',  7),
  ('cccccccc-0000-0000-0000-000000000005', :S, 'Edu',   5);

insert into public.sorteios (id, sessao_id, numero, jogadores_por_equipe, qtd_equipes)
values ('dddddddd-0000-0000-0000-000000000001', :S, 1, 2, 2);
insert into public.equipes (id, sessao_id, sorteio_id, nome, ordem) values
  ('eeeeeeee-0000-0000-0000-00000000000a', :S, 'dddddddd-0000-0000-0000-000000000001', 'Time A', 1),
  ('eeeeeeee-0000-0000-0000-00000000000b', :S, 'dddddddd-0000-0000-0000-000000000001', 'Time B', 2);
insert into public.equipe_participantes (sessao_id, sorteio_id, equipe_id, participante_id) values
  (:S, 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001'),
  (:S, 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000002'),
  (:S, 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000003'),
  (:S, 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000004');

select teste.deve_falhar(
  $q$insert into public.equipe_participantes (sessao_id, sorteio_id, equipe_id, participante_id) values ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000001')$q$,
  '23505', 'participante em duas equipes do mesmo sorteio');
select teste.deve_falhar(
  $q$insert into public.equipe_participantes (sessao_id, sorteio_id, equipe_id, participante_id) values ('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001')$q$,
  '23503', 'participante de outra sessão não entra na equipe');
select teste.deve_falhar(
  $q$update public.participantes set nota = 10 where nome = 'Ana'$q$,
  '23514', 'nota travada após confirmação dos times');
select teste.deve_falhar(
  $q$delete from public.participantes where nome = 'Ana'$q$,
  '23503', 'participante em equipe não pode ser removido');
-- Edu está na fila de espera: pode ser removido
delete from public.participantes where nome = 'Edu';

\set P '''ffffffff-0000-0000-0000-000000000001'''
select teste.deve_falhar(
  $q$insert into public.partidas (sessao_id, numero, equipe_a_id, equipe_b_id, duracao_segundos, condicao_encerramento) values ('aaaaaaaa-0000-0000-0000-000000000002', 1, 'eeeeeeee-0000-0000-0000-00000000000a', 'eeeeeeee-0000-0000-0000-00000000000a', 480, 'tempo')$q$,
  '23514', 'partida com a mesma equipe dos dois lados');
select teste.deve_falhar(
  $q$insert into public.partidas (sessao_id, numero, equipe_a_id, equipe_b_id, duracao_segundos, condicao_encerramento) values ('aaaaaaaa-0000-0000-0000-000000000002', 1, 'eeeeeeee-0000-0000-0000-00000000000a', 'eeeeeeee-0000-0000-0000-00000000000b', 480, 'gols')$q$,
  '23514', 'condição por gols exige limite');

insert into public.partidas (id, sessao_id, numero, equipe_a_id, equipe_b_id,
  duracao_segundos, condicao_encerramento, limite_gols)
values (:P, :S, 1, 'eeeeeeee-0000-0000-0000-00000000000a', 'eeeeeeee-0000-0000-0000-00000000000b',
  480, 'o_que_vier_primeiro', 2);

insert into public.partida_escalacoes (sessao_id, partida_id, participante_id, lado) values
  (:S, :P, 'cccccccc-0000-0000-0000-000000000001', 'A'),
  (:S, :P, 'cccccccc-0000-0000-0000-000000000002', 'A'),
  (:S, :P, 'cccccccc-0000-0000-0000-000000000003', 'B'),
  (:S, :P, 'cccccccc-0000-0000-0000-000000000004', 'B');

select teste.deve_falhar(
  $q$insert into public.gols (sessao_id, partida_id, equipe_id, participante_id, tempo_partida_segundos) values ('aaaaaaaa-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001', 10)$q$,
  '23514', 'gol em partida não iniciada');

update public.partidas
   set status = 'em_andamento', started_at = '2026-10-18 23:55-03', relogio_retomado_em = '2026-10-18 23:55-03'
 where id = :P;

-- Gol normal da Ana (Time A) — marcado após a meia-noite: continua na sessão
insert into public.gols (id, sessao_id, partida_id, equipe_id, participante_id, tempo_partida_segundos, ocorrido_em)
values ('99999999-0000-0000-0000-000000000001', :S, :P, 'eeeeeeee-0000-0000-0000-00000000000a',
        'cccccccc-0000-0000-0000-000000000001', 360, '2026-10-19 00:01-03');

-- Reenvio do mesmo evento não duplica
insert into public.gols (id, sessao_id, partida_id, equipe_id, participante_id, tempo_partida_segundos, ocorrido_em)
values ('99999999-0000-0000-0000-000000000001', :S, :P, 'eeeeeeee-0000-0000-0000-00000000000a',
        'cccccccc-0000-0000-0000-000000000001', 360, '2026-10-19 00:01-03')
on conflict (id) do nothing;

-- Gol contra do Caio (Time B) beneficia o Time A
insert into public.gols (sessao_id, partida_id, equipe_id, participante_id, tipo, tempo_partida_segundos)
values (:S, :P, 'eeeeeeee-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000003', 'contra', 400);

-- Gol do Caio para o Time B
insert into public.gols (sessao_id, partida_id, equipe_id, participante_id, tempo_partida_segundos)
values (:S, :P, 'eeeeeeee-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000003', 420);

select teste.deve_falhar(
  $q$insert into public.gols (sessao_id, partida_id, equipe_id, participante_id, tempo_partida_segundos) values ('aaaaaaaa-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000001', 10)$q$,
  '23514', 'gol normal creditado à equipe errada');
select teste.deve_falhar(
  $q$insert into public.gols (sessao_id, partida_id, equipe_id, participante_id, tipo, tempo_partida_segundos) values ('aaaaaaaa-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001', 'contra', 10)$q$,
  '23514', 'gol contra precisa ser de jogador adversário');
select teste.deve_falhar(
  $q$insert into public.gols (sessao_id, partida_id, equipe_id, participante_id, tipo, tempo_partida_segundos) values ('aaaaaaaa-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001', 'penalti', 10)$q$,
  '23514', 'tipo de gol inválido');

select teste.igual((select placar_a from public.v_placar_partidas where partida_id = :P), 2, 'placar A');
select teste.igual((select placar_b from public.v_placar_partidas where partida_id = :P), 1, 'placar B');
select teste.igual((select count(*) from public.v_artilharia)::int, 0, 'partida não confirmada não entra na artilharia');

-- Corrigir: remover o gol do Caio enquanto não confirmada
delete from public.gols where equipe_id = 'eeeeeeee-0000-0000-0000-00000000000b';
select teste.igual((select placar_b from public.v_placar_partidas where partida_id = :P), 0, 'placar B corrigido');

-- Confirmar a partida
update public.partidas
   set status = 'confirmada', relogio_retomado_em = null, relogio_acumulado_ms = 420000,
       ended_at = now(), confirmed_at = now()
 where id = :P;

select teste.igual((select gols from public.v_artilharia where nome = 'Ana'), 1, 'Ana tem 1 gol');
select teste.igual((select count(*) from public.v_artilharia where nome = 'Caio')::int, 0, 'gol contra não conta para o autor');
select teste.deve_falhar(
  $q$insert into public.gols (sessao_id, partida_id, equipe_id, participante_id, tempo_partida_segundos) values ('aaaaaaaa-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000002', 10)$q$,
  '23514', 'partida confirmada não aceita gols');
select teste.deve_falhar(
  $q$delete from public.gols where partida_id = 'ffffffff-0000-0000-0000-000000000001'$q$,
  '23514', 'partida confirmada não permite apagar gols');

-- Segunda partida (pênaltis não entram na artilharia; ranking com empate)
\set P2 '''ffffffff-0000-0000-0000-000000000002'''
insert into public.partidas (id, sessao_id, numero, equipe_a_id, equipe_b_id,
  duracao_segundos, condicao_encerramento, status, started_at, relogio_retomado_em)
values (:P2, :S, 2, 'eeeeeeee-0000-0000-0000-00000000000b', 'eeeeeeee-0000-0000-0000-00000000000a',
  480, 'tempo', 'em_andamento', now(), now());
insert into public.partida_escalacoes (sessao_id, partida_id, participante_id, lado) values
  (:S, :P2, 'cccccccc-0000-0000-0000-000000000003', 'A'),
  (:S, :P2, 'cccccccc-0000-0000-0000-000000000004', 'A'),
  (:S, :P2, 'cccccccc-0000-0000-0000-000000000001', 'B'),
  (:S, :P2, 'cccccccc-0000-0000-0000-000000000002', 'B');
insert into public.gols (sessao_id, partida_id, equipe_id, participante_id, tempo_partida_segundos)
values (:S, :P2, 'eeeeeeee-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000004', 100),
       (:S, :P2, 'eeeeeeee-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000002', 200);
select teste.deve_falhar(
  $q$update public.partidas set penaltis_a = 4 where id = 'ffffffff-0000-0000-0000-000000000002'$q$,
  '23514', 'pênaltis exigem os dois lados');
update public.partidas
   set status = 'confirmada', relogio_retomado_em = null, ended_at = now(), confirmed_at = now(),
       penaltis_a = 4, penaltis_b = 3
 where id = :P2;

select teste.igual((select count(*) from public.v_artilharia where posicao = 1)::int, 3, 'três empatados em 1º');
select teste.igual((select sum(gols) from public.v_artilharia)::int, 3, 'pênaltis fora da artilharia');

-- Desconfirmar (reabrir) retira os gols do ranking oficial
update public.partidas set status = 'finalizada', confirmed_at = null where id = :P2;
select teste.igual((select sum(gols) from public.v_artilharia)::int, 1, 'partida reaberta sai do ranking');

-- Artilharia não mistura sessões: org2 não vê nada do org1
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select teste.igual((select count(*) from public.v_artilharia)::int, 0, 'org2 não vê artilharia do org1');
select teste.igual((select count(*) from public.gols)::int, 0, 'org2 não vê gols do org1');
reset role;

-- ====================================================================
-- 5. Exclusão da sessão remove tudo em cascata
-- ====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
delete from public.sessoes where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select teste.igual((select count(*) from public.gols)::int, 0, 'cascata: gols');
select teste.igual((select count(*) from public.partidas)::int, 0, 'cascata: partidas');
select teste.igual((select count(*) from public.participantes)::int, 1, 'cascata: só restam participantes da outra sessão');
reset role;

\echo '   todas as asserções passaram'
