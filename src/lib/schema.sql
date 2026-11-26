-- Keep in sync with SCHEMA_SQL in src/lib/db.ts (applied idempotently by ensureSchema()).
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  sleep_start text not null default '23:30',
  sleep_end text not null default '07:30',
  timezone text not null default 'Asia/Kolkata',
  tracking_start timestamptz not null default now(),
  last_notified_slot timestamptz,
  last_notified_at timestamptz
);
create table if not exists entries (
  id serial primary key,
  slot_start timestamptz not null unique,
  slot_end timestamptz not null,
  is_sleep boolean not null default false,
  kicks int not null default 0 check (kicks >= 0),
  rolls int not null default 0 check (rolls >= 0),
  other int not null default 0 check (other >= 0),
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
-- Columns added after the first release (idempotent for existing databases).
alter table settings add column if not exists initialized boolean not null default false;
alter table settings add column if not exists failed_logins int not null default 0;
alter table settings add column if not exists locked_until timestamptz;
insert into settings (id) values (1) on conflict (id) do nothing;
