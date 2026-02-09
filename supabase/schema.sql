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

-- --- User public profiles (username) ---

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_username_format_check
    check (username ~ '^[a-z0-9_.-]{3,24}$')
);

create unique index if not exists user_profiles_username_lower_uidx
on public.user_profiles (lower(username));

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_updated_at_timestamp();

create or replace function public.generate_random_username()
returns text
language plpgsql
set search_path = public
as $$
begin
  return 'u_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
end;
$$;

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  if exists (select 1 from public.user_profiles where user_id = new.id) then
    return new;
  end if;

  for i in 1..50 loop
    candidate := public.generate_random_username();
    begin
      insert into public.user_profiles (user_id, username)
      values (new.id, candidate);
      return new;
    exception
      when unique_violation then
        if exists (select 1 from public.user_profiles where user_id = new.id) then
          return new;
        end if;
    end;
  end loop;

  raise exception 'Nie udalo sie wygenerowac unikalnego username dla user_id=%', new.id;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user_profile();

-- Backfill existing accounts
do $$
declare
  rec record;
  candidate text;
begin
  for rec in
    select u.id
    from auth.users u
    left join public.user_profiles up on up.user_id = u.id
    where up.user_id is null
  loop
    for i in 1..50 loop
      candidate := public.generate_random_username();
      begin
        insert into public.user_profiles (user_id, username)
        values (rec.id, candidate);
        exit;
      exception
        when unique_violation then
          null;
      end;
    end loop;
  end loop;
end;
$$;

alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles_select_public" on public.user_profiles;
drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own"
on public.user_profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own"
on public.user_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own"
on public.user_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- --- User shared decks and subscriptions ---

create table if not exists public.shared_decks (
  id text primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_username text not null,
  source_deck_id text not null,
  name text not null,
  description text not null default '',
  deck_group text,
  categories jsonb,
  questions jsonb not null default '[]'::jsonb,
  question_count int not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, source_deck_id)
);

create index if not exists shared_decks_is_published_updated_at_idx
on public.shared_decks (is_published, updated_at desc);

create index if not exists shared_decks_owner_user_id_idx
on public.shared_decks (owner_user_id);

drop trigger if exists set_shared_decks_updated_at on public.shared_decks;
create trigger set_shared_decks_updated_at
before update on public.shared_decks
for each row
execute function public.set_updated_at_timestamp();

create or replace function public.sync_shared_deck_owner_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shared_decks
  set owner_username = new.username
  where owner_user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists on_user_profile_username_updated on public.user_profiles;
create trigger on_user_profile_username_updated
after update of username on public.user_profiles
for each row
when (old.username is distinct from new.username)
execute function public.sync_shared_deck_owner_username();

create or replace function public.set_shared_deck_owner_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_username text;
begin
  select up.username
  into profile_username
  from public.user_profiles up
  where up.user_id = new.owner_user_id;

  if profile_username is not null and length(profile_username) > 0 then
    new.owner_username := profile_username;
  end if;
  return new;
end;
$$;

drop trigger if exists set_shared_deck_owner_username on public.shared_decks;
create trigger set_shared_deck_owner_username
before insert or update of owner_user_id, owner_username
on public.shared_decks
for each row
execute function public.set_shared_deck_owner_username();

alter table public.shared_decks enable row level security;

drop policy if exists "shared_decks_read_published" on public.shared_decks;
create policy "shared_decks_read_published"
on public.shared_decks
for select
to anon, authenticated
using (is_published = true);

drop policy if exists "shared_decks_read_own_any" on public.shared_decks;
create policy "shared_decks_read_own_any"
on public.shared_decks
for select
to authenticated
using (auth.uid() = owner_user_id);

drop policy if exists "shared_decks_insert_own" on public.shared_decks;
create policy "shared_decks_insert_own"
on public.shared_decks
for insert
to authenticated
with check (auth.uid() = owner_user_id);

drop policy if exists "shared_decks_update_own" on public.shared_decks;
create policy "shared_decks_update_own"
on public.shared_decks
for update
to authenticated
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create table if not exists public.shared_deck_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  shared_deck_id text not null references public.shared_decks(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, shared_deck_id)
);

create index if not exists shared_deck_subscriptions_user_id_idx
on public.shared_deck_subscriptions (user_id);

create index if not exists shared_deck_subscriptions_shared_deck_id_idx
on public.shared_deck_subscriptions (shared_deck_id);

alter table public.shared_deck_subscriptions enable row level security;

