-- =====================================================================
-- JogueAI — Migração 0001: esquema inicial
-- ---------------------------------------------------------------------
-- Princípios:
--   * Todo registro pertence a um organizador (owner_id = auth.uid()).
--   * RLS habilitado em todas as tabelas; o papel "anon" não tem acesso.
--   * IDs (UUID) podem ser gerados no aparelho: servem como chave de
--     idempotência na sincronização (reenviar não duplica).
--   * Chaves estrangeiras compostas (sessao_id, ...) garantem que tudo o
--     que é ligado entre si pertence à MESMA sessão.
--   * Placar e artilharia NÃO são armazenados: são calculados a partir
--     dos eventos de gol (views), evitando contagens inconsistentes.
--   * Pênaltis de desempate ficam na partida, fora da tabela de gols,
--     e portanto nunca entram na artilharia.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funções utilitárias de trigger
-- ---------------------------------------------------------------------
create or replace function public.tg_definir_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Impede mudar o dono ou a sessão de um registro já existente.
create or replace function public.tg_proteger_vinculos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Não é permitido alterar o dono do registro.'
      using errcode = 'check_violation';
  end if;
  -- (if aninhado: plpgsql não garante curto-circuito e "sessoes" não tem sessao_id)
  if tg_table_name <> 'sessoes' then
    if to_jsonb(new) -> 'sessao_id' is distinct from to_jsonb(old) -> 'sessao_id' then
      raise exception 'Não é permitido mover o registro para outra sessão.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- sessoes
-- ---------------------------------------------------------------------
create table public.sessoes (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid()
                   references auth.users (id) on delete cascade,
  data_referencia  date not null,
  status           text not null default 'em_andamento'
                   check (status in ('em_andamento', 'encerrada')),
  encerrada_em     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sessoes_encerramento_coerente
    check ((status = 'encerrada') = (encerrada_em is not null)),
  constraint sessoes_id_owner_uk unique (id, owner_id)
);

comment on table public.sessoes is
  'Um encontro (racha). Partidas e gols ficam ligados à sessão, não à data do evento, para que jogos após a meia-noite continuem na sessão original.';

-- No máximo uma sessão em andamento por organizador: evita sessões duplicadas.
create unique index sessoes_uma_em_andamento_uk
  on public.sessoes (owner_id) where status = 'em_andamento';
create index sessoes_owner_data_idx
  on public.sessoes (owner_id, data_referencia desc, created_at desc);

-- ---------------------------------------------------------------------
-- participantes (cadastro por sessão)
-- ---------------------------------------------------------------------
create table public.participantes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  sessao_id   uuid not null,
  nome        text not null,
  nota        smallint not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint participantes_nome_formato check (
    nome = btrim(nome)
    and char_length(nome) between 1 and 40
    and nome !~ '\s{2,}'
  ),
  constraint participantes_nota_intervalo check (nota between 1 and 10),
  constraint participantes_sessao_fk foreign key (sessao_id, owner_id)
    references public.sessoes (id, owner_id) on delete cascade,
  constraint participantes_sessao_id_uk unique (sessao_id, id)
);

-- Nome único por sessão (sem diferenciar maiúsculas/minúsculas):
-- evita confusão ao escolher o autor de um gol.
create unique index participantes_nome_por_sessao_uk
  on public.participantes (sessao_id, lower(nome));
create index participantes_owner_idx on public.participantes (owner_id);

-- ---------------------------------------------------------------------
-- sorteios (cada confirmação de times gera um sorteio)
-- ---------------------------------------------------------------------
create table public.sorteios (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid(),
  sessao_id             uuid not null,
  numero                integer not null check (numero >= 1),
  jogadores_por_equipe  smallint not null check (jogadores_por_equipe between 1 and 50),
  qtd_equipes           smallint not null check (qtd_equipes between 2 and 20),
  confirmado_em         timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint sorteios_sessao_fk foreign key (sessao_id, owner_id)
    references public.sessoes (id, owner_id) on delete cascade,
  constraint sorteios_numero_uk unique (sessao_id, numero),
  constraint sorteios_sessao_id_uk unique (sessao_id, id)
);
create index sorteios_owner_idx on public.sorteios (owner_id);

