-- Gols, gol contra, pênaltis e confirmação do resultado (Fase 4),
-- exatamente como o app grava.
\set QUIET on
\o /dev/null
reset role;
insert into auth.users (id, email) values ('55555555-5555-5555-5555-555555555555', 'org5@teste');
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);

insert into public.sessoes (id, data_referencia) values ('a0000000-0000-0000-0000-000000000005', '2026-10-25');
\set S '''a0000000-0000-0000-0000-000000000005'''
insert into public.participantes (id, sessao_id, nome, nota) values
  ('c5000000-0000-0000-0000-000000000001', :S, 'Ana', 7), ('c5000000-0000-0000-0000-000000000002', :S, 'Bia', 7),
  ('c5000000-0000-0000-0000-000000000003', :S, 'Caio', 6), ('c5000000-0000-0000-0000-000000000004', :S, 'Duda', 6);
insert into public.sorteios (id, sessao_id, numero, jogadores_por_equipe, qtd_equipes) values ('d5000000-0000-0000-0000-000000000001', :S, 1, 2, 2);
insert into public.equipes (id, sessao_id, sorteio_id, nome, ordem) values
  ('e5000000-0000-0000-0000-00000000000a', :S, 'd5000000-0000-0000-0000-000000000001', 'Time A', 1),
  ('e5000000-0000-0000-0000-00000000000b', :S, 'd5000000-0000-0000-0000-000000000001', 'Time B', 2);
\set A '''e5000000-0000-0000-0000-00000000000a'''
\set B '''e5000000-0000-0000-0000-00000000000b'''
\set P '''f5000000-0000-0000-0000-000000000001'''
insert into public.partidas (id, sessao_id, numero, equipe_a_id, equipe_b_id, status, duracao_segundos,
  condicao_encerramento, limite_gols, desempate, relogio_acumulado_ms, relogio_retomado_em, started_at)
values (:P, :S, 1, :A, :B, 'em_andamento', 480, 'o_que_vier_primeiro', 2, 'penaltis', 0, now(), now());
insert into public.partida_escalacoes (sessao_id, partida_id, participante_id, lado) values
  (:S, :P, 'c5000000-0000-0000-0000-000000000001', 'A'), (:S, :P, 'c5000000-0000-0000-0000-000000000002', 'A'),
  (:S, :P, 'c5000000-0000-0000-0000-000000000003', 'B'), (:S, :P, 'c5000000-0000-0000-0000-000000000004', 'B');

-- gol normal de Ana para A; gol contra de Ana (time A) a favor de B; gol sem autor para B
insert into public.gols (id, sessao_id, partida_id, equipe_id, participante_id, tipo, tempo_partida_segundos) values
  ('a5000000-0000-0000-0000-0000000000a1', :S, :P, :A, 'c5000000-0000-0000-0000-000000000001', 'normal', 30),
  ('a5000000-0000-0000-0000-0000000000a2', :S, :P, :B, 'c5000000-0000-0000-0000-000000000001', 'contra', 90),
  ('a5000000-0000-0000-0000-0000000000a3', :S, :P, :B, null, 'normal', 120);
select teste.igual((select placar_a from public.v_placar_partidas where partida_id = :P), 1, 'placar A');
select teste.igual((select placar_b from public.v_placar_partidas where partida_id = :P), 2, 'placar B (gol contra conta para B)');
select teste.deve_falhar(
  $q$insert into public.gols (sessao_id, partida_id, equipe_id, participante_id, tipo, tempo_partida_segundos)
     values ('a0000000-0000-0000-0000-000000000005', 'f5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-000000000003', 'contra', 10)$q$,
  '23514', 'gol contra com autor do próprio time beneficiado');
-- correção: o gol sem autor passa a ser de Caio; remoção do gol contra
update public.gols set participante_id = 'c5000000-0000-0000-0000-000000000003' where id = 'a5000000-0000-0000-0000-0000000000a3';
delete from public.gols where id = 'a5000000-0000-0000-0000-0000000000a2';

-- 1 x 1: encerra; confirmar sem pênaltis é recusado
update public.partidas set status = 'finalizada', relogio_retomado_em = null, relogio_acumulado_ms = 480000,
  ended_at = now(), configuracao_extra = '{"motivo_fim":"tempo"}' where id = :P;
select teste.deve_falhar(
  $q$update public.partidas set status = 'confirmada', confirmed_at = now() where id = 'f5000000-0000-0000-0000-000000000001'$q$,
  '23514', 'empate exige pênaltis');
select teste.deve_falhar(
  $q$update public.partidas set penaltis_a = 3, penaltis_b = 3 where id = 'f5000000-0000-0000-0000-000000000001'$q$,
  '23514', 'pênaltis precisam de vencedor');
update public.partidas set penaltis_a = 4, penaltis_b = 3 where id = :P;
update public.partidas set status = 'confirmada', confirmed_at = now() where id = :P;
select teste.deve_falhar(
  $q$delete from public.gols where id = 'a5000000-0000-0000-0000-0000000000a1'$q$,
  '23514', 'gols de partida confirmada não mudam');

-- artilharia oficial: só gols normais de partida confirmada
select teste.igual((select count(*) from public.v_artilharia where sessao_id = :S)::int, 2, 'dois artilheiros');

-- reabrir para corrigir: volta a finalizada
update public.partidas set status = 'finalizada', confirmed_at = null where id = :P;
delete from public.gols where id = 'a5000000-0000-0000-0000-0000000000a1';
select teste.deve_falhar(
  $q$update public.partidas set status = 'confirmada', confirmed_at = now() where id = 'f5000000-0000-0000-0000-000000000001'$q$,
  '23514', 'pênaltis sem empate são recusados');
update public.partidas set penaltis_a = null, penaltis_b = null where id = :P;
update public.partidas set status = 'confirmada', confirmed_at = now() where id = :P;

-- excluir a sessão remove tudo, inclusive gols de partida confirmada
delete from public.sessoes where id = :S;
select teste.igual((select count(*) from public.gols where sessao_id = :S)::int, 0, 'gols excluídos com a sessão');
reset role;
\echo '   todas as asserções passaram'
