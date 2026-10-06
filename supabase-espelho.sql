-- =====================================================================
-- ANALISTA LIVE — Espelho da Equipa (consulta 24/7 pela equipa técnica)
-- Executar no SQL Editor do Supabase, UMA vez, no MESMO projeto que já
-- serve a sincronização do jogo. Não mexe na tabela `sync_events`.
-- =====================================================================
--
-- O que é: uma cópia permanente do que está no iPad do analista (jogos,
-- registos, plantéis, scouting, campeonato, árbitros…). O iPad escreve; os
-- aparelhos da equipa técnica só leem.
--
-- PORQUE CABE NO PLANO GRATUITO (500 MB de base de dados):
--  - Uma linha por registo, SUBSTITUÍDA quando muda (não é um histórico que
--    cresce a cada golo, como a `sync_events`). O tamanho acompanha os dados
--    reais: uma época inteira anda pelos 10–30 MB.
--  - O jogo vai sem o `teamSnapshot` (as fotos dos dois plantéis repetidas em
--    cada jogo — foi o que encheu os 815 MB).
--  - Quem consulta só descarrega o que mudou desde a última vez.
--
-- QUEM VÊ: ninguém lê as tabelas diretamente (RLS ligado e SEM políticas). Tudo
-- passa por quatro funções que exigem a chave da equipa:
--  - a chave de ESCRITA fica só no iPad do analista;
--  - a chave de LEITURA vai no link que o analista partilha com a equipa
--    técnica. Abre-se uma vez e o aparelho fica a lembrar-se.
-- Sem a chave não se lista nem se lê nada. Não há contas nem palavras-passe.
-- Se alguém sair da equipa, o analista muda o link (Definições) e o antigo
-- deixa de funcionar.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.mirror_teams (
  id          uuid primary key default gen_random_uuid(),
  write_hash  text not null unique,
  read_hash   text not null unique,
  created_at  timestamptz not null default now()
);

create sequence if not exists public.mirror_rev_seq;

create table if not exists public.mirror_rows (
  team_id     uuid not null references public.mirror_teams(id) on delete cascade,
  store       text not null,               -- matches | occurrences | players | …
  id          text not null,               -- id do registo no iPad
  payload     jsonb,                       -- null = foi apagado no iPad
  rev         bigint not null,             -- ordem das alterações (quem lê pede "desde a rev X")
  updated_at  timestamptz not null default now(),
  primary key (team_id, store, id)
);

create index if not exists mirror_rows_rev_idx on public.mirror_rows (team_id, rev);

alter table public.mirror_teams enable row level security;
alter table public.mirror_rows  enable row level security;
-- Sem políticas: o cliente anónimo não lê nem escreve nestas tabelas.

-- ---------------------------------------------------------------------
-- Funções (correm com os direitos do dono, por isso passam o RLS — mas só
-- depois de confirmarem a chave).
-- ---------------------------------------------------------------------

create or replace function public._mirror_hash(p_key text)
returns text language sql immutable as $$
  select encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
$$;

-- Ativar a partilha (feito pelo iPad do analista, uma vez).
create or replace function public.mirror_register(p_write text, p_read text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_write, '')) < 24 or length(coalesce(p_read, '')) < 24 then
    raise exception 'chave demasiado curta';
  end if;
  insert into mirror_teams (write_hash, read_hash)
  values (_mirror_hash(p_write), _mirror_hash(p_read))
  on conflict (write_hash) do nothing;
end $$;

-- Mudar o link de leitura (quem tinha o antigo deixa de ver).
create or replace function public.mirror_rotate_read(p_write text, p_new_read text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_new_read, '')) < 24 then raise exception 'chave demasiado curta'; end if;
  update mirror_teams set read_hash = _mirror_hash(p_new_read) where write_hash = _mirror_hash(p_write);
  if not found then raise exception 'chave de escrita desconhecida'; end if;
end $$;

-- Enviar alterações. p_rows = [{ "s": store, "i": id, "p": payload | null }, …]
create or replace function public.mirror_push(p_write text, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  v_row  jsonb;
  v_n    integer := 0;
begin
  select id into v_team from mirror_teams where write_hash = _mirror_hash(p_write);
  if v_team is null then raise exception 'chave de escrita desconhecida'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'lote inválido';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if (v_row->>'s') not in ('matches','occurrences','players','library','plans','opponents',
                             'teams','formations','drawings','competitions','referees','meta') then
      raise exception 'store desconhecida: %', v_row->>'s';
    end if;
    -- Proteção do espaço: nenhum registo isolado passa de 2 MB.
    if pg_column_size(v_row->'p') > 2 * 1024 * 1024 then
      raise exception 'registo demasiado grande: % %', v_row->>'s', v_row->>'i';
    end if;
    insert into mirror_rows (team_id, store, id, payload, rev, updated_at)
    values (v_team, v_row->>'s', v_row->>'i',
            case when jsonb_typeof(v_row->'p') = 'null' then null else v_row->'p' end,
            nextval('mirror_rev_seq'), now())
    on conflict (team_id, store, id) do update
      set payload = excluded.payload, rev = excluded.rev, updated_at = excluded.updated_at;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Ler o que mudou desde a rev p_since.
create or replace function public.mirror_pull(p_read text, p_since bigint, p_limit integer default 400)
returns table (store text, id text, payload jsonb, rev bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  select t.id into v_team from mirror_teams t where t.read_hash = _mirror_hash(p_read);
  if v_team is null then raise exception 'link sem acesso'; end if;
  return query
    select r.store, r.id, r.payload, r.rev, r.updated_at
    from mirror_rows r
    where r.team_id = v_team and r.rev > coalesce(p_since, 0)
    order by r.rev
    limit least(greatest(coalesce(p_limit, 400), 1), 1000);
end $$;

-- Quanto ocupa (para o analista ver que cabe no plano). Aceita qualquer chave.
create or replace function public.mirror_status(p_key text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  v_out  json;
begin
  select id into v_team from mirror_teams
   where write_hash = _mirror_hash(p_key) or read_hash = _mirror_hash(p_key);
  if v_team is null then raise exception 'chave desconhecida'; end if;
  select json_build_object(
    'rows',       count(*) filter (where payload is not null),
    'bytes',      coalesce(sum(pg_column_size(payload)), 0),
    'lastChange', max(updated_at),
    'dbBytes',    pg_database_size(current_database())
  ) into v_out
  from mirror_rows where team_id = v_team;
  return v_out;
end $$;

revoke all on function public.mirror_register(text, text)          from public;
revoke all on function public.mirror_rotate_read(text, text)       from public;
revoke all on function public.mirror_push(text, jsonb)             from public;
revoke all on function public.mirror_pull(text, bigint, integer)   from public;
revoke all on function public.mirror_status(text)                  from public;
grant execute on function public.mirror_register(text, text)        to anon;
grant execute on function public.mirror_rotate_read(text, text)     to anon;
grant execute on function public.mirror_push(text, jsonb)           to anon;
grant execute on function public.mirror_pull(text, bigint, integer) to anon;
grant execute on function public.mirror_status(text)                to anon;

-- Confirmar:
--   select count(*) from public.mirror_rows;
--   select public.mirror_status('<chave>');
