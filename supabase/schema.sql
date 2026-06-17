-- AIM Timeline — Supabase schema
-- Run this once in the Supabase SQL editor for a fresh project.
-- Creates the tables, the automatic change log, the write RPCs, and RLS so that
-- the public (anon) key can READ but never WRITE. All writes go through the
-- Netlify function using the service-role key.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists departments (
  id          int primary key,
  name        text not null,
  color       text not null default '#888888',
  sort_order  int  not null default 0,
  hidden      boolean not null default false   -- shared: hidden from the board for everyone
);

create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  department_id int  not null references departments(id) on delete cascade,
  title         text not null,
  start_date    date not null,
  end_date      date not null,
  color         text,                       -- null => inherit department colour
  note          text default '',
  importance    text not null default 'major' check (importance in ('major','minor')),
  wrap          boolean not null default false,
  solo          boolean not null default false,   -- force this event onto its own row
  locked        boolean not null default false,   -- "dates locked in": confirm before changing dates
  row_index     int,                              -- null => auto-pack; set => pinned to this row in its lane
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists events_department_idx on events(department_id);
create index if not exists events_dates_idx       on events(start_date, end_date);

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  actor       text not null default 'unknown',
  action      text not null,                -- insert | update | delete
  table_name  text not null,
  record_id   text not null,
  title       text,                         -- snapshot, so the log stays readable
  field       text,                         -- changed column (null for insert/delete)
  old_value   text,
  new_value   text
);

create index if not exists audit_ts_idx on audit_log(ts desc);

-- Bring older databases up to date (no-ops on a fresh schema, since `create table`
-- above already includes these columns). `create table if not exists` will NOT add
-- columns to a table that already exists, so add them explicitly here.
alter table departments add column if not exists hidden boolean not null default false;
alter table events      add column if not exists wrap   boolean not null default false;
alter table events      add column if not exists solo   boolean not null default false;
alter table events      add column if not exists locked boolean not null default false;
alter table events      add column if not exists row_index int;

-- ---------------------------------------------------------------------------
-- Change log: a trigger that diffs every write into audit_log.
-- The actor name is read from a per-transaction setting (app.actor) that the
-- write RPCs set just before mutating, so every row is attributed.
-- ---------------------------------------------------------------------------
create or replace function log_audit() returns trigger as $$
declare
  actor  text := coalesce(nullif(current_setting('app.actor', true), ''), 'unknown');
  ttl    text;
  k      text;
  old_j  jsonb;
  new_j  jsonb;
begin
  if (tg_op = 'INSERT') then
    insert into audit_log(actor, action, table_name, record_id, title, field, old_value, new_value)
    values (actor, 'insert', tg_table_name, new.id::text, coalesce(to_jsonb(new)->>'title', to_jsonb(new)->>'name'), null, null, null);
    return new;

  elsif (tg_op = 'UPDATE') then
    old_j := to_jsonb(old);
    new_j := to_jsonb(new);
    ttl   := coalesce(new_j->>'title', new_j->>'name');
    for k in select jsonb_object_keys(new_j) loop
      if k in ('updated_at') then continue; end if;
      if (old_j -> k) is distinct from (new_j -> k) then
        insert into audit_log(actor, action, table_name, record_id, title, field, old_value, new_value)
        values (actor, 'update', tg_table_name, new.id::text, ttl, k, old_j ->> k, new_j ->> k);
      end if;
    end loop;
    return new;

  elsif (tg_op = 'DELETE') then
    insert into audit_log(actor, action, table_name, record_id, title, field, old_value, new_value)
    values (actor, 'delete', tg_table_name, old.id::text, coalesce(to_jsonb(old)->>'title', to_jsonb(old)->>'name'), null, null, null);
    return old;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists events_audit on events;
create trigger events_audit
  after insert or update or delete on events
  for each row execute function log_audit();

drop trigger if exists departments_audit on departments;
create trigger departments_audit
  after insert or update or delete on departments
  for each row execute function log_audit();

