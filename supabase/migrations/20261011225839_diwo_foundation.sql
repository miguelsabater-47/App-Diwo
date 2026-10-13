-- Reviewed DIWO foundation. Transaction and history managed by apply_migration.
-- No real identity/event seed; Clerk activation and business writers are separate.
do $$
begin
  if pg_catalog.to_regprocedure('auth.jwt()') is null then
    raise exception 'Supabase auth.jwt() is required';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    raise exception 'Supabase API roles are required';
  end if;
end $$;

-- Deliberately fail if existing application objects would be overwritten.
create schema diwo_private;
revoke all on schema diwo_private from public;
grant usage on schema diwo_private to authenticated;

create function diwo_private.current_clerk_subject()
returns text language sql stable set search_path = '' as $$
  select case when (auth.jwt() ->> 'sub') ~ '^user_[A-Za-z0-9_-]+$'
    then auth.jwt() ->> 'sub' else null end
$$;

create function diwo_private.valid_attendee_names(names text[])
returns boolean language sql immutable set search_path = '' as $$
  select names is not null and pg_catalog.array_ndims(names) = 1
    and pg_catalog.array_lower(names, 1) = 1 and pg_catalog.cardinality(names) > 0
    and not exists (select 1 from pg_catalog.unnest(names) as n(name)
      where n.name is null or pg_catalog.btrim(n.name) = '')
$$;

create table public.user_roles (
  clerk_user_id text primary key check (clerk_user_id ~ '^user_[A-Za-z0-9_-]+$'),
  role text not null default 'user' check (role in ('user', 'admin', 'door_staff')),
  assigned_by text references public.user_roles(clerk_user_id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
create unique index user_roles_one_admin on public.user_roles(role) where role = 'admin';
create index user_roles_assigned_by on public.user_roles(assigned_by);

create function diwo_private.current_app_role()
returns text language plpgsql stable security definer set search_path = '' as $$
declare subject text := diwo_private.current_clerk_subject(); result text;
begin
  if subject is null then return null; end if;
  select r.role into result from public.user_roles r where r.clerk_user_id = subject;
  return coalesce(result, 'user');
end $$;

create function diwo_private.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(diwo_private.current_app_role() = 'admin', false)
$$;

-- A valid Clerk subject must have a current stored privilege, never a JWT app
-- role/metadata value. NULL is permitted only for trusted owner maintenance;
-- malformed/absent subjects in an ordinary API role fail even inside a definer.
create function diwo_private.require_actor(allowed_roles text[])
returns text language plpgsql stable set search_path = '' as $$
declare actor text := diwo_private.current_clerk_subject();
begin
  if actor is not null then
    if not (diwo_private.current_app_role() = any(allowed_roles)) then
      raise exception using errcode = '42501', message = 'operation_not_authorized';
    end if;
    return actor;
  end if;
  if coalesce(pg_catalog.current_setting('role', true), '') not in ('none', 'postgres', 'service_role') then
    raise exception using errcode = '42501', message = 'verified_clerk_identity_required';
  end if;
  return null;
end $$;

create table public.events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  slug text not null unique check (pg_catalog.btrim(slug) <> ''),
  title text not null check (pg_catalog.btrim(title) <> ''),
  timezone text not null default 'Europe/Madrid' check (timezone = 'Europe/Madrid'),
  public_location text not null check (pg_catalog.btrim(public_location) <> ''),
  unit_price_cents integer not null default 500 check (unit_price_cents = 500),
  currency text not null default 'EUR' check (currency = 'EUR'),
  sales_open_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  arrival_from timestamptz not null,
  arrival_until timestamptz not null,
  is_published boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (sales_open_at < starts_at and starts_at < ends_at),
  check (starts_at <= arrival_from and arrival_from < arrival_until and arrival_until <= ends_at)
);

create table public.orders (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  buyer_clerk_id text not null check (buyer_clerk_id ~ '^user_[A-Za-z0-9_-]+$'),
  buyer_name text not null check (pg_catalog.btrim(buyer_name) <> ''),
  attendee_names text[] not null check (diwo_private.valid_attendee_names(attendee_names) is true),
  quantity integer generated always as (pg_catalog.cardinality(attendee_names)) stored,
  unit_price_cents integer not null default 500 check (unit_price_cents = 500),
  total_cents bigint generated always as (pg_catalog.cardinality(attendee_names)::bigint * unit_price_cents) stored,
  currency text not null default 'EUR' check (currency = 'EUR'),
  reference text not null unique default ('DIWO-' || pg_catalog.upper(pg_catalog.substr(
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12))),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'cancelled')),
  payment_reported_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by text references public.user_roles(clerk_user_id) on delete restrict,
  closed_at timestamptz,
  closed_by text references public.user_roles(clerk_user_id) on delete restrict,
  closed_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (id, event_id),
  check (quantity > 0),
  check ((status = 'confirmed') = (confirmed_at is not null)),
  check ((confirmed_at is null) = (confirmed_by is null)),
  check ((status in ('rejected', 'cancelled')) = (closed_at is not null)),
  check ((closed_at is null) = (closed_by is null))
);
create index orders_buyer_created on public.orders(buyer_clerk_id, created_at desc);
create index orders_event_status on public.orders(event_id, status, created_at);
create index orders_confirmed_by on public.orders(confirmed_by);
create index orders_closed_by on public.orders(closed_by);

