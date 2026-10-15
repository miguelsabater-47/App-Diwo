-- READ ONLY. Run before creation; retain results and repeat after manual closure.
-- Outputs no raw user subjects, credentials or QR. No fixture/event/role changes.
with paid as (
  select id,event_id,reference,buyer_name,attendee_names,quantity,total_cents,currency,
    status,payment_reported_at,confirmed_at,created_at,updated_at
  from public.orders
  where event_id='9d560641-aacf-4d25-8d65-94960bba59b2'::uuid and status='confirmed'
), retained_tickets as (
  select id,order_id,event_id,ticket_position,attendee_name,status,issued_at,used_at,revoked_at
  from public.tickets where event_id='9d560641-aacf-4d25-8d65-94960bba59b2'::uuid
)
select
  e.id as technical_event_id, e.slug, e.is_published,
  pg_catalog.clock_timestamp() >= e.sales_open_at as sales_time_reached,
  e.slug <> 'diwo-x-2-2026' as not_real_event,
  (select count(*) from paid) as retained_paid_order_count,
  (select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'[]')) from paid p) as retained_paid_fingerprint,
  (select count(*) from retained_tickets) as retained_ticket_count,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) from retained_tickets t) as retained_ticket_fingerprint,
  (select count(*) from public.orders where id in (
    'cb67be71-6b85-4c80-b234-70a920ba41e8'::uuid,
    '5856888b-18ee-4fb6-8e4f-ba6222e993ab'::uuid)) as closure_fixture_count
from public.events e where e.id='9d560641-aacf-4d25-8d65-94960bba59b2'::uuid;
