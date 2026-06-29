begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

/* --------------------------- Account state and roles --------------------------- */

alter table public.profiles
  alter column role drop default,
  alter column role drop not null;

alter table public.profiles
  add column if not exists access_status text not null default 'pending',
  add column if not exists allow_public_lookup boolean not null default false,
  add column if not exists show_role boolean not null default true,
  add column if not exists show_project_vault boolean not null default false,
  add column if not exists hide_plugin_stack boolean not null default false,
  add column if not exists show_forge_activity boolean not null default false;

update public.profiles
set role = case role
  when 'Free' then 'Nulqor Free'
  when 'Creator' then 'Nulqor Creator'
  when 'Studio' then 'Nulqor Teams'
  when 'Enterprise' then 'Nulqor Enterprise'
  when 'Site Creator' then 'Nulqor Creator'
  else role
end;

update public.profiles
set access_status = case when role is null then 'pending' else 'active' end;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (
  role is null or role in (
    'Founder',
    'App Admin',
    'Site Admin',
    'App Tester',
    'Site Tester',
    'Nulqor Enterprise',
    'Nulqor Teams',
    'Nulqor Creator',
    'Nulqor Free'
  )
);

alter table public.profiles drop constraint if exists profiles_access_status_check;
alter table public.profiles add constraint profiles_access_status_check
  check (access_status in ('pending', 'active', 'denied', 'suspended'));

alter table public.profiles drop constraint if exists profiles_visibility_check;
alter table public.profiles add constraint profiles_visibility_check
  check (profile_visibility in ('private', 'public'));

create or replace function private.requested_plan_role(requested text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case lower(btrim(coalesce(requested, '')))
    when 'free' then 'Nulqor Free'
    when 'nulqor free' then 'Nulqor Free'
    when 'creator' then 'Nulqor Creator'
    when 'nulqor creator' then 'Nulqor Creator'
    when 'studio' then 'Nulqor Teams'
    when 'team' then 'Nulqor Teams'
    when 'teams' then 'Nulqor Teams'
    when 'nulqor teams' then 'Nulqor Teams'
    when 'enterprise' then 'Nulqor Enterprise'
    when 'nulqor enterprise' then 'Nulqor Enterprise'
    else null
  end;
$$;

revoke all on function private.requested_plan_role(text) from public, anon, authenticated;

/* ------------------------------ Access helpers ------------------------------ */

create or replace function public.has_active_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and access_status = 'active' and role is not null
  );
$$;

create or replace function public.is_founder()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and access_status = 'active' and role = 'Founder'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and access_status = 'active'
      and role in ('Founder', 'App Admin', 'Site Admin', 'App Tester', 'Site Tester')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and access_status = 'active'
      and role in ('Founder', 'Site Admin')
  );
$$;

create or replace function public.is_site_access_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and access_status = 'active'
      and role in ('Founder', 'Site Admin')
  );
$$;

create or replace function public.is_internal_account_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and access_status = 'active'
      and role in ('Founder', 'Site Admin', 'App Admin')
  );
$$;

revoke all on function public.has_active_access() from public, anon;
grant execute on function public.has_active_access() to authenticated;

revoke all on function public.is_founder() from public, anon, authenticated;
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_site_access_admin() from public, anon, authenticated;
revoke all on function public.is_internal_account_admin() from public, anon, authenticated;

/* --------------------------- Signup and request queue -------------------------- */

alter table public.waitlist drop constraint if exists waitlist_status_check;
alter table public.waitlist add constraint waitlist_status_check
  check (status in ('pending', 'accepted', 'denied'));

alter table public.waitlist drop constraint if exists waitlist_requested_plan_check;
alter table public.waitlist add constraint waitlist_requested_plan_check
  check (private.requested_plan_role(role) is not null);

create unique index if not exists waitlist_email_lower_idx
  on public.waitlist (lower(email));

