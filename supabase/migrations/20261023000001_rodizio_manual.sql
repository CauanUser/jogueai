-- JogueAI — Rodízio manual e histórico de substituições.
-- O histórico é separado das escalações congeladas de partidas anteriores.
create table public.rodizio_eventos (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  sessao_id uuid not null,
  partida_id uuid not null,
  sorteio_id uuid not null,
  equipe_id uuid,
  participante_saiu_id uuid,
  participante_entrou_id uuid,
  tipo text not null check (tipo in ('substituicao', 'sem_substituicao', 'encerrado')),
  created_at timestamptz not null default now(),
  constraint rodizio_sessao_fk foreign key (sessao_id, owner_id)
    references public.sessoes (id, owner_id) on delete cascade,
  constraint rodizio_partida_fk foreign key (sessao_id, partida_id)
    references public.partidas (sessao_id, id) on delete cascade,
  constraint rodizio_sorteio_fk foreign key (sessao_id, sorteio_id)
    references public.sorteios (sessao_id, id) on delete cascade,
  constraint rodizio_equipe_fk foreign key (sessao_id, equipe_id)
    references public.equipes (sessao_id, id) on delete no action,
  constraint rodizio_saiu_fk foreign key (sessao_id, participante_saiu_id)
    references public.participantes (sessao_id, id) on delete no action,
  constraint rodizio_entrou_fk foreign key (sessao_id, participante_entrou_id)
    references public.participantes (sessao_id, id) on delete no action,
  constraint rodizio_tipo_dados check (
    (tipo = 'substituicao' and equipe_id is not null
      and participante_saiu_id is not null and participante_entrou_id is not null
      and participante_saiu_id <> participante_entrou_id)
    or
    (tipo in ('sem_substituicao', 'encerrado') and equipe_id is null
      and participante_saiu_id is null and participante_entrou_id is null)
  )
);
create index rodizio_eventos_sessao_idx on public.rodizio_eventos (sessao_id, created_at);
create index rodizio_eventos_partida_idx on public.rodizio_eventos (partida_id);
create unique index rodizio_sem_substituicao_unico
  on public.rodizio_eventos (partida_id) where tipo in ('sem_substituicao', 'encerrado');

alter table public.rodizio_eventos enable row level security;
revoke all on public.rodizio_eventos from anon, public;
grant select, insert, update, delete on public.rodizio_eventos to authenticated;
create policy rodizio_eventos_select_dono on public.rodizio_eventos
  for select to authenticated using (owner_id = (select auth.uid()));
create policy rodizio_eventos_insert_dono on public.rodizio_eventos
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy rodizio_eventos_update_dono on public.rodizio_eventos
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy rodizio_eventos_delete_dono on public.rodizio_eventos
  for delete to authenticated using (owner_id = (select auth.uid()));
revoke execute on function public.tg_proteger_vinculos() from anon, authenticated, public;
