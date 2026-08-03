-- Party-wise pricing: assign a price list to each party.
-- Run once in Supabase → SQL Editor → New query → Run.
alter table public.customers add column if not exists price_list_id uuid references public.price_lists(id);
alter table public.customers add column if not exists price_list_name text;
