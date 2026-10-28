-- PR 3: payment requests with an immutable recipient/amount snapshot and a
-- public capability link (only its SHA-256 hash is stored).
--
-- Access model (same as PR 2):
--   * Owners SELECT their own rows; no client writes; anon has no access.
--   * Create / regenerate link / cancel go through service_role-only
--     functions that take user_id from the verified server session.
--   * The public payment page is served by the server, which looks up a
--     request by token hash and returns a minimal projection.

create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wallet_id uuid not null references public.wallets (id) on delete restrict,
  recipient_snapshot text not null check (
    recipient_snapshot ~ '^0x[0-9a-f]{40}$'
    and recipient_snapshot <> '0x0000000000000000000000000000000000000000'
  ),
  -- Integer USDC base units (6 decimals). Never floating point.
  -- Unconstrained numeric plus explicit checks: numeric(78,0) would silently
  -- round 1.5 to 2 on assignment instead of rejecting it.
  amount_units numeric not null check (
    amount_units > 0
    and amount_units = trunc(amount_units)
    and amount_units < 1e78
  ),
  chain_id integer not null check (chain_id = 84532),
  token_address text not null check (token_address = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'),
  status text not null default 'open'
    check (status in ('open', 'confirming', 'confirmed', 'expired', 'cancelled')),
  public_token_hash text not null unique check (public_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index payment_requests_user_created_idx
  on public.payment_requests (user_id, created_at desc);

alter table public.audit_events
  add constraint audit_events_request_id_fkey
  foreign key (request_id) references public.payment_requests (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Snapshot immutability and allowed status transitions (enforced for every
-- role, including service_role).
-- ---------------------------------------------------------------------------
create function public.guard_payment_request_update()
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
  then
    raise exception 'payment_request_snapshot_immutable' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'open' and new.status in ('confirming', 'expired', 'cancelled'))
    or (old.status = 'confirming' and new.status in ('open', 'confirmed', 'expired'))
  ) then
    raise exception 'payment_request_invalid_transition' using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.guard_payment_request_update() from public, anon, authenticated;

create trigger payment_requests_guard_update
  before update on public.payment_requests
  for each row execute function public.guard_payment_request_update();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.payment_requests enable row level security;

revoke all on public.payment_requests from anon, authenticated;
grant select on public.payment_requests to authenticated;

create policy "payment_requests: owner can read"
  on public.payment_requests for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- create_payment_request: snapshots the recipient from a wallet the user owns.
-- ---------------------------------------------------------------------------
create function public.create_payment_request(
  p_user_id uuid,
  p_wallet_id uuid,
  p_amount_units numeric,
  p_public_token_hash text,
  p_expires_at timestamptz
)
returns public.payment_requests
language plpgsql
set search_path = ''
as $$
declare
  v_wallet public.wallets;
  v_request public.payment_requests;
begin
  select * into v_wallet
  from public.wallets
  where id = p_wallet_id and user_id = p_user_id;

  if not found then
    raise exception 'wallet_not_found' using errcode = 'P0001';
  end if;

  insert into public.payment_requests (
    user_id, wallet_id, recipient_snapshot, amount_units, chain_id, token_address,
    public_token_hash, expires_at
  )
  values (
    p_user_id, v_wallet.id, v_wallet.address, p_amount_units, v_wallet.chain_id,
    '0x036cbd53842c5426634e7929541ec2318f3dcf7e', p_public_token_hash, p_expires_at
  )
  returning * into v_request;

  insert into public.audit_events (user_id, request_id, event_type)
  values (p_user_id, v_request.id, 'request.created');

  return v_request;
end;
$$;

-- ---------------------------------------------------------------------------
-- regenerate_payment_link: replaces the capability; the old link stops working.
-- ---------------------------------------------------------------------------
create function public.regenerate_payment_link(
  p_user_id uuid,
  p_request_id uuid,
  p_public_token_hash text
)
returns public.payment_requests
language plpgsql
set search_path = ''
as $$
declare
  v_request public.payment_requests;
begin
  select * into v_request
  from public.payment_requests
  where id = p_request_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if v_request.status <> 'open' or v_request.expires_at <= now() then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;

  update public.payment_requests
  set public_token_hash = p_public_token_hash
  where id = v_request.id
  returning * into v_request;

  insert into public.audit_events (user_id, request_id, event_type)
  values (p_user_id, v_request.id, 'request.link_regenerated');

  return v_request;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_payment_request: open → cancelled. The link stops working.
-- ---------------------------------------------------------------------------
create function public.cancel_payment_request(p_user_id uuid, p_request_id uuid)
returns public.payment_requests
language plpgsql
set search_path = ''
as $$
declare
  v_request public.payment_requests;
begin
  select * into v_request
  from public.payment_requests
  where id = p_request_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if v_request.status <> 'open' then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;

  update public.payment_requests
  set status = 'cancelled'
  where id = v_request.id
  returning * into v_request;

  insert into public.audit_events (user_id, request_id, event_type)
  values (p_user_id, v_request.id, 'request.cancelled');

  return v_request;
end;
$$;

revoke all on function public.create_payment_request(uuid, uuid, numeric, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.regenerate_payment_link(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_payment_request(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_payment_request(uuid, uuid, numeric, text, timestamptz)
  to service_role;
grant execute on function public.regenerate_payment_link(uuid, uuid, text) to service_role;
grant execute on function public.cancel_payment_request(uuid, uuid) to service_role;
