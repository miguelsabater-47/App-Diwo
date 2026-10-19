-- LOCAL DRAFT ONLY. Requires the foundation and order/payment RPCs.
-- Deploy the compatible application readers BEFORE applying this in a separately
-- authorized hosted transaction. No existing references, rows, grants or QR change.
begin;

-- Four independent 5-bit samples from random UUIDv4 bytes: 32^4 combinations.
-- Exclude 0/1/I/O. A payment reference is NOT an authorization or QR credential.
create function diwo_private.generate_order_reference()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  result text := '';
  position integer;
begin
  for position in 0..3 loop
    result := result || pg_catalog.substr(alphabet, (pg_catalog.get_byte(bytes, position) & 31) + 1, 1);
  end loop;
  return result;
end $$;
revoke all on function diwo_private.generate_order_reference() from public, anon, authenticated, service_role;

alter table public.orders alter column reference set default diwo_private.generate_order_reference();

-- Preserve actor/role checks, lock ordering and exact same-ID replay. Only an
-- actual reference conflict is retried INSIDE this transaction; never a new HTTP
-- write, request UUID, modified payload or overwrite of the conflicting order.
create or replace function diwo_private.create_order_request(
  request_id uuid, target_event uuid, request_buyer_name text, request_attendee_names text[]
)
returns table (order_id uuid, order_reference text, order_status text,
  ticket_quantity integer, total_cents bigint)
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor text := diwo_private.lock_order_actor(array['user', 'door_staff', 'admin']);
  cleaned_buyer text := pg_catalog.btrim(request_buyer_name);
  cleaned_names text[];
  existing_order public.orders%rowtype;
  attempt integer;
begin
  if request_id is null or target_event is null or cleaned_buyer is null or cleaned_buyer = ''
     or diwo_private.valid_attendee_names(request_attendee_names) is not true then
    raise exception using errcode = '22023', message = 'invalid_order_request';
  end if;
  select pg_catalog.array_agg(pg_catalog.btrim(n.name) order by n.position)
    into cleaned_names from pg_catalog.unnest(request_attendee_names)
      with ordinality as n(name, position);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('diwo:create-order:' || request_id::text, 0));
  select o.* into existing_order from public.orders o where o.id = request_id for update;
  if found then
    if existing_order.buyer_clerk_id <> actor or existing_order.event_id <> target_event
       or existing_order.buyer_name <> cleaned_buyer
       or existing_order.attendee_names is distinct from cleaned_names then
      raise exception using errcode = '22023', message = 'request_id_conflict';
    end if;
    return query select existing_order.id, existing_order.reference,
      existing_order.status, existing_order.quantity, existing_order.total_cents;
    return;
  end if;

  perform 1 from public.events e where e.id = target_event
    and e.is_published and pg_catalog.clock_timestamp() >= e.sales_open_at for share;
  if not found then
    raise exception using errcode = '22023', message = 'sales_not_open';
  end if;
  for attempt in 1..16 loop
    insert into public.orders(id, event_id, buyer_clerk_id, buyer_name, attendee_names)
      values(request_id, target_event, actor, cleaned_buyer, cleaned_names)
      on conflict on constraint orders_reference_key do nothing
      returning * into existing_order;
    if found then
      return query select existing_order.id, existing_order.reference,
        existing_order.status, existing_order.quantity, existing_order.total_cents;
      return;
    end if;
  end loop;
  raise exception using errcode = '54000', message = 'order_reference_generation_failed';
end $$;

-- CREATE OR REPLACE preserves the existing RPC's owner and execution ACL.
-- No public wrapper, API grant, RLS policy, guard or history protection changes.
commit;
