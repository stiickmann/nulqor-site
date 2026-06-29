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

create index if not exists waitlist_user_id_idx
  on public.waitlist (user_id)
  where user_id is not null;

create index if not exists forge_shared_project_members_invited_by_idx
  on public.forge_shared_project_members (invited_by);