create table public.tickets (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  order_id uuid not null,
  event_id uuid not null,
  ticket_position integer not null check (ticket_position > 0),
  attendee_name text not null check (pg_catalog.btrim(attendee_name) <> ''),
  status text not null default 'valid' check (status in ('valid', 'used', 'revoked')),
  -- Two UUIDv4 values provide ~244 random bits; no identity in this bearer token.
  -- It is NOT a payment reference and is excluded from client SELECT grants.
  qr_token text not null unique default (pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
    || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')) check (qr_token ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default pg_catalog.clock_timestamp(),
  used_at timestamptz,
  used_by text references public.user_roles(clerk_user_id) on delete restrict,
  revoked_at timestamptz,
  revoked_by text references public.user_roles(clerk_user_id) on delete restrict,
  revoked_reason text,
  foreign key (order_id, event_id) references public.orders(id, event_id) on delete restrict,
  unique (order_id, ticket_position),
  check ((status = 'used') = (used_at is not null)),
  check ((used_at is null) = (used_by is null)),
  check ((status = 'revoked') = (revoked_at is not null)),
  check ((revoked_at is null) = (revoked_by is null)),
  check (used_at is null or used_at >= issued_at),
  check (revoked_at is null or revoked_at >= issued_at)
);
create index tickets_event_status on public.tickets(event_id, status);
create index tickets_used_by on public.tickets(used_by);
create index tickets_revoked_by on public.tickets(revoked_by);

create function diwo_private.protect_role_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' then
      raise exception using errcode = '23514', message = 'admin_identity_is_protected';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.clerk_user_id is distinct from old.clerk_user_id
      or (old.role = 'admin' and new.role <> 'admin')) then
    raise exception using errcode = '23514', message = 'role_identity_is_protected';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end $$;
create trigger user_roles_identity before insert or update or delete on public.user_roles
  for each row execute function diwo_private.protect_role_identity();

