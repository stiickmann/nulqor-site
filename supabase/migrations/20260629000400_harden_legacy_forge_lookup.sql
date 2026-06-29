create or replace function public.forge_lookup_public_profile(search_value text)
returns table(user_id uuid, username text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.username, profile.display_name, profile.avatar_url
  from public.profiles profile
  where public.has_active_access()
    and search_value ~ '^[A-Za-z0-9_]{3,20}$'
    and profile.access_status = 'active'
    and profile.profile_visibility = 'public'
    and profile.allow_public_lookup
    and lower(profile.username) = lower(btrim(search_value))
  limit 1;
$$;

revoke all on function public.forge_lookup_public_profile(text) from public, anon;
grant execute on function public.forge_lookup_public_profile(text) to authenticated, service_role;

create or replace function public.forge_shared_seat_limit(owner_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when profile.access_status <> 'active' or profile.role is null then 0
    when profile.role = 'Nulqor Free' then 3
    when profile.role = 'Nulqor Creator' then 6
    when profile.role = 'Nulqor Teams' then 24
    when profile.role in (
      'Nulqor Enterprise', 'Site Tester', 'App Tester',
      'Site Admin', 'App Admin', 'Founder'
    ) then 200
    else 0
  end
  from public.profiles profile
  where profile.id = owner_user_id;
$$;

revoke all on function public.forge_shared_seat_limit(uuid) from public, anon, authenticated;
grant execute on function public.forge_shared_seat_limit(uuid) to service_role;
