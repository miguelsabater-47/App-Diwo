-- READ ONLY. Run after creation and again after closing through the signed UI.
-- Missing/changed fixture data is a failure, not permission to reset/reseed it.
with expected(id,expected_status,buyer_name,attendee_name) as (
  values
    ('cb67be71-6b85-4c80-b234-70a920ba41e8'::uuid,'cancelled','PRUEBA CIERRE - CANCELAR','Asistente ficticio cierre - Cancelar'),
    ('5856888b-18ee-4fb6-8e4f-ba6222e993ab'::uuid,'cancelled','PRUEBA CIERRE - RECHAZAR','Asistente ficticio cierre - Rechazar')
)
select e.id as fixture_id, e.expected_status, o.id is not null as exists,
  o.status, o.status=e.expected_status as final_status_matches,
  o.event_id='9d560641-aacf-4d25-8d65-94960bba59b2'::uuid as technical_event_matches,
  o.buyer_name=e.buyer_name and o.attendee_names=array[e.attendee_name]::text[] as exact_payload_matches,
  o.quantity, o.total_cents, o.currency,
  o.payment_reported_at is null as no_payment_notice,
  o.confirmed_at is null and o.confirmed_by is null as never_approved,
  o.closed_at,
  o.closed_by=(select clerk_user_id from public.user_roles where role='admin') as closed_by_protected_admin,
  (select count(*) from public.tickets t where t.order_id=e.id) as ticket_count
from expected e left join public.orders o on o.id=e.id
order by e.expected_status;
