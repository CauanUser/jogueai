-- JogueAI: identifica participantes cadastrados como goleiro.
alter table public.participantes
  add column if not exists goleiro boolean not null default false;

comment on column public.participantes.goleiro is
  'Indica se o participante joga como goleiro no futebol.';
