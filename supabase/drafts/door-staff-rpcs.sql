-- LOCAL REVIEW DRAFT. Not applied hosted; not a migration-history entry.
-- Requires foundation and lock_order_actor from order-payment-rpcs.sql.
-- Clerk registration/verified-email resolution is server-side, never from metadata.
-- No seeds, new tables/columns, admin changes or direct table-write grants.
begin;

create or replace function diwo_private.staff_reference(subject text)
returns text language sql immutable strict set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('diwo:staff:' || subject,'UTF8')),'hex')
$$;

create or replace function diwo_private.read_staff_target(target_subject text)
returns table (staff_id text, app_role text, version timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform diwo_private.lock_order_actor(array['admin']);
  if target_subject is null or target_subject !~ '^user_[A-Za-z0-9_-]+$' then
    raise exception using errcode='22023', message='invalid_staff_request';
  end if;
  return query select diwo_private.staff_reference(target_subject), coalesce(r.role,'user'), r.updated_at
    from (values(target_subject)) as target(subject)
    left join public.user_roles r on r.clerk_user_id=target.subject;
end $$;

-- Internal primitive: only the definer entry points below may call this function.
create or replace function diwo_private.set_door_role(target_subject text, enabled boolean, expected_version timestamptz)
returns table (staff_id text, app_role text, version timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor text := diwo_private.lock_order_actor(array['admin']);
  current_row public.user_roles%rowtype;
  desired text := case when enabled then 'door_staff' else 'user' end;
begin
  if target_subject is null or target_subject !~ '^user_[A-Za-z0-9_-]+$' or enabled is null then
    raise exception using errcode='22023', message='invalid_staff_request';
  end if;
  -- Lock actor first, then target gap, then target row. Protect a first assignment
  -- too; ordinary sensitive operations hold SHARE on this same target role row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('diwo:staff:' || target_subject,0));
  select r.* into current_row from public.user_roles r where r.clerk_user_id=target_subject for update;
  if target_subject=actor or current_row.role='admin' then
    raise exception using errcode='22023', message='admin_identity_is_protected';
  end if;
  if current_row.role=desired then
    return query select diwo_private.staff_reference(target_subject), current_row.role, current_row.updated_at;
    return;
  end if;
  if current_row.updated_at is distinct from expected_version then
    raise exception using errcode='22023', message='staff_state_changed';
  end if;
  if current_row.clerk_user_id is null then
    insert into public.user_roles(clerk_user_id,role,assigned_by)
      values(target_subject,desired,actor) returning * into current_row;
  else
    update public.user_roles r set role=desired,assigned_by=actor
      where r.clerk_user_id=target_subject returning r.* into current_row;
  end if;
  return query select diwo_private.staff_reference(target_subject), current_row.role, current_row.updated_at;
end $$;

create or replace function diwo_private.grant_door_staff(target_subject text, expected_version timestamptz)
returns table (staff_id text, app_role text, version timestamptz)
language sql volatile security definer set search_path = '' as $$
  select * from diwo_private.set_door_role(target_subject,true,expected_version)
$$;

create or replace function diwo_private.revoke_door_staff(target_staff_id text, expected_version timestamptz)
returns table (staff_id text, app_role text, version timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare target_subject text;
begin
  perform diwo_private.lock_order_actor(array['admin']);
  if target_staff_id is null or target_staff_id !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='invalid_staff_request';
  end if;
  select r.clerk_user_id into target_subject from public.user_roles r
    where diwo_private.staff_reference(r.clerk_user_id)=target_staff_id;
  if target_subject is null then
    raise exception using errcode='22023', message='staff_account_not_found';
  end if;
  return query select * from diwo_private.set_door_role(target_subject,false,expected_version);
end $$;

-- Raw subjects stay on the server when joining the Clerk directory to these rows.
-- total_count detects an upstream row limit rather than presenting a partial list.
create or replace function diwo_private.list_door_staff()
returns table (staff_id text, clerk_subject text, version timestamptz, total_count bigint)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform diwo_private.lock_order_actor(array['admin']);
  return query select diwo_private.staff_reference(r.clerk_user_id),r.clerk_user_id,r.updated_at,count(*) over()
    from public.user_roles r where r.role='door_staff' order by r.created_at,r.clerk_user_id;
end $$;

create or replace function public.read_staff_target(target_subject text)
returns table (staff_id text, app_role text, version timestamptz)
language sql volatile security invoker set search_path = '' as $$
  select * from diwo_private.read_staff_target(target_subject)
$$;
create or replace function public.grant_door_staff(target_subject text, expected_version timestamptz)
returns table (staff_id text, app_role text, version timestamptz)
language sql volatile security invoker set search_path = '' as $$
  select * from diwo_private.grant_door_staff(target_subject,expected_version)
$$;
create or replace function public.revoke_door_staff(target_staff_id text, expected_version timestamptz)
returns table (staff_id text, app_role text, version timestamptz)
language sql volatile security invoker set search_path = '' as $$
  select * from diwo_private.revoke_door_staff(target_staff_id,expected_version)
$$;
create or replace function public.list_door_staff()
returns table (staff_id text, clerk_subject text, version timestamptz, total_count bigint)
language sql volatile security invoker set search_path = '' as $$
  select * from diwo_private.list_door_staff()
$$;

revoke all on function diwo_private.staff_reference(text),diwo_private.set_door_role(text,boolean,timestamptz),
  diwo_private.read_staff_target(text),diwo_private.grant_door_staff(text,timestamptz),
  diwo_private.revoke_door_staff(text,timestamptz),diwo_private.list_door_staff(),
  public.read_staff_target(text),public.grant_door_staff(text,timestamptz),
  public.revoke_door_staff(text,timestamptz),public.list_door_staff()
  from public,anon,authenticated,service_role;
grant execute on function diwo_private.read_staff_target(text),diwo_private.grant_door_staff(text,timestamptz),
  diwo_private.revoke_door_staff(text,timestamptz),diwo_private.list_door_staff(),
  public.read_staff_target(text),public.grant_door_staff(text,timestamptz),
  public.revoke_door_staff(text,timestamptz),public.list_door_staff() to authenticated;
commit;
