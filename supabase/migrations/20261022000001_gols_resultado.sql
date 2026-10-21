-- =====================================================================
-- JogueAI — Migração 0003: gols, pênaltis e confirmação do resultado
-- ---------------------------------------------------------------------
--  * Disputa de pênaltis precisa ter vencedor.
--  * Confirmar o resultado exige pênaltis quando a partida termina
--    empatada com desempate por pênaltis, e proíbe pênaltis sem empate.
-- =====================================================================

alter table public.partidas
  add constraint partidas_penaltis_com_vencedor
  check (penaltis_a is null or penaltis_a <> penaltis_b);

-- Confirmação do resultado: confere pênaltis x placar calculado dos gols.
create or replace function public.tg_validar_confirmacao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_a int;
  v_b int;
begin
  if new.status <> 'confirmada' or old.status = 'confirmada' then
    return new;
  end if;
  select count(*) filter (where g.equipe_id = new.equipe_a_id),
         count(*) filter (where g.equipe_id = new.equipe_b_id)
    into v_a, v_b
    from public.gols g where g.partida_id = new.id;

  if v_a = v_b and new.desempate = 'penaltis' and new.penaltis_a is null then
    raise exception 'Empate: registre a disputa de pênaltis antes de confirmar.'
      using errcode = 'check_violation';
  end if;
  if new.penaltis_a is not null and (v_a <> v_b or new.desempate <> 'penaltis') then
    raise exception 'Pênaltis só valem para partida empatada com desempate por pênaltis.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger partidas_validar_confirmacao before update on public.partidas
  for each row execute function public.tg_validar_confirmacao();
