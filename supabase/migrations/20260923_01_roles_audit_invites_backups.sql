-- Applied to Supabase project School-Systems-EU on 2026-09-23 (migration security_roles_audit_invites_backups + security_scrub_audit_internal).
-- =====================================================================
-- Security layer 1: staff roles, invite PINs, audit log, error log,
-- Drive backup tokens, health check. (2FA enforcement is in layer 2.)
-- =====================================================================

-- ---------- Staff roles ----------
alter table public.staff
  add column if not exists user_id uuid unique references auth.users(id) on delete cascade,
  add column if not exists role text,
  add column if not exists active boolean not null default true,
  add column if not exists added_by text;
update public.staff s set user_id = u.id from auth.users u where lower(u.email) = lower(s.email) and s.user_id is null;
update public.staff set role = 'owner' where role is null;
alter table public.staff alter column role set not null;
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('owner','accountant','secretary'));

-- 2FA gate. Layer 2 replaces the body with an aal2 check.
create or replace function public.mfa_ok() returns boolean
language sql stable set search_path = '' as $$ select true $$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s
  where s.active and s.user_id = auth.uid() and public.mfa_ok()
  limit 1
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() is not null
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = any(roles), false)
$$;

-- ---------- Per-role row security ----------
do $$
declare t text;
begin
  foreach t in array array['students','payments','grades','attendance','subjects','academic_plan','settings','data_requests'] loop
    execute format('drop policy if exists staff_all on public.%I', t);
  end loop;
end $$;

-- students: everyone reads; owner+secretary add/edit; only owner deletes
create policy students_read   on public.students for select to authenticated using ((select public.has_role('owner','accountant','secretary')));
create policy students_insert on public.students for insert to authenticated with check ((select public.has_role('owner','secretary')));
create policy students_update on public.students for update to authenticated using ((select public.has_role('owner','secretary'))) with check ((select public.has_role('owner','secretary')));
create policy students_delete on public.students for delete to authenticated using ((select public.has_role('owner')));

-- payments: owner+accountant; only owner deletes
create policy payments_read   on public.payments for select to authenticated using ((select public.has_role('owner','accountant')));
create policy payments_insert on public.payments for insert to authenticated with check ((select public.has_role('owner','accountant')));
create policy payments_update on public.payments for update to authenticated using ((select public.has_role('owner','accountant'))) with check ((select public.has_role('owner','accountant')));
create policy payments_delete on public.payments for delete to authenticated using ((select public.has_role('owner')));

-- academic tables: owner+secretary
create policy grades_rw     on public.grades        for all to authenticated using ((select public.has_role('owner','secretary'))) with check ((select public.has_role('owner','secretary')));
create policy attendance_rw on public.attendance    for all to authenticated using ((select public.has_role('owner','secretary'))) with check ((select public.has_role('owner','secretary')));
create policy subjects_rw   on public.subjects      for all to authenticated using ((select public.has_role('owner','secretary'))) with check ((select public.has_role('owner','secretary')));
create policy plan_rw       on public.academic_plan for all to authenticated using ((select public.has_role('owner','secretary'))) with check ((select public.has_role('owner','secretary')));

-- settings: everyone reads, owner writes
create policy settings_read  on public.settings for select to authenticated using ((select public.has_role('owner','accountant','secretary')));
create policy settings_write on public.settings for all    to authenticated using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

-- data requests (erasure log): owner only
create policy data_requests_owner on public.data_requests for all to authenticated using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

-- staff list: owner reads; changes only through functions below
drop policy if exists staff_owner_read on public.staff;
create policy staff_owner_read on public.staff for select to authenticated using ((select public.has_role('owner')));

