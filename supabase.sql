-- JOSH Finance cloud sync table for Supabase
-- Run in Supabase Dashboard > SQL Editor
create table if not exists public.finance_states (
  user_name text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Simple demo policy: allow anon read/write (replace with auth.uid() scoping for production)
alter table public.finance_states enable row level security;
drop policy if exists "open demo" on public.finance_states;
create policy "open demo" on public.finance_states for all using (true) with check (true);

-- Production alternative (per Supabase Auth user, store auth user id in user_name):
-- drop policy "open demo" on public.finance_states;
-- create policy "owner only" on public.finance_states for all using (auth.uid()::text = user_name) with check (auth.uid()::text = user_name);
