-- Verification only: two temporary fixtures are rolled back in the same transaction.
-- Run as project owner in a disposable test session; any failure aborts the transaction.
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('81e1db6b-44f9-401b-8fd4-ec7bb23a1101','authenticated','authenticated','orbit-rls-a@example.invalid',now(),now()),
('81e1db6b-44f9-401b-8fd4-ec7bb23a1102','authenticated','authenticated','orbit-rls-b@example.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"81e1db6b-44f9-401b-8fd4-ec7bb23a1101","role":"authenticated"}',true);
do $verify$
declare r jsonb; n integer;
begin
r := public.study_sync_cas('81e1db6b-44f9-401b-8fd4-ec7bb23a1101',0,'{"schema":1,"cells":{}}');
if r->>'ok' <> 'true' or r->>'revision' <> '1' then raise exception 'Own initial write failed'; end if;
r := public.study_sync_cas('81e1db6b-44f9-401b-8fd4-ec7bb23a1101',0,'{"schema":1,"cells":{}}');
if r->>'ok' <> 'false' or r->>'revision' <> '1' then raise exception 'Stale CAS not rejected'; end if;
r := public.study_sync_cas('81e1db6b-44f9-401b-8fd4-ec7bb23a1101',1,'{"schema":1,"cells":{}}');
if r->>'ok' <> 'true' or r->>'revision' <> '2' then raise exception 'Own update failed'; end if;
begin
update public.study_progress set user_id='81e1db6b-44f9-401b-8fd4-ec7bb23a1102' where user_id='81e1db6b-44f9-401b-8fd4-ec7bb23a1101';
raise exception 'Owner reassignment unexpectedly allowed';
exception when insufficient_privilege then null; end;
begin
delete from public.study_progress where user_id='81e1db6b-44f9-401b-8fd4-ec7bb23a1101';
raise exception 'Client delete unexpectedly allowed';
exception when insufficient_privilege then null; end;
end $verify$;
select set_config('request.jwt.claims','{"sub":"81e1db6b-44f9-401b-8fd4-ec7bb23a1102","role":"authenticated"}',true);
do $verify$
declare r jsonb; n integer;
begin
select count(*) into n from public.study_progress where user_id='81e1db6b-44f9-401b-8fd4-ec7bb23a1101';
if n <> 0 then raise exception 'Other user can read A'; end if;
update public.study_progress set revision=900 where user_id='81e1db6b-44f9-401b-8fd4-ec7bb23a1101';
get diagnostics n=row_count;
if n <> 0 then raise exception 'Other user can update A'; end if;
begin
insert into public.study_progress(user_id) values('81e1db6b-44f9-401b-8fd4-ec7bb23a1101');
raise exception 'Other user can insert as A';
exception when insufficient_privilege then null; end;
begin
perform public.study_sync_cas('81e1db6b-44f9-401b-8fd4-ec7bb23a1101',2,'{"schema":1,"cells":{}}');
raise exception 'Other user can call RPC as A';
exception when insufficient_privilege then null; end;
r := public.study_sync_cas('81e1db6b-44f9-401b-8fd4-ec7bb23a1102',0,'{"schema":1,"cells":{}}');
if r->>'ok' <> 'true' then raise exception 'B own write failed'; end if;
end $verify$;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $verify$
begin
begin
perform 1 from public.study_progress;
raise exception 'Anonymous read unexpectedly allowed';
exception when insufficient_privilege then null; end;
begin
perform public.study_sync_cas('81e1db6b-44f9-401b-8fd4-ec7bb23a1101',2,'{"schema":1,"cells":{}}');
raise exception 'Anonymous RPC unexpectedly allowed';
exception when insufficient_privilege then null; end;
end $verify$;
reset role;
select 'PASS: own read/write, stale CAS, cross-user read/update/insert/RPC, ownership transfer, delete and anonymous access' as verification,
(select revision from public.study_progress where user_id='81e1db6b-44f9-401b-8fd4-ec7bb23a1101') as unchanged_a_revision;
rollback;
