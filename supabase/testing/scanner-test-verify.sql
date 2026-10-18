-- Read-only verification. ONLY in diwo-scanner-test AFTER installer Success.
with expected(signature, definer) as (
  values
    ('public.read_door_event()', false),
    ('public.check_in_ticket(uuid,text)', false),
    ('diwo_private.read_door_event()', true),
    ('diwo_private.check_in_ticket(uuid,text)', true)
), functions as (
  select e.*, p.oid, p.prosecdef, p.proconfig
  from expected e left join pg_catalog.pg_proc p
    on p.oid=pg_catalog.to_regprocedure(e.signature)
), tables as (
  select c.oid, c.relrowsecurity from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'
    and c.relname in ('events','orders','tickets','user_roles')
)
select
  coalesce(pg_catalog.obj_description(pg_catalog.to_regnamespace('diwo_private'), 'pg_namespace')
    = 'DIWO_SCANNER_TEST_ONLY_V1 - isolated empty scanner project', false) as test_marker_ok,
  (select count(*)=4 and bool_and(relrowsecurity) from tables) as tables_rls_ok,
  (select count(*) filter(where oid is not null and prosecdef=definer
    and coalesce('search_path=""'=any(proconfig),false))=4 from functions) as scanner_functions_ok,
  (select bool_and(oid is not null
    and coalesce(has_function_privilege('authenticated',oid,'EXECUTE'),false)
    and not coalesce(has_function_privilege('anon',oid,'EXECUTE'),true)
    and not coalesce(has_function_privilege('service_role',oid,'EXECUTE'),true)) from functions) as scanner_access_ok,
  not has_column_privilege('authenticated','public.tickets','qr_token','SELECT') as private_qr_blocked,
  (select bool_and(not has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE')) from tables) as direct_writes_blocked,
  not has_function_privilege('authenticated','diwo_private.lock_order_actor(text[])','EXECUTE') as actor_helper_blocked,
  (select count(*)=0 from public.user_roles) as no_users,
  (select count(*)=0 from public.events) as no_events,
  (select count(*)=0 from public.orders) as no_orders,
  (select count(*)=0 from public.tickets) as no_tickets;
