-- REVIEW DRAFT ONLY. Not applied remotely; not a migration or an event seed.
-- Requires the applied foundation. No new tables or direct client write grants.
-- Public invoker wrappers expose narrow private definers, never owner fallback.

-- All writers lock the actor role first, then request/order, then child tickets.
-- Role updates/deletes wait for the operation's transaction; the next call reads
-- the new role. No JWT application-role claims or editable metadata are used.
create function diwo_private.lock_order_actor(allowed_roles text[])
returns text language plpgsql volatile set search_path = '' as $$
declare
  actor text := diwo_private.current_clerk_subject();
  stored_role text;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'verified_clerk_identity_required';
  end if;
  select r.role into stored_role from public.user_roles r
    where r.clerk_user_id = actor for share;
  if not coalesce(coalesce(stored_role, 'user') = any(allowed_roles), false) then
    raise exception using errcode = '42501', message = 'operation_not_authorized';
  end if;
  return actor;
end $$;

-- request_id is a client-generated UUIDv4, reused ONLY for this same submission.
-- It becomes the existing immutable order primary key: no extra ledger/table.
-- Reusing it with different payload/owner is rejected without disclosing rows.
create function diwo_private.create_order_request(
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
begin
  if request_id is null or target_event is null or cleaned_buyer is null or cleaned_buyer = ''
     or diwo_private.valid_attendee_names(request_attendee_names) is not true then
    raise exception using errcode = '22023', message = 'invalid_order_request';
  end if;
  select pg_catalog.array_agg(pg_catalog.btrim(n.name) order by n.position)
    into cleaned_names from pg_catalog.unnest(request_attendee_names)
      with ordinality as n(name, position);

  -- Serialize creation while no order row exists. Transaction lock is released
  -- automatically at commit/rollback; hash collisions only serialize extra work.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('diwo:create-order:' || request_id::text, 0));
  select o.* into existing_order from public.orders o where o.id = request_id for update;
  if found then
    if existing_order.buyer_clerk_id <> actor or existing_order.event_id <> target_event
       or existing_order.buyer_name <> cleaned_buyer
       or existing_order.attendee_names is distinct from cleaned_names then
      raise exception using errcode = '22023', message = 'request_id_conflict';
    end if;
    -- A retry can read the original result even after approval/closing sales.
    return query select existing_order.id, existing_order.reference,
      existing_order.status, existing_order.quantity, existing_order.total_cents;
    return;
  end if;

  perform 1 from public.events e where e.id = target_event
    and e.is_published and pg_catalog.clock_timestamp() >= e.sales_open_at for share;
  if not found then
    raise exception using errcode = '22023', message = 'sales_not_open';
  end if;
  -- Foundation trigger rechecks publication/sales and immutable 500-cent price.
  insert into public.orders(id, event_id, buyer_clerk_id, buyer_name, attendee_names)
    values(request_id, target_event, actor, cleaned_buyer, cleaned_names)
    returning * into existing_order;
  return query select existing_order.id, existing_order.reference,
    existing_order.status, existing_order.quantity, existing_order.total_cents;
end $$;

create function diwo_private.report_order_payment(target_order uuid)
returns table (order_id uuid, order_status text, payment_reported_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor text := diwo_private.lock_order_actor(array['user', 'door_staff', 'admin']);
  existing_order public.orders%rowtype;
begin
  select o.* into existing_order from public.orders o
    where o.id = target_order and o.buyer_clerk_id = actor for update;
  if not found then
    raise exception using errcode = '22023', message = 'order_not_found';
  end if;
  if existing_order.status not in ('pending', 'confirmed') then
    raise exception using errcode = '22023', message = 'order_not_pending';
  end if;
  -- Notice never confirms payment. An already approved order is a safe no-op.
  if existing_order.status = 'pending' and existing_order.payment_reported_at is null then
    update public.orders o set payment_reported_at = pg_catalog.clock_timestamp()
      where o.id = target_order returning o.* into existing_order;
  end if;
  return query select existing_order.id, existing_order.status, existing_order.payment_reported_at;
end $$;

create function diwo_private.approve_order_payment(target_order uuid)
returns table (order_id uuid, order_status text, confirmed_at timestamptz,
  issued_ticket_count bigint)
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor text := diwo_private.lock_order_actor(array['admin']);
  existing_order public.orders%rowtype;
  issued_count bigint;
begin
  select o.* into existing_order from public.orders o where o.id = target_order for update;
  if not found then
    raise exception using errcode = '22023', message = 'order_not_found';
  end if;
  if existing_order.status not in ('pending', 'confirmed') then
    raise exception using errcode = '22023', message = 'order_not_pending';
  end if;
  if existing_order.status = 'pending' then
    update public.orders o set status = 'confirmed', confirmed_by = actor
      where o.id = target_order returning o.* into existing_order;
    insert into public.tickets(order_id, event_id, ticket_position, attendee_name)
      select existing_order.id, existing_order.event_id, n.position::integer, n.name
      from pg_catalog.unnest(existing_order.attendee_names)
        with ordinality as n(name, position) order by n.position;
  end if;
  select pg_catalog.count(*) into issued_count from public.tickets t
    where t.order_id = existing_order.id;
  if issued_count <> existing_order.quantity then
    raise exception using errcode = '23514', message = 'order_ticket_count_mismatch';
  end if;
  -- Repeats preserve original payment/operator/time and ALL issued identities,
  -- including tickets subsequently used/annulled. Never reactivate or duplicate.
  return query select existing_order.id, existing_order.status,
    existing_order.confirmed_at, issued_count;
end $$;

create function public.create_order_request(
  request_id uuid, target_event uuid, request_buyer_name text, request_attendee_names text[]
)
returns table (order_id uuid, order_reference text, order_status text,
  ticket_quantity integer, total_cents bigint)
language sql volatile set search_path = '' as $$
  select * from diwo_private.create_order_request(
    request_id, target_event, request_buyer_name, request_attendee_names)
$$;

create function public.report_order_payment(target_order uuid)
returns table (order_id uuid, order_status text, payment_reported_at timestamptz)
language sql volatile set search_path = '' as $$
  select * from diwo_private.report_order_payment(target_order)
$$;

create function public.approve_order_payment(target_order uuid)
returns table (order_id uuid, order_status text, confirmed_at timestamptz,
  issued_ticket_count bigint)
language sql volatile set search_path = '' as $$
  select * from diwo_private.approve_order_payment(target_order)
$$;

revoke all on function diwo_private.lock_order_actor(text[]) from public, anon, authenticated, service_role;
revoke all on function diwo_private.create_order_request(uuid,uuid,text,text[]),
  diwo_private.report_order_payment(uuid), diwo_private.approve_order_payment(uuid),
  public.create_order_request(uuid,uuid,text,text[]), public.report_order_payment(uuid),
  public.approve_order_payment(uuid) from public, anon, authenticated, service_role;
grant execute on function diwo_private.create_order_request(uuid,uuid,text,text[]),
  diwo_private.report_order_payment(uuid), diwo_private.approve_order_payment(uuid),
  public.create_order_request(uuid,uuid,text,text[]), public.report_order_payment(uuid),
  public.approve_order_payment(uuid) to authenticated;
