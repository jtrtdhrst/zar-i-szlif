-- Żar i Szlif | Supabase PostgreSQL | initial private user registry + durable welcome queue
-- New source of truth. D1 is NOT a deployment target.
-- Fail-closed: no emails until explicit historical-user reconciliation + deployment approval.
begin;

create table if not exists public.app_users (
  google_sub text primary key check (length(google_sub) between 1 and 255),
  email text not null check (length(email) between 3 and 254),
  email_verified boolean not null default false,
  creation_source text not null check (creation_source in ('oauth_first_seen', 'verified_signup', 'legacy_import')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists app_users_email_idx on public.app_users (lower(email));

create table if not exists public.welcome_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  historical_accounts_reconciled boolean not null default false,
  cutover_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.welcome_control (singleton, enabled, historical_accounts_reconciled)
values (true, false, false) on conflict (singleton) do nothing;

create table if not exists public.welcome_jobs (
  event_id uuid primary key default gen_random_uuid(),
  google_sub text not null unique references public.app_users(google_sub) on delete restrict,
  kind text not null default 'registration_created' check (kind = 'registration_created'),
  state text not null default 'queued'
    check (state in ('queued', 'leased', 'delivered', 'needs_reconciliation', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_id uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  provider_contact_id text,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists welcome_jobs_ready_idx on public.welcome_jobs (state, available_at);

alter table public.app_users enable row level security;
alter table public.welcome_control enable row level security;
alter table public.welcome_jobs enable row level security;
revoke all on public.app_users, public.welcome_control, public.welcome_jobs from anon, authenticated;
grant select, insert, update on public.app_users, public.welcome_control, public.welcome_jobs to service_role;

-- Only call from a server after verifying the Google OIDC identity. A login is NOT
-- proof of new registration. p_authoritative_signup must be false for plain login.
-- One SQL transaction: unique insert decides is_new, queue unique decides enrollment.
create or replace function public.register_app_user(
  p_google_sub text,
  p_email text,
  p_email_verified boolean,
  p_authoritative_signup boolean default false
)
returns table(is_new boolean, account_created_at timestamptz, welcome_enqueued boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_created timestamptz;
  v_new boolean := false;
  v_queued boolean := false;
  v_gate public.welcome_control%rowtype;
begin
  if p_google_sub is null or length(trim(p_google_sub)) = 0 or
     p_email is null or position('@' in p_email) < 2 or
     coalesce(p_email_verified, false) is false then
    raise exception 'verified Google identity required' using errcode = '22023';
  end if;

  insert into public.app_users(google_sub,email,email_verified,creation_source)
  values(trim(p_google_sub),lower(trim(p_email)),true,
         case when p_authoritative_signup then 'verified_signup' else 'oauth_first_seen' end)
  on conflict (google_sub) do nothing returning created_at into v_created;

  v_new := (v_created is not null);
  if not v_new then
    update public.app_users
       set last_seen_at = now(), email = lower(trim(p_email)), email_verified = true
     where google_sub = trim(p_google_sub)
     returning created_at into v_created;
  end if;

  select * into v_gate from public.welcome_control where singleton = true;
  if v_new and p_authoritative_signup and v_gate.enabled and
     v_gate.historical_accounts_reconciled and v_gate.cutover_at is not null and
     v_created >= v_gate.cutover_at then
    insert into public.welcome_jobs (google_sub)
    values (trim(p_google_sub))
    on conflict (google_sub) do nothing;
    v_queued := found;
  end if;

  return query select v_new,v_created,v_queued;
end;
$$;
revoke all on function public.register_app_user(text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.register_app_user(text,text,boolean,boolean) to service_role;

-- Claim a job atomically. Never dispatch a second provider request after an
-- ambiguous result without checking the actual Mautic effect / stable marker.
create or replace function public.claim_welcome_job()
returns table(event_id uuid, google_sub text, lease_id uuid)
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with candidate as (
    select j.event_id from public.welcome_jobs j
    where j.state = 'queued' and j.available_at <= now()
    order by j.created_at for update skip locked limit 1
  ), claimed as (
    update public.welcome_jobs j
    set state = 'leased', attempts = j.attempts + 1,
        lease_id = gen_random_uuid(), lease_until = now() + interval '5 minutes'
    from candidate c where j.event_id = c.event_id
    returning j.event_id, j.google_sub, j.lease_id
  )
  select c.event_id,c.google_sub,c.lease_id from claimed c;
end;
$$;
revoke all on function public.claim_welcome_job() from public, anon, authenticated;
grant execute on function public.claim_welcome_job() to service_role;

-- Provider success is marked ONLY after provider readback; any timeout/uncertain
-- outcome goes to needs_reconciliation, never automatically re-enqueue.
create or replace function public.finish_welcome_job(
  p_event_id uuid, p_lease_id uuid, p_delivered boolean,
  p_provider_contact_id text default null, p_provider_message_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  update public.welcome_jobs
    set state = case when p_delivered then 'delivered' else 'needs_reconciliation' end,
        delivered_at = case when p_delivered then now() else null end,
        provider_contact_id = p_provider_contact_id,
        provider_message_id = p_provider_message_id,
        lease_id = null, lease_until = null
  where event_id = p_event_id and lease_id = p_lease_id and state = 'leased';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;
revoke all on function public.finish_welcome_job(uuid,uuid,boolean,text,text) from public, anon, authenticated;
grant execute on function public.finish_welcome_job(uuid,uuid,boolean,text,text) to service_role;

commit;
