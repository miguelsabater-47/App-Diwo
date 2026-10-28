-- Registered in the main DIWO Supabase project on 2026-10-28.
-- No ticket/order/role/event data is modified by this migration.
create table diwo_private.manual_admissions (
  ticket_id uuid primary key references public.tickets(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  admitted_at timestamptz not null,
  admitted_by text not null references public.user_roles(clerk_user_id) on delete restrict,
  method text not null default 'manual' check(method='manual')
);
alter table diwo_private.manual_admissions enable row level security;
revoke all on diwo_private.manual_admissions from public,anon,authenticated,service_role;
create index manual_admissions_event_time on diwo_private.manual_admissions(event_id,admitted_at desc);
create function diwo_private.manual_check_in_ticket(target_event uuid,target_ticket uuid)
returns table(outcome text,ticket_id uuid,attendee_name text,used_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
declare actor text:=diwo_private.lock_order_actor(array['admin','door_staff']); bearer text; receipt record;
begin
  if target_event is null or target_ticket is null then raise exception using errcode='22023',message='invalid_manual_access'; end if;
  select t.qr_token into bearer from public.tickets t where t.id=target_ticket and t.event_id=target_event;
  if not found then return query select 'unknown'::text,null::uuid,null::text,null::timestamptz; return; end if;
  select * into receipt from diwo_private.check_in_ticket(target_event,bearer);
  if receipt.outcome='admitted' then
    insert into diwo_private.manual_admissions(ticket_id,event_id,admitted_at,admitted_by)
      values(receipt.ticket_id,target_event,receipt.used_at,actor);
  end if;
  return query select receipt.outcome,receipt.ticket_id,receipt.attendee_name,receipt.used_at;
end $$;
create function public.manual_check_in_ticket(target_event uuid,target_ticket uuid)
returns table(outcome text,ticket_id uuid,attendee_name text,used_at timestamptz)
language sql volatile security invoker set search_path='' as $$ select * from diwo_private.manual_check_in_ticket(target_event,target_ticket) $$;
revoke all on function public.manual_check_in_ticket(uuid,uuid),diwo_private.manual_check_in_ticket(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.manual_check_in_ticket(uuid,uuid),diwo_private.manual_check_in_ticket(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
