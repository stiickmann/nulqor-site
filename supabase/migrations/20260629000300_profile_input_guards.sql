alter table public.profiles
  drop constraint if exists profiles_username_format_check,
  add constraint profiles_username_format_check
    check (username ~ '^[A-Za-z0-9_]{3,20}$');

alter table public.profiles
  drop constraint if exists profiles_display_name_length_check,
  add constraint profiles_display_name_length_check
    check (
      display_name is null
      or char_length(btrim(display_name)) between 1 and 60
    );

alter table public.profiles
  drop constraint if exists profiles_avatar_url_check,
  add constraint profiles_avatar_url_check
    check (
      avatar_url is null
      or btrim(avatar_url) = ''
      or (
        char_length(avatar_url) <= 2048
        and avatar_url like
          'https://qxtpplrwrqjijptfmsij.supabase.co/storage/v1/object/public/avatars/'
          || id::text || '/%'
      )
    );
