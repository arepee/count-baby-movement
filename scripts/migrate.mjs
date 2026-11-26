#!/usr/bin/env node
// Applies the DB schema to DATABASE_URL. Idempotent (create table if not exists).
// Optional: the app also creates the schema automatically on first request.
// Usage: DATABASE_URL=postgres://... npm run db:migrate
//   (or put DATABASE_URL in .env.local; it is loaded automatically if present)
import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

for (const f of [".env.local", ".env"]) {
  if (!process.env.DATABASE_URL && existsSync(f)) {
    const m = readFileSync(f, "utf8").match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m);
    if (m) process.env.DATABASE_URL = m[1].trim();
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// Keep in sync with docs/SPEC.md / src/lib/schema.sql.
const statements = [
  `create table if not exists settings (
    id int primary key default 1 check (id = 1),
    sleep_start text not null default '23:30',
    sleep_end text not null default '07:30',
    timezone text not null default 'Asia/Kolkata',
    tracking_start timestamptz not null default now(),
    last_notified_slot timestamptz,
    last_notified_at timestamptz
  )`,
  `create table if not exists entries (
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
  )`,
  `create table if not exists push_subscriptions (
    endpoint text primary key,
    p256dh text not null,
    auth text not null,
    enabled boolean not null default true,
    created_at timestamptz not null default now()
  )`,
];

const sql = neon(url);
for (const s of statements) {
  await sql.query(s);
  console.log("ok:", s.split("\n")[0].replace(/\s*\($/, ""));
}
console.log("Schema applied.");
