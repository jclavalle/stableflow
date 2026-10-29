-- PR 4: payment attempts, verified receipts and atomic confirmation.
--
-- A payer-submitted transaction hash is only a *candidate* (payment_attempts).
-- A request becomes `confirmed` only when the server has verified the chain
-- receipt and confirm_payment() inserts unique evidence (verified_receipts)
-- in the same transaction that changes the request status.

-- ---------------------------------------------------------------------------
-- creation_block: head block captured before the request is published, so
-- older transfers can never satisfy a new request. Requests from before this
-- migration have none and can never be confirmed (fail closed).
-- ---------------------------------------------------------------------------
alter table public.payment_requests
  add column creation_block bigint check (creation_block is null or creation_block > 0);

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
  ) then
    raise exception 'payment_request_invalid_transition' using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop function public.create_payment_request(uuid, uuid, numeric, text, timestamptz);

create function public.create_payment_request(
  p_user_id uuid,
  p_wallet_id uuid,
  p_amount_units numeric,
  p_public_token_hash text,
  p_expires_at timestamptz,
  p_creation_block bigint
)
returns public.payment_requests
language plpgsql
set search_path = ''
as $$
declare
  v_wallet public.wallets;
  v_request public.payment_requests;
begin
  if p_creation_block is null or p_creation_block <= 0 then
    raise exception 'creation_block_required' using errcode = 'P0001';
  end if;

  select * into v_wallet
  from public.wallets
  where id = p_wallet_id and user_id = p_user_id;

  if not found then
    raise exception 'wallet_not_found' using errcode = 'P0001';
  end if;

  insert into public.payment_requests (
    user_id, wallet_id, recipient_snapshot, amount_units, chain_id, token_address,
    public_token_hash, expires_at, creation_block
  )
  values (
    p_user_id, v_wallet.id, v_wallet.address, p_amount_units, v_wallet.chain_id,
    '0x036cbd53842c5426634e7929541ec2318f3dcf7e', p_public_token_hash, p_expires_at,
    p_creation_block
  )
  returning * into v_request;

  insert into public.audit_events (user_id, request_id, event_type)
  values (p_user_id, v_request.id, 'request.created');

  return v_request;
end;
$$;

revoke all on function public.create_payment_request(uuid, uuid, numeric, text, timestamptz, bigint)
  from public, anon, authenticated;
grant execute on function public.create_payment_request(uuid, uuid, numeric, text, timestamptz, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- payment_attempts: candidate transaction hashes. An invalid attempt never
-- fails the request.
--   submitted — stored, not yet found on chain
--   pending   — matching transfer found, waiting for confirmations
--   rejected  — does not satisfy this request (error_code says why)
--   verified  — evidence recorded in verified_receipts
-- ---------------------------------------------------------------------------
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.payment_requests (id) on delete cascade,
  chain_id integer not null check (chain_id = 84532),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  status text not null default 'submitted'
    check (status in ('submitted', 'pending', 'rejected', 'verified')),
  error_code text check (error_code is null or error_code ~ '^[a-z_]{3,64}$'),
  confirmations integer not null default 0 check (confirmations >= 0),
  created_at timestamptz not null default now(),
  last_checked_at timestamptz,
  unique (request_id, chain_id, tx_hash)
);

create index payment_attempts_request_idx on public.payment_attempts (request_id, created_at desc);

-- ---------------------------------------------------------------------------
-- verified_receipts: one per request; a (chain, tx, log) can satisfy only one
-- request, ever.
-- ---------------------------------------------------------------------------
create table public.verified_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.payment_requests (id) on delete restrict,
  chain_id integer not null check (chain_id = 84532),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number > 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_timestamp timestamptz not null,
  sender text not null check (sender ~ '^0x[0-9a-f]{40}$'),
  recipient text not null check (recipient ~ '^0x[0-9a-f]{40}$'),
  amount_units numeric not null check (amount_units > 0 and amount_units = trunc(amount_units)),
  confirmations integer not null check (confirmations > 0),
  verified_at timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index)
);

