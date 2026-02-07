-- Supabase schema for Bazunia user data + roles/admin/public decks

-- --- Core user storage ---

create table if not exists public.user_storage (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists user_storage_user_id_idx on public.user_storage (user_id);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_storage_updated_at on public.user_storage;
create trigger set_user_storage_updated_at
before update on public.user_storage
for each row
execute function public.set_updated_at_timestamp();

alter table public.user_storage enable row level security;

drop policy if exists "user_storage_select_own" on public.user_storage;
create policy "user_storage_select_own"
on public.user_storage
for select
using (auth.uid() = user_id);

drop policy if exists "user_storage_insert_own" on public.user_storage;
create policy "user_storage_insert_own"
on public.user_storage
for insert
with check (auth.uid() = user_id);

drop policy if exists "user_storage_update_own" on public.user_storage;
create policy "user_storage_update_own"
on public.user_storage
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_storage_delete_own" on public.user_storage;
create policy "user_storage_delete_own"
on public.user_storage
for delete
using (auth.uid() = user_id);

-- --- Roles ---

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('user', 'admin', 'dev');
  end if;
end
$$;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_roles_role_idx on public.user_roles (role);

drop trigger if exists set_user_roles_updated_at on public.user_roles;
create trigger set_user_roles_updated_at
before update on public.user_roles
for each row
execute function public.set_updated_at_timestamp();

alter table public.user_roles enable row level security;

-- Backfill existing accounts
insert into public.user_roles (user_id, role)
select id, 'user'::public.app_role
from auth.users
on conflict (user_id) do nothing;

create or replace function public.handle_new_auth_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'user'::public.app_role)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_role on auth.users;
create trigger on_auth_user_created_role
after insert on auth.users
for each row execute function public.handle_new_auth_user_role();

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ur.role from public.user_roles ur where ur.user_id = auth.uid()),
    'user'::public.app_role
  );
$$;

create or replace function public.admin_list_users()
returns table(
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  role public.app_role
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Brak autoryzacji';
  end if;

  if public.current_app_role() not in ('admin'::public.app_role, 'dev'::public.app_role) then
    raise exception 'Brak uprawnień';
  end if;

  return query
    select
      u.id::uuid as user_id,
      u.email::text as email,
      u.created_at::timestamptz as created_at,
      u.last_sign_in_at::timestamptz as last_sign_in_at,
      coalesce(ur.role, 'user'::public.app_role)::public.app_role as role
    from auth.users u
    left join public.user_roles ur on ur.user_id = u.id
    order by u.created_at desc;
end;
$$;

create or replace function public.admin_set_user_role(target_user_id uuid, next_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.app_role;
  target_current_role public.app_role;
  normalized_next_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'Brak autoryzacji';
  end if;

  actor_role := public.current_app_role();
  if actor_role not in ('admin'::public.app_role, 'dev'::public.app_role) then
    raise exception 'Brak uprawnień';
  end if;

  begin
    normalized_next_role := next_role::public.app_role;
  exception when others then
    raise exception 'Nieprawidłowa rola docelowa: %', next_role;
  end;

  if normalized_next_role = 'dev'::public.app_role then
    raise exception 'Rola dev nie moze byc ustawiana z panelu';
  end if;

  select coalesce(role, 'user'::public.app_role)
  into target_current_role
  from public.user_roles
  where user_id = target_user_id;

  if target_current_role is null then
    insert into public.user_roles (user_id, role)
    values (target_user_id, 'user'::public.app_role)
    on conflict (user_id) do nothing;
    target_current_role := 'user'::public.app_role;
  end if;

  if target_current_role = 'dev'::public.app_role then
    raise exception 'Nie mozna zmieniac roli konta dev';
  end if;

  -- admin: only user -> admin
  if actor_role = 'admin'::public.app_role then
    if not (target_current_role = 'user'::public.app_role and normalized_next_role = 'admin'::public.app_role) then
      raise exception 'Admin moze tylko promowac user -> admin';
    end if;
  end if;

  -- dev: user -> admin OR admin -> user
  if actor_role = 'dev'::public.app_role then
    if not (
      (target_current_role = 'user'::public.app_role and normalized_next_role = 'admin'::public.app_role)
      or
      (target_current_role = 'admin'::public.app_role and normalized_next_role = 'user'::public.app_role)
    ) then
      raise exception 'Dev moze wykonywac tylko user -> admin albo admin -> user';
    end if;
  end if;

  update public.user_roles
  set role = normalized_next_role
  where user_id = target_user_id;
end;
$$;

revoke all on function public.current_app_role() from public;
revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_set_user_role(uuid, text) from public;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

-- --- Global public decks ---

create table if not exists public.public_decks (
  id text primary key,
  name text not null,
  description text not null default '',
  deck_group text,
  categories jsonb,
  questions jsonb not null default '[]'::jsonb,
  question_count int not null default 0,
  version int not null default 1,
  source text not null default 'public-db',
  is_archived boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists public_decks_is_archived_idx on public.public_decks (is_archived);

drop trigger if exists set_public_decks_updated_at on public.public_decks;
create trigger set_public_decks_updated_at
before update on public.public_decks
for each row
execute function public.set_updated_at_timestamp();

alter table public.public_decks enable row level security;

drop policy if exists "public_decks_read_active" on public.public_decks;
create policy "public_decks_read_active"
on public.public_decks
for select
to anon, authenticated
using (is_archived = false);

drop policy if exists "public_decks_read_archived_admin_dev" on public.public_decks;
create policy "public_decks_read_archived_admin_dev"
on public.public_decks
for select
to authenticated
using (
  is_archived = true
  and public.current_app_role() in ('admin'::public.app_role, 'dev'::public.app_role)
);

drop policy if exists "public_decks_insert_admin_dev" on public.public_decks;
create policy "public_decks_insert_admin_dev"
on public.public_decks
for insert
to authenticated
with check (public.current_app_role() in ('admin'::public.app_role, 'dev'::public.app_role));

drop policy if exists "public_decks_update_admin_dev" on public.public_decks;
create policy "public_decks_update_admin_dev"
on public.public_decks
for update
to authenticated
using (public.current_app_role() in ('admin'::public.app_role, 'dev'::public.app_role))
with check (public.current_app_role() in ('admin'::public.app_role, 'dev'::public.app_role));

-- Bootstrap first developer (run after account registration)
-- insert into public.user_roles (user_id, role)
-- select id, 'dev'::public.app_role
-- from auth.users
-- where lower(email) = lower('szymponbiceps118@gmail.com')
-- on conflict (user_id) do update
-- set role = excluded.role;
