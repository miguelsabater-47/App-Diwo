-- LOCAL REVIEW DRAFT ONLY. Not applied hosted, no fixtures or history changes.
-- Requires foundation and order-payment's lock_order_actor. No direct write grants.
begin;

create or replace function diwo_private.read_door_event()
returns table(event_id uuid, event_title text, used_admissions bigint, pending_admissions bigint, issued_non_revoked bigint)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform diwo_private.lock_order_actor(array['admin','door_staff']);
  return query select e.id,e.title,
    count(t.id) filter(where t.status='used'),
    count(t.id) filter(where t.status='valid'),
    count(t.id) filter(where t.status in ('valid','used'))
    from public.events e left join public.tickets t on t.event_id=e.id
    where e.slug='diwo-x-2-2026' and e.is_published group by e.id,e.title;
end $$;

create or replace function diwo_private.check_in_ticket(target_event uuid, scanned_token text)
returns table(outcome text, ticket_id uuid, attendee_name text, used_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor text := diwo_private.lock_order_actor(array['admin','door_staff']);
  candidate public.tickets%rowtype;
  parent public.orders%rowtype;
begin
  if target_event is null or scanned_token is null or scanned_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid_scan_request';
  end if;
  -- This is never a publication action, technical-event fallback or time cutoff.
  perform 1 from public.events e where e.id=target_event and e.slug='diwo-x-2-2026' and e.is_published for share;
  if not found then raise exception using errcode='22023',message='door_event_unavailable'; end if;
  select t.* into candidate from public.tickets t where t.qr_token=scanned_token;
  if not found then return query select 'unknown'::text,null::uuid,null::text,null::timestamptz; return; end if;
  if candidate.event_id<>target_event then
    return query select 'wrong_event'::text,null::uuid,null::text,null::timestamptz; return;
  end if;
  -- Same ordering as approval and future annulment: role -> event -> order -> ticket.
  -- The first lookup is immutable identity only. ALWAYS read live status after locks.
  select o.* into parent from public.orders o where o.id=candidate.order_id for update;
  select t.* into candidate from public.tickets t where t.id=candidate.id for update;
  if parent.status<>'confirmed' or parent.event_id<>target_event then
    raise exception using errcode='23514',message='invalid_ticket_parent';
  end if;
  if candidate.status='valid' then
    update public.tickets t set status='used',used_by=actor where t.id=candidate.id returning t.* into candidate;
    return query select 'admitted'::text,candidate.id,candidate.attendee_name,candidate.used_at;
  elsif candidate.status='used' then
    return query select 'already_used'::text,candidate.id,candidate.attendee_name,candidate.used_at;
  elsif candidate.status='revoked' then
    return query select 'revoked'::text,candidate.id,candidate.attendee_name,null::timestamptz;
  else
    raise exception using errcode='23514',message='invalid_ticket_state';
  end if;
end $$;

create or replace function public.read_door_event()
returns table(event_id uuid, event_title text, used_admissions bigint, pending_admissions bigint, issued_non_revoked bigint)
language sql volatile security invoker set search_path = '' as $$ select * from diwo_private.read_door_event() $$;
create or replace function public.check_in_ticket(target_event uuid, scanned_token text)
returns table(outcome text, ticket_id uuid, attendee_name text, used_at timestamptz)
language sql volatile security invoker set search_path = '' as $$ select * from diwo_private.check_in_ticket(target_event,scanned_token) $$;

revoke all on function public.read_door_event(),diwo_private.read_door_event(),
  public.check_in_ticket(uuid,text),diwo_private.check_in_ticket(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.read_door_event(),diwo_private.read_door_event(),
  public.check_in_ticket(uuid,text),diwo_private.check_in_ticket(uuid,text) to authenticated;
commit;
