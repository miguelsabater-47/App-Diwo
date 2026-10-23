-- Authorized real extras: admin-only, unlimited independently of 133 general tickets.
-- Applied via the authorized hosted migration admin_extra_ticket_issuance.
-- Additive metadata; no fixtures, paid-order edits, role changes or publication.
begin;

create table diwo_private.extra_ticket_batches (
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete restrict,
  issued_by text not null references public.user_roles(clerk_user_id) on delete restrict,
  attendee_names text[] not null check (diwo_private.valid_attendee_names(attendee_names) is true),
  quantity integer generated always as (pg_catalog.cardinality(attendee_names)) stored,
  reference text not null unique default ('EX-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,12))),
  issued_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(id,event_id)
);
create index extra_batches_event on diwo_private.extra_ticket_batches(event_id,issued_at);
create index extra_batches_issuer on diwo_private.extra_ticket_batches(issued_by);
alter table diwo_private.extra_ticket_batches enable row level security;
revoke all on diwo_private.extra_ticket_batches from public,anon,authenticated,service_role;

alter table public.tickets alter column order_id drop not null;
alter table public.tickets add column extra_batch_id uuid;
alter table public.tickets add constraint tickets_exactly_one_source
  check ((order_id is not null) <> (extra_batch_id is not null));
alter table public.tickets add constraint tickets_extra_parent
  foreign key(extra_batch_id,event_id) references diwo_private.extra_ticket_batches(id,event_id) on delete restrict;
alter table public.tickets add constraint tickets_extra_position unique(extra_batch_id,ticket_position);

create function diwo_private.guard_extra_batch()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op <> 'INSERT' then raise exception using errcode='23514',message='extra_history_must_be_retained'; end if;
  if new.issued_by is distinct from diwo_private.lock_order_actor(array['admin']) then
    raise exception using errcode='42501',message='operation_not_authorized';
  end if;
  perform 1 from public.events e where e.id=new.event_id and e.slug='diwo-x-2-2026' and e.is_published for share;
  if not found then raise exception using errcode='22023',message='extra_event_unavailable'; end if;
  new.issued_at:=pg_catalog.clock_timestamp();
  return new;
end $$;
create trigger extra_batches_guard before insert or update or delete on diwo_private.extra_ticket_batches
  for each row execute function diwo_private.guard_extra_batch();

create or replace function diwo_private.guard_ticket()
returns trigger language plpgsql set search_path='' as $$
declare actor text; parent public.orders%rowtype; extra diwo_private.extra_ticket_batches%rowtype;
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='ticket_history_must_be_retained'; end if;
  if tg_op='INSERT' then
    perform diwo_private.require_actor(array['admin']);
    if new.extra_batch_id is not null then
      perform diwo_private.lock_order_actor(array['admin']);
      select b.* into extra from diwo_private.extra_ticket_batches b where b.id=new.extra_batch_id and b.event_id=new.event_id for update;
      if not found or new.order_id is not null or new.ticket_position<1 or new.ticket_position>extra.quantity
        or new.attendee_name is distinct from extra.attendee_names[new.ticket_position] or new.status<>'valid' then
        raise exception using errcode='23514',message='ticket_must_match_extra_batch';
      end if;
    else
      select o.* into parent from public.orders o where o.id=new.order_id and o.event_id=new.event_id for update;
      if not found then raise exception using errcode='23503',message='order_event_mismatch'; end if;
      if parent.status<>'confirmed' or new.ticket_position>parent.quantity or new.ticket_position<1
        or new.attendee_name is distinct from parent.attendee_names[new.ticket_position] or new.status<>'valid' then
        raise exception using errcode='23514',message='ticket_must_match_confirmed_order';
      end if;
    end if;
    new.issued_at:=pg_catalog.clock_timestamp();
  else
    if row(new.id,new.order_id,new.extra_batch_id,new.event_id,new.ticket_position,new.attendee_name,new.qr_token,new.issued_at)
      is distinct from row(old.id,old.order_id,old.extra_batch_id,old.event_id,old.ticket_position,old.attendee_name,old.qr_token,old.issued_at) then
      raise exception using errcode='23514',message='ticket_identity_is_immutable';
    end if;
    if old.status<>'valid' then raise exception using errcode='23514',message='ticket_is_terminal'; end if;
    if new.status='used' then
      actor:=diwo_private.require_actor(array['admin','door_staff']);
      new.used_by:=coalesce(actor,new.used_by); new.used_at:=pg_catalog.clock_timestamp();
      if not exists(select 1 from public.user_roles r where r.clerk_user_id=new.used_by and r.role in ('admin','door_staff')) then
        raise exception using errcode='23514',message='access_operator_required'; end if;
    elsif new.status='revoked' then
      actor:=diwo_private.require_actor(array['admin']);
      new.revoked_by:=coalesce(actor,new.revoked_by); new.revoked_at:=pg_catalog.clock_timestamp();
      if not exists(select 1 from public.user_roles r where r.clerk_user_id=new.revoked_by and r.role='admin') then
        raise exception using errcode='23514',message='admin_revocation_required'; end if;
    end if;
  end if;
  return new;
end $$;

create function diwo_private.enforce_extra_ticket_count()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch uuid; wanted integer; actual bigint;
begin
  if tg_table_name='extra_ticket_batches' then batch:=new.id;
  elsif tg_op='DELETE' then batch:=old.extra_batch_id;
  else batch:=new.extra_batch_id; end if;
  if batch is null then return null; end if;
  select b.quantity into wanted from diwo_private.extra_ticket_batches b where b.id=batch;
  select pg_catalog.count(*) into actual from public.tickets t where t.extra_batch_id=batch;
  if wanted is null or wanted<>actual then raise exception using errcode='23514',message='extra_ticket_count_mismatch'; end if;
  return null;
end $$;
create constraint trigger extra_batches_exact_count after insert or update on diwo_private.extra_ticket_batches
  deferrable initially deferred for each row execute function diwo_private.enforce_extra_ticket_count();
create constraint trigger tickets_exact_extra_count after insert or update or delete on public.tickets
  deferrable initially deferred for each row execute function diwo_private.enforce_extra_ticket_count();

create function diwo_private.issue_extra_tickets(request_id uuid,request_attendee_names text[])
returns table(batch_id uuid,batch_reference text,event_id uuid,ticket_id uuid,ticket_position integer,
  attendee_name text,status text,issued_at timestamptz,used_at timestamptz,revoked_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
declare actor text:=diwo_private.lock_order_actor(array['admin']); names text[];
  batch diwo_private.extra_ticket_batches%rowtype; event_key uuid;
begin
  if request_id is null or request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or diwo_private.valid_attendee_names(request_attendee_names) is not true
    or pg_catalog.octet_length(pg_catalog.array_to_json(request_attendee_names)::text)>65536
    or exists(select 1 from pg_catalog.unnest(request_attendee_names) n where pg_catalog.length(pg_catalog.btrim(n))>120) then
    raise exception using errcode='22023',message='invalid_extra_request'; end if;
  select pg_catalog.array_agg(pg_catalog.btrim(n.name) order by n.position) into names
    from pg_catalog.unnest(request_attendee_names) with ordinality n(name,position);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('diwo:extra-request:'||request_id::text,0));
  select b.* into batch from diwo_private.extra_ticket_batches b where b.id=request_id for update;
  if found then
    if batch.issued_by<>actor or batch.attendee_names is distinct from names then
      raise exception using errcode='22023',message='request_id_conflict'; end if;
  else
    select e.id into event_key from public.events e where e.slug='diwo-x-2-2026' and e.is_published for share;
    if not found then raise exception using errcode='22023',message='extra_event_unavailable'; end if;
    insert into diwo_private.extra_ticket_batches(id,event_id,issued_by,attendee_names)
      values(request_id,event_key,actor,names) returning * into batch;
    insert into public.tickets(extra_batch_id,event_id,ticket_position,attendee_name)
      select batch.id,batch.event_id,n.position::integer,n.name from pg_catalog.unnest(names) with ordinality n(name,position);
  end if;
  return query select b.id,b.reference,t.event_id,t.id,t.ticket_position,t.attendee_name,t.status,t.issued_at,t.used_at,t.revoked_at
    from diwo_private.extra_ticket_batches b join public.tickets t on t.extra_batch_id=b.id
    where b.id=batch.id order by t.ticket_position;
end $$;

create function diwo_private.list_extra_tickets()
returns table(batch_id uuid,batch_reference text,event_id uuid,ticket_id uuid,ticket_position integer,
  attendee_name text,status text,issued_at timestamptz,used_at timestamptz,revoked_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
begin
  perform diwo_private.lock_order_actor(array['admin']);
  return query select b.id,b.reference,t.event_id,t.id,t.ticket_position,t.attendee_name,t.status,t.issued_at,t.used_at,t.revoked_at
    from diwo_private.extra_ticket_batches b join public.tickets t on t.extra_batch_id=b.id
    join public.events e on e.id=b.event_id where e.slug='diwo-x-2-2026'
    order by t.issued_at desc,t.id;
end $$;

create function diwo_private.read_extra_ticket(target_ticket uuid)
returns table(id uuid,order_id uuid,event_id uuid,attendee_name text,status text,issued_at timestamptz,
  used_at timestamptz,revoked_at timestamptz,qr_token text,event_slug text,event_title text,starts_at timestamptz,
  ends_at timestamptz,timezone text,public_location text,unit_price_cents integer,currency text,order_reference text)
language plpgsql volatile security definer set search_path='' as $$
begin
  perform diwo_private.lock_order_actor(array['admin']);
  return query select t.id,b.id,t.event_id,t.attendee_name,t.status,t.issued_at,t.used_at,t.revoked_at,
    case when t.status='valid' then t.qr_token else null end,e.slug,e.title,e.starts_at,e.ends_at,e.timezone,e.public_location,
    0,'EUR'::text,b.reference from public.tickets t join diwo_private.extra_ticket_batches b on b.id=t.extra_batch_id
    join public.events e on e.id=t.event_id where t.id=target_ticket and e.slug='diwo-x-2-2026';
end $$;

-- General approvals ignore extras. General INSERT remains unconditionally closed.
create or replace function diwo_private.guard_event_ticket_capacity()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare issued bigint;
begin
  if not exists(select 1 from public.events e where e.id=new.event_id and e.slug='diwo-x-2-2026') then return new; end if;
  if tg_op='INSERT' then raise exception using errcode='22023',message='sales_closed'; end if;
  if old.status<>'pending' or new.status<>'confirmed' then return new; end if;
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='22023',message='capacity_isolation_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('diwo:ticket-capacity:'||new.event_id::text,0));
  select pg_catalog.count(*) into issued from public.tickets t where t.event_id=new.event_id and t.order_id is not null and t.status in ('valid','used');
  if issued+pg_catalog.cardinality(new.attendee_names)>133 then raise exception using errcode='22023',message='event_capacity_exceeded'; end if;
  return new;
end $$;

create or replace function diwo_private.revoke_issued_ticket(target_ticket uuid)
returns table(ticket_id uuid,ticket_status text,revoked_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
declare actor text:=diwo_private.lock_order_actor(array['admin']); candidate public.tickets%rowtype;
begin
  select t.* into candidate from public.tickets t where t.id=target_ticket;
  if not found then raise exception using errcode='22023',message='ticket_not_found'; end if;
  perform 1 from public.events e where e.id=candidate.event_id for share;
  if candidate.extra_batch_id is null then
    perform 1 from public.orders o where o.id=candidate.order_id and o.event_id=candidate.event_id and o.status='confirmed' for update;
  else
    perform 1 from diwo_private.extra_ticket_batches b where b.id=candidate.extra_batch_id and b.event_id=candidate.event_id for update;
  end if;
  if not found then raise exception using errcode='23514',message='invalid_ticket_parent'; end if;
  select t.* into candidate from public.tickets t where t.id=target_ticket for update;
  if candidate.status='used' then raise exception using errcode='22023',message='ticket_already_used';
  elsif candidate.status='valid' then
    update public.tickets t set status='revoked',revoked_by=actor,revoked_reason='Anulada individualmente por administración'
      where t.id=target_ticket returning t.* into candidate;
  elsif candidate.status<>'revoked' then raise exception using errcode='23514',message='invalid_ticket_state'; end if;
  return query select candidate.id,candidate.status,candidate.revoked_at;
end $$;

create or replace function diwo_private.check_in_ticket(target_event uuid,scanned_token text)
returns table(outcome text,ticket_id uuid,attendee_name text,used_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
declare actor text:=diwo_private.lock_order_actor(array['admin','door_staff']); candidate public.tickets%rowtype;
begin
  if target_event is null or scanned_token is null or scanned_token !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='invalid_scan_request'; end if;
  perform 1 from public.events e where e.id=target_event and e.slug='diwo-x-2-2026' and e.is_published for share;
  if not found then raise exception using errcode='22023',message='door_event_unavailable'; end if;
  select t.* into candidate from public.tickets t where t.qr_token=scanned_token;
  if not found then return query select 'unknown'::text,null::uuid,null::text,null::timestamptz; return; end if;
  if candidate.event_id<>target_event then return query select 'wrong_event'::text,null::uuid,null::text,null::timestamptz; return; end if;
  if candidate.extra_batch_id is null then
    perform 1 from public.orders o where o.id=candidate.order_id and o.event_id=target_event and o.status='confirmed' for update;
  else
    perform 1 from diwo_private.extra_ticket_batches b where b.id=candidate.extra_batch_id and b.event_id=target_event for update;
  end if;
  if not found then raise exception using errcode='23514',message='invalid_ticket_parent'; end if;
  select t.* into candidate from public.tickets t where t.id=candidate.id for update;
  if candidate.status='valid' then
    update public.tickets t set status='used',used_by=actor where t.id=candidate.id returning t.* into candidate;
    return query select 'admitted'::text,candidate.id,candidate.attendee_name,candidate.used_at;
  elsif candidate.status='used' then return query select 'already_used'::text,candidate.id,candidate.attendee_name,candidate.used_at;
  elsif candidate.status='revoked' then return query select 'revoked'::text,candidate.id,candidate.attendee_name,null::timestamptz;
  else raise exception using errcode='23514',message='invalid_ticket_state'; end if;
end $$;

create or replace function diwo_private.read_door_event()
returns table(event_id uuid,event_title text,used_admissions bigint,pending_admissions bigint,issued_non_revoked bigint)
language plpgsql volatile security definer set search_path='' as $$
begin
  perform diwo_private.lock_order_actor(array['admin','door_staff']);
  return query select e.id,e.title,count(t.id) filter(where t.status='used'),count(t.id) filter(where t.status='valid'),
    count(t.id) filter(where t.status in ('valid','used')) from public.events e
    left join public.tickets t on t.event_id=e.id and t.order_id is not null
    where e.slug='diwo-x-2-2026' and e.is_published group by e.id,e.title;
end $$;
create function diwo_private.extra_event_counters(target_event uuid)
returns table(used_admissions bigint,pending_admissions bigint,issued_non_revoked bigint)
language plpgsql volatile security definer set search_path='' as $$
begin
  perform diwo_private.lock_order_actor(array['admin','door_staff']);
  return query select count(*) filter(where t.status='used'),count(*) filter(where t.status='valid'),
    count(*) filter(where t.status in ('valid','used')) from public.tickets t where t.event_id=target_event and t.extra_batch_id is not null;
end $$;
create or replace function diwo_private.event_counters(target_event uuid)
returns table(used_admissions bigint,pending_admissions bigint,issued_non_revoked bigint,progress_ratio numeric)
language plpgsql stable security definer set search_path='' as $$
begin
  if diwo_private.current_clerk_subject() is null or diwo_private.current_app_role() not in ('admin','door_staff') then
    raise exception using errcode='42501',message='operational_counters_not_authorized'; end if;
  if not exists(select 1 from public.events e where e.id=target_event) then raise exception using errcode='22023',message='event_not_found'; end if;
  return query select count(*) filter(where t.status='used'),count(*) filter(where t.status='valid'),
    count(*) filter(where t.status in ('valid','used')),
    (count(*) filter(where t.status='used'))::numeric/nullif(count(*) filter(where t.status in ('valid','used')),0)
    from public.tickets t where t.event_id=target_event and t.order_id is not null;
end $$;

create function public.issue_extra_tickets(request_id uuid,request_attendee_names text[])
returns table(batch_id uuid,batch_reference text,event_id uuid,ticket_id uuid,ticket_position integer,
  attendee_name text,status text,issued_at timestamptz,used_at timestamptz,revoked_at timestamptz)
language sql volatile security invoker set search_path='' as $$ select * from diwo_private.issue_extra_tickets(request_id,request_attendee_names) $$;
create function public.list_extra_tickets()
returns table(batch_id uuid,batch_reference text,event_id uuid,ticket_id uuid,ticket_position integer,
  attendee_name text,status text,issued_at timestamptz,used_at timestamptz,revoked_at timestamptz)
language sql volatile security invoker set search_path='' as $$ select * from diwo_private.list_extra_tickets() $$;
create function public.read_extra_ticket(target_ticket uuid)
returns table(id uuid,order_id uuid,event_id uuid,attendee_name text,status text,issued_at timestamptz,
  used_at timestamptz,revoked_at timestamptz,qr_token text,event_slug text,event_title text,starts_at timestamptz,
  ends_at timestamptz,timezone text,public_location text,unit_price_cents integer,currency text,order_reference text)
language sql volatile security invoker set search_path='' as $$ select * from diwo_private.read_extra_ticket(target_ticket) $$;
create function public.get_extra_event_counters(target_event uuid)
returns table(used_admissions bigint,pending_admissions bigint,issued_non_revoked bigint)
language sql volatile security invoker set search_path='' as $$ select * from diwo_private.extra_event_counters(target_event) $$;

revoke all on function diwo_private.guard_extra_batch(),diwo_private.enforce_extra_ticket_count(),
  diwo_private.issue_extra_tickets(uuid,text[]),diwo_private.list_extra_tickets(),diwo_private.read_extra_ticket(uuid),diwo_private.extra_event_counters(uuid),
  public.issue_extra_tickets(uuid,text[]),public.list_extra_tickets(),public.read_extra_ticket(uuid),public.get_extra_event_counters(uuid)
  from public,anon,authenticated,service_role;
grant execute on function diwo_private.issue_extra_tickets(uuid,text[]),diwo_private.list_extra_tickets(),diwo_private.read_extra_ticket(uuid),
  diwo_private.extra_event_counters(uuid),public.issue_extra_tickets(uuid,text[]),public.list_extra_tickets(),public.read_extra_ticket(uuid),public.get_extra_event_counters(uuid)
  to authenticated;
notify pgrst,'reload schema';
commit;
