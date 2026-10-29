-- PR 5: immutable BRL payout quotes and a simulation-only payout.
--
-- Nothing here moves money. A quote is an illustrative calculation with fixed
-- fictional assumptions; a simulation is a state machine that ends in
-- "completed_simulation" without any bank transfer, token burn or swap.
--
-- Access model (same as earlier PRs): owners SELECT their own rows; all
-- writes go through service_role-only functions with user_id taken from the
-- verified server session.

-- ---------------------------------------------------------------------------
-- under_review: the chain evidence behind a confirmed request disappeared or
-- moved (reorg). Terminal for the MVP; blocks quotes and simulations.
-- ---------------------------------------------------------------------------
alter table public.payment_requests drop constraint payment_requests_status_check;
alter table public.payment_requests add constraint payment_requests_status_check
  check (status in ('open', 'confirming', 'confirmed', 'expired', 'cancelled', 'under_review'));

create or replace function public.guard_payment_request_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.wallet_id is distinct from old.wallet_id
    or new.recipient_snapshot is distinct from old.recipient_snapshot
    or new.amount_units is distinct from old.amount_units
    or new.chain_id is distinct from old.chain_id
    or new.token_address is distinct from old.token_address
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
    or new.creation_block is distinct from old.creation_block
  then
    raise exception 'payment_request_snapshot_immutable' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'open' and new.status in ('confirming', 'expired', 'cancelled'))
    or (old.status = 'confirming' and new.status in ('open', 'confirmed', 'expired'))
    or (old.status = 'confirmed' and new.status = 'under_review')
  ) then
    raise exception 'payment_request_invalid_transition' using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Shared append-only guard for the tables below.
create function public.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end;
$$;

revoke all on function public.reject_mutation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- payout_quotes: immutable. The arithmetic is re-checked by constraints, so a
-- stored quote is always internally consistent:
--   service_fee  = ceil(input * service_fee_bps / 10000)          (USDC units, up)
--   net          = input - service_fee - fixed_fee                 (> 0)
--   effective    = floor(reference * (10000 - spread_bps) / 10000) (scaled rate)
--   output_minor = floor(net * effective * 100 / (1e6 * fx_scale)) (BRL cents, down)
-- ---------------------------------------------------------------------------
create table public.payout_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.payment_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  input_units numeric not null check (input_units > 0 and input_units = trunc(input_units)),
  service_fee_bps integer not null check (service_fee_bps between 0 and 10000),
  service_fee_units numeric not null check (service_fee_units >= 0),
  fixed_fee_units numeric not null check (fixed_fee_units >= 0 and fixed_fee_units = trunc(fixed_fee_units)),
  net_units numeric not null check (net_units > 0),
  fx_scale integer not null check (fx_scale > 0),
  reference_rate_scaled integer not null check (reference_rate_scaled > 0),
  spread_bps integer not null check (spread_bps between 0 and 9999),
  effective_rate_scaled integer not null check (effective_rate_scaled > 0),
  output_minor numeric not null check (output_minor > 0),
  currency text not null check (currency = 'BRL'),
  assumptions_version text not null check (assumptions_version ~ '^[a-z0-9.-]{3,64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at),
  check (service_fee_units = ceil(input_units * service_fee_bps / 10000)),
  check (net_units = input_units - service_fee_units - fixed_fee_units),
  check (effective_rate_scaled = floor(reference_rate_scaled::numeric * (10000 - spread_bps) / 10000)),
  check (output_minor = floor(net_units * effective_rate_scaled * 100 / (1000000::numeric * fx_scale)))
);

create index payout_quotes_request_idx on public.payout_quotes (request_id, created_at desc);

create trigger payout_quotes_append_only
  before update or delete on public.payout_quotes
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- payout_simulations: one per request, one per quote; always a simulation.
--   created -> processing -> completed_simulation
--   created | processing -> failed_simulation
-- ---------------------------------------------------------------------------
create table public.payout_simulations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.payment_requests (id) on delete cascade,
  quote_id uuid not null unique references public.payout_quotes (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'created'
    check (status in ('created', 'processing', 'completed_simulation', 'failed_simulation')),
  simulation boolean not null default true check (simulation),
  idempotency_key text not null unique check (idempotency_key ~ '^[0-9a-f-]{36}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z_]{3,64}$'),
  created_at timestamptz not null default now(),
  processing_at timestamptz,
  completed_at timestamptz
);

create function public.guard_payout_simulation_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_id is distinct from old.request_id
    or new.quote_id is distinct from old.quote_id
    or new.user_id is distinct from old.user_id
    or new.simulation is distinct from old.simulation
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_at is distinct from old.created_at
  then
    raise exception 'payout_simulation_immutable' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'created' and new.status in ('processing', 'failed_simulation'))
    or (old.status = 'processing' and new.status in ('completed_simulation', 'failed_simulation'))
  ) then
    raise exception 'payout_simulation_invalid_transition' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_payout_simulation_update() from public, anon, authenticated;

