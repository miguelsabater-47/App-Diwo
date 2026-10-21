-- DIWO X 2.0 capacity: pending requests do not reserve places.
-- Existing RPCs, role checks, reference generation and exact replays stay intact.
begin;

create function diwo_private.guard_event_ticket_capacity()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare
  issued bigint;
begin
  if tg_op = 'UPDATE' then
    if old.status <> 'pending' or new.status <> 'confirmed' then return new; end if;
  end if;
  if not exists (select 1 from public.events e
    where e.id = new.event_id and e.slug = 'diwo-x-2-2026') then return new; end if;

  -- A fresh count after the per-event lock is required. Fail closed for callers
  -- choosing a frozen snapshot instead of the API's READ COMMITTED isolation.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '22023', message = 'capacity_isolation_required';
  end if;
  -- Actor/order locks are already held by the existing writers. Acquire this
  -- lock before ticket issuance; no ticket row locks or event lock upgrades.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('diwo:ticket-capacity:' || new.event_id::text, 0));
  select pg_catalog.count(*) into issued from public.tickets t
    where t.event_id = new.event_id and t.status in ('valid', 'used');
  if issued + pg_catalog.cardinality(new.attendee_names) > 131 then
    raise exception using errcode = '22023', message = 'event_capacity_exceeded';
  end if;
  return new;
end $$;

create trigger orders_event_ticket_capacity
before insert or update of status on public.orders
for each row execute function diwo_private.guard_event_ticket_capacity();

-- Only the aggregate is exposed: never attendees, buyers, QR tokens or payments.
create function diwo_private.get_event_ticket_availability(target_event uuid)
returns table (capacity integer, remaining_tickets integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if diwo_private.current_clerk_subject() is null then
    raise exception using errcode = '42501', message = 'verified_clerk_identity_required';
  end if;
  return query select 131, greatest(0, 131 - (
    select pg_catalog.count(*)::integer from public.tickets t
    where t.event_id = e.id and t.status in ('valid', 'used')))
    from public.events e where e.id = target_event
      and e.slug = 'diwo-x-2-2026' and e.is_published;
end $$;

create function public.get_event_ticket_availability(target_event uuid)
returns table (capacity integer, remaining_tickets integer)
language sql stable security invoker set search_path = '' as $$
  select * from diwo_private.get_event_ticket_availability(target_event)
$$;

revoke all on function diwo_private.guard_event_ticket_capacity(),
  diwo_private.get_event_ticket_availability(uuid),
  public.get_event_ticket_availability(uuid) from public, anon, authenticated, service_role;
grant execute on function diwo_private.get_event_ticket_availability(uuid),
  public.get_event_ticket_availability(uuid) to authenticated;

commit;
