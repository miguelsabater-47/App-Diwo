-- Authorized exception: close NEW requests; existing requests may be approved up to 133.
-- Apply after event-ticket-capacity.sql. No orders, tickets or role grants are changed.
begin;

create or replace function diwo_private.guard_event_ticket_capacity()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare
  issued bigint;
begin
  if not exists (select 1 from public.events e
    where e.id = new.event_id and e.slug = 'diwo-x-2-2026') then return new; end if;

  -- Enforced at INSERT, including stale clients and direct RPC calls. Exact
  -- request replays return their existing receipt before INSERT and remain safe.
  if tg_op = 'INSERT' then
    raise exception using errcode = '22023', message = 'sales_closed';
  end if;
  if old.status <> 'pending' or new.status <> 'confirmed' then return new; end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '22023', message = 'capacity_isolation_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('diwo:ticket-capacity:' || new.event_id::text, 0));
  select pg_catalog.count(*) into issued from public.tickets t
    where t.event_id = new.event_id and t.status in ('valid', 'used');
  if issued + pg_catalog.cardinality(new.attendee_names) > 133 then
    raise exception using errcode = '22023', message = 'event_capacity_exceeded';
  end if;
  return new;
end $$;

create or replace function diwo_private.get_event_ticket_availability(target_event uuid)
returns table (capacity integer, remaining_tickets integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if diwo_private.current_clerk_subject() is null then
    raise exception using errcode = '42501', message = 'verified_clerk_identity_required';
  end if;
  -- Remaining request availability is zero, not unused approval headroom.
  -- Annulments/cancellations must never automatically reopen sales.
  return query select 133, 0 from public.events e where e.id = target_event
    and e.slug = 'diwo-x-2-2026' and e.is_published;
end $$;

commit;
