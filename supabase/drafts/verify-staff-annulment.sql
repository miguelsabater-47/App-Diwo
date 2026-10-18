-- READ ONLY. App Diwo original, dujltrbvytsnftlfitbd, SQL Editor as postgres.
-- No identities, QR tokens, attendee data, grants or writes.
with expected(signature,definer,client_execute) as (values
  ('public.read_staff_target(text)',false,true),
  ('public.grant_door_staff(text,timestamp with time zone)',false,true),
  ('public.revoke_door_staff(text,timestamp with time zone)',false,true),
  ('public.list_door_staff()',false,true),
  ('public.revoke_issued_ticket(uuid)',false,true),
  ('diwo_private.staff_reference(text)',false,false),
  ('diwo_private.set_door_role(text,boolean,timestamp with time zone)',true,false),
  ('diwo_private.read_staff_target(text)',true,true),
  ('diwo_private.grant_door_staff(text,timestamp with time zone)',true,true),
  ('diwo_private.revoke_door_staff(text,timestamp with time zone)',true,true),
  ('diwo_private.list_door_staff()',true,true),
  ('diwo_private.revoke_issued_ticket(uuid)',true,true)
), catalog as (
  select e.*,p.oid,p.prosecdef,p.proconfig,p.proacl,p.proowner
  from expected e left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)
)
select
  (select count(oid)=12 from catalog) as all_12_functions_present,
  (select bool_and(oid is not null and prosecdef=definer and
    coalesce(proconfig @> array['search_path=""'],false)) from catalog) as execution_modes_and_paths_ok,
  (select bool_and(oid is not null and
    pg_catalog.has_function_privilege('authenticated',oid,'execute')=client_execute)
    from catalog) as authenticated_permissions_ok,
  (select bool_and(oid is not null and
    not pg_catalog.has_function_privilege('anon',oid,'execute') and
    not pg_catalog.has_function_privilege('service_role',oid,'execute') and
    not exists(select 1 from pg_catalog.aclexplode(coalesce(proacl,pg_catalog.acldefault('f',proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE')) from catalog) as public_anon_service_denied,
  not exists(select 1 from (values('public.user_roles'),('public.orders'),('public.tickets')) t(name)
    cross join (values('anon'),('authenticated'),('service_role')) r(name)
    where pg_catalog.has_table_privilege(r.name,t.name,'insert,update,delete')) as no_direct_writes,
  not pg_catalog.has_column_privilege('authenticated','public.tickets','qr_token','select') as private_qr_not_selectable,
  pg_catalog.obj_description(pg_catalog.to_regnamespace('diwo_private'),'pg_namespace') is distinct from
    'DIWO_SCANNER_TEST_ONLY_V1 - isolated empty scanner project' as not_scanner_sandbox,
  (select count(*) from public.user_roles where role='admin') as admin_count,
  (select count(*) from public.user_roles where role='door_staff') as staff_count,
  (select count(*) from public.orders where status='confirmed') as paid_orders,
  (select count(*) from public.tickets) as retained_tickets,
  (select count(*) from public.tickets where status='used') as used_tickets,
  (select count(*) from public.tickets where status='revoked') as revoked_tickets,
  (select count(*) from public.events where slug='diwo-x-2-2026' and is_published) as actual_published_events;
