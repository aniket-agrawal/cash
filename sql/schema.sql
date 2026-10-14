create table if not exists pipelines (
  id text primary key,
  name text not null,
  spec text not null,
  every_minutes int not null default 5,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists runs (
  id bigserial primary key,
  pipeline_id text references pipelines(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  trigger text not null default 'cron',
  steps jsonb not null default '[]'::jsonb,
  output text,
  error text,
  model_calls int not null default 0,
  latency_ms int
);
create index if not exists runs_pipeline_started on runs(pipeline_id, started_at desc);
create table if not exists steer (
  id bigserial primary key,
  pipeline_id text references pipelines(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
create table if not exists inbox (
  id bigserial primary key,
  pipeline_id text,
  run_id bigint,
  title text,
  body text,
  created_at timestamptz not null default now()
);
create table if not exists kv (
  k text primary key,
  v jsonb,
  updated_at timestamptz not null default now()
);
