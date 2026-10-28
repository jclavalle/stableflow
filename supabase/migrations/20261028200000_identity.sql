-- PR 2: identity, wallet proof and audit tables.
-- Payment, receipt, quote and simulation tables arrive with PRs 3–5.
--
-- Access model:
--   * RLS is enabled on every table.
--   * Authenticated users may only SELECT their own rows.
--   * All writes go through the server (service_role) and the functions below.
--   * anon has no table access at all.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  preferred_currency text not null default 'BRL' check (preferred_currency in ('BRL')),
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- wallet_challenges (server-only; never readable by clients)
-- ---------------------------------------------------------------------------
create table public.wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null check (chain_id = 84532),
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  message text not null,
  domain text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create index wallet_challenges_user_created_idx
  on public.wallet_challenges (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- wallets (verified only; no private keys, ever)
-- ---------------------------------------------------------------------------
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  address text not null check (
    address ~ '^0x[0-9a-f]{40}$'
    and address <> '0x0000000000000000000000000000000000000000'
  ),
  chain_id integer not null check (chain_id = 84532),
  verified_at timestamptz not null default now(),
  unique (chain_id, address)
);

create index wallets_user_idx on public.wallets (user_id);

-- ---------------------------------------------------------------------------
-- audit_events (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  request_id uuid,
  event_type text not null check (event_type ~ '^[a-z][a-z_.]{2,63}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_user_created_idx on public.audit_events (user_id, created_at desc);

create function public.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only' using errcode = 'P0001';
end;
$$;

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function public.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.wallet_challenges enable row level security;
alter table public.wallets enable row level security;
alter table public.audit_events enable row level security;

-- Start from nothing, then grant only reads to signed-in users.
revoke all on public.profiles, public.wallet_challenges, public.wallets, public.audit_events
  from anon, authenticated;

grant select on public.profiles, public.wallets, public.audit_events to authenticated;

create policy "profiles: owner can read"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "wallets: owner can read"
  on public.wallets for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "audit_events: owner can read"
  on public.audit_events for select to authenticated
  using ((select auth.uid()) = user_id);

-- wallet_challenges: no grants and no policies for clients.

-- ---------------------------------------------------------------------------
-- link_wallet: consume a challenge and link the wallet atomically.
-- The caller (server) must have already verified the signature over the exact
-- stored message. user_id comes from the server session, never a request body.
-- ---------------------------------------------------------------------------
create function public.link_wallet(p_user_id uuid, p_nonce_hash text)
returns public.wallets
language plpgsql
set search_path = ''
as $$
declare
  v_challenge public.wallet_challenges;
  v_wallet public.wallets;
begin
  select * into v_challenge
  from public.wallet_challenges
  where nonce_hash = p_nonce_hash and user_id = p_user_id
  for update;

  if not found then
    raise exception 'challenge_not_found' using errcode = 'P0001';
  end if;
  if v_challenge.consumed_at is not null then
    raise exception 'challenge_consumed' using errcode = 'P0001';
  end if;
  if v_challenge.expires_at <= now() then
    raise exception 'challenge_expired' using errcode = 'P0001';
  end if;

  update public.wallet_challenges
  set consumed_at = now()
  where id = v_challenge.id;

  select * into v_wallet
  from public.wallets
  where chain_id = v_challenge.chain_id and address = v_challenge.address
  for update;

  if found then
    if v_wallet.user_id <> p_user_id then
      raise exception 'wallet_linked_to_another_user' using errcode = 'P0001';
    end if;
    update public.wallets set verified_at = now() where id = v_wallet.id
    returning * into v_wallet;
  else
    insert into public.wallets (user_id, address, chain_id)
    values (p_user_id, v_challenge.address, v_challenge.chain_id)
    returning * into v_wallet;
  end if;

  insert into public.audit_events (user_id, event_type, metadata)
  values (
    p_user_id,
    'wallet.linked',
    jsonb_build_object('wallet_id', v_wallet.id, 'chain_id', v_wallet.chain_id)
  );

  return v_wallet;
end;
$$;

revoke all on function public.link_wallet(uuid, text) from public, anon, authenticated;
grant execute on function public.link_wallet(uuid, text) to service_role;

revoke all on function public.reject_audit_mutation() from public, anon, authenticated;