create function diwo_private.guard_order()
returns trigger language plpgsql set search_path = '' as $$
declare actor text; event_row public.events%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514', message = 'order_history_must_be_retained';
  end if;
  if tg_op = 'INSERT' then
    actor := diwo_private.require_actor(array['user', 'admin', 'door_staff']);
    if actor is not null and new.buyer_clerk_id <> actor then
      raise exception using errcode = '42501', message = 'buyer_identity_mismatch';
    end if;
    select e.* into event_row from public.events e where e.id = new.event_id;
    if not found then raise exception using errcode = '23503', message = 'event_not_found'; end if;
    if not event_row.is_published or pg_catalog.clock_timestamp() < event_row.sales_open_at then
      raise exception using errcode = '23514', message = 'sales_not_open';
    end if;
    if new.unit_price_cents <> event_row.unit_price_cents or new.currency <> event_row.currency
       or new.status <> 'pending' or new.payment_reported_at is not null then
      raise exception using errcode = '23514', message = 'invalid_initial_order';
    end if;
    new.created_at := pg_catalog.clock_timestamp();
  else
    if row(new.id, new.event_id, new.buyer_clerk_id, new.buyer_name, new.attendee_names,
           new.unit_price_cents, new.currency, new.reference, new.created_at)
       is distinct from row(old.id, old.event_id, old.buyer_clerk_id, old.buyer_name, old.attendee_names,
           old.unit_price_cents, old.currency, old.reference, old.created_at) then
      raise exception using errcode = '23514', message = 'order_snapshot_is_immutable';
    end if;
    if old.status <> 'pending' then
      raise exception using errcode = '23514', message = 'closed_order_cannot_be_changed';
    end if;
    if new.status <> old.status then
      actor := diwo_private.require_actor(array['admin']);
      if new.status = 'confirmed' then
        new.confirmed_by := coalesce(actor, new.confirmed_by);
        new.confirmed_at := pg_catalog.clock_timestamp();
        if not exists (select 1 from public.user_roles where clerk_user_id = new.confirmed_by and role = 'admin') then
          raise exception using errcode = '23514', message = 'admin_confirmation_required';
        end if;
      elsif new.status in ('rejected', 'cancelled') then
        new.closed_by := coalesce(actor, new.closed_by);
        new.closed_at := pg_catalog.clock_timestamp();
        if not exists (select 1 from public.user_roles where clerk_user_id = new.closed_by and role = 'admin') then
          raise exception using errcode = '23514', message = 'admin_decision_required';
        end if;
      end if;
      if new.payment_reported_at is distinct from old.payment_reported_at then
        raise exception using errcode = '23514', message = 'payment_notice_is_separate';
      end if;
    elsif new.payment_reported_at is distinct from old.payment_reported_at then
      actor := diwo_private.require_actor(array['user', 'admin', 'door_staff']);
      if (actor is not null and actor <> old.buyer_clerk_id)
         or old.payment_reported_at is not null or new.payment_reported_at is null then
        raise exception using errcode = '42501', message = 'payment_notice_not_authorized';
      end if;
      new.payment_reported_at := pg_catalog.clock_timestamp();
    end if;
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end $$;
create trigger orders_state_guard before insert or update or delete on public.orders
  for each row execute function diwo_private.guard_order();

create function diwo_private.guard_ticket()
returns trigger language plpgsql set search_path = '' as $$
declare actor text; parent public.orders%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514', message = 'ticket_history_must_be_retained';
  end if;
  if tg_op = 'INSERT' then
    perform diwo_private.require_actor(array['admin']);
    select o.* into parent from public.orders o where o.id = new.order_id and o.event_id = new.event_id for update;
    if not found then raise exception using errcode = '23503', message = 'order_event_mismatch'; end if;
    if parent.status <> 'confirmed' or new.ticket_position > parent.quantity
       or new.ticket_position < 1 or new.attendee_name is distinct from parent.attendee_names[new.ticket_position]
       or new.status <> 'valid' then
      raise exception using errcode = '23514', message = 'ticket_must_match_confirmed_order';
    end if;
    new.issued_at := pg_catalog.clock_timestamp();
  else
    if row(new.id, new.order_id, new.event_id, new.ticket_position, new.attendee_name, new.qr_token, new.issued_at)
       is distinct from row(old.id, old.order_id, old.event_id, old.ticket_position, old.attendee_name, old.qr_token, old.issued_at) then
      raise exception using errcode = '23514', message = 'ticket_identity_is_immutable';
    end if;
    if old.status <> 'valid' then
      raise exception using errcode = '23514', message = 'ticket_is_terminal';
    end if;
    if new.status = 'used' then
      actor := diwo_private.require_actor(array['admin', 'door_staff']);
      new.used_by := coalesce(actor, new.used_by);
      new.used_at := pg_catalog.clock_timestamp();
      if not exists (select 1 from public.user_roles where clerk_user_id = new.used_by and role in ('admin', 'door_staff')) then
        raise exception using errcode = '23514', message = 'access_operator_required';
      end if;
    elsif new.status = 'revoked' then
      actor := diwo_private.require_actor(array['admin']);
      new.revoked_by := coalesce(actor, new.revoked_by);
      new.revoked_at := pg_catalog.clock_timestamp();
      if not exists (select 1 from public.user_roles where clerk_user_id = new.revoked_by and role = 'admin') then
        raise exception using errcode = '23514', message = 'admin_revocation_required';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger tickets_state_guard before insert or update or delete on public.tickets
  for each row execute function diwo_private.guard_ticket();