-- ---------------------------------------------------------------------
-- equipes
-- ---------------------------------------------------------------------
create table public.equipes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  sessao_id   uuid not null,
  sorteio_id  uuid not null,
  nome        text not null check (nome = btrim(nome) and char_length(nome) between 1 and 30),
  cor         text not null default '#1E88E5' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ordem       smallint not null check (ordem >= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint equipes_sessao_fk foreign key (sessao_id, owner_id)
    references public.sessoes (id, owner_id) on delete cascade,
  constraint equipes_sorteio_fk foreign key (sessao_id, sorteio_id)
    references public.sorteios (sessao_id, id) on delete cascade,
  constraint equipes_ordem_uk unique (sorteio_id, ordem),
  constraint equipes_sessao_id_uk unique (sessao_id, id),
  constraint equipes_sorteio_id_uk unique (sorteio_id, id)
);
create unique index equipes_nome_por_sorteio_uk on public.equipes (sorteio_id, lower(nome));
create index equipes_owner_idx on public.equipes (owner_id);

-- ---------------------------------------------------------------------
-- equipe_participantes (composição das equipes sorteadas)
-- Jogadores do sorteio sem equipe = fila de espera (derivado).
-- ---------------------------------------------------------------------
create table public.equipe_participantes (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid(),
  sessao_id        uuid not null,
  sorteio_id       uuid not null,
  equipe_id        uuid not null,
  participante_id  uuid not null,
  created_at       timestamptz not null default now(),
  constraint equipe_part_sessao_fk foreign key (sessao_id, owner_id)
    references public.sessoes (id, owner_id) on delete cascade,
  constraint equipe_part_sorteio_fk foreign key (sessao_id, sorteio_id)
    references public.sorteios (sessao_id, id) on delete cascade,
  constraint equipe_part_equipe_fk foreign key (sorteio_id, equipe_id)
    references public.equipes (sorteio_id, id) on delete cascade,
  -- NO ACTION (e não RESTRICT): permite a exclusão em cascata da sessão,
  -- mas impede remover isoladamente um participante que está em uma equipe.
  constraint equipe_part_participante_fk foreign key (sessao_id, participante_id)
    references public.participantes (sessao_id, id) on delete no action,
  -- Um participante não pode estar em duas equipes do mesmo sorteio.
  constraint equipe_part_unico_por_sorteio_uk unique (sorteio_id, participante_id)
);
create index equipe_part_equipe_idx on public.equipe_participantes (equipe_id);
create index equipe_part_participante_idx on public.equipe_participantes (participante_id);
create index equipe_part_owner_idx on public.equipe_participantes (owner_id);

