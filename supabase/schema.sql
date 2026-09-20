-- INE Price Tracker — Supabase schema
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tracked products
-- ---------------------------------------------------------------------------
create table if not exists tracked_products (
  id              uuid primary key default gen_random_uuid(),
  store_product_id text not null,               -- id/slug used by the mock store
  name            text not null,
  url             text not null,
  image_url       text,
  currency        text default 'INR',
  -- bonus: configurable frequency per product
  interval_minutes integer not null default 120 check (interval_minutes >= 5),
  active          boolean not null default true,
  -- denormalised "latest known good" state, kept for fast dashboard reads
  last_price      numeric(12,2),
  last_in_stock   boolean,
  last_stock_text text,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  consecutive_failures integer not null default 0,
  -- bonus: structure-change detection
  last_strategy   text,
  structure_changed_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (store_product_id)
);

-- ---------------------------------------------------------------------------
-- Price + stock history. Only written on a VALIDATED success.
-- ---------------------------------------------------------------------------
create table if not exists price_history (
  id           bigserial primary key,
  product_id   uuid not null references tracked_products(id) on delete cascade,
  price        numeric(12,2) not null check (price > 0),
  in_stock     boolean,
  stock_text   text,
  currency     text default 'INR',
  strategy     text,                            -- which extraction path produced this
  source       text,                            -- 'http' | 'browser'
  scraped_at   timestamptz not null default now()
);
create index if not exists price_history_product_time
  on price_history (product_id, scraped_at desc);

-- ---------------------------------------------------------------------------
-- Scrape log. EVERY attempt lands here, success or not.
-- ---------------------------------------------------------------------------
do $$ begin
  create type scrape_outcome as enum ('success', 'retried', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

create table if not exists scrape_logs (
  id            bigserial primary key,
  product_id    uuid references tracked_products(id) on delete cascade,
  run_id        uuid,                            -- groups one cron cycle
  outcome       scrape_outcome not null,
  attempts      integer not null default 1,
  duration_ms   integer,
  http_status   integer,
  source        text,                            -- 'http' | 'browser'
  strategy      text,
  price         numeric(12,2),                   -- null unless outcome = success
  in_stock      boolean,
  error_kind    text,                            -- timeout | http_error | parse_error | validation_error | network_error
  message       text,
  attempt_trail jsonb,                           -- per-attempt detail, honest record
  started_at    timestamptz not null default now()
);
create index if not exists scrape_logs_product_time
  on scrape_logs (product_id, started_at desc);
create index if not exists scrape_logs_run on scrape_logs (run_id);

-- ---------------------------------------------------------------------------
-- Alerts (bonus): price drop / back in stock
-- ---------------------------------------------------------------------------
create table if not exists alerts (
  id          bigserial primary key,
  product_id  uuid not null references tracked_products(id) on delete cascade,
  kind        text not null,                     -- 'price_drop' | 'price_rise' | 'back_in_stock' | 'out_of_stock' | 'structure_change'
  old_value   text,
  new_value   text,
  message     text not null,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists alerts_time on alerts (created_at desc);

-- ---------------------------------------------------------------------------
-- Convenience view: dashboard rows
-- ---------------------------------------------------------------------------
create or replace view product_dashboard as
select
  p.*,
  (select count(*) from price_history h where h.product_id = p.id)                  as history_points,
  (select min(h.price) from price_history h where h.product_id = p.id)              as min_price,
  (select max(h.price) from price_history h where h.product_id = p.id)              as max_price,
  (select round(avg(h.price), 2) from price_history h where h.product_id = p.id)    as avg_price,
  (select count(*) from scrape_logs l
     where l.product_id = p.id and l.outcome = 'success')                           as success_count,
  (select count(*) from scrape_logs l
     where l.product_id = p.id and l.outcome = 'failed')                            as failure_count
from tracked_products p;

-- ---------------------------------------------------------------------------
-- RLS: the backend uses the service-role key, which bypasses RLS.
-- Enable RLS so the anon key cannot read/write directly.
-- ---------------------------------------------------------------------------
alter table tracked_products enable row level security;
alter table price_history    enable row level security;
alter table scrape_logs      enable row level security;
alter table alerts           enable row level security;
