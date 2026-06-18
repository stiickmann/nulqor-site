// Account auth (Supabase): nav state + floating account badge & panel on every
// page, plus login / signup / logout on account.html.
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
  const logoutButton = document.querySelector("#logoutButton");
  const note = document.querySelector("#authNote");

  const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
  // Roles that unlock Forge Studio access.
  const FORGE_ROLES = ["Creator", "Studio", "Site Tester", "Site Creator", "Site Admin", "Founder"];

  let currentUserId = null;
  let currentProfile = { username: "", role: "Free", display_name: "", avatar_url: "" };

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

  // True only if we can confirm the name is taken by SOMEONE ELSE.
  async function usernameTaken(name) {
    if (name && currentProfile.username && name.toLowerCase() === currentProfile.username.toLowerCase()) {
      return false; // it's their own current username
    }
    try {
      const { data, error } = await sb.rpc("username_available", { name });
      if (error) return false;
      return data === false;
    } catch (_e) {
      return false;
    }
  }

  async function loadProfile(userId) {
    const empty = { username: "", role: "Free", display_name: "", avatar_url: "" };
    try {
      let { data, error } = await sb
        .from("profiles")
        .select("username, role, display_name, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        const res = await sb.from("profiles").select("username, role").eq("id", userId).maybeSingle();
        data = res.data;
      }
      if (!data) return empty;
      return {
        username: data.username || "",
        role: data.role || "Free",
        display_name: data.display_name || "",
        avatar_url: data.avatar_url || "",
      };
    } catch (_e) {
      return empty;
    }
  }

  function displayNameOf(profile) {
    return profile.display_name || profile.username || "Member";
  }

  function applyAvatar(faceEl, profile) {
    const name = displayNameOf(profile);
    if (profile.avatar_url) {
      faceEl.style.backgroundImage = `url("${profile.avatar_url}")`;
      faceEl.textContent = "";
      faceEl.classList.add("has-image");
    } else {
      faceEl.style.backgroundImage = "";
      faceEl.textContent = (name[0] || "N").toUpperCase();
      faceEl.classList.remove("has-image");
    }
  }

  function productsForRole(role) {
    const forge = FORGE_ROLES.includes(role);
    return [{ name: "Forge Studio", status: forge ? "Early access" : "Coming soon", active: forge }];
  }

  /* ----------------------------- Badge + Panel ----------------------------- */

  let chipEl = null;
  let panelEl = null;

  function buildChip() {
    if (chipEl) return;

    chipEl = document.createElement("button");
    chipEl.type = "button";
    chipEl.className = "account-chip";
    chipEl.setAttribute("aria-haspopup", "dialog");
    chipEl.setAttribute("aria-expanded", "false");
    chipEl.hidden = true;
    chipEl.innerHTML =
      '<span class="account-chip-avatar" data-chip-face>N</span>' +
      '<span class="account-chip-text">' +
      '<span class="account-chip-name" data-chip-name></span>' +
      '<span class="account-chip-role" data-chip-role></span>' +
      "</span>";
    document.body.appendChild(chipEl);

    panelEl = document.createElement("div");
    panelEl.className = "account-panel";
    panelEl.setAttribute("role", "dialog");
    panelEl.setAttribute("aria-label", "Account");
    panelEl.hidden = true;
    panelEl.innerHTML =
      '<div class="account-panel-head">' +
      '<span class="account-panel-avatar" data-panel-face>N</span>' +
      '<div class="account-panel-id">' +
      '<div class="account-panel-name" data-panel-name></div>' +
      '<div class="account-panel-user" data-panel-user></div>' +
      "</div></div>" +
      '<div class="account-panel-plan"><span>Subscription</span>' +
      '<strong class="account-chip-role" data-panel-plan></strong></div>' +
      '<div class="account-panel-products"><p class="account-panel-label">Your products</p>' +
      "<ul data-panel-products></ul></div>" +
      '<div class="account-panel-edit" data-panel-edit hidden>' +
      '<label class="account-panel-field"><span>Avatar</span>' +
      '<input type="file" accept="image/*" data-panel-avatar-input /></label>' +
      '<label class="account-panel-field"><span>Display name</span>' +
      '<input type="text" maxlength="40" placeholder="Your name" data-panel-display /></label>' +
      '<label class="account-panel-field"><span>Username</span>' +
      '<input type="text" minlength="3" maxlength="20" placeholder="your_handle" data-panel-username /></label>' +
      '<button class="button button-primary" type="button" data-panel-save>Save changes</button>' +
      '<p class="account-panel-note" data-panel-note role="status" aria-live="polite"></p></div>' +
      '<div class="account-panel-actions">' +
      '<button class="account-panel-action" type="button" data-panel-toggle-edit>Edit profile</button>' +
      '<button class="account-panel-action" type="button" data-panel-logout>Log out</button>' +
      "</div>";
    document.body.appendChild(panelEl);

    chipEl.addEventListener("click", (e) => {
      e.preventDefault();
      togglePanel();
    });

    panelEl.querySelector("[data-panel-toggle-edit]").addEventListener("click", () => {
      const edit = panelEl.querySelector("[data-panel-edit]");
      edit.hidden = !edit.hidden;
    });
    panelEl.querySelector("[data-panel-save]").addEventListener("click", saveProfile);
    panelEl.querySelector("[data-panel-avatar-input]").addEventListener("change", onAvatarPicked);
    panelEl.querySelector("[data-panel-logout]").addEventListener("click", async () => {
      await sb.auth.signOut();
      closePanel();
    });
    panelEl.querySelector("[data-panel-username]").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveProfile();
      }
    });

    document.addEventListener("click", (e) => {
      if (panelEl.hidden) return;
      if (!panelEl.contains(e.target) && e.target !== chipEl && !chipEl.contains(e.target)) {
        closePanel();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
    });
  }

  function openPanel() {
    if (!panelEl) return;
    panelEl.hidden = false;
    chipEl.setAttribute("aria-expanded", "true");
  }
  function closePanel() {
    if (!panelEl) return;
    panelEl.hidden = true;
    panelEl.querySelector("[data-panel-edit]").hidden = true;
    chipEl.setAttribute("aria-expanded", "false");
  }
  function togglePanel() {
    if (panelEl.hidden) openPanel();
    else closePanel();
  }

  function panelNote(message, ok) {
    const el = panelEl && panelEl.querySelector("[data-panel-note]");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-success", ok === true);
    el.classList.toggle("is-error", ok === false);
  }

  function renderPanel(profile) {
    if (!panelEl) return;
    const name = displayNameOf(profile);
    panelEl.querySelector("[data-panel-name]").textContent = name;
    panelEl.querySelector("[data-panel-user]").textContent = profile.username ? "@" + profile.username : "set a username";
    const plan = panelEl.querySelector("[data-panel-plan]");
    plan.textContent = profile.role || "Free";
    plan.setAttribute("data-role", profile.role || "Free");
    applyAvatar(panelEl.querySelector("[data-panel-face]"), profile);

    const list = panelEl.querySelector("[data-panel-products]");
    list.innerHTML = "";
    productsForRole(profile.role).forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${p.name}</span><span class="product-status${p.active ? " is-active" : ""}">${p.status}</span>`;
      list.appendChild(li);
    });

    const dn = panelEl.querySelector("[data-panel-display]");
    const un = panelEl.querySelector("[data-panel-username]");
    if (document.activeElement !== dn) dn.value = profile.display_name || "";
    if (document.activeElement !== un) un.value = profile.username || "";
  }

  function updateChip(loggedIn, profile) {
    if (!chipEl) return;
    if (!loggedIn) {
      chipEl.hidden = true;
      closePanel();
      return;
    }
    chipEl.querySelector("[data-chip-name]").textContent = displayNameOf(profile);
    chipEl.querySelector("[data-chip-role]").textContent = profile.role || "Free";
    chipEl.setAttribute("data-role", profile.role || "Free");
    applyAvatar(chipEl.querySelector("[data-chip-face]"), profile);
    chipEl.hidden = false;
  }

  /* ------------------------------ Profile edits ----------------------------- */

  async function onAvatarPicked(event) {
    const file = event.target.files && event.target.files[0];
    if (!file || !currentUserId) return;
    if (file.size > 3 * 1024 * 1024) {
      panelNote("Image must be under 3 MB.", false);
      return;
    }
    panelNote("Uploading avatar…");
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `${currentUserId}/avatar.${ext}`;
    const up = await sb.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (up.error) {
      panelNote("Avatar upload failed: " + up.error.message, false);
      return;
    }
    const pub = sb.storage.from("avatars").getPublicUrl(path);
    const url = pub.data.publicUrl + "?t=" + Date.now();
    const { error } = await sb
      .from("profiles")
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq("id", currentUserId);
    if (error) {
      panelNote(error.message, false);
      return;
    }
    panelNote("Avatar updated.", true);
    refresh();
  }

  async function saveProfile() {
    if (!currentUserId) return;
    const dn = panelEl.querySelector("[data-panel-display]");
    const un = panelEl.querySelector("[data-panel-username]");
    const username = String(un.value || "").trim();
    const display = String(dn.value || "").trim();

    const problem = usernameProblem(username);
    if (problem) {
      panelNote(problem, false);
      return;
    }

    panelNote("Saving…");
    if (await usernameTaken(username)) {
      panelNote(`The username "${username}" is already taken.`, false);
      return;
    }

    const { error } = await sb
      .from("profiles")
      .update({ username, display_name: display || null, updated_at: new Date().toISOString() })
      .eq("id", currentUserId);

    if (error) {
      const taken = error.code === "23505" || /duplicate key/i.test(error.message || "");
      panelNote(taken ? `The username "${username}" is already taken.` : error.message, false);
      return;
    }
    panelNote("Profile saved.", true);
    refresh();
  }

  async function refresh() {
    const { data } = await sb.auth.getSession();
    renderSession(data.session);
  }

  /* ------------------------------ Pricing reveal ---------------------------- */
  // Prices live in a private "plans" table only logged-in members can read,
  // so they never appear in the public page source.
  const priceNote = document.querySelector("#pricingNote");
  const priceNoteDefault = priceNote ? priceNote.innerHTML : "";
  let plansCache = null;

  async function fetchPlans() {
    if (plansCache) return plansCache;
    try {
      const { data, error } = await sb.from("plans").select("id, price");
      if (error || !data) return null;
      const map = {};
      data.forEach((p) => (map[p.id] = p.price));
      plansCache = map;
      return map;
    } catch (_e) {
      return null;
    }
  }

  async function revealPrices(loggedIn) {
    const priceEls = document.querySelectorAll(".plan-price[data-plan]");
    if (!priceEls.length) return;
    const map = loggedIn ? await fetchPlans() : null;
    if (loggedIn && map) {
      priceEls.forEach((el) => {
        el.textContent = map[el.dataset.plan] || "Coming Soon";
      });
      if (priceNote) priceNote.textContent = "You're signed in — here's your Nulqor launch pricing.";
    } else {
      priceEls.forEach((el) => (el.textContent = "Coming Soon"));
      if (priceNote) priceNote.innerHTML = priceNoteDefault;
    }
  }

  /* -------------------------------- Session -------------------------------- */

  async function renderSession(session) {
    setNav(session);
    const loggedIn = Boolean(session && session.user);
    let profile = { username: "", role: "Free", display_name: "", avatar_url: "" };
    if (loggedIn) profile = await loadProfile(session.user.id);
    currentProfile = profile;
    currentUserId = loggedIn ? session.user.id : null;

    updateChip(loggedIn, profile);
    revealPrices(loggedIn);
    if (loggedIn) renderPanel(profile);

    if (!page) return; // the rest is account-page only
    if (formsWrap) formsWrap.hidden = loggedIn;
    if (sessionCard) sessionCard.hidden = !loggedIn;
    if (loggedIn) {
      if (sessionEmail) sessionEmail.textContent = session.user.email;
      if (sessionUsername) sessionUsername.textContent = displayNameOf(profile);
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
    if (page) showNote("Accounts aren't connected yet. Add your Supabase keys to config.js.", false);
    return;
  }

  buildChip();
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
        showNote("Account created. You can log in now.", true);
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
