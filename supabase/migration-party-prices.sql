-- Party-wise item rates: each party can have its own rate per item.
-- Run once in Supabase → SQL Editor → New query → Run.
create table if not exists public.party_prices (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  item_id     uuid not null references public.items(id) on delete cascade,
  rate        numeric not null default 0,
  updated_at  timestamptz not null default now(),
  unique (customer_id, item_id)
);
create index if not exists idx_party_prices_customer on public.party_prices(customer_id);

alter table public.party_prices enable row level security;
-- any signed-in user can read (salesmen need the rates); only admin can write
drop policy if exists party_prices_read on public.party_prices;
create policy party_prices_read on public.party_prices for select using (auth.uid() is not null);
drop policy if exists party_prices_admin on public.party_prices;
create policy party_prices_admin on public.party_prices for all using (public.is_admin()) with check (public.is_admin());
