// Creates the shared Supabase client as window.nulqorSupabase.
// Stays null (with a console note) until real keys are added to config.js,
// so the site never crashes when the backend isn't wired up yet.
(function () {
  const cfg = window.NULQOR_SUPABASE || {};
  const configured =
    Boolean(window.supabase) &&
    Boolean(cfg.url) &&
    Boolean(cfg.anonKey) &&
    !cfg.url.includes("YOUR_") &&
    !cfg.anonKey.includes("YOUR_");

  if (!configured) {
    window.nulqorSupabase = null;
    console.warn(
      "[Nulqor] Supabase not configured yet — add your Project URL and anon key to config.js."
    );
    return;
  }

  window.nulqorSupabase = window.supabase.createClient(cfg.url, cfg.anonKey);
})();