-- ---------- Audit log (append-only) ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_email text default (auth.jwt() ->> 'email'),
  role text,
  action text not null,
  table_name text,
  row_key text,
  student_id text,
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_student_idx on public.audit_log (student_id);
alter table public.audit_log enable row level security;
drop policy if exists audit_owner_read on public.audit_log;
create policy audit_owner_read on public.audit_log for select to authenticated using ((select public.has_role('owner')));
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare fo jsonb; fn jsonb; o jsonb; n jsonb; k text;
begin
  if current_setting('app.erasing', true) = '1' then return null; end if;
  if tg_op <> 'INSERT' then fo := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then fn := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(e.key, e.value) into o from jsonb_each(fo) e where fn -> e.key is distinct from e.value;
    select jsonb_object_agg(e.key, e.value) into n from jsonb_each(fn) e where fo -> e.key is distinct from e.value;
    if o is null and n is null then return null; end if;
  else
    o := fo; n := fn;
  end if;
  -- never keep password-like or hash columns in the log
  o := o - 'code_hash' - 'token_hash'; n := n - 'code_hash' - 'token_hash';
  k := coalesce(fn, fo) ->> tg_argv[0];
  insert into public.audit_log (role, action, table_name, row_key, student_id, old_data, new_data)
  values (public.my_role(), lower(tg_op), tg_table_name, k, coalesce(fn, fo) ->> 'student_id', o, n);
  return null;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('students','student_id'),('payments','transaction_id'),('grades','id'),('attendance','id'),
    ('subjects','id'),('academic_plan','id'),('settings','key'),('staff','email'),('data_requests','id')
  ) v(t, k) loop
    execute format('drop trigger if exists audit on public.%I', r.t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_trigger(%L)', r.t, r.k);
  end loop;
end $$;

-- Events the app reports (logins, exports, profile views, backups)
create or replace function public.log_event(p_action text, p_student_id text default null, p_detail jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action not in ('login','logout','view_student','export_student','backup_download','print_report','mfa_enrolled') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  insert into public.audit_log (role, action, student_id, new_data)
  values (public.my_role(), p_action, left(p_student_id, 50),
          case when p_detail is null then null else (select jsonb_object_agg(key, left(value::text, 200)) from jsonb_each(p_detail)) end);
end $$;

-- ---------- Invite PINs ----------
create table if not exists public.staff_invites (
  id bigint generated always as identity primary key,
  code_hash text not null,
  role text not null check (role in ('owner','accountant','secretary')),
  note text,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by text,
  revoked boolean not null default false
);
create unique index if not exists staff_invites_open_code on public.staff_invites (code_hash) where used_at is null and not revoked;
alter table public.staff_invites enable row level security;
drop policy if exists invites_owner_read on public.staff_invites;
create policy invites_owner_read on public.staff_invites for select to authenticated using ((select public.has_role('owner')));
revoke insert, update, delete, truncate on public.staff_invites from anon, authenticated;
drop trigger if exists audit on public.staff_invites;
create trigger audit after insert or update or delete on public.staff_invites for each row execute function public.audit_trigger('id');

create table if not exists public.invite_attempts (
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists invite_attempts_user_at on public.invite_attempts (user_id, at desc);
alter table public.invite_attempts enable row level security;
revoke all on public.invite_attempts from anon, authenticated;

create or replace function public.create_invite(p_role text, p_note text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare pin text; h text; exp timestamptz := now() + interval '48 hours';
begin
  if not public.has_role('owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role not in ('owner','accountant','secretary') then raise exception 'bad role' using errcode = '22023'; end if;
  loop
    pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 100000000)::text, 8, '0');
    h := encode(extensions.digest(pin, 'sha256'), 'hex');
    exit when not exists (select 1 from public.staff_invites where code_hash = h and used_at is null and not revoked);
  end loop;
  insert into public.staff_invites (code_hash, role, note, expires_at) values (h, p_role, left(p_note, 100), exp);
  return json_build_object('pin', pin, 'role', p_role, 'expires_at', exp);
end $$;

create or replace function public.revoke_invite(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.staff_invites set revoked = true where id = p_id and used_at is null;
end $$;

-- Called by a newly signed-up user to join the school with the PIN they were given.
create or replace function public.redeem_invite(p_pin text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); em text; inv public.staff_invites; fails int;
begin
  if uid is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select email into em from auth.users where id = uid;
  if exists (select 1 from public.staff where user_id = uid and active) then
    raise exception 'already a staff member' using errcode = '23505';
  end if;
  select count(*) into fails from public.invite_attempts where user_id = uid and not ok and at > now() - interval '15 minutes';
  if fails >= 5 then raise exception 'too many attempts' using errcode = 'P0001', hint = 'locked'; end if;
  select * into inv from public.staff_invites
   where code_hash = encode(extensions.digest(coalesce(p_pin, ''), 'sha256'), 'hex')
     and used_at is null and not revoked and expires_at > now()
   for update;
  if not found then
    insert into public.invite_attempts (user_id, ok) values (uid, false);
    return null;
  end if;
  insert into public.invite_attempts (user_id, ok) values (uid, true);
  update public.staff_invites set used_at = now(), used_by = em where id = inv.id;
  insert into public.staff (email, user_id, role, active, added_by)
  values (em, uid, inv.role, true, inv.created_by)
  on conflict (email) do update set user_id = excluded.user_id, role = excluded.role, active = true, added_by = excluded.added_by;
  return inv.role;
end $$;

-- Owner changes a staff member's role or removes them (cannot lock themselves out).
create or replace function public.set_staff(p_email text, p_role text, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.staff;
begin
  if not public.has_role('owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into target from public.staff where lower(email) = lower(p_email);
  if not found then raise exception 'staff not found' using errcode = 'P0002'; end if;
  if target.user_id = auth.uid() then raise exception 'cannot change your own account' using errcode = '22023'; end if;
  if p_role not in ('owner','accountant','secretary') then raise exception 'bad role' using errcode = '22023'; end if;
  update public.staff set role = p_role, active = p_active where email = target.email;
end $$;

-- Owner resets a staff member's 2FA (lost phone). They set it up again at next login.
create or replace function public.reset_staff_mfa(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.staff;
begin
  if not public.has_role('owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into target from public.staff where lower(email) = lower(p_email);
  if not found or target.user_id is null then raise exception 'staff not found' using errcode = 'P0002'; end if;
  if target.user_id = auth.uid() then raise exception 'cannot change your own account' using errcode = '22023'; end if;
  delete from auth.mfa_factors where user_id = target.user_id;
  insert into public.audit_log (role, action, row_key, table_name) values ('owner', 'mfa_reset', target.email, 'staff');
end $$;

-- Owner staff list with 2FA status
create or replace function public.staff_list()
returns table (email text, role text, active boolean, added_by text, created_at timestamptz, has_2fa boolean, last_sign_in timestamptz, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select s.email, s.role, s.active, s.added_by, s.created_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified'),
         u.last_sign_in_at, s.user_id = auth.uid()
  from public.staff s left join auth.users u on u.id = s.user_id
  where public.has_role('owner')
  order by s.active desc, s.created_at
$$;

-- ---------- Erasure now owner-only and scrubs the audit trail ----------
create or replace function public.erase_student(p_student_id text, p_requested_by text, p_note text)
returns json language plpgsql security definer set search_path = '' as $$
declare a int; g int; p int; s int;
begin
  if not public.has_role('owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('app.erasing', '1', true);
  delete from public.attendance where student_id = p_student_id; get diagnostics a = row_count;
  delete from public.grades where student_id = p_student_id; get diagnostics g = row_count;
  delete from public.payments where student_id = p_student_id; get diagnostics p = row_count;
  delete from public.students where student_id = p_student_id; get diagnostics s = row_count;
  if s = 0 then raise exception 'student not found' using errcode = 'P0002'; end if;
  perform public.scrub_audit(p_student_id);
  insert into public.data_requests (request_type, student_id, requested_by, note)
    values ('erase', p_student_id, left(p_requested_by, 200), left(p_note, 500));
  perform set_config('app.erasing', '0', true);
  insert into public.audit_log (role, action, table_name, row_key, student_id, new_data)
    values (public.my_role(), 'erase', 'students', p_student_id, p_student_id, json_build_object('attendance', a, 'grades', g, 'payments', p)::jsonb);
  return json_build_object('attendance', a, 'grades', g, 'payments', p);
end $$;

create or replace function public.scrub_audit(p_student_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.audit_log set old_data = null, new_data = null where student_id = p_student_id;
end $$;

-- ---------- Error log ----------
create table if not exists public.error_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_email text default (auth.jwt() ->> 'email'),
  method text, route text, status int, code text, message text
);
create index if not exists error_log_at_idx on public.error_log (at desc);
alter table public.error_log enable row level security;
drop policy if exists errors_owner_read on public.error_log;
create policy errors_owner_read on public.error_log for select to authenticated using ((select public.has_role('owner')));
revoke insert, update, delete, truncate on public.error_log from anon, authenticated;

create or replace function public.log_error(p_method text, p_route text, p_status int, p_code text, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if (select count(*) from public.error_log where at > now() - interval '1 minute') > 60 then return; end if;
  insert into public.error_log (method, route, status, code, message)
  values (left(p_method, 10), left(p_route, 200), p_status, left(p_code, 20), left(p_message, 300));
end $$;

-- ---------- Health check (public, reveals nothing) ----------
create or replace function public.health_check() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('ok', (select count(*) from public.error_log where status >= 500 and at > now() - interval '15 minutes') < 5)
$$;

-- ---------- Automatic backups to the school's own Google Drive ----------
create table if not exists public.backup_tokens (
  id bigint generated always as identity primary key,
  token_hash text not null unique,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false
);
alter table public.backup_tokens enable row level security;
drop policy if exists backup_tokens_owner_read on public.backup_tokens;
create policy backup_tokens_owner_read on public.backup_tokens for select to authenticated using ((select public.has_role('owner')));
revoke insert, update, delete, truncate on public.backup_tokens from anon, authenticated;

create or replace function public.create_backup_token() returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.has_role('owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.backup_tokens set revoked = true where not revoked;
  insert into public.backup_tokens (token_hash) values (encode(extensions.digest(tok, 'sha256'), 'hex'));
  insert into public.audit_log (role, action) values ('owner', 'backup_token_created');
  return tok;
end $$;

create or replace function public.revoke_backup_tokens() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.backup_tokens set revoked = true where not revoked;
  insert into public.audit_log (role, action) values ('owner', 'backup_token_revoked');
end $$;

create or replace function public.backup_export(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare t public.backup_tokens;
begin
  select * into t from public.backup_tokens
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and not revoked;
  if not found then
    perform pg_sleep(1);
    raise exception 'invalid backup token' using errcode = '42501';
  end if;
  update public.backup_tokens set last_used_at = now() where id = t.id;
  insert into public.audit_log (user_email, role, action) values ('google-drive-backup', null, 'auto_backup');
  return json_build_object(
    'exported_at', now(),
    'students', coalesce((select json_agg(x order by x.id) from public.students x), '[]'),
    'payments', coalesce((select json_agg(x order by x.id) from public.payments x), '[]'),
    'subjects', coalesce((select json_agg(x order by x.id) from public.subjects x), '[]'),
    'grades', coalesce((select json_agg(x order by x.id) from public.grades x), '[]'),
    'attendance', coalesce((select json_agg(x order by x.id) from public.attendance x), '[]'),
    'academic_plan', coalesce((select json_agg(x order by x.id) from public.academic_plan x), '[]'),
    'settings', coalesce((select json_agg(x) from public.settings x), '[]'),
    'data_requests', coalesce((select json_agg(x order by x.id) from public.data_requests x), '[]'),
    'terms_acceptances', coalesce((select json_agg(x order by x.id) from public.terms_acceptances x), '[]'),
    'staff', coalesce((select json_agg(json_build_object('email', s.email, 'role', s.role, 'active', s.active)) from public.staff s), '[]')
  );
end $$;

-- ---------- Function permissions ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.mfa_ok()','public.my_role()','public.is_staff()','public.has_role(text[])',
    'public.audit_trigger()','public.log_event(text,text,jsonb)','public.create_invite(text,text)',
    'public.revoke_invite(bigint)','public.redeem_invite(text)','public.set_staff(text,text,boolean)',
    'public.reset_staff_mfa(text)','public.staff_list()','public.erase_student(text,text,text)',
    'public.scrub_audit(text)','public.log_error(text,text,integer,text,text)','public.create_backup_token()',
    'public.revoke_backup_tokens()','public.health_check()','public.backup_export(text)',
    'public.dashboard_stats()','public.student_balances()','public.sync_student_number_seq()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke execute on function public.audit_trigger() from authenticated;
  grant execute on function public.health_check() to anon;
  grant execute on function public.backup_export(text) to anon;
end $$;

revoke execute on function public.scrub_audit(text) from authenticated, anon, public;
