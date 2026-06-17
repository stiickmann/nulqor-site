// Account auth (Supabase): nav login/logout state on every page, plus
// login / signup / logout and username management on account.html.
(function () {
  const sb = window.nulqorSupabase;
  const navAccount = document.querySelector("[data-account-link]");

  const page = document.querySelector("[data-auth-page]");
  const formsWrap = document.querySelector("[data-auth-forms]");
  const tabs = page ? Array.from(page.querySelectorAll("[data-auth-mode]")) : [];
  const loginForm = document.querySelector("#loginForm");
  const signupForm = document.querySelector("#signupForm");
  const sessionCard = document.querySelector("#authSession");
  const sessionUsername = document.querySelector("#sessionUsername");
  const sessionEmail = document.querySelector("#sessionEmail");
  const usernameInput = document.querySelector("#usernameInput");
  const saveUsernameButton = document.querySelector("#saveUsernameButton");
  const logoutButton = document.querySelector("#logoutButton");
  const note = document.querySelector("#authNote");

  const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
  let currentUserId = null;

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

  function usernameProblem(name) {
    if (!USERNAME_RE.test(name)) {
      return "Username must be 3–20 characters: letters, numbers, or underscores.";
    }
    return null;
  }

  // Returns true only if we can confirm the username is already taken.
  // If the lookup isn't available yet (DB not set up), we don't block.
  async function usernameTaken(name) {
    try {
      const { data, error } = await sb.rpc("username_available", { name });
      if (error) return false;
      return data === false;
    } catch (_e) {
      return false;
    }
  }

  async function loadProfile(userId) {
    try {
      const { data } = await sb
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();
      return data && data.username ? data.username : "";
    } catch (_e) {
      return "";
    }
  }

  async function renderSession(session) {
    setNav(session);
    if (!page) return;
    const loggedIn = Boolean(session && session.user);
    if (formsWrap) formsWrap.hidden = loggedIn;
    if (sessionCard) sessionCard.hidden = !loggedIn;
    if (!loggedIn) {
      currentUserId = null;
      return;
    }
    currentUserId = session.user.id;
    if (sessionEmail) sessionEmail.textContent = session.user.email;
    const username = await loadProfile(session.user.id);
    if (sessionUsername) sessionUsername.textContent = username || "—";
    if (usernameInput && document.activeElement !== usernameInput) {
      usernameInput.value = username || "";
    }
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
      const username = String(formData.get("username") || "").trim();
      const password = String(formData.get("password") || "");

      const problem = usernameProblem(username);
      if (problem) {
        showNote(problem, false);
        return;
      }
      if (password.length < 6) {
        showNote("Password must be at least 6 characters.", false);
        return;
      }

      showNote("Checking username…", undefined);
      if (await usernameTaken(username)) {
        showNote(`The username "${username}" is already taken.`, false);
        return;
      }

      showNote("Creating your account…", undefined);
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });

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

  async function saveUsername() {
    if (!currentUserId) return;
    const username = String(usernameInput ? usernameInput.value : "").trim();

    const problem = usernameProblem(username);
    if (problem) {
      showNote(problem, false);
      return;
    }

    showNote("Saving username…", undefined);
    if (await usernameTaken(username)) {
      showNote(`The username "${username}" is already taken.`, false);
      return;
    }

    const { error } = await sb
      .from("profiles")
      .upsert({ id: currentUserId, username, updated_at: new Date().toISOString() });

    if (error) {
      const taken = error.code === "23505" || /duplicate key/i.test(error.message || "");
      showNote(taken ? `The username "${username}" is already taken.` : error.message, false);
      return;
    }

    if (sessionUsername) sessionUsername.textContent = username;
    showNote("Username saved.", true);
  }

  if (saveUsernameButton) {
    saveUsernameButton.addEventListener("click", saveUsername);
  }
  if (usernameInput) {
    usernameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveUsername();
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await sb.auth.signOut();
      showNote("Logged out.", true);
    });
  }
})();
