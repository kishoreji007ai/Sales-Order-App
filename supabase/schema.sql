-- =====================================================================
--  Sales Order Hub — Supabase schema
--  Run in Supabase:  SQL Editor -> New query -> paste all -> Run.
--  Safe to re-run (uses IF NOT EXISTS / OR REPLACE where possible).
-- =====================================================================

-- ---------- PROFILES (one row per login, linked to auth.users) --------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       text not null default 'salesman' check (role in ('admin','salesman')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- auto-create a profile row whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- helper: is the caller an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- MASTERS (managed by admin, shared to everyone) -------------
create table if not exists public.price_lists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  tally_name text,                                   -- Tally price level name
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  place      text,
  gstin      text,
  address    text,
  tally_guid text unique,                            -- set when synced from Tally
  source     text not null default 'app' check (source in ('app','tally')),
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  unit       text default 'Pcs',
  gst        numeric default 0,
  hsn        text,
  base_rate  numeric default 0,
  tally_guid text unique,                            -- set when synced from Tally
  source     text not null default 'app' check (source in ('app','tally')),
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

-- per-price-list rate for an item
create table if not exists public.item_prices (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.items(id) on delete cascade,
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  rate          numeric not null default 0,
  unique (item_id, price_list_id)
);

-- ---------- ORDERS (created by salesmen) ------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        text,
  order_date      date not null default current_date,
  customer_id     uuid references public.customers(id),
  customer_name   text,
  price_list_id   uuid references public.price_lists(id),
  price_list_name text,
  salesman_id     uuid not null default auth.uid() references public.profiles(id),
  salesman_name   text,
  status          text not null default 'Pending'
                    check (status in ('Pending','Confirmed','Delivered','Cancelled')),
  notes           text,
  subtotal        numeric default 0,
  tax_total       numeric default 0,
  total           numeric default 0,
  tally_exported  boolean not null default false,    -- flipped once pushed/imported to Tally
  created_at      timestamptz not null default now()
);

create table if not exists public.order_lines (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id  uuid references public.items(id),
  name     text,
  unit     text,
  rate     numeric,
  gst      numeric,
  qty      numeric,
  amount   numeric
);

-- helpful indexes
create index if not exists idx_orders_salesman on public.orders(salesman_id);
create index if not exists idx_orders_status   on public.orders(status);
create index if not exists idx_lines_order      on public.order_lines(order_id);
create index if not exists idx_prices_item      on public.item_prices(item_id);

-- =====================================================================
--  ROW LEVEL SECURITY
--  Masters: any signed-in user reads; only admin writes.
--  Orders : a salesman sees/creates only their own; admin sees all.
-- =====================================================================
alter table public.profiles    enable row level security;
alter table public.price_lists enable row level security;
alter table public.customers   enable row level security;
alter table public.items       enable row level security;
alter table public.item_prices enable row level security;
alter table public.orders      enable row level security;
alter table public.order_lines enable row level security;

-- profiles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update using (public.is_admin());

-- masters read (signed-in), write (admin) — same shape for each table
do $$
declare t text;
begin
  foreach t in array array['price_lists','customers','items','item_prices'] loop
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select using (auth.uid() is not null);', t, t);
    execute format('drop policy if exists %I_admin_all on public.%I;', t, t);
    execute format('create policy %I_admin_all on public.%I for all using (public.is_admin()) with check (public.is_admin());', t, t);
  end loop;
end $$;

-- orders: own or admin
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (salesman_id = auth.uid() or public.is_admin());
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert with check (salesman_id = auth.uid());
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update using (salesman_id = auth.uid() or public.is_admin());
drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders
  for delete using (salesman_id = auth.uid() or public.is_admin());

-- order_lines: follow the parent order's ownership
drop policy if exists lines_select on public.order_lines;
create policy lines_select on public.order_lines for select
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.salesman_id = auth.uid() or public.is_admin())));
drop policy if exists lines_write on public.order_lines;
create policy lines_write on public.order_lines for all
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.salesman_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.orders o where o.id = order_id
                 and (o.salesman_id = auth.uid() or public.is_admin())));

-- =====================================================================
--  After running this:
--   1. Create your own login (Authentication -> Users -> Add user), then
--      promote yourself to admin:
--        update public.profiles set role='admin'
--        where id = (select id from auth.users where email='YOU@example.com');
--   2. Add a login for each salesman the same way (leave them as 'salesman').
-- =====================================================================
