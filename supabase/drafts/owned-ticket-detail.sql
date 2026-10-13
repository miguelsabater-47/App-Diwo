-- REVIEW DRAFT ONLY. Apply manually after the foundation and order RPC drafts.
-- Read-only: does not change orders, tickets, roles, events, or persisted tokens.
begin;

create or replace function diwo_private.read_owned_ticket(target_ticket uuid)
returns table (
  id uuid, order_id uuid, event_id uuid, attendee_name text, status text,
  issued_at timestamptz, used_at timestamptz, revoked_at timestamptz,
  qr_token text, event_slug text, event_title text, starts_at timestamptz,
  ends_at timestamptz, timezone text, public_location text,
  unit_price_cents integer, currency text, order_reference text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor text := diwo_private.current_clerk_subject();
  stored_role text;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'verified_clerk_identity_required';
  end if;
  select r.role into stored_role from public.user_roles r where r.clerk_user_id = actor;
  if coalesce(stored_role, 'user') not in ('user', 'admin', 'door_staff') then
    raise exception using errcode = '42501', message = 'operation_not_authorized';
  end if;

  return query
    select t.id, t.order_id, t.event_id, t.attendee_name, t.status,
      t.issued_at, t.used_at, t.revoked_at,
      case when t.status = 'valid' then t.qr_token else null end,
      e.slug, e.title, e.starts_at, e.ends_at, e.timezone, e.public_location,
      o.unit_price_cents, o.currency, o.reference
    from public.tickets t
    join public.orders o on o.id = t.order_id and o.event_id = t.event_id
    join public.events e on e.id = t.event_id
    where t.id = target_ticket
      and o.buyer_clerk_id = actor
      and o.status = 'confirmed';
end $$;

create or replace function public.read_owned_ticket(target_ticket uuid)
returns table (
  id uuid, order_id uuid, event_id uuid, attendee_name text, status text,
  issued_at timestamptz, used_at timestamptz, revoked_at timestamptz,
  qr_token text, event_slug text, event_title text, starts_at timestamptz,
  ends_at timestamptz, timezone text, public_location text,
  unit_price_cents integer, currency text, order_reference text
)
language sql stable security invoker set search_path = '' as $$
  select * from diwo_private.read_owned_ticket(target_ticket)
$$;

revoke all on function diwo_private.read_owned_ticket(uuid),
  public.read_owned_ticket(uuid) from public, anon, authenticated, service_role;
-- Required for the invoker wrapper to reach its private-schema implementation.
-- The schema remains outside PostgREST's exposed schemas.
grant execute on function diwo_private.read_owned_ticket(uuid) to authenticated;
grant execute on function public.read_owned_ticket(uuid) to authenticated;

commit;
