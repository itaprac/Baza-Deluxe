-- Supabase schema for Baza Deluxe user data

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

create policy "user_storage_select_own"
on public.user_storage
for select
using (auth.uid() = user_id);

create policy "user_storage_insert_own"
on public.user_storage
for insert
with check (auth.uid() = user_id);

create policy "user_storage_update_own"
on public.user_storage
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_storage_delete_own"
on public.user_storage
for delete
using (auth.uid() = user_id);
