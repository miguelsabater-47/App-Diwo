-- LOCAL REVIEW DRAFT. NOT applied hosted; NOT a migration-history entry.
-- Requires foundation and order-payment-rpcs (including lock_order_actor).
-- No seeds, new columns, policies, direct write grants or paid-history updates.
begin;

create or replace function diwo_private.close_order_request(target_order uuid, decision text)
returns table (order_id uuid, order_status text, closed_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor text := diwo_private.lock_order_actor(array['admin']);
  existing_order public.orders%rowtype;
begin
  if decision is null or decision not in ('cancelled', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_order_request';
  end if;
  -- Same lock order and parent lock as approval: role first, then order.
  select o.* into existing_order from public.orders o where o.id = target_order for update;
  if not found then
    raise exception using errcode = '22023', message = 'order_not_found';
  end if;
  if existing_order.status <> 'pending' and existing_order.status <> decision then
    raise exception using errcode = '22023', message = 'order_not_pending';
  end if;
  if exists (select 1 from public.tickets t where t.order_id = existing_order.id) then
    raise exception using errcode = '23514', message = 'order_ticket_count_mismatch';
  end if;
  if existing_order.status = 'pending' then
    update public.orders o set status = decision, closed_by = actor
      where o.id = existing_order.id returning o.* into existing_order;
    -- Existing guard records server time/verified actor, retains snapshot and notice.
  end if;
  -- Same-action retries are no-ops: preserve original operator, date and payload.
  -- Opposite-action retries and confirmed orders never change their state.
  return query select existing_order.id, existing_order.status, existing_order.closed_at;
end $$;

create or replace function public.cancel_order_request(target_order uuid)
returns table (order_id uuid, order_status text, closed_at timestamptz)
language sql volatile security invoker set search_path = '' as $$
  select * from diwo_private.close_order_request(target_order, 'cancelled')
$$;

create or replace function public.reject_order_request(target_order uuid)
returns table (order_id uuid, order_status text, closed_at timestamptz)
language sql volatile security invoker set search_path = '' as $$
  select * from diwo_private.close_order_request(target_order, 'rejected')
$$;

revoke all on function diwo_private.close_order_request(uuid,text),
  public.cancel_order_request(uuid), public.reject_order_request(uuid)
  from public, anon, authenticated, service_role;
grant execute on function diwo_private.close_order_request(uuid,text),
  public.cancel_order_request(uuid), public.reject_order_request(uuid) to authenticated;

commit;
