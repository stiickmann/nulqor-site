create or replace function public.public_account_lookup(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_profile public.profiles%rowtype;
  viewer_id uuid := (select auth.uid());
  viewer_role text;
  viewer_is_owner boolean := false;
  viewer_is_internal_admin boolean := false;
  viewer_is_staff boolean := false;
  public_allowed boolean := false;
  telemetry_snapshot jsonb := '{}'::jsonb;
  telemetry_updated_at timestamptz;
  telemetry_source text;
  telemetry_app_version text;
  public_plugins jsonb := '[]'::jsonb;
  public_projects jsonb := '[]'::jsonb;
  account_identity jsonb := null;
  account_core jsonb := null;
  studio_footprint jsonb := null;
  member_since timestamptz;
  email_verified boolean := false;
  two_factor_enabled boolean := false;
  active_session_count integer := 0;
begin
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,20}$' then
    return jsonb_build_object('found', false);
  end if;

  select * into target_profile
  from public.profiles
  where lower(username) = lower(p_username)
  limit 1;

  if target_profile.id is null then
    return jsonb_build_object('found', false);
  end if;

  viewer_is_owner := viewer_id is not null and viewer_id = target_profile.id;
  if viewer_id is not null then
    select role into viewer_role
    from public.profiles
    where id = viewer_id and access_status = 'active';
  end if;
  viewer_is_internal_admin := coalesce(
    viewer_role in ('Founder', 'Site Admin', 'App Admin'),
    false
  );
  viewer_is_staff := coalesce(
    viewer_role in ('Founder', 'App Admin', 'Site Admin', 'App Tester', 'Site Tester'),
    false
  );

  public_allowed := target_profile.access_status = 'active'
    and target_profile.profile_visibility = 'public'
    and target_profile.allow_public_lookup;

  if not public_allowed and not viewer_is_owner and not viewer_is_staff then
    return jsonb_build_object('found', false);
  end if;

  select snapshot.snapshot, snapshot.updated_at, snapshot.source, snapshot.app_version
    into telemetry_snapshot, telemetry_updated_at, telemetry_source, telemetry_app_version
  from public.forge_telemetry_snapshots snapshot
  where snapshot.user_id = target_profile.id;

  telemetry_snapshot := coalesce(telemetry_snapshot, '{}'::jsonb);

  if public_allowed and not target_profile.hide_plugin_stack then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'name', plugin.value ->> 'name',
      'uses', coalesce(plugin.value -> 'uses', plugin.value -> 'useCount'),
      'status', plugin.value ->> 'status'
    ))), '[]'::jsonb)
    into public_plugins
    from jsonb_array_elements(
      case when jsonb_typeof(telemetry_snapshot -> 'plugins') = 'array'
        then telemetry_snapshot -> 'plugins' else '[]'::jsonb end
    ) as plugin(value);
  end if;

  if public_allowed and target_profile.show_project_vault then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'name', project.value ->> 'name',
      'updatedAt', coalesce(project.value ->> 'updatedAt', project.value ->> 'lastOpenedAt'),
      'editor', project.value ->> 'mostUsedEditor'
    ))), '[]'::jsonb)
    into public_projects
    from jsonb_array_elements(
      case when jsonb_typeof(telemetry_snapshot -> 'projects') = 'array'
        then telemetry_snapshot -> 'projects' else '[]'::jsonb end
    ) as project(value)
    join public.forge_project_visibility visibility
      on visibility.user_id = target_profile.id
     and visibility.project_key = lower(btrim(project.value ->> 'name'))
     and visibility.is_public
    where coalesce(project.value ->> 'name', '') <> '';
  end if;

  if viewer_is_owner or viewer_is_staff then
    select
      auth_user.created_at,
      auth_user.email_confirmed_at is not null,
      exists (
        select 1 from auth.mfa_factors factor
        where factor.user_id = target_profile.id and factor.status::text = 'verified'
      ),
      (
        select count(*)::integer from auth.sessions active_session
        where active_session.user_id = target_profile.id
          and (active_session.not_after is null or active_session.not_after > now())
      )
    into member_since, email_verified, two_factor_enabled, active_session_count
    from auth.users auth_user
    where auth_user.id = target_profile.id;

    account_identity := jsonb_build_object(
      'displayName', coalesce(target_profile.display_name, target_profile.username),
      'username', target_profile.username,
      'product', 'Forge Studio',
      'plan', target_profile.role,
      'status', target_profile.access_status,
      'memberSince', member_since
    );

    account_core := jsonb_build_object(
      'plan', target_profile.role,
      'status', target_profile.access_status,
      'includedProducts', case when target_profile.access_status = 'active' then jsonb_build_array('Forge Studio') else '[]'::jsonb end,
      'cloudSavesUsed', telemetry_snapshot #> '{totals,cloudSavesUsed}',
      'aiUsage', coalesce(telemetry_snapshot #>> '{totals,aiUsage}', telemetry_snapshot #>> '{ai,usage}'),
      'emailVerified', email_verified,
      'twoFactorEnabled', two_factor_enabled,
      'activeSessions', active_session_count
    );
  end if;

  if viewer_is_staff then
    studio_footprint := jsonb_build_object(
      'appVersion', coalesce(telemetry_app_version, telemetry_snapshot #>> '{app,version}'),
      'source', telemetry_source,
      'updatedAt', telemetry_updated_at,
      'forgeRoot', case when telemetry_updated_at is null then 'Not connected' else 'Supabase telemetry' end,
      'latestRelease', coalesce(
        telemetry_snapshot #>> '{build,latestRelease,name}',
        telemetry_snapshot #>> '{app,release}'
      ),
      'distBundle', case when telemetry_updated_at is null then null else 'Public-safe snapshot' end,
      'projectsTracked', jsonb_array_length(
        case when jsonb_typeof(telemetry_snapshot -> 'projects') = 'array'
          then telemetry_snapshot -> 'projects' else '[]'::jsonb end
      ),
      'telemetryConnected', telemetry_updated_at is not null,
      'trackingState', case
        when telemetry_updated_at is null then 'Not connected'
        when telemetry_updated_at < now() - interval '10 minutes' then 'Live (stale)'
        else 'Live'
      end
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'profile', jsonb_strip_nulls(jsonb_build_object(
      'displayName', coalesce(target_profile.display_name, target_profile.username),
      'username', target_profile.username,
      'avatarUrl', target_profile.avatar_url,
      'role', case when viewer_is_owner or viewer_is_staff or (public_allowed and target_profile.show_role)
        then target_profile.role else null end
    )),
    'sections', jsonb_build_object(
      'accountIdentity', viewer_is_owner or viewer_is_staff,
      'pluginStack', public_allowed and not target_profile.hide_plugin_stack,
      'projectVault', public_allowed and target_profile.show_project_vault,
      'forgeActivity', public_allowed and target_profile.show_forge_activity,
      'creationInsights', public_allowed and target_profile.show_forge_stats,
      'creatorLibrary', public_allowed and target_profile.show_uploaded_assets,
      'accountCore', viewer_is_owner or viewer_is_staff,
      'studioFootprint', viewer_is_staff
    ),
    'plugins', public_plugins,
    'projects', public_projects,
    'activity', case when public_allowed and target_profile.show_forge_activity then jsonb_build_object(
      'weeklyActivity', telemetry_snapshot -> 'weeklyActivity',
      'forgeTimeMs', telemetry_snapshot #> '{totals,forgeTimeMs}',
      'projectsCreated', telemetry_snapshot #> '{totals,projectsCreated}',
      'modelsExported', telemetry_snapshot #> '{totals,modelsExported}'
    ) else null end,
    'insights', case when public_allowed and target_profile.show_forge_stats
      then telemetry_snapshot -> 'insights' else null end,
    'library', case when public_allowed and target_profile.show_uploaded_assets
      then telemetry_snapshot -> 'library' else null end,
    'accountIdentity', account_identity,
    'accountCore', account_core,
    'studioFootprint', studio_footprint,
    'viewer', jsonb_build_object(
      'owner', viewer_is_owner,
      'staff', viewer_is_staff,
      'internalAdmin', viewer_is_internal_admin
    )
  );
end;
$$;

revoke all on function public.public_account_lookup(text) from public;
grant execute on function public.public_account_lookup(text) to anon, authenticated;
