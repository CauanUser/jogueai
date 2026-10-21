-- Ciclo de vida de uma partida exatamente como o app grava (Fase 3).
\set QUIET on
\o /dev/null
reset role;
insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'org4@teste');
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);

insert into public.sessoes (id, data_referencia) values ('a0000000-0000-0000-0000-000000000004', '2026-10-25');
\set S '''a0000000-0000-0000-0000-000000000004'''
insert into public.participantes (id, sessao_id, nome, nota) values
  ('c4000000-0000-0000-0000-000000000001', :S, 'Ana', 7), ('c4000000-0000-0000-0000-000000000002', :S, 'Bia', 7);
insert into public.sorteios (id, sessao_id, numero, jogadores_por_equipe, qtd_equipes) values ('d4000000-0000-0000-0000-000000000001', :S, 1, 1, 2);
insert into public.equipes (id, sessao_id, sorteio_id, nome, ordem) values
  ('e4000000-0000-0000-0000-00000000000a', :S, 'd4000000-0000-0000-0000-000000000001', 'Time A', 1),
  ('e4000000-0000-0000-0000-00000000000b', :S, 'd4000000-0000-0000-0000-000000000001', 'Time B', 2);

\set P '''f4000000-0000-0000-0000-000000000001'''
-- criar (configurada)
insert into public.partidas (id, sessao_id, numero, equipe_a_id, equipe_b_id, status, duracao_segundos,
  condicao_encerramento, limite_gols, acrescimos_segundos, intervalo_segundos, desempate, configuracao_extra,
  relogio_acumulado_ms, relogio_retomado_em, started_at, ended_at, confirmed_at)
values (:P, :S, 1, 'e4000000-0000-0000-0000-00000000000a', 'e4000000-0000-0000-0000-00000000000b', 'configurada', 480,
  'o_que_vier_primeiro', 2, 0, 0, 'penaltis', '{}', 0, null, null, null, null);
insert into public.partida_escalacoes (sessao_id, partida_id, participante_id, lado) values
  (:S, :P, 'c4000000-0000-0000-0000-000000000001', 'A'), (:S, :P, 'c4000000-0000-0000-0000-000000000002', 'B');
-- iniciar
update public.partidas set status = 'em_andamento', started_at = now(), relogio_retomado_em = now() where id = :P;
-- pausar
update public.partidas set status = 'pausada', relogio_retomado_em = null, relogio_acumulado_ms = 60000 where id = :P;
select teste.deve_falhar(
  $q$update public.partidas set status = 'em_andamento' where id = 'f4000000-0000-0000-0000-000000000001'$q$,
  '23514', 'em andamento exige relógio rodando');
-- acréscimo e retomar
update public.partidas set acrescimos_segundos = 60, status = 'em_andamento', relogio_retomado_em = now() where id = :P;
-- fim automático por tempo
update public.partidas set status = 'finalizada', relogio_retomado_em = null, relogio_acumulado_ms = 540000,
  ended_at = now(), configuracao_extra = '{"motivo_fim":"tempo"}' where id = :P;
select teste.igual((select configuracao_extra->>'motivo_fim' from public.partidas where id = :P), 'tempo', 'motivo do fim gravado');
select teste.deve_falhar(
  $q$update public.partidas set ended_at = null where id = 'f4000000-0000-0000-0000-000000000001'$q$,
  '23514', 'finalizada exige ended_at');

-- partida iniciada e cancelada
insert into public.partidas (id, sessao_id, numero, equipe_a_id, equipe_b_id, status, duracao_segundos,
  condicao_encerramento, limite_gols, relogio_acumulado_ms, started_at)
values ('f4000000-0000-0000-0000-000000000002', :S, 2, 'e4000000-0000-0000-0000-00000000000b', 'e4000000-0000-0000-0000-00000000000a',
  'cancelada', 480, 'tempo', null, 1000, now());
-- partida nunca iniciada é excluída (escalações vão junto)
insert into public.partidas (id, sessao_id, numero, equipe_a_id, equipe_b_id, duracao_segundos, condicao_encerramento, limite_gols)
values ('f4000000-0000-0000-0000-000000000003', :S, 3, 'e4000000-0000-0000-0000-00000000000a', 'e4000000-0000-0000-0000-00000000000b', 480, 'gols', 3);
insert into public.partida_escalacoes (sessao_id, partida_id, participante_id, lado) values
  (:S, 'f4000000-0000-0000-0000-000000000003', 'c4000000-0000-0000-0000-000000000001', 'A');
delete from public.partidas where id = 'f4000000-0000-0000-0000-000000000003';
select teste.igual((select count(*) from public.partida_escalacoes where partida_id = 'f4000000-0000-0000-0000-000000000003')::int, 0, 'escalações excluídas junto');
reset role;
\echo '   todas as asserções passaram'