-- ---------------------------------------------------------------------
-- partidas (configuração congelada por partida)
-- ---------------------------------------------------------------------
create table public.partidas (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null default auth.uid(),
  sessao_id              uuid not null,
  numero                 integer not null check (numero >= 1),
  equipe_a_id            uuid not null,
  equipe_b_id            uuid not null,
  status                 text not null default 'configurada'
                         check (status in ('configurada', 'em_andamento', 'pausada',
                                           'finalizada', 'confirmada', 'cancelada')),
  -- Configuração da partida (cópia, não referência ao padrão global)
  duracao_segundos       integer not null check (duracao_segundos between 30 and 7200),
  condicao_encerramento  text not null
                         check (condicao_encerramento in ('tempo', 'gols', 'o_que_vier_primeiro')),
  limite_gols            smallint check (limite_gols between 1 and 99),
  acrescimos_segundos    integer not null default 0 check (acrescimos_segundos between 0 and 1800),
  intervalo_segundos     integer not null default 0 check (intervalo_segundos between 0 and 3600),
  desempate              text not null default 'penaltis' check (desempate in ('nenhum', 'penaltis')),
  configuracao_extra     jsonb not null default '{}'::jsonb
                         check (jsonb_typeof(configuracao_extra) = 'object'),
  -- Cronômetro baseado em timestamps:
  -- decorrido = relogio_acumulado_ms + (agora - relogio_retomado_em), se rodando.
  relogio_acumulado_ms   bigint not null default 0 check (relogio_acumulado_ms >= 0),
  relogio_retomado_em    timestamptz,
  -- Disputa de pênaltis (registro manual; não entra na artilharia)
  penaltis_a             smallint check (penaltis_a >= 0),
  penaltis_b             smallint check (penaltis_b >= 0),
  started_at             timestamptz,
  ended_at               timestamptz,
  confirmed_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint partidas_equipes_distintas check (equipe_a_id <> equipe_b_id),
  constraint partidas_limite_coerente
    check (condicao_encerramento = 'tempo' or limite_gols is not null),
  constraint partidas_penaltis_coerentes
    check ((penaltis_a is null) = (penaltis_b is null)),
  constraint partidas_relogio_coerente
    check ((status = 'em_andamento') = (relogio_retomado_em is not null)),
  constraint partidas_inicio_coerente
    check ((status = 'configurada') = (started_at is null)),
  constraint partidas_fim_coerente
    check ((status in ('finalizada', 'confirmada')) <= (ended_at is not null)),
  constraint partidas_confirmacao_coerente
    check ((status = 'confirmada') = (confirmed_at is not null)),
  constraint partidas_sessao_fk foreign key (sessao_id, owner_id)
    references public.sessoes (id, owner_id) on delete cascade,
  constraint partidas_equipe_a_fk foreign key (sessao_id, equipe_a_id)
    references public.equipes (sessao_id, id) on delete no action,
  constraint partidas_equipe_b_fk foreign key (sessao_id, equipe_b_id)
    references public.equipes (sessao_id, id) on delete no action,
  constraint partidas_numero_uk unique (sessao_id, numero),
  constraint partidas_sessao_id_uk unique (sessao_id, id)
);
create index partidas_sessao_status_idx on public.partidas (sessao_id, status);
create index partidas_equipe_a_idx on public.partidas (equipe_a_id);
create index partidas_equipe_b_idx on public.partidas (equipe_b_id);
create index partidas_owner_idx on public.partidas (owner_id);

-- ---------------------------------------------------------------------
-- partida_escalacoes (quem jogou por cada lado, congelado por partida)
-- ---------------------------------------------------------------------
create table public.partida_escalacoes (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid(),
  sessao_id        uuid not null,
  partida_id       uuid not null,
  participante_id  uuid not null,
  lado             char(1) not null check (lado in ('A', 'B')),
  created_at       timestamptz not null default now(),
  constraint escalacoes_sessao_fk foreign key (sessao_id, owner_id)
    references public.sessoes (id, owner_id) on delete cascade,
  constraint escalacoes_partida_fk foreign key (sessao_id, partida_id)
    references public.partidas (sessao_id, id) on delete cascade,
  constraint escalacoes_participante_fk foreign key (sessao_id, participante_id)
    references public.participantes (sessao_id, id) on delete no action,
  constraint escalacoes_jogador_unico_uk unique (partida_id, participante_id)
);
create index escalacoes_participante_idx on public.partida_escalacoes (participante_id);
create index escalacoes_owner_idx on public.partida_escalacoes (owner_id);

