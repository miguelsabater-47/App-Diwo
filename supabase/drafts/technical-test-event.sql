-- Authorized technical fixture ONLY, 2026-10-12. Execute as postgres in App Diwo.
-- Published fictional metadata permits a signed RPC test before real sales open.
-- No real event, order, ticket, role, function or permission is modified here.
begin;
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'owner_execution_required';
  end if;
  lock table public.events in share row exclusive mode;
  insert into public.events(id, slug, title, public_location, sales_open_at,
    starts_at, ends_at, arrival_from, arrival_until, is_published)
  values (
    '9d560641-aacf-4d25-8d65-94960bba59b2', 'diwo-technical-test-20261012',
    'PRUEBA TÉCNICA — NO VÁLIDA PARA DIWO X 2.0', 'Evento ficticio de integración',
    '2020-01-01 20:00:00 Europe/Madrid', '2020-01-02 23:00:00 Europe/Madrid',
    '2020-01-03 07:00:00 Europe/Madrid', '2020-01-02 23:30:00 Europe/Madrid',
    '2020-01-03 01:30:00 Europe/Madrid', true
  ) on conflict (id) do nothing;
  -- Re-execution must preserve an exact fixture, never overwrite a conflicting row.
  if not exists (
    select 1 from public.events where id = '9d560641-aacf-4d25-8d65-94960bba59b2'
      and slug = 'diwo-technical-test-20261012'
      and title = 'PRUEBA TÉCNICA — NO VÁLIDA PARA DIWO X 2.0'
      and public_location = 'Evento ficticio de integración'
      and timezone = 'Europe/Madrid' and unit_price_cents = 500 and currency = 'EUR'
      and sales_open_at = '2020-01-01 20:00:00 Europe/Madrid'::timestamptz
      and starts_at = '2020-01-02 23:00:00 Europe/Madrid'::timestamptz
      and ends_at = '2020-01-03 07:00:00 Europe/Madrid'::timestamptz
      and arrival_from = '2020-01-02 23:30:00 Europe/Madrid'::timestamptz
      and arrival_until = '2020-01-03 01:30:00 Europe/Madrid'::timestamptz
      and is_published
  ) then
    raise exception 'technical_fixture_conflict';
  end if;
end $$;
select id as technical_event_id, title, is_published,
  sales_open_at < clock_timestamp() as technical_sales_open
from public.events where id = '9d560641-aacf-4d25-8d65-94960bba59b2';
commit;
