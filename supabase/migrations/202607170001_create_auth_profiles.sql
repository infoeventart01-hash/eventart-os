-- EventArt authentication profiles and event-level access.
-- Safe to rerun; passwords and application data remain outside these tables.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text,
  role text not null,
  active boolean not null default true,
  client_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists client_record_id text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('owner', 'team', 'client'));

create table if not exists public.user_event_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_record_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_record_id)
);

alter table public.user_event_access add column if not exists user_id uuid;
alter table public.user_event_access add column if not exists event_record_id text;
alter table public.user_event_access add column if not exists created_at timestamptz not null default now();
alter table public.user_event_access drop constraint if exists user_event_access_user_id_fkey;
alter table public.user_event_access
  add constraint user_event_access_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

create index if not exists profiles_email_lower_idx on public.profiles (lower(email));
create index if not exists profiles_role_active_idx on public.profiles (role, active);
create index if not exists user_event_access_user_idx on public.user_event_access (user_id);
create index if not exists user_event_access_event_idx on public.user_event_access (event_record_id);

create or replace function public.set_eventart_profile_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_eventart_profile_updated_at on public.profiles;
create trigger set_eventart_profile_updated_at
before update on public.profiles
for each row execute function public.set_eventart_profile_updated_at();

alter table public.profiles enable row level security;
alter table public.user_event_access enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read their own event assignments" on public.user_event_access;
create policy "Users can read their own event assignments"
on public.user_event_access for select to authenticated
using (auth.uid() = user_id);

revoke all on table public.profiles from anon;
revoke all on table public.user_event_access from anon;
grant select on table public.profiles to authenticated;
grant select on table public.user_event_access to authenticated;
grant all on table public.profiles to service_role;
grant all on table public.user_event_access to service_role;

comment on table public.profiles is 'EventArt application roles linked to Supabase Auth users.';
comment on table public.user_event_access is 'Airtable Event record IDs assigned to EventArt users.';
