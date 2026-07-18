-- EventArt account profiles and event assignments. Passwords remain in Supabase Auth.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role text not null check (role in ('owner', 'team', 'client')),
  active boolean not null default true,
  client_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_event_access (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  event_record_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_record_id)
);

alter table public.profiles enable row level security;
alter table public.user_event_access enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can read their own event assignments" on public.user_event_access;
create policy "Users can read their own event assignments" on public.user_event_access for select to authenticated using (auth.uid() = user_id);

create index if not exists user_event_access_user_idx on public.user_event_access(user_id);
