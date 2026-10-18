-- Prepared maintenance only; never an application RPC or automatic migration.
-- Replace BOTH placeholders using Clerk Production and the read-only role report.
-- Execute only after the operator explicitly confirms these two identities.
-- No trigger is disabled, no grants/RLS are changed and no history is rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $transfer$
declare
  expected_admin constant text := '__EXPECTED_ADMIN_SUBJECT__';
  production_admin constant text := '__PRODUCTION_ADMIN_SUBJECT__';
  table_owner text;
  actual_admin text;
  old_role text;
  target_role text;
  original_guard text;
  history_before jsonb;
  history_after jsonb;
  other_roles_before jsonb;
  other_roles_after jsonb;
begin
  if expected_admin !~ '^user_[A-Za-z0-9_-]+$'
     or production_admin !~ '^user_[A-Za-z0-9_-]+$'
     or expected_admin = production_admin then
    raise exception 'admin_transfer_requires_two_explicit_distinct_subjects';
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner) into table_owner
    from pg_catalog.pg_class c where c.oid = 'public.user_roles'::regclass;
  if current_user <> table_owner then
    raise exception 'admin_transfer_requires_table_owner';
  end if;

  -- Fail rather than wait on active business writes. Close operator tabs first.
  lock table public.orders, public.tickets in share mode nowait;
  lock table public.user_roles in share row exclusive mode nowait;

  if (select count(*) from public.user_roles where role = 'admin') <> 1 then
    raise exception 'admin_transfer_requires_exactly_one_current_admin';
  end if;
  select clerk_user_id into actual_admin from public.user_roles where role = 'admin';
  select role into old_role from public.user_roles where clerk_user_id = expected_admin;
  select role into target_role from public.user_roles where clerk_user_id = production_admin;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.user_roles'::regclass
      and t.tgname = 'user_roles_identity' and not t.tgisinternal
      and t.tgenabled in ('O', 'A')
      and t.tgfoid = 'diwo_private.protect_role_identity()'::regprocedure
  ) then
    raise exception 'admin_transfer_requires_existing_identity_protection';
  end if;
  select pg_catalog.pg_get_functiondef('diwo_private.protect_role_identity()'::regprocedure)
    into original_guard;

  if actual_admin = production_admin and old_role = 'user' then
    raise notice 'admin_transfer_already_completed_no_changes';
    return;
  end if;
  if actual_admin <> expected_admin or old_role <> 'admin'
     or (target_role is not null and target_role not in ('user', 'door_staff')) then
    raise exception 'admin_transfer_identity_or_state_mismatch';
  end if;

  select jsonb_build_object(
    'orders', (select md5(coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)::text) from public.orders o),
    'tickets', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)::text) from public.tickets t)
  ) into history_before;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.clerk_user_id), '[]'::jsonb)
    into other_roles_before from public.user_roles r
    where r.clerk_user_id not in (expected_admin, production_admin);

  -- Transaction-local, stricter guard: ONLY the table owner can demote exactly
  -- the expected identity, changing no field except role and its timestamp.
  -- Other sessions cannot see this uncommitted function definition. The exact
  -- original definition is restored BEFORE granting the new admin and commit.
  execute format($definition$
    create or replace function diwo_private.protect_role_identity()
    returns trigger language plpgsql security invoker set search_path = '' as $guard$
    begin
      if tg_op = 'UPDATE' and current_user = %L
         and old.clerk_user_id = %L and new.clerk_user_id = old.clerk_user_id
         and old.role = 'admin' and new.role = 'user'
         and (to_jsonb(new) - 'role' - 'updated_at') = (to_jsonb(old) - 'role' - 'updated_at') then
        new.updated_at := pg_catalog.clock_timestamp();
        return new;
      end if;
      raise exception using errcode = '23514', message = 'admin_transfer_exact_owner_operation_only';
    end $guard$;
  $definition$, table_owner, expected_admin);

  update public.user_roles set role = 'user' where clerk_user_id = expected_admin;
  execute original_guard;

  if target_role is null then
    insert into public.user_roles(clerk_user_id, role, assigned_by)
      values(production_admin, 'admin', expected_admin);
  else
    update public.user_roles set role = 'admin', assigned_by = expected_admin
      where clerk_user_id = production_admin;
  end if;

  select jsonb_build_object(
    'orders', (select md5(coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)::text) from public.orders o),
    'tickets', (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)::text) from public.tickets t)
  ) into history_after;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.clerk_user_id), '[]'::jsonb)
    into other_roles_after from public.user_roles r
    where r.clerk_user_id not in (expected_admin, production_admin);

  if history_before is distinct from history_after
     or other_roles_before is distinct from other_roles_after
     or original_guard is distinct from pg_catalog.pg_get_functiondef('diwo_private.protect_role_identity()'::regprocedure)
     or (select count(*) from public.user_roles where role = 'admin') <> 1
     or not exists (select 1 from public.user_roles where clerk_user_id = production_admin and role = 'admin')
     or not exists (select 1 from public.user_roles where clerk_user_id = expected_admin and role = 'user') then
    raise exception 'admin_transfer_postcondition_failed';
  end if;
  raise notice 'admin_transfer_completed_history_and_protection_preserved';
end $transfer$;

commit;