-- ---------------------------------------------------------------------------
-- Write RPCs (security definer). Only the service_role may execute them, so the
-- Netlify function (which checks the edit password first) is the only writer.
-- They set app.actor in-transaction so the trigger above attributes the change.
-- ---------------------------------------------------------------------------
create or replace function api_upsert_event(actor text, payload jsonb)
returns events as $$
declare result events;
begin
  perform set_config('app.actor', actor, true);
  if (payload ? 'id') and coalesce(payload->>'id','') <> '' then
    update events set
      department_id = (payload->>'department_id')::int,
      title         = payload->>'title',
      start_date    = (payload->>'start_date')::date,
      end_date      = (payload->>'end_date')::date,
      color         = nullif(payload->>'color',''),
      note          = coalesce(payload->>'note',''),
      importance    = coalesce(payload->>'importance','major'),
      wrap          = coalesce((payload->>'wrap')::boolean, false),
      solo          = coalesce((payload->>'solo')::boolean, false),
      locked        = coalesce((payload->>'locked')::boolean, false),
      row_index     = nullif(payload->>'row_index','')::int,
      updated_at    = now()
    where id = (payload->>'id')::uuid
    returning * into result;
  else
    insert into events(department_id, title, start_date, end_date, color, note, importance, wrap, solo, locked, row_index)
    values (
      (payload->>'department_id')::int,
      payload->>'title',
      (payload->>'start_date')::date,
      (payload->>'end_date')::date,
      nullif(payload->>'color',''),
      coalesce(payload->>'note',''),
      coalesce(payload->>'importance','major'),
      coalesce((payload->>'wrap')::boolean, false),
      coalesce((payload->>'solo')::boolean, false),
      coalesce((payload->>'locked')::boolean, false),
      nullif(payload->>'row_index','')::int
    )
    returning * into result;
  end if;
  return result;
end;
$$ language plpgsql security definer;

create or replace function api_delete_event(actor text, event_id uuid)
returns void as $$
begin
  perform set_config('app.actor', actor, true);
  delete from events where id = event_id;
end;
$$ language plpgsql security definer;

create or replace function api_upsert_department(actor text, payload jsonb)
returns departments as $$
declare result departments;
begin
  perform set_config('app.actor', actor, true);
  if (payload ? 'id') and coalesce(payload->>'id','') <> '' then
    update departments set
      name       = payload->>'name',
      color      = coalesce(nullif(payload->>'color',''), '#888888'),
      sort_order = coalesce((payload->>'sort_order')::int, sort_order),
      hidden     = coalesce((payload->>'hidden')::boolean, hidden)
    where id = (payload->>'id')::int
    returning * into result;
  else
    insert into departments(id, name, color, sort_order, hidden)
    values (
      (select coalesce(max(id), 0) + 1 from departments),
      payload->>'name',
      coalesce(nullif(payload->>'color',''), '#888888'),
      coalesce((payload->>'sort_order')::int, (select coalesce(max(sort_order), 0) + 1 from departments)),
      coalesce((payload->>'hidden')::boolean, false)
    )
    returning * into result;
  end if;
  return result;
end;
$$ language plpgsql security definer;

create or replace function api_delete_department(actor text, dept_id int)
returns void as $$
begin
  perform set_config('app.actor', actor, true);
  delete from departments where id = dept_id;  -- ON DELETE CASCADE removes its events
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- Row Level Security: anon can read everything, write nothing.
-- service_role bypasses RLS, so the Netlify function can still write.
-- ---------------------------------------------------------------------------
alter table departments enable row level security;
alter table events      enable row level security;
alter table audit_log   enable row level security;

drop policy if exists anon_read_departments on departments;
drop policy if exists anon_read_events      on events;
drop policy if exists anon_read_audit       on audit_log;

create policy anon_read_departments on departments for select to anon, authenticated using (true);
create policy anon_read_events      on events      for select to anon, authenticated using (true);
create policy anon_read_audit       on audit_log   for select to anon, authenticated using (true);

-- Lock the write RPCs down to service_role only (so they can't be called with
-- the public anon key, which would bypass the password gate).
revoke all on function api_upsert_event(text, jsonb)      from public, anon, authenticated;
revoke all on function api_delete_event(text, uuid)       from public, anon, authenticated;
revoke all on function api_upsert_department(text, jsonb) from public, anon, authenticated;
revoke all on function api_delete_department(text, int)   from public, anon, authenticated;
grant execute on function api_upsert_event(text, jsonb)      to service_role;
grant execute on function api_delete_event(text, uuid)       to service_role;
grant execute on function api_upsert_department(text, jsonb) to service_role;
grant execute on function api_delete_department(text, int)   to service_role;
