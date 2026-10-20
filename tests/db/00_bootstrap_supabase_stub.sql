-- Simulação mínima do ambiente Supabase para testes locais.
-- NÃO aplicar no Supabase real (lá isso já existe).
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase concede privilégios padrão a anon/authenticated em public;
-- reproduzimos isso para provar que a migração os revoga.
alter default privileges in schema public grant all on tables to anon, authenticated;
