// Account auth (Supabase): nav login/logout state on every page,
// plus login / signup / logout handling on account.html.
(function () {
  const sb = window.nulqorSupabase;
  const navAccount = document.querySelector("[data-account-link]");

  const page = document.querySelector("[data-auth-page]");
  const formsWrap = document.querySelector("[data-auth-forms]");
  const tabs = page ? Array.from(page.querySelectorAll("[data-auth-mode]")) : [];
  const loginForm = document.querySelector("#loginForm");
  const signupForm = document.querySelector("#signupForm");
  const sessionCard = document.querySelector("#authSession");
  const sessionEmail = document.querySelector("#sessionEmail");
  const logoutButton = document.querySelector("#logoutButton");
  const note = document.querySelector("#authNote");

  function setNav(session) {
    if (navAccount) {
      navAccount.textContent = session && session.user ? "Account" : "Log in";
    }
  }

  function showNote(message, ok) {
    if (!note) return;
    note.textContent = message;
    note.classList.toggle("is-success", ok === true);
    note.classList.toggle("is-error", ok === false);
  }

  function setMode(mode) {
    tabs.forEach((tab) => {
      const active = tab.dataset.authMode === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    if (loginForm) loginForm.hidden = mode !== "login";
    if (signupForm) signupForm.hidden = mode !== "signup";
  }

  function renderSession(session) {
    setNav(session);
    if (!page) return;
    const loggedIn = Boolean(session && session.user);
    if (formsWrap) formsWrap.hidden = loggedIn;
    if (sessionCard) sessionCard.hidden = !loggedIn;
    if (loggedIn && sessionEmail) sessionEmail.textContent = session.user.email;
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setMode(tab.dataset.authMode);
      showNote("", undefined);
    });
  });

  if (!sb) {
    setNav(null);
    if (page) {
      showNote("Accounts aren't connected yet. Add your Supabase keys to config.js.", false);
    }
    return;
  }

  setMode("login");
  sb.auth.getSession().then(({ data }) => renderSession(data.session));
  sb.auth.onAuthStateChange((_event, session) => renderSession(session));

  if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(signupForm);
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      if (password.length < 6) {
        showNote("Password must be at least 6 characters.", false);
        return;
      }

      showNote("Creating your account…", undefined);
      const { data, error } = await sb.auth.signUp({ email, password });

      if (error) {
        showNote(error.message, false);
        return;
      }

      signupForm.reset();
      if (data.session) {
        showNote("Account created — you're logged in.", true);
      } else {
        showNote("Account created. Check your email to confirm, then log in.", true);
        setMode("login");
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      showNote("Logging in…", undefined);
      const { error } = await sb.auth.signInWithPassword({ email, password });

      if (error) {
        showNote(error.message, false);
        return;
      }

      loginForm.reset();
      showNote("Logged in.", true);
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await sb.auth.signOut();
      showNote("Logged out.", true);
    });
  }
})();