-- Deferred verification prevents payment confirmation without exactly N tickets.
-- Approval RPC must perform confirmation + all INSERTs in the same transaction.
create function diwo_private.enforce_ticket_count()
returns trigger language plpgsql security definer set search_path = '' as $$
declare order_key uuid; state text; wanted integer; actual bigint;
begin
  if tg_table_name = 'orders' then order_key := new.id;
  elsif tg_op = 'DELETE' then order_key := old.order_id;
  else order_key := new.order_id; end if;
  select status, quantity into state, wanted from public.orders where id = order_key;
  if not found then return null; end if;
  select pg_catalog.count(*) into actual from public.tickets where order_id = order_key;
  if (state = 'confirmed' and actual <> wanted) or (state <> 'confirmed' and actual <> 0) then
    raise exception using errcode = '23514', message = 'order_ticket_count_mismatch';
  end if;
  return null;
end $$;
create constraint trigger orders_exact_ticket_count after insert or update on public.orders
  deferrable initially deferred for each row execute function diwo_private.enforce_ticket_count();
create constraint trigger tickets_exact_ticket_count after insert or update or delete on public.tickets
  deferrable initially deferred for each row execute function diwo_private.enforce_ticket_count();

alter table public.user_roles enable row level security;
alter table public.events enable row level security;
alter table public.orders enable row level security;
alter table public.tickets enable row level security;
revoke all on public.user_roles, public.events, public.orders, public.tickets from public, anon, authenticated, service_role;
grant usage on schema public to anon, authenticated;
grant select on public.events to anon, authenticated;
grant select (clerk_user_id, role, updated_at) on public.user_roles to authenticated;
grant select (id, event_id, buyer_clerk_id, buyer_name, attendee_names, quantity, unit_price_cents,
  total_cents, currency, reference, status, payment_reported_at, confirmed_at, closed_at,
  closed_reason, created_at, updated_at) on public.orders to authenticated;
grant select (id, order_id, event_id, ticket_position, attendee_name, status, issued_at,
  used_at, revoked_at, revoked_reason) on public.tickets to authenticated;

create policy events_published_read on public.events for select to anon, authenticated using (is_published);
create policy events_admin_read on public.events for select to authenticated using ((select diwo_private.is_admin()));
create policy roles_own_or_admin on public.user_roles for select to authenticated
  using (clerk_user_id = (select diwo_private.current_clerk_subject()) or (select diwo_private.is_admin()));
create policy orders_own_or_admin on public.orders for select to authenticated
  using (buyer_clerk_id = (select diwo_private.current_clerk_subject()) or (select diwo_private.is_admin()));
create policy tickets_own_or_admin on public.tickets for select to authenticated
  using ((select diwo_private.is_admin()) or exists (select 1 from public.orders o
    where o.id = tickets.order_id and o.event_id = tickets.event_id
      and o.buyer_clerk_id = (select diwo_private.current_clerk_subject())));

create function diwo_private.event_counters(target_event uuid)
returns table (used_admissions bigint, pending_admissions bigint, issued_non_revoked bigint, progress_ratio numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if diwo_private.current_clerk_subject() is null
     or diwo_private.current_app_role() not in ('admin', 'door_staff') then
    raise exception using errcode = '42501', message = 'operational_counters_not_authorized';
  end if;
  if not exists (select 1 from public.events where id = target_event) then
    raise exception using errcode = '22023', message = 'event_not_found';
  end if;
  return query select
    pg_catalog.count(*) filter (where t.status = 'used'),
    pg_catalog.count(*) filter (where t.status = 'valid'),
    pg_catalog.count(*) filter (where t.status in ('valid', 'used')),
    (pg_catalog.count(*) filter (where t.status = 'used'))::numeric /
      nullif(pg_catalog.count(*) filter (where t.status in ('valid', 'used')), 0)
    from public.tickets t where t.event_id = target_event;
end $$;

-- Exposed wrappers are invokers; privileged lookups remain outside the API schema.
create function public.get_current_app_role()
returns text language sql stable set search_path = '' as $$
  select diwo_private.current_app_role()
$$;
create function public.get_event_counters(target_event uuid)
returns table (used_admissions bigint, pending_admissions bigint, issued_non_revoked bigint, progress_ratio numeric)
language sql stable set search_path = '' as $$
  select * from diwo_private.event_counters(target_event)
$$;

revoke all on all functions in schema diwo_private from public, anon, authenticated, service_role;
grant execute on function diwo_private.current_clerk_subject(), diwo_private.current_app_role(),
  diwo_private.is_admin(), diwo_private.event_counters(uuid) to authenticated;
revoke all on function public.get_current_app_role(), public.get_event_counters(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_current_app_role(), public.get_event_counters(uuid) to authenticated;