drop policy if exists "visitors can join waitlist without spoofing users" on public.waitlist;
drop policy if exists "anonymous visitors can request access" on public.waitlist;
drop policy if exists "members can request own access" on public.waitlist;
drop policy if exists "members can read own access request" on public.waitlist;

create policy "anonymous visitors can request access"
on public.waitlist for insert to anon
with check (user_id is null);

create policy "members can request own access"
on public.waitlist for insert to authenticated
with check (
  user_id = (select auth.uid())
  and lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
);

create policy "members can read own access request"
on public.waitlist for select to authenticated
using (user_id = (select auth.uid()));

grant insert on public.waitlist to anon, authenticated;
grant select on public.waitlist to authenticated;
revoke update, delete on public.waitlist from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.waitlist%rowtype;
  initial_role text := null;
  initial_status text := 'pending';
begin
  select w.* into request_row
  from public.waitlist w
  where lower(w.email) = lower(new.email)
  order by w.created_at desc
  limit 1;

  if found then
    if request_row.status = 'accepted' then
      initial_role := private.requested_plan_role(request_row.role);
      initial_status := 'active';
    elsif request_row.status = 'denied' then
      initial_status := 'denied';
    end if;
  end if;

  insert into public.profiles (id, username, role, access_status)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'username', ''),
    initial_role,
    initial_status
  )
  on conflict (id) do nothing;

  if request_row.id is not null and request_row.user_id is null then
    update public.waitlist set user_id = new.id where id = request_row.id;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

/* ----------------------------- Admin RPC rules ----------------------------- */

