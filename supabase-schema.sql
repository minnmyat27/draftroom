-- Draftroom cloud schema
-- Run this entire file in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  tags text[] not null default '{}',
  favorite boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notes_title_length check (char_length(title) <= 120),
  constraint notes_content_length check (char_length(content) <= 1000000),
  constraint notes_tag_count check (cardinality(tags) <= 6)
);

create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);

create index if not exists notes_user_archived_idx
  on public.notes (user_id, archived, updated_at desc);

create or replace function public.set_note_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_notes_updated_at on public.notes;
create trigger set_notes_updated_at
before update on public.notes
for each row
execute function public.set_note_updated_at();

alter table public.notes enable row level security;
alter table public.notes force row level security;

revoke all on table public.notes from anon;
revoke all on table public.notes from authenticated;
grant select, insert, update, delete on table public.notes to authenticated;

drop policy if exists "Users can read their own notes" on public.notes;
create policy "Users can read their own notes"
on public.notes
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own notes" on public.notes;
create policy "Users can create their own notes"
on public.notes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own notes" on public.notes;
create policy "Users can update their own notes"
on public.notes
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own notes" on public.notes;
create policy "Users can delete their own notes"
on public.notes
for delete
to authenticated
using ((select auth.uid()) = user_id);

comment on table public.notes is
  'Private Draftroom notes. Access is restricted to the authenticated owner by RLS.';
