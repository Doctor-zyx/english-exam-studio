-- Apply in the Supabase SQL editor as the project owner. No keys belong in this file.
-- Every browser write is still checked by auth.uid() and Row Level Security.
begin;

create table if not exists public.study_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0 and revision < 9007199254740991),
  document jsonb not null default '{"schema":1,"cells":{}}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint study_progress_document_shape check ((
    jsonb_typeof(document) = 'object'
    and document->>'schema' = '1'
    and jsonb_typeof(document->'cells') = 'object'
    and octet_length(document::text) <= 2000000
  ) is true)
);

alter table public.study_progress enable row level security;
alter table public.study_progress force row level security;
revoke all on table public.study_progress from public, anon, authenticated;
grant select, insert, update on table public.study_progress to authenticated;

drop policy if exists study_progress_select_own on public.study_progress;
create policy study_progress_select_own on public.study_progress for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists study_progress_insert_own on public.study_progress;
create policy study_progress_insert_own on public.study_progress for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists study_progress_update_own on public.study_progress;
create policy study_progress_update_own on public.study_progress for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
-- No DELETE grant/policy: logical deletions remain as tombstones for offline devices.

create or replace function public.study_sync_cas(
  expected_user_id uuid,
  expected_revision bigint,
  next_document jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  current_row public.study_progress%rowtype;
begin
  if caller is null or expected_user_id is distinct from caller then
    raise exception 'Authenticated user does not match expected_user_id' using errcode = '42501';
  end if;
  if expected_revision is null or expected_revision < 0 or expected_revision >= 9007199254740990 then
    raise exception 'Invalid revision' using errcode = '22023';
  end if;
  if next_document is null or jsonb_typeof(next_document) <> 'object'
     or next_document->>'schema' is distinct from '1'
     or jsonb_typeof(next_document->'cells') is distinct from 'object'
     or octet_length(next_document::text) > 2000000 then
    raise exception 'Invalid or oversized progress document' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(next_document->'cells')) > 12000 then
    raise exception 'Too many progress cells' using errcode = '22023';
  end if;

  -- Concurrent first writes serialize on the primary key, then on this row lock.
  insert into public.study_progress(user_id) values(caller) on conflict(user_id) do nothing;
  select * into strict current_row from public.study_progress where user_id = caller for update;
  if current_row.revision <> expected_revision then
    return jsonb_build_object('ok', false, 'revision', current_row.revision, 'document', current_row.document);
  end if;
  update public.study_progress
    set document = next_document, revision = current_row.revision + 1, updated_at = now()
    where user_id = caller
    returning * into current_row;
  return jsonb_build_object('ok', true, 'revision', current_row.revision, 'document', current_row.document);
end;
$$;

revoke all on function public.study_sync_cas(uuid,bigint,jsonb) from public, anon;
grant execute on function public.study_sync_cas(uuid,bigint,jsonb) to authenticated;
comment on table public.study_progress is 'Private per-user English study progress; no public reading; cells include durable deletion tombstones.';
comment on function public.study_sync_cas(uuid,bigint,jsonb) is 'Authenticated compare-and-swap. User ID is checked explicitly to prevent account-switch races. Invoker RLS remains in force.';

commit;