-- ---------------------------------------------------------------------
-- gols (eventos)
-- ---------------------------------------------------------------------
create table public.gols (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null default auth.uid(),
  sessao_id               uuid not null,
  partida_id              uuid not null,
  equipe_id               uuid not null,      -- equipe beneficiada no placar
  participante_id         uuid,               -- autor (nulo = sem autor identificado)
  tipo                    text not null default 'normal' check (tipo in ('normal', 'contra')),
  tempo_partida_segundos  integer not null check (tempo_partida_segundos between 0 and 86400),
  ocorrido_em             timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint gols_sessao_fk foreign key (sessao_id, owner_id)
    references public.sessoes (id, owner_id) on delete cascade,
  constraint gols_partida_fk foreign key (sessao_id, partida_id)
    references public.partidas (sessao_id, id) on delete cascade,
  constraint gols_equipe_fk foreign key (sessao_id, equipe_id)
    references public.equipes (sessao_id, id) on delete no action,
  -- O autor precisa estar escalado naquela partida.
  constraint gols_autor_escalado_fk foreign key (partida_id, participante_id)
    references public.partida_escalacoes (partida_id, participante_id) on delete no action
);
create index gols_partida_idx on public.gols (partida_id);
create index gols_sessao_participante_idx on public.gols (sessao_id, participante_id);
create index gols_equipe_idx on public.gols (equipe_id);
create index gols_owner_idx on public.gols (owner_id);

-- ---------------------------------------------------------------------
-- preferencias (modelo padrão de partida para as PRÓXIMAS partidas)
-- ---------------------------------------------------------------------
create table public.preferencias (
  owner_id        uuid primary key default auth.uid()
                  references auth.users (id) on delete cascade,
  partida_padrao  jsonb not null default jsonb_build_object(
                    'duracao_segundos', 480,
                    'condicao_encerramento', 'o_que_vier_primeiro',
                    'limite_gols', 2,
                    'acrescimos_segundos', 0,
                    'intervalo_segundos', 0,
                    'desempate', 'penaltis'
                  ) check (jsonb_typeof(partida_padrao) = 'object'),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Regras de negócio no banco
-- ---------------------------------------------------------------------

-- Participantes: só podem ser alterados em sessão em andamento;
-- a nota fica travada depois que o participante entra em uma equipe.
create or replace function public.tg_validar_participante()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_sessao uuid := coalesce(new.sessao_id, old.sessao_id);
begin
  select s.status into v_status from public.sessoes s where s.id = v_sessao;

  -- v_status nulo: a sessão está sendo excluída (cascata) — permitido.
  if v_status = 'encerrada' then
    raise exception 'A sessão está encerrada; participantes não podem ser alterados.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and new.nota is distinct from old.nota and exists (
    select 1 from public.equipe_participantes ep where ep.participante_id = old.id
  ) then
    raise exception 'A nota não pode ser alterada depois que os times foram confirmados.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Gols: validam partida, equipe beneficiada e lado do autor.
create or replace function public.tg_validar_gol()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_partida public.partidas%rowtype;
  v_lado_benef char(1);
  v_lado_autor char(1);
  v_partida_id uuid := coalesce(new.partida_id, old.partida_id);
begin
  select * into v_partida from public.partidas p where p.id = v_partida_id;

  if not found then
    -- Partida sendo excluída (cascata).
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'Partida inexistente.' using errcode = 'foreign_key_violation';
  end if;

  if v_partida.status in ('confirmada', 'cancelada') then
    raise exception 'A partida está %; reabra-a para corrigir os gols.', v_partida.status
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if v_partida.status = 'configurada' then
    raise exception 'A partida ainda não foi iniciada.' using errcode = 'check_violation';
  end if;

  if new.equipe_id = v_partida.equipe_a_id then
    v_lado_benef := 'A';
  elsif new.equipe_id = v_partida.equipe_b_id then
    v_lado_benef := 'B';
  else
    raise exception 'A equipe beneficiada não participa desta partida.'
      using errcode = 'check_violation';
  end if;

  if new.participante_id is not null then
    select e.lado into v_lado_autor
      from public.partida_escalacoes e
     where e.partida_id = new.partida_id and e.participante_id = new.participante_id;

    if v_lado_autor is null then
      raise exception 'O autor do gol não está escalado nesta partida.'
        using errcode = 'check_violation';
    end if;
    if new.tipo = 'normal' and v_lado_autor <> v_lado_benef then
      raise exception 'Gol normal: o autor deve jogar pela equipe beneficiada.'
        using errcode = 'check_violation';
    end if;
    if new.tipo = 'contra' and v_lado_autor = v_lado_benef then
      raise exception 'Gol contra: o autor deve jogar pela equipe adversária.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Triggers --------------------------------------------------------------
