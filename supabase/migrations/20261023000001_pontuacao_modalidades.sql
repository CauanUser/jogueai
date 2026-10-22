-- Pontuação por evento para modalidades além do futebol.
-- Eventos existentes continuam valendo 1 gol.
alter table public.gols add column if not exists valor smallint not null default 1
  check (valor between 1 and 3);
