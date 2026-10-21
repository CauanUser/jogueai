-- Testes da migração 0002 (participante sem nota).
\set QUIET on
\o /dev/null
reset role;
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'org3@teste');

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);

insert into public.sessoes (id, data_referencia) values ('a0000000-0000-0000-0000-000000000003', '2026-10-25');
\set S '''a0000000-0000-0000-0000-000000000003'''

-- Importado sem nota: aceito
insert into public.participantes (id, sessao_id, nome) values
  ('c0000000-0000-0000-0000-000000000001', :S, 'Alisson'),
  ('c0000000-0000-0000-0000-000000000002', :S, 'Michel');
select teste.igual((select count(*) from public.participantes where nota is null)::int, 2, 'participante sem nota aceito');

-- Nota fora do intervalo continua proibida
select teste.deve_falhar(
  $q$update public.participantes set nota = 11 where nome = 'Alisson'$q$,
  '23514', 'nota 11 continua proibida');

insert into public.sorteios (id, sessao_id, numero, jogadores_por_equipe, qtd_equipes)
values ('d0000000-0000-0000-0000-000000000003', :S, 1, 1, 2);
insert into public.equipes (id, sessao_id, sorteio_id, nome, ordem) values
  ('e0000000-0000-0000-0000-00000000000a', :S, 'd0000000-0000-0000-0000-000000000003', 'Time A', 1),
  ('e0000000-0000-0000-0000-00000000000b', :S, 'd0000000-0000-0000-0000-000000000003', 'Time B', 2);

-- Sem nota não entra em time
select teste.deve_falhar(
  $q$insert into public.equipe_participantes (sessao_id, sorteio_id, equipe_id, participante_id) values ('a0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001')$q$,
  '23514', 'jogador sem nota não entra em time');

-- Com nota, entra; depois a nota não pode ser apagada
update public.participantes set nota = 7 where sessao_id = :S;
insert into public.equipe_participantes (sessao_id, sorteio_id, equipe_id, participante_id) values
  (:S, 'd0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
select teste.deve_falhar(
  $q$update public.participantes set nota = null where id = 'c0000000-0000-0000-0000-000000000001'$q$,
  '23514', 'nota de quem está em time não pode ser apagada');
reset role;
\echo '   todas as asserções passaram'