create trigger payout_simulations_guard
  before update on public.payout_simulations
  for each row execute function public.guard_payout_simulation_update();

create trigger payout_simulations_no_delete
  before delete on public.payout_simulations
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.payout_quotes enable row level security;
alter table public.payout_simulations enable row level security;

revoke all on public.payout_quotes, public.payout_simulations from anon, authenticated;
grant select on public.payout_quotes, public.payout_simulations to authenticated;

create policy "payout_quotes: owner can read"
  on public.payout_quotes for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "payout_simulations: owner can read"
  on public.payout_simulations for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- create_payout_quote: only for the owner's confirmed request with a receipt.
-- The caller computes the figures; the table constraints re-check them and
-- this function pins the input to the request amount.
-- ---------------------------------------------------------------------------
create function public.create_payout_quote(
  p_user_id uuid,
  p_request_id uuid,
  p_input_units numeric,
  p_service_fee_bps integer,
  p_service_fee_units numeric,
  p_fixed_fee_units numeric,
  p_net_units numeric,
  p_fx_scale integer,
  p_reference_rate_scaled integer,
  p_spread_bps integer,
  p_effective_rate_scaled integer,
  p_output_minor numeric,
  p_assumptions_version text,
  p_valid_seconds integer
)
returns public.payout_quotes
language plpgsql
set search_path = ''
as $$
declare
  v_request public.payment_requests;
  v_quote public.payout_quotes;
begin
  if p_valid_seconds is null or p_valid_seconds not between 1 and 900 then
    raise exception 'invalid_quote_validity' using errcode = 'P0001';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_request_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;

  if v_request.status <> 'confirmed'
    or not exists (select 1 from public.verified_receipts where request_id = p_request_id)
  then
    raise exception 'request_not_confirmed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payout_simulations where request_id = p_request_id) then
    raise exception 'simulation_exists' using errcode = 'P0001';
  end if;
  if p_input_units <> v_request.amount_units then
    raise exception 'quote_input_mismatch' using errcode = 'P0001';
  end if;
  if (select count(*) from public.payout_quotes where request_id = p_request_id) >= 30 then
    raise exception 'too_many_quotes' using errcode = 'P0001';
  end if;

  insert into public.payout_quotes (
    request_id, user_id, input_units, service_fee_bps, service_fee_units, fixed_fee_units,
    net_units, fx_scale, reference_rate_scaled, spread_bps, effective_rate_scaled, output_minor,
    currency, assumptions_version, expires_at
  )
  values (
    p_request_id, p_user_id, p_input_units, p_service_fee_bps, p_service_fee_units, p_fixed_fee_units,
    p_net_units, p_fx_scale, p_reference_rate_scaled, p_spread_bps, p_effective_rate_scaled, p_output_minor,
    'BRL', p_assumptions_version, now() + make_interval(secs => p_valid_seconds)
  )
  returning * into v_quote;

  insert into public.audit_events (user_id, request_id, event_type, metadata)
  values (p_user_id, p_request_id, 'payout.quote_created',
          jsonb_build_object('quote_id', v_quote.id, 'output_minor', v_quote.output_minor::text,
                             'assumptions_version', p_assumptions_version));

  return v_quote;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_payout_simulation: one per request. Idempotent per key: the same key
-- returns the same simulation; a different key for the same request fails.
-- The caller must have re-checked the chain evidence just before (rule 9).
-- ---------------------------------------------------------------------------
create function public.create_payout_simulation(
  p_user_id uuid,
  p_quote_id uuid,
  p_idempotency_key text
)
returns public.payout_simulations
language plpgsql
set search_path = ''
as $$
declare
  v_quote public.payout_quotes;
  v_request public.payment_requests;
  v_simulation public.payout_simulations;
begin
  select * into v_quote
  from public.payout_quotes
  where id = p_quote_id and user_id = p_user_id;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0001';
  end if;

  -- Lock the request first: serializes concurrent simulations for it.
  select * into v_request
  from public.payment_requests
  where id = v_quote.request_id
  for update;

  select * into v_simulation
  from public.payout_simulations
  where idempotency_key = p_idempotency_key;
  if found then
    if v_simulation.user_id = p_user_id and v_simulation.quote_id = p_quote_id then
      return v_simulation; -- idempotent repeat
    end if;
    raise exception 'idempotency_key_reused' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.payout_simulations where request_id = v_quote.request_id) then
    raise exception 'simulation_exists' using errcode = 'P0001';
  end if;
  if v_request.status <> 'confirmed' then
    raise exception 'request_not_confirmed' using errcode = 'P0001';
  end if;
  if v_quote.expires_at <= now() then
    raise exception 'quote_expired' using errcode = 'P0001';
  end if;

  insert into public.payout_simulations (request_id, quote_id, user_id, idempotency_key)
  values (v_quote.request_id, p_quote_id, p_user_id, p_idempotency_key)
  returning * into v_simulation;

  insert into public.audit_events (user_id, request_id, event_type, metadata)
  values (p_user_id, v_quote.request_id, 'payout.simulation_created',
          jsonb_build_object('simulation_id', v_simulation.id, 'quote_id', p_quote_id));

  return v_simulation;
