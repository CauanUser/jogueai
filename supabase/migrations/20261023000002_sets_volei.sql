-- Identifica a que set pertence cada ponto de vôlei.
alter table public.gols add column if not exists set_numero smallint not null default 1
  check (set_numero between 1 and 5);