create trigger sessoes_updated_at before update on public.sessoes
  for each row execute function public.tg_definir_updated_at();
create trigger sessoes_vinculos before update on public.sessoes
  for each row execute function public.tg_proteger_vinculos();

create trigger participantes_updated_at before update on public.participantes
  for each row execute function public.tg_definir_updated_at();
create trigger participantes_vinculos before update on public.participantes
  for each row execute function public.tg_proteger_vinculos();
create trigger participantes_validar before insert or update or delete on public.participantes
  for each row execute function public.tg_validar_participante();

create trigger sorteios_vinculos before update on public.sorteios
  for each row execute function public.tg_proteger_vinculos();

create trigger equipes_updated_at before update on public.equipes
  for each row execute function public.tg_definir_updated_at();
create trigger equipes_vinculos before update on public.equipes
  for each row execute function public.tg_proteger_vinculos();

create trigger equipe_part_vinculos before update on public.equipe_participantes
  for each row execute function public.tg_proteger_vinculos();

create trigger partidas_updated_at before update on public.partidas
  for each row execute function public.tg_definir_updated_at();
create trigger partidas_vinculos before update on public.partidas
  for each row execute function public.tg_proteger_vinculos();

create trigger escalacoes_vinculos before update on public.partida_escalacoes
  for each row execute function public.tg_proteger_vinculos();

create trigger gols_updated_at before update on public.gols
  for each row execute function public.tg_definir_updated_at();
create trigger gols_vinculos before update on public.gols
  for each row execute function public.tg_proteger_vinculos();
create trigger gols_validar before insert or update or delete on public.gols
  for each row execute function public.tg_validar_gol();

create trigger preferencias_updated_at before update on public.preferencias
  for each row execute function public.tg_definir_updated_at();

-- ---------------------------------------------------------------------
-- Views (security_invoker: respeitam o RLS de quem consulta)
-- ---------------------------------------------------------------------
create view public.v_placar_partidas
with (security_invoker = true) as
select
  p.id         as partida_id,
  p.sessao_id,
  p.numero,
  p.status,
  count(g.id) filter (where g.equipe_id = p.equipe_a_id)::int as placar_a,
  count(g.id) filter (where g.equipe_id = p.equipe_b_id)::int as placar_b,
  p.penaltis_a,
  p.penaltis_b
from public.partidas p
left join public.gols g on g.partida_id = p.id
group by p.id;

-- Artilharia oficial: apenas gols "normal" de partidas confirmadas.
-- rank() produz a classificação padrão de competição: 1º, 2º, 2º, 4º.
create view public.v_artilharia
with (security_invoker = true) as
select
  g.sessao_id,
  g.participante_id,
  pa.nome,
  count(*)::int as gols,
  rank() over (partition by g.sessao_id order by count(*) desc)::int as posicao
from public.gols g
join public.partidas p on p.id = g.partida_id and p.status = 'confirmada'
join public.participantes pa on pa.id = g.participante_id
where g.tipo = 'normal'
group by g.sessao_id, g.participante_id, pa.nome;

-- ---------------------------------------------------------------------
-- Segurança: RLS + privilégios
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'sessoes', 'participantes', 'sorteios', 'equipes', 'equipe_participantes',
    'partidas', 'partida_escalacoes', 'gols', 'preferencias'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('revoke all on table public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))',
      t || '_select_dono', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))',
      t || '_insert_dono', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      t || '_update_dono', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))',
      t || '_delete_dono', t);
  end loop;
end;
$$;

revoke all on public.v_placar_partidas, public.v_artilharia from anon, public;
grant select on public.v_placar_partidas, public.v_artilharia to authenticated;

revoke execute on function
  public.tg_definir_updated_at(),
  public.tg_proteger_vinculos(),
  public.tg_validar_participante(),
  public.tg_validar_gol()
from anon, authenticated, public;
