-- Draftroom collaboration upgrade
-- Run after supabase-schema.sql in Supabase Dashboard -> SQL Editor.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.note_members (
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

create index if not exists note_members_user_note_idx
  on public.note_members (user_id, note_id);

create table if not exists public.note_invites (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz
);

create index if not exists note_invites_note_idx
  on public.note_invites (note_id, created_at desc);

create unique index if not exists note_invites_one_redemption_idx
  on public.note_invites (token)
  where redeemed_at is null and revoked_at is null;

alter table public.note_members enable row level security;
alter table public.note_members force row level security;
alter table public.note_invites enable row level security;
alter table public.note_invites force row level security;

create or replace function private.note_access_level(p_note_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  access_level text;
begin
  if current_user_id is null then
    return null;
  end if;

  select case
    when note.user_id = current_user_id then 'owner'
    else member.role
  end
  into access_level
  from public.notes as note
  left join public.note_members as member
    on member.note_id = note.id
   and member.user_id = current_user_id
  where note.id = p_note_id;

  return access_level;
end;
$$;

revoke all on function private.note_access_level(uuid) from public, anon;
grant execute on function private.note_access_level(uuid) to authenticated;

create or replace function private.protect_note_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'Note identity and ownership cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_note_identity on public.notes;
create trigger protect_note_identity
before update on public.notes
for each row
execute function private.protect_note_identity();

drop policy if exists "Users can read their own notes" on public.notes;
drop policy if exists "Users can create their own notes" on public.notes;
drop policy if exists "Users can update their own notes" on public.notes;
drop policy if exists "Users can delete their own notes" on public.notes;

create policy "Owners and collaborators can read notes"
on public.notes
for select
to authenticated
using ((select private.note_access_level(id)) in ('owner', 'editor', 'viewer'));

create policy "Users can create owned notes"
on public.notes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Owners and editors can update notes"
on public.notes
for update
to authenticated
using ((select private.note_access_level(id)) in ('owner', 'editor'))
with check ((select private.note_access_level(id)) in ('owner', 'editor'));

create policy "Only owners can delete notes"
on public.notes
for delete
to authenticated
using ((select private.note_access_level(id)) = 'owner');

drop policy if exists "Members can view relevant memberships" on public.note_members;
create policy "Members can view relevant memberships"
on public.note_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.note_access_level(note_id)) = 'owner'
);

drop policy if exists "Owners manage memberships" on public.note_members;
create policy "Owners manage memberships"
on public.note_members
for all
to authenticated
using ((select private.note_access_level(note_id)) = 'owner')
with check ((select private.note_access_level(note_id)) = 'owner');

drop policy if exists "Owners manage invitations" on public.note_invites;
create policy "Owners manage invitations"
on public.note_invites
for all
to authenticated
using ((select private.note_access_level(note_id)) = 'owner')
with check (
  (select private.note_access_level(note_id)) = 'owner'
  and created_by = (select auth.uid())
);

create or replace function private.redeem_note_invite_internal(invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  invite_row public.note_invites%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into invite_row
  from public.note_invites
  where token = invite_token
    and revoked_at is null
    and redeemed_at is null
    and expires_at > now()
  for update;

  if invite_row.id is null then
    raise exception 'This invitation is invalid, expired, or already used';
  end if;

  if invite_row.created_by = current_user_id then
    return invite_row.note_id;
  end if;

  insert into public.note_members (note_id, user_id, role, created_by)
  values (invite_row.note_id, current_user_id, invite_row.role, invite_row.created_by)
  on conflict (note_id, user_id)
  do update set role = excluded.role;

  update public.note_invites
  set redeemed_by = current_user_id,
      redeemed_at = now()
  where id = invite_row.id;

  return invite_row.note_id;
end;
$$;

revoke all on function private.redeem_note_invite_internal(uuid) from public, anon;
grant execute on function private.redeem_note_invite_internal(uuid) to authenticated;

create or replace function public.redeem_note_invite(invite_token uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.redeem_note_invite_internal(invite_token);
$$;

revoke all on function public.redeem_note_invite(uuid) from public, anon;
grant execute on function public.redeem_note_invite(uuid) to authenticated;

revoke all on table public.note_members from anon;
revoke all on table public.note_invites from anon;
revoke all on table public.note_members from authenticated;
revoke all on table public.note_invites from authenticated;
grant select, insert, update, delete on table public.note_members to authenticated;
grant select, insert, update, delete on table public.note_invites to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notes'
  ) then
    execute 'alter publication supabase_realtime add table public.notes';
  end if;
end;
$$;

comment on table public.note_members is
  'Signed-in collaborators and their editor or viewer access to a note.';
comment on table public.note_invites is
  'Single-use, expiring capability links created only by note owners.';