create function public.reject_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'verified_receipts is append-only' using errcode = 'P0001';
end;
$$;

revoke all on function public.reject_receipt_mutation() from public, anon, authenticated;

create trigger verified_receipts_append_only
  before update or delete on public.verified_receipts
  for each row execute function public.reject_receipt_mutation();

-- ---------------------------------------------------------------------------
-- Privileges and RLS: owners read attempts/receipts of their own requests.
-- ---------------------------------------------------------------------------
alter table public.payment_attempts enable row level security;
alter table public.verified_receipts enable row level security;

revoke all on public.payment_attempts, public.verified_receipts from anon, authenticated;
grant select on public.payment_attempts, public.verified_receipts to authenticated;

create policy "payment_attempts: request owner can read"
  on public.payment_attempts for select to authenticated
  using (exists (
    select 1 from public.payment_requests r
    where r.id = request_id and r.user_id = (select auth.uid())
  ));

create policy "verified_receipts: request owner can read"
  on public.verified_receipts for select to authenticated
  using (exists (
    select 1 from public.payment_requests r
    where r.id = request_id and r.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- submit_payment_attempt: store a candidate hash for an open request.
-- Idempotent per (request, tx). Capped per request.
-- ---------------------------------------------------------------------------
create function public.submit_payment_attempt(p_request_id uuid, p_tx_hash text)
returns public.payment_attempts
language plpgsql
set search_path = ''
as $$
declare
  v_request public.payment_requests;
  v_attempt public.payment_attempts;
  v_count integer;
begin
  select * into v_request
  from public.payment_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;

  select * into v_attempt
  from public.payment_attempts
  where request_id = p_request_id and chain_id = v_request.chain_id and tx_hash = p_tx_hash;
  if found then
    return v_attempt;
  end if;

  if v_request.status not in ('open', 'confirming')
    or (v_request.status = 'open' and v_request.expires_at <= now())
  then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.payment_attempts where request_id = p_request_id;
  if v_count >= 10 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;

  insert into public.payment_attempts (request_id, chain_id, tx_hash)
  values (p_request_id, v_request.chain_id, p_tx_hash)
  returning * into v_attempt;

  insert into public.audit_events (user_id, request_id, event_type, metadata)
  values (v_request.user_id, p_request_id, 'payment.attempt_submitted',
          jsonb_build_object('tx_hash', p_tx_hash));

  return v_attempt;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_attempt_check: store a non-final verifier outcome and keep the
-- request status consistent (confirming iff some attempt is pending).
-- ---------------------------------------------------------------------------
create function public.record_attempt_check(
  p_request_id uuid,
  p_tx_hash text,
  p_status text,
  p_error_code text,
  p_confirmations integer
)
returns public.payment_attempts
language plpgsql
set search_path = ''
as $$
declare
  v_request public.payment_requests;
  v_attempt public.payment_attempts;
begin
  if p_status not in ('submitted', 'pending', 'rejected') then
    raise exception 'invalid_attempt_status' using errcode = 'P0001';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;

  update public.payment_attempts
  set status = p_status,
      error_code = case when p_status = 'rejected' then p_error_code else null end,
      confirmations = coalesce(p_confirmations, 0),
      last_checked_at = now()
  where request_id = p_request_id and tx_hash = p_tx_hash and status <> 'verified'
  returning * into v_attempt;

  if not found then
    select * into v_attempt
    from public.payment_attempts
    where request_id = p_request_id and tx_hash = p_tx_hash;
    if not found then
      raise exception 'attempt_not_found' using errcode = 'P0001';
    end if;
    return v_attempt; -- already verified; nothing to change
  end if;

  if v_request.status = 'open'
    and exists (select 1 from public.payment_attempts where request_id = p_request_id and status = 'pending')
  then
    update public.payment_requests set status = 'confirming' where id = p_request_id;
  elsif v_request.status = 'confirming'
    and not exists (select 1 from public.payment_attempts where request_id = p_request_id and status = 'pending')
  then
    update public.payment_requests set status = 'open' where id = p_request_id;
  end if;

  if p_status = 'rejected' then
    insert into public.audit_events (user_id, request_id, event_type, metadata)
    values (v_request.user_id, p_request_id, 'payment.attempt_rejected',
            jsonb_build_object('tx_hash', p_tx_hash, 'error_code', p_error_code));
  end if;

  return v_attempt;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_payment: lock the request, re-check the evidence against the
-- immutable snapshot, insert unique evidence and mark confirmed — atomically.
-- Repeating the same confirmation returns the existing receipt.
-- ---------------------------------------------------------------------------
create function public.confirm_payment(
  p_request_id uuid,
  p_tx_hash text,
  p_log_index integer,
  p_block_number bigint,
  p_block_hash text,
  p_block_timestamp timestamptz,
  p_sender text,
  p_recipient text,
  p_amount_units numeric,
  p_confirmations integer
)
returns public.verified_receipts
language plpgsql
set search_path = ''
as $$
declare
  v_request public.payment_requests;
  v_receipt public.verified_receipts;
begin
  select * into v_request
  from public.payment_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;

  select * into v_receipt from public.verified_receipts where request_id = p_request_id;
  if found then
    if v_receipt.tx_hash = p_tx_hash and v_receipt.log_index = p_log_index then
      return v_receipt; -- idempotent repeat
    end if;
    raise exception 'request_already_confirmed' using errcode = 'P0001';
  end if;

  if v_request.status not in ('open', 'confirming') then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;
  if v_request.creation_block is null or p_block_number < v_request.creation_block then
    raise exception 'evidence_before_request' using errcode = 'P0001';
  end if;
  if p_block_timestamp >= v_request.expires_at then
    raise exception 'evidence_after_expiry' using errcode = 'P0001';
  end if;
  if p_recipient <> v_request.recipient_snapshot
    or p_amount_units <> v_request.amount_units
  then
    raise exception 'evidence_mismatch' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.payment_attempts
    where request_id = p_request_id and tx_hash = p_tx_hash
  ) then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;

  begin
    insert into public.verified_receipts (
      request_id, chain_id, tx_hash, log_index, block_number, block_hash, block_timestamp,
      sender, recipient, amount_units, confirmations
    )
    values (
      p_request_id, v_request.chain_id, p_tx_hash, p_log_index, p_block_number, p_block_hash,
      p_block_timestamp, p_sender, p_recipient, p_amount_units, p_confirmations
    )
    returning * into v_receipt;
  exception when unique_violation then
    raise exception 'evidence_already_used' using errcode = 'P0001';
  end;

  update public.payment_attempts
  set status = 'verified', error_code = null, confirmations = p_confirmations, last_checked_at = now()
  where request_id = p_request_id and tx_hash = p_tx_hash;

  if v_request.status = 'open' then
    update public.payment_requests set status = 'confirming' where id = p_request_id;
  end if;
  update public.payment_requests set status = 'confirmed' where id = p_request_id;

  insert into public.audit_events (user_id, request_id, event_type, metadata)
  values (v_request.user_id, p_request_id, 'payment.confirmed',
          jsonb_build_object('tx_hash', p_tx_hash, 'block_number', p_block_number));

  return v_receipt;
end;
$$;

revoke all on function public.submit_payment_attempt(uuid, text) from public, anon, authenticated;
revoke all on function public.record_attempt_check(uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.confirm_payment(uuid, text, integer, bigint, text, timestamptz, text, text, numeric, integer)
  from public, anon, authenticated;

grant execute on function public.submit_payment_attempt(uuid, text) to service_role;
grant execute on function public.record_attempt_check(uuid, text, text, text, integer) to service_role;
grant execute on function public.confirm_payment(uuid, text, integer, bigint, text, timestamptz, text, text, numeric, integer)
  to service_role;