drop policy if exists "shared_deck_subscriptions_select_own" on public.shared_deck_subscriptions;
create policy "shared_deck_subscriptions_select_own"
on public.shared_deck_subscriptions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "shared_deck_subscriptions_insert_own" on public.shared_deck_subscriptions;
create policy "shared_deck_subscriptions_insert_own"
on public.shared_deck_subscriptions
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.shared_decks sd
    where sd.id = shared_deck_id
      and sd.is_published = true
      and sd.owner_user_id <> auth.uid()
  )
);

drop policy if exists "shared_deck_subscriptions_update_own" on public.shared_deck_subscriptions;
create policy "shared_deck_subscriptions_update_own"
on public.shared_deck_subscriptions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "shared_deck_subscriptions_delete_own" on public.shared_deck_subscriptions;
create policy "shared_deck_subscriptions_delete_own"
on public.shared_deck_subscriptions
for delete
to authenticated
using (auth.uid() = user_id);

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

-- --- Public deck visibility overrides (static public deck source + DB hide/show) ---

create table if not exists public.public_deck_visibility (
  deck_id text primary key,
  is_hidden boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists public_deck_visibility_is_hidden_idx
on public.public_deck_visibility (is_hidden);

drop trigger if exists set_public_deck_visibility_updated_at on public.public_deck_visibility;
create trigger set_public_deck_visibility_updated_at
before update on public.public_deck_visibility
for each row
execute function public.set_updated_at_timestamp();

alter table public.public_deck_visibility enable row level security;

drop policy if exists "public_deck_visibility_read_all" on public.public_deck_visibility;
create policy "public_deck_visibility_read_all"
on public.public_deck_visibility
for select
to anon, authenticated
using (true);

drop policy if exists "public_deck_visibility_insert_admin_dev" on public.public_deck_visibility;
create policy "public_deck_visibility_insert_admin_dev"
on public.public_deck_visibility
for insert
to authenticated
with check (public.current_app_role() in ('admin'::public.app_role, 'dev'::public.app_role));

drop policy if exists "public_deck_visibility_update_admin_dev" on public.public_deck_visibility;
create policy "public_deck_visibility_update_admin_dev"
on public.public_deck_visibility
for update
to authenticated
using (public.current_app_role() in ('admin'::public.app_role, 'dev'::public.app_role))
with check (public.current_app_role() in ('admin'::public.app_role, 'dev'::public.app_role));

drop policy if exists "public_deck_visibility_delete_admin_dev" on public.public_deck_visibility;
create policy "public_deck_visibility_delete_admin_dev"
on public.public_deck_visibility
for delete
to authenticated
using (public.current_app_role() in ('admin'::public.app_role, 'dev'::public.app_role));

-- Backfill hidden state from legacy public_decks.is_archived
insert into public.public_deck_visibility (deck_id, is_hidden)
select pd.id, true
from public.public_decks pd
where pd.is_archived = true
on conflict (deck_id) do update
set is_hidden = excluded.is_hidden;

-- --- Community answer votes ---

create table if not exists public.answer_votes (
  target_scope text not null
    check (target_scope in ('public', 'shared')),
  target_deck_id text not null,
  question_id text not null,
  answer_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote smallint not null
    check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (target_scope, target_deck_id, question_id, answer_id, user_id)
);

create index if not exists answer_votes_target_question_idx
on public.answer_votes (target_scope, target_deck_id, question_id);

create index if not exists answer_votes_target_answer_idx
on public.answer_votes (target_scope, target_deck_id, question_id, answer_id);

create index if not exists answer_votes_user_target_question_idx
on public.answer_votes (user_id, target_scope, target_deck_id, question_id);

drop trigger if exists set_answer_votes_updated_at on public.answer_votes;
create trigger set_answer_votes_updated_at
before update on public.answer_votes
for each row
execute function public.set_updated_at_timestamp();

alter table public.answer_votes enable row level security;

create or replace function public.can_access_answer_vote_target(
  p_target_scope text,
  p_target_deck_id text,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_target_scope = 'public' then
    return coalesce(length(trim(p_target_deck_id)), 0) > 0;
  end if;

  if p_target_scope = 'shared' then
    if exists (
      select 1
      from public.shared_decks sd
      where sd.id = p_target_deck_id
        and sd.is_published = true
    ) then
      return true;
    end if;

    if p_user_id is null then
      return false;
    end if;

    if exists (
      select 1
      from public.shared_decks sd
      where sd.id = p_target_deck_id
        and sd.owner_user_id = p_user_id
    ) then
      return true;
    end if;

    if exists (
      select 1
      from public.shared_deck_subscriptions sds
      where sds.shared_deck_id = p_target_deck_id
        and sds.user_id = p_user_id
    ) then
      return true;
    end if;

    return false;
  end if;

  return false;
end;
$$;

create or replace function public.set_answer_vote(
  p_target_scope text,
  p_target_deck_id text,
  p_question_id text,
  p_answer_id text,
  p_vote smallint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
begin
  actor_id := auth.uid();

  if actor_id is null then
    raise exception 'Brak autoryzacji';
  end if;

  if p_target_scope not in ('public', 'shared') then
    raise exception 'Nieprawidłowy target_scope';
  end if;

  if p_vote not in (-1, 0, 1) then
    raise exception 'Nieprawidłowa wartość głosu';
  end if;

  if coalesce(length(trim(p_target_deck_id)), 0) = 0
    or coalesce(length(trim(p_question_id)), 0) = 0
    or coalesce(length(trim(p_answer_id)), 0) = 0 then
    raise exception 'Brak wymaganych identyfikatorów głosu';
  end if;

  if not public.can_access_answer_vote_target(p_target_scope, p_target_deck_id, actor_id) then
    raise exception 'Brak uprawnień do tej talii';
  end if;

  if p_vote = 0 then
    delete from public.answer_votes av
    where av.target_scope = p_target_scope
      and av.target_deck_id = p_target_deck_id
      and av.question_id = p_question_id
      and av.answer_id = p_answer_id
      and av.user_id = actor_id;
    return;
  end if;

  insert into public.answer_votes (
    target_scope,
    target_deck_id,
    question_id,
    answer_id,
    user_id,
    vote
  )
  values (
    p_target_scope,
    p_target_deck_id,
    p_question_id,
    p_answer_id,
    actor_id,
    p_vote
  )
  on conflict (target_scope, target_deck_id, question_id, answer_id, user_id)
  do update set
    vote = excluded.vote,
    updated_at = now();
end;
$$;

create or replace function public.fetch_answer_vote_summary(
  p_target_scope text,
  p_target_deck_id text,
  p_question_ids text[]
)
returns table(
  question_id text,
  answer_id text,
  plus_count int,
  minus_count int,
  user_vote smallint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_target_scope not in ('public', 'shared') then
    raise exception 'Nieprawidłowy target_scope';
  end if;

  if not public.can_access_answer_vote_target(p_target_scope, p_target_deck_id, auth.uid()) then
    raise exception 'Brak uprawnień do tej talii';
  end if;

  if p_question_ids is null or array_length(p_question_ids, 1) is null then
    return;
  end if;

  return query
  with selected_questions as (
    select distinct qid
    from unnest(p_question_ids) as qid
    where qid is not null
      and length(trim(qid)) > 0
  ),
  aggregated as (
    select
      av.question_id,
      av.answer_id,
      count(*) filter (where av.vote = 1)::int as plus_count,
      count(*) filter (where av.vote = -1)::int as minus_count
    from public.answer_votes av
    join selected_questions sq on sq.qid = av.question_id
    where av.target_scope = p_target_scope
      and av.target_deck_id = p_target_deck_id
    group by av.question_id, av.answer_id
  ),
  my_votes as (
    select
      av.question_id,
      av.answer_id,
      av.vote
    from public.answer_votes av
    join selected_questions sq on sq.qid = av.question_id
    where av.target_scope = p_target_scope
      and av.target_deck_id = p_target_deck_id
      and av.user_id = auth.uid()
  )
  select
    a.question_id,
    a.answer_id,
    a.plus_count,
    a.minus_count,
    coalesce(mv.vote, 0)::smallint as user_vote
  from aggregated a
  left join my_votes mv
    on mv.question_id = a.question_id
   and mv.answer_id = a.answer_id
  order by a.question_id, a.answer_id;
end;
$$;

revoke all on function public.can_access_answer_vote_target(text, text, uuid) from public;
revoke all on function public.set_answer_vote(text, text, text, text, smallint) from public;
revoke all on function public.fetch_answer_vote_summary(text, text, text[]) from public;

grant execute on function public.can_access_answer_vote_target(text, text, uuid) to anon, authenticated;
grant execute on function public.set_answer_vote(text, text, text, text, smallint) to authenticated;
grant execute on function public.fetch_answer_vote_summary(text, text, text[]) to anon, authenticated;

-- Bootstrap first developer (run after account registration)
-- insert into public.user_roles (user_id, role)
-- select id, 'dev'::public.app_role
-- from auth.users
-- where lower(email) = lower('szymponbiceps118@gmail.com')
-- on conflict (user_id) do update
-- set role = excluded.role;