end;
$$;

-- ---------------------------------------------------------------------------
-- advance_payout_simulation: deterministic, server-timed transitions.
--   created    -> processing           once 1 s has passed
--   processing -> completed_simulation once 3 s have passed AND the caller
--                                      re-checked the evidence (p_evidence_ok)
--   processing -> failed_simulation    if that re-check found it invalid
-- p_evidence_ok null means "not checked / chain unavailable": no completion.
-- ---------------------------------------------------------------------------
create function public.advance_payout_simulation(
  p_user_id uuid,
  p_simulation_id uuid,
  p_evidence_ok boolean
)
returns public.payout_simulations
language plpgsql
set search_path = ''
as $$
declare
  v_simulation public.payout_simulations;
begin
  select * into v_simulation
  from public.payout_simulations
  where id = p_simulation_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'simulation_not_found' using errcode = 'P0001';
  end if;

  if v_simulation.status = 'created' and now() - v_simulation.created_at >= interval '1 second' then
    update public.payout_simulations
    set status = 'processing', processing_at = now()
    where id = p_simulation_id
    returning * into v_simulation;

    insert into public.audit_events (user_id, request_id, event_type, metadata)
    values (p_user_id, v_simulation.request_id, 'payout.simulation_processing',
            jsonb_build_object('simulation_id', p_simulation_id));
  elsif v_simulation.status = 'processing'
    and now() - v_simulation.processing_at >= interval '3 seconds'
    and p_evidence_ok is not null
  then
    if p_evidence_ok then
      update public.payout_simulations
      set status = 'completed_simulation', completed_at = now()
      where id = p_simulation_id
      returning * into v_simulation;

      insert into public.audit_events (user_id, request_id, event_type, metadata)
      values (p_user_id, v_simulation.request_id, 'payout.simulation_completed',
              jsonb_build_object('simulation_id', p_simulation_id));
    else
      update public.payout_simulations
      set status = 'failed_simulation', completed_at = now(), failure_code = 'evidence_invalidated'
      where id = p_simulation_id
      returning * into v_simulation;

      insert into public.audit_events (user_id, request_id, event_type, metadata)
      values (p_user_id, v_simulation.request_id, 'payout.simulation_failed',
              jsonb_build_object('simulation_id', p_simulation_id, 'failure_code', 'evidence_invalidated'));
    end if;
  end if;

  return v_simulation;
end;
$$;

-- ---------------------------------------------------------------------------
-- flag_evidence_review: the receipt behind a confirmed request is no longer
-- on the canonical chain. Moves the request to under_review and fails any
-- unfinished simulation. History is preserved (receipts stay append-only).
-- ---------------------------------------------------------------------------
create function public.flag_evidence_review(p_request_id uuid, p_reason text)
returns public.payment_requests
language plpgsql
set search_path = ''
as $$
declare
  v_request public.payment_requests;
begin
  if p_reason is null or p_reason !~ '^[a-z_]{3,64}$' then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if v_request.status = 'under_review' then
    return v_request;
  end if;
  if v_request.status <> 'confirmed' then
    raise exception 'request_not_confirmed' using errcode = 'P0001';
  end if;

  update public.payment_requests set status = 'under_review' where id = p_request_id
  returning * into v_request;

  update public.payout_simulations
  set status = 'failed_simulation', completed_at = now(), failure_code = 'evidence_invalidated'
  where request_id = p_request_id and status in ('created', 'processing');

  insert into public.audit_events (user_id, request_id, event_type, metadata)
  values (v_request.user_id, p_request_id, 'payment.evidence_invalidated',
          jsonb_build_object('reason', p_reason));

  return v_request;
end;
$$;

revoke all on function public.create_payout_quote(uuid, uuid, numeric, integer, numeric, numeric, numeric, integer, integer, integer, integer, numeric, text, integer)
  from public, anon, authenticated;
revoke all on function public.create_payout_simulation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.advance_payout_simulation(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.flag_evidence_review(uuid, text) from public, anon, authenticated;

grant execute on function public.create_payout_quote(uuid, uuid, numeric, integer, numeric, numeric, numeric, integer, integer, integer, integer, numeric, text, integer)
  to service_role;
grant execute on function public.create_payout_simulation(uuid, uuid, text) to service_role;
grant execute on function public.advance_payout_simulation(uuid, uuid, boolean) to service_role;
grant execute on function public.flag_evidence_review(uuid, text) to service_role;