drop function if exists public.admin_list_members();
create function public.admin_list_members()
returns table(
  id uuid,
  username text,
  display_name text,
  role text,
  access_status text,
  email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_site_access_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select p.id, p.username, p.display_name, p.role, p.access_status, u.email::text, u.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by u.created_at desc;
end;
$$;

create or replace function public.admin_list_waitlist()
returns table(id text, name text, email text, role text, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_site_access_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select w.id::text, w.name, w.email, w.role, w.status, w.created_at
  from public.waitlist w
  order by w.created_at desc;
end;
$$;

create or replace function public.admin_set_role(target uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_founder() then
    raise exception 'Only the Founder can change roles';
  end if;

  if new_role not in (
    'Founder', 'App Admin', 'Site Admin', 'App Tester', 'Site Tester',
    'Nulqor Enterprise', 'Nulqor Teams', 'Nulqor Creator', 'Nulqor Free'
  ) then
    raise exception 'Invalid role: %', new_role;
  end if;

  update public.profiles
  set role = new_role, access_status = 'active', updated_at = now()
  where id = target;
end;
$$;

create or replace function public.admin_set_waitlist_status(target_id text, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.waitlist%rowtype;
  approved_role text;
begin
  if not public.is_site_access_admin() then
    raise exception 'Not authorized';
  end if;

  if new_status not in ('accepted', 'denied') then
    raise exception 'Invalid request status';
  end if;

  select * into request_row
  from public.waitlist
  where id::text = target_id
  for update;

  if request_row.id is null then
    raise exception 'Access request not found';
  end if;

  update public.waitlist set status = new_status where id = request_row.id;

  if request_row.user_id is not null then
    if new_status = 'accepted' then
      approved_role := private.requested_plan_role(request_row.role);
      if approved_role is null then raise exception 'Invalid requested plan'; end if;
      update public.profiles
      set role = approved_role, access_status = 'active', updated_at = now()
      where id = request_row.user_id;
    else
      update public.profiles
      set role = null, access_status = 'denied', updated_at = now()
      where id = request_row.user_id;
    end if;
  end if;
end;
$$;

create or replace function public.admin_delete_waitlist(target_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_founder() then
    raise exception 'Only the Founder can delete requests';
  end if;
  delete from public.waitlist where id::text = target_id;
end;
$$;

revoke all on function public.admin_list_members() from public, anon;
revoke all on function public.admin_list_waitlist() from public, anon;
revoke all on function public.admin_set_role(uuid, text) from public, anon;
revoke all on function public.admin_set_waitlist_status(text, text) from public, anon;
revoke all on function public.admin_delete_waitlist(text) from public, anon;
grant execute on function public.admin_list_members() to authenticated;
grant execute on function public.admin_list_waitlist() to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_set_waitlist_status(text, text) to authenticated;
grant execute on function public.admin_delete_waitlist(text) to authenticated;

/* --------------------------- Plan/access enforcement -------------------------- */

drop policy if exists "Members can read plans" on public.plans;
drop policy if exists "Active members can read plans" on public.plans;
create policy "Active members can read plans"
on public.plans for select to authenticated
using (public.has_active_access());

drop policy if exists "own interest add" on public.launch_interest;
drop policy if exists "own interest read" on public.launch_interest;
create policy "active members add own interest"
on public.launch_interest for insert to authenticated
with check ((select auth.uid()) = user_id and public.has_active_access());
create policy "active members read own interest"
on public.launch_interest for select to authenticated
using ((select auth.uid()) = user_id and public.has_active_access());

drop policy if exists "Users delete own Forge telemetry snapshot" on public.forge_telemetry_snapshots;
drop policy if exists "Users insert own Forge telemetry snapshot" on public.forge_telemetry_snapshots;
drop policy if exists "Users read own Forge telemetry snapshot" on public.forge_telemetry_snapshots;
drop policy if exists "Users update own Forge telemetry snapshot" on public.forge_telemetry_snapshots;

create policy "active users delete own Forge telemetry snapshot"
on public.forge_telemetry_snapshots for delete to authenticated
using ((select auth.uid()) = user_id and public.has_active_access());
create policy "active users insert own Forge telemetry snapshot"
on public.forge_telemetry_snapshots for insert to authenticated
with check ((select auth.uid()) = user_id and public.has_active_access());
create policy "active users read own Forge telemetry snapshot"
on public.forge_telemetry_snapshots for select to authenticated
using ((select auth.uid()) = user_id and public.has_active_access());
create policy "active users update own Forge telemetry snapshot"
on public.forge_telemetry_snapshots for update to authenticated
using ((select auth.uid()) = user_id and public.has_active_access())
with check ((select auth.uid()) = user_id and public.has_active_access());

create or replace function public.forge_can_read_shared_project(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_active_access() and exists (
    select 1 from public.forge_shared_projects project
    where project.id = project_uuid
      and (
        project.owner_id = (select auth.uid())
        or exists (
          select 1 from public.forge_shared_project_members member
          where member.project_id = project.id
            and member.user_id = (select auth.uid())
            and member.status = 'accepted'
        )
      )
  );
$$;

create or replace function public.forge_can_edit_shared_project(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_active_access() and exists (
    select 1 from public.forge_shared_projects project
    where project.id = project_uuid
      and (
        project.owner_id = (select auth.uid())
        or exists (
          select 1 from public.forge_shared_project_members member
          where member.project_id = project.id
            and member.user_id = (select auth.uid())
            and member.status = 'accepted'
            and member.permission in ('editor', 'admin')
        )
      )
  );
$$;

drop policy if exists "shared projects insert owner" on public.forge_shared_projects;
drop policy if exists "shared projects delete owner" on public.forge_shared_projects;
create policy "shared projects insert owner"
on public.forge_shared_projects for insert to authenticated
with check (owner_id = (select auth.uid()) and public.has_active_access());
create policy "shared projects delete owner"
on public.forge_shared_projects for delete to authenticated
using (owner_id = (select auth.uid()) and public.has_active_access());

drop policy if exists "shared members read relevant" on public.forge_shared_project_members;
drop policy if exists "shared members insert managers" on public.forge_shared_project_members;
drop policy if exists "shared members update owner" on public.forge_shared_project_members;
drop policy if exists "shared members delete relevant" on public.forge_shared_project_members;

create policy "shared members read relevant"
on public.forge_shared_project_members for select to authenticated
using (
  public.has_active_access() and (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.forge_shared_projects project
      where project.id = project_id and project.owner_id = (select auth.uid())
    )
  )
);

create policy "shared members insert managers"
on public.forge_shared_project_members for insert to authenticated
with check (
  public.has_active_access()
  and invited_by = (select auth.uid())
  and user_id <> (select auth.uid())
  and exists (
    select 1 from public.forge_shared_projects project
    where project.id = project_id
      and (
        project.owner_id = (select auth.uid())
        or exists (
          select 1 from public.forge_shared_project_members manager
          where manager.project_id = project.id
            and manager.user_id = (select auth.uid())
            and manager.status = 'accepted'
            and manager.permission = 'admin'
        )
      )
  )
);

create policy "shared members update owner"
on public.forge_shared_project_members for update to authenticated
using (
  public.has_active_access() and exists (
    select 1 from public.forge_shared_projects project
    where project.id = project_id and project.owner_id = (select auth.uid())
  )
)
with check (
  public.has_active_access() and exists (
    select 1 from public.forge_shared_projects project
    where project.id = project_id and project.owner_id = (select auth.uid())
  )
);

create policy "shared members delete relevant"
on public.forge_shared_project_members for delete to authenticated
using (
  public.has_active_access() and (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.forge_shared_projects project
      where project.id = project_id and project.owner_id = (select auth.uid())
    )
  )
);

/* ------------------------- Per-project public visibility ------------------------ */

create table if not exists public.forge_project_visibility (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_key text not null,
  project_name text not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, project_key),
  constraint forge_project_visibility_key_check
    check (char_length(project_key) between 1 and 160),
  constraint forge_project_visibility_name_check
    check (char_length(project_name) between 1 and 160)
);

alter table public.forge_project_visibility enable row level security;

drop policy if exists "users read own project visibility" on public.forge_project_visibility;
drop policy if exists "users insert own project visibility" on public.forge_project_visibility;
drop policy if exists "users update own project visibility" on public.forge_project_visibility;
drop policy if exists "users delete own project visibility" on public.forge_project_visibility;

create policy "users read own project visibility"
on public.forge_project_visibility for select to authenticated
using ((select auth.uid()) = user_id and public.has_active_access());
create policy "users insert own project visibility"
on public.forge_project_visibility for insert to authenticated
with check ((select auth.uid()) = user_id and public.has_active_access());
create policy "users update own project visibility"
on public.forge_project_visibility for update to authenticated
using ((select auth.uid()) = user_id and public.has_active_access())
with check ((select auth.uid()) = user_id and public.has_active_access());
create policy "users delete own project visibility"
on public.forge_project_visibility for delete to authenticated
using ((select auth.uid()) = user_id and public.has_active_access());

grant select, insert, update, delete on public.forge_project_visibility to authenticated, service_role;
revoke all on public.forge_project_visibility from anon;

/* -------------------------- Public profile lookup RPC ------------------------- */

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
  public_allowed boolean := false;
  telemetry_snapshot jsonb := '{}'::jsonb;
  telemetry_updated_at timestamptz;
  telemetry_source text;
  telemetry_app_version text;
  public_plugins jsonb := '[]'::jsonb;
  public_projects jsonb := '[]'::jsonb;
  account_core jsonb := null;
  studio_footprint jsonb := null;
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

  public_allowed := target_profile.access_status = 'active'
    and target_profile.profile_visibility = 'public'
    and target_profile.allow_public_lookup;

  if not public_allowed and not viewer_is_owner and not viewer_is_internal_admin then
    return jsonb_build_object('found', false);
  end if;

  select s.snapshot, s.updated_at, s.source, s.app_version
    into telemetry_snapshot, telemetry_updated_at, telemetry_source, telemetry_app_version
  from public.forge_telemetry_snapshots s
  where s.user_id = target_profile.id;

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

  if viewer_is_owner or viewer_is_internal_admin then
    select
      u.email_confirmed_at is not null,
      exists (
        select 1 from auth.mfa_factors factor
        where factor.user_id = target_profile.id and factor.status::text = 'verified'
      ),
      (
        select count(*)::integer from auth.sessions session
        where session.user_id = target_profile.id
          and (session.not_after is null or session.not_after > now())
      )
    into email_verified, two_factor_enabled, active_session_count
    from auth.users u
    where u.id = target_profile.id;

    account_core := jsonb_build_object(
      'plan', target_profile.role,
      'status', target_profile.access_status,
      'includedProducts', case when target_profile.access_status = 'active' then jsonb_build_array('Forge Studio') else '[]'::jsonb end,
      'cloudSavesUsed', telemetry_snapshot #> '{totals,cloudSavesUsed}',
      'emailVerified', email_verified,
      'twoFactorEnabled', two_factor_enabled,
      'activeSessions', active_session_count
    );
  end if;

  if viewer_is_internal_admin then
    studio_footprint := jsonb_build_object(
      'appVersion', coalesce(telemetry_app_version, telemetry_snapshot #>> '{app,version}'),
      'source', telemetry_source,
      'updatedAt', telemetry_updated_at,
      'projectsTracked', jsonb_array_length(
        case when jsonb_typeof(telemetry_snapshot -> 'projects') = 'array'
          then telemetry_snapshot -> 'projects' else '[]'::jsonb end
      ),
      'telemetryConnected', telemetry_updated_at is not null
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'profile', jsonb_strip_nulls(jsonb_build_object(
      'displayName', coalesce(target_profile.display_name, target_profile.username),
      'username', target_profile.username,
      'avatarUrl', target_profile.avatar_url,
      'role', case when viewer_is_owner or viewer_is_internal_admin or (public_allowed and target_profile.show_role)
        then target_profile.role else null end
    )),
    'sections', jsonb_build_object(
      'pluginStack', public_allowed and not target_profile.hide_plugin_stack,
      'projectVault', public_allowed and target_profile.show_project_vault,
      'forgeActivity', public_allowed and target_profile.show_forge_activity,
      'creationInsights', public_allowed and target_profile.show_forge_stats,
      'creatorLibrary', public_allowed and target_profile.show_uploaded_assets,
      'accountCore', viewer_is_owner or viewer_is_internal_admin,
      'studioFootprint', viewer_is_internal_admin
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
    'accountCore', account_core,
    'studioFootprint', studio_footprint,
    'viewer', jsonb_build_object(
      'owner', viewer_is_owner,
      'internalAdmin', viewer_is_internal_admin
    )
  );
end;
$$;

revoke all on function public.public_account_lookup(text) from public;
grant execute on function public.public_account_lookup(text) to anon, authenticated;

/* -------------------------- Profile column privileges ------------------------- */

drop policy if exists "read own profile" on public.profiles;
drop policy if exists "insert own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;

create policy "read own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "insert own profile"
on public.profiles for insert to authenticated
with check (id = (select auth.uid()));

create policy "update own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

revoke insert, update on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (
  id, username, display_name, avatar_url, updated_at,
  profile_visibility, show_on_marketplace, show_forge_stats, show_uploaded_assets,
  allow_public_lookup, show_role, show_project_vault, hide_plugin_stack, show_forge_activity
) on public.profiles to authenticated;

create index if not exists waitlist_user_id_idx
  on public.waitlist (user_id)
  where user_id is not null;

create index if not exists forge_shared_project_members_invited_by_idx
  on public.forge_shared_project_members (invited_by);
grant update (
  username, display_name, avatar_url, updated_at,
  profile_visibility, show_on_marketplace, show_forge_stats, show_uploaded_assets,
  allow_public_lookup, show_role, show_project_vault, hide_plugin_stack, show_forge_activity
) on public.profiles to authenticated;

create or replace function public.founder_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.profiles where access_status = 'active';
$$;

revoke all on function public.founder_count() from public;
grant execute on function public.founder_count() to anon, authenticated;

commit;
