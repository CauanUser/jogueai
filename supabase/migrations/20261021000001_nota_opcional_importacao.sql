-- =====================================================================
-- JogueAI — Migração 0002: participantes podem entrar sem nota
-- ---------------------------------------------------------------------
-- Com a importação da lista do WhatsApp, os jogadores são cadastrados
-- primeiro e recebem a nota depois. A nota passa a ser opcional no
-- cadastro, mas continua obrigatória (1 a 10) para entrar em um time.
-- =====================================================================

alter table public.participantes alter column nota drop not null;
-- A restrição participantes_nota_intervalo (nota between 1 and 10) continua
-- valendo: em SQL, um CHECK com valor nulo é aceito.

-- Ninguém entra em um time sem nota.
create or replace function public.tg_exigir_nota_na_equipe()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.participantes p
     where p.id = new.participante_id and p.nota is null
  ) then
    raise exception 'Todos os jogadores precisam ter nota antes do sorteio.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger equipe_part_exigir_nota before insert or update on public.equipe_participantes
  for each row execute function public.tg_exigir_nota_na_equipe();

revoke execute on function public.tg_exigir_nota_na_equipe() from anon, authenticated, public;

-- Observação: quem já está em um time continua com a nota travada pela
-- função tg_validar_participante (migração 0001), o que também impede
-- que a nota seja apagada depois do sorteio.
