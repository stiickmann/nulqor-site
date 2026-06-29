begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.username_login_rate_limits (
  bucket_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint username_login_rate_limits_hash_check
    check (bucket_hash ~ '^[a-f0-9]{64}$'),
  constraint username_login_rate_limits_attempt_count_check
    check (attempt_count >= 0)
);

alter table private.username_login_rate_limits enable row level security;

revoke all on table private.username_login_rate_limits from public, anon, authenticated, service_role;

comment on table private.username_login_rate_limits is
  'Server-only hashed rate-limit buckets for Forge username sign-in.';

create or replace function public.user_id_for_login_username(p_username text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id
  from public.profiles as p
  where lower(p.username) = lower(btrim(p_username))
  limit 1;
$$;

revoke all on function public.user_id_for_login_username(text) from public, anon, authenticated;
grant execute on function public.user_id_for_login_username(text) to service_role;

create or replace function public.consume_username_login_attempt(
  p_bucket_hash text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_attempt_count integer;
  v_blocked_until timestamptz;
  v_allowed boolean := true;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_bucket_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid rate-limit bucket';
  end if;

  if p_max_attempts < 1 or p_max_attempts > 100
     or p_window_seconds < 1 or p_window_seconds > 86400
     or p_block_seconds < 1 or p_block_seconds > 86400 then
    raise exception 'invalid rate-limit settings';
  end if;

  insert into private.username_login_rate_limits (
    bucket_hash,
    window_started_at,
    attempt_count,
    updated_at
  ) values (
    p_bucket_hash,
    v_now,
    0,
    v_now
  )
  on conflict (bucket_hash) do nothing;

  select r.window_started_at, r.attempt_count, r.blocked_until
    into v_window_started_at, v_attempt_count, v_blocked_until
  from private.username_login_rate_limits as r
  where r.bucket_hash = p_bucket_hash
  for update;

  if v_blocked_until is not null and v_blocked_until > v_now then
    v_allowed := false;
  elsif v_window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    update private.username_login_rate_limits
       set window_started_at = v_now,
           attempt_count = 1,
           blocked_until = null,
           updated_at = v_now
     where bucket_hash = p_bucket_hash;
  else
    v_attempt_count := v_attempt_count + 1;
    v_allowed := v_attempt_count <= p_max_attempts;

    update private.username_login_rate_limits
       set attempt_count = v_attempt_count,
           blocked_until = case
             when v_allowed then null
             else v_now + make_interval(secs => p_block_seconds)
           end,
           updated_at = v_now
     where bucket_hash = p_bucket_hash;
  end if;

  if random() < 0.01 then
    delete from private.username_login_rate_limits
     where updated_at < v_now - interval '1 day';
  end if;

  return v_allowed;
end;
$$;

revoke all on function public.consume_username_login_attempt(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_username_login_attempt(text, integer, integer, integer)
  to service_role;

commit;
