-- =====================================================================
-- ANALISTA LIVE — configuração do Supabase
-- Executar no SQL Editor do Supabase (uma única vez).
-- =====================================================================

-- Registo append-only de tudo o que acontece numa sessão de jogo.
-- Serve de canal de entrega (via Realtime) e de histórico, para que um
-- dispositivo que entre a meio consiga recuperar o jogo desde o início.
create table if not exists public.sync_events (
  id            bigint generated always as identity primary key,
  envelope_id   text not null unique,          -- id gerado no dispositivo: garante idempotência
  session_code  text not null,                 -- código curto da sessão (ex: K7P4Q2)
  device_id     text not null,                 -- quem enviou (evita aplicar o próprio eco)
  entity_type   text not null,                 -- snapshot | occurrence | match | message | moment
  entity_id     text,
  operation     text not null,                 -- upsert | delete | snapshot
  payload       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists sync_events_session_idx
  on public.sync_events (session_code, created_at);

-- Realtime: entrega imediata dos INSERT desta tabela.
alter publication supabase_realtime add table public.sync_events;

-- ---------------------------------------------------------------------
-- SEGURANÇA (RLS)
-- ---------------------------------------------------------------------
-- Modelo: quem conhece o código da sessão participa nela. Não há contas de
-- utilizador — é o mesmo princípio de um código de reunião.
--
-- IMPORTANTE, e sem rodeios: isto significa que quem descobrir o código
-- consegue LER o jogo. Para o contexto (um jogo, duas horas, um código
-- diferente por jogo) é um risco aceitável. Se um dia guardares aqui
-- informação sensível de scouting, passa a exigir autenticação.
alter table public.sync_events enable row level security;

-- Escrita: qualquer cliente anónimo pode inserir eventos.
-- Não pode apagar nem alterar — o registo é append-only, o que impede que
-- um dispositivo destrua o histórico de outro.
create policy "sync_events_insert_anon"
  on public.sync_events for insert
  to anon
  with check (true);

create policy "sync_events_select_anon"
  on public.sync_events for select
  to anon
  using (true);

-- Sem políticas de update/delete: ficam proibidos para o cliente anónimo.

-- ---------------------------------------------------------------------
-- LIMPEZA AUTOMÁTICA (NÃO é opcional — corre estas três linhas)
-- ---------------------------------------------------------------------
-- Os eventos só interessam durante e logo após o jogo; o arquivo verdadeiro
-- está no IndexedDB do analista e nos backups JSON. Apagar o que é antigo
-- mantém a base pequena e reduz a exposição dos dados.
--
-- PORQUE ESTÁ ISTO AQUI EM VEZ DE "opcional": esta tabela é append-only e sem
-- limpeza cresce para sempre. Num projeto real chegou a 815 MB (2306 linhas,
-- 96,95% de toda a base de dados, acima do limite de 500 MB do plano gratuito)
-- porque numa versão antiga o `publishMatchState()` enviava o objeto `match`
-- inteiro, com o `teamSnapshot` lá dentro: logótipos e a foto de cada jogador
-- dos dois planteis em base64, a cada golo, cartão e substituição. Eram ~1,3 MB
-- por linha. Hoje o `SyncCore.lightMatch()` retira o `teamSnapshot` e cada
-- linha pesa ~1,9 KB (≈1 MB por dia de jogo) — mas o que já lá está nunca sai
-- sozinho.
create or replace function public.purge_old_sync_events()
returns void
language sql
as $$
  -- 2 dias chega: os eventos só servem durante o jogo e no imediato a seguir.
  delete from public.sync_events where created_at < now() - interval '2 days';
$$;

-- Automatização (a extensão pg_cron vem disponível no Supabase):
create extension if not exists pg_cron;
select cron.schedule('purge-sync-events', '0 4 * * *', 'select public.purge_old_sync_events()');

-- Confirmar que ficou agendado:
--   select jobname, active, schedule from cron.job;
--
-- Se a tabela já estiver enorme, apagar linhas NÃO devolve o espaço (o
-- Postgres não encolhe o ficheiro). Fora de um jogo:
--   truncate table public.sync_events;        -- instantâneo, liberta tudo
-- ou, para guardar os últimos dias:
--   delete from public.sync_events where created_at < now() - interval '2 days';
--   vacuum full public.sync_events;           -- tranca a tabela uns segundos
--
-- Nada disto perde dados da Analista Live: esta tabela é só o canal de entrega
-- entre o iPad do analista e o do banco. O único efeito é que um dispositivo
-- que entre a meio de um jogo deixa de recuperar o histórico anterior — e o
-- analista resolve isso reenviando o estado.
