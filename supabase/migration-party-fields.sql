-- Adds Tally party fields to the customers master.
-- Run once in Supabase → SQL Editor → New query → Run.
alter table public.customers add column if not exists party_group text;
alter table public.customers add column if not exists state text;
alter table public.customers add column if not exists country text;
-- (items already have gst, hsn and base_rate columns — no change needed there.)
