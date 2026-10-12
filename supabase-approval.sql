-- JOSH Finance — approval queue mirror (Supabase)
-- Run AFTER supabase.sql in SQL Editor.
-- SECURITY: status/role ONLY. Never store passwords, salts, or hashes here —
-- verifiers stay in each device's localStorage (PBKDF2 210k). Cloud holds queue state.
create table if not exists public.user_approvals (
  user_name text primary key,
  role text not null default 'user' check (role in ('superadmin','user')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  updated_at timestamptz not null default now()
);
alter table public.user_approvals enable row level security;
drop policy if exists "open demo approvals" on public.user_approvals;
create policy "open demo approvals" on public.user_approvals for all using (true) with check (true);
-- Production: restrict writes to superadmin via Supabase Auth + Edge Function (see README-DEPLOY.md).
