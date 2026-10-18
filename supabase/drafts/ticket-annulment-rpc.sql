-- LOCAL DRAFT. Not applied hosted. Requires foundation + lock_order_actor.
-- Individual unused ticket only. Never delete/reset paid history or refund money.
begin;
create or replace function diwo_private.revoke_issued_ticket(target_ticket uuid)
returns table(ticket_id uuid, ticket_status text, revoked_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor text := diwo_private.lock_order_actor(array['admin']);
  candidate public.tickets%rowtype;
  parent public.orders%rowtype;
begin
  if target_ticket is null then
    raise exception using errcode='22023',message='invalid_ticket_request';
  end if;
  -- Initial lookup provides immutable identity only, never a decision on status.
  select t.* into candidate from public.tickets t where t.id=target_ticket;
  if not found then raise exception using errcode='22023',message='ticket_not_found'; end if;
  -- Same lock order as check-in: actor -> event -> order -> ticket.
  perform 1 from public.events e where e.id=candidate.event_id for share;
  select o.* into parent from public.orders o where o.id=candidate.order_id for update;
  select t.* into candidate from public.tickets t where t.id=target_ticket for update;
  if parent.status<>'confirmed' or parent.event_id<>candidate.event_id then
    raise exception using errcode='23514',message='invalid_ticket_parent';
  end if;
  if candidate.status='used' then
    raise exception using errcode='22023',message='ticket_already_used';
  elsif candidate.status='valid' then
    update public.tickets t set status='revoked',revoked_by=actor,
      revoked_reason='Anulada individualmente por administración'
      where t.id=target_ticket returning t.* into candidate;
  elsif candidate.status<>'revoked' then
    raise exception using errcode='23514',message='invalid_ticket_state';
  end if;
  -- Repeating the same ticket returns its original audit, without another update.
  return query select candidate.id,candidate.status,candidate.revoked_at;
end $$;
create or replace function public.revoke_issued_ticket(target_ticket uuid)
returns table(ticket_id uuid, ticket_status text, revoked_at timestamptz)
language sql volatile security invoker set search_path = '' as $$
  select * from diwo_private.revoke_issued_ticket(target_ticket)
$$;
revoke all on function public.revoke_issued_ticket(uuid),diwo_private.revoke_issued_ticket(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.revoke_issued_ticket(uuid),diwo_private.revoke_issued_ticket(uuid)
  to authenticated;
commit;
