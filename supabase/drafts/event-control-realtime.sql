-- Historical test input. Applied as 20261028204407_event_control_realtime.sql.
-- Do not reapply this draft to the hosted database.
-- Requires real extras/scanner infrastructure and admin-manual-access.sql.
-- No publication, fixtures, role assignment or direct ticket grants.
begin;

create function diwo_private.read_event_control(search_query text default '',page_number integer default 0)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  perform diwo_private.lock_order_actor(array['admin','door_staff']);
  if search_query is null or length(search_query)>120 or page_number is null or page_number<0 or page_number>99999 then
    raise exception using errcode='22023',message='invalid_event_query';
  end if;
  with event as materialized (
    select e.id,e.title,e.timezone,e.starts_at,e.ends_at from public.events e
    where e.slug='diwo-x-2-2026' and e.is_published
  ), tickets as materialized (
    select t.id,t.attendee_name,t.status,t.used_at,t.order_id,
      coalesce(o.reference,t.id::text)||' · #'||t.ticket_position as code,
      jsonb_build_object('id',t.id,'name',t.attendee_name,'code',coalesce(o.reference,t.id::text)||' · #'||t.ticket_position,
        'status',t.status,'usedAt',t.used_at,'kind',case when t.order_id is null then 'extra' else 'general' end) as dto
    from public.tickets t join event e on t.event_id=e.id left join public.orders o on o.id=t.order_id and o.event_id=e.id
    where (t.order_id is not null and o.status='confirmed') or (t.order_id is null and t.extra_batch_id is not null)
  ), counts as (
    select count(*) filter(where status in ('valid','used')) as total,
      count(*) filter(where status='used') as used,
      count(*) filter(where status='valid') as pending,
      count(*) filter(where status in ('valid','used') and order_id is not null) as general,
      count(*) filter(where status in ('valid','used') and order_id is null) as extras from tickets
  ), found as materialized (
    select * from tickets where btrim(search_query)<>'' and strpos(
      translate(lower(attendee_name||' '||code||' '||id::text),'áéíóúüñ','aeiouun'),
      translate(lower(btrim(search_query)),'áéíóúüñ','aeiouun'))>0
  ) select jsonb_build_object(
    'event',jsonb_build_object('id',e.id,'title',e.title,'timezone',e.timezone,
      'phase',case when statement_timestamp()<e.starts_at then 'upcoming' when statement_timestamp()<e.ends_at then 'live' else 'ended' end),
    'checkedAt',statement_timestamp(),'used',c.used,'pending',c.pending,'total',c.total,
    'percentage',case when c.total=0 then 0 else round(c.used*100.0/c.total)::integer end,
    'general',c.general,'extras',c.extras,'page',page_number,
    'matches',(select count(*) from found),'historyTotal',c.used,
    'results',coalesce((select jsonb_agg(s.dto order by s.attendee_name,s.id) from
      (select * from found order by attendee_name,id limit 20 offset page_number*20) s),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(s.dto order by s.used_at desc,s.id desc) from
      (select * from tickets where status='used' order by used_at desc,id desc limit 20 offset page_number*20) s),'[]'::jsonb),
    'latest',coalesce((select jsonb_agg(s.dto order by s.used_at desc,s.id desc) from
      (select * from tickets where status='used' order by used_at desc,id desc limit 5) s),'[]'::jsonb)
  ) into result from event e cross join counts c;
  if result is null then raise exception using errcode='22023',message='door_event_unavailable'; end if;
  return result;
end $$;
create function public.read_event_control(search_query text default '',page_number integer default 0)
returns jsonb language sql volatile security invoker set search_path='' as $$ select diwo_private.read_event_control(search_query,page_number) $$;
revoke all on function public.read_event_control(text,integer),diwo_private.read_event_control(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_event_control(text,integer),diwo_private.read_event_control(text,integer) to authenticated;

-- The only broadcast payload is {}. No names, IDs, counters, payment or QR data.
create function diwo_private.signal_event_control() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform realtime.send('{}'::jsonb,'changed','diwo:event:'||new.event_id::text,true);
  return null;
exception when others then
  -- A transport outage must not consume/fail an otherwise valid admission.
  -- The dashboard reconciles using a protected read every 3 seconds.
  raise warning 'event_control_signal_unavailable'; return null;
end $$;
revoke all on function diwo_private.signal_event_control() from public,anon,authenticated,service_role;
create trigger tickets_event_control_insert after insert on public.tickets for each row execute function diwo_private.signal_event_control();
create trigger tickets_event_control_status after update of status on public.tickets for each row when(old.status is distinct from new.status) execute function diwo_private.signal_event_control();

create function diwo_private.can_receive_event_signal(target_topic text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.user_roles r where r.clerk_user_id=auth.jwt()->>'sub' and r.role in ('admin','door_staff'))
    and exists(select 1 from public.events e where e.slug='diwo-x-2-2026' and e.is_published and target_topic='diwo:event:'||e.id::text)
$$;
revoke all on function diwo_private.can_receive_event_signal(text) from public,anon,authenticated,service_role;
grant execute on function diwo_private.can_receive_event_signal(text) to authenticated;
create policy diwo_event_signal_receive on realtime.messages for select to authenticated
using(extension='broadcast' and diwo_private.can_receive_event_signal(realtime.topic()) and topic=realtime.topic());
-- Restrictive boundaries also protect this namespace if other policies exist.
create policy diwo_event_signal_boundary on realtime.messages as restrictive for select to authenticated
using(case when topic like 'diwo:event:%' then extension='broadcast' and diwo_private.can_receive_event_signal(topic) else true end);
create policy diwo_event_signal_anon_boundary on realtime.messages as restrictive for select to anon
using(topic not like 'diwo:event:%');
create policy diwo_event_signal_no_client_send on realtime.messages as restrictive for insert to anon,authenticated
with check(topic not like 'diwo:event:%');
notify pgrst,'reload schema';
commit;
