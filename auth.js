// Account auth (Supabase): nav state + floating account badge & panel on every
// page, plus login / signup / logout on account.html.
(function () {
  const sb = window.nulqorSupabase;
  const navAccount = document.querySelector("[data-account-link]");

  const page = document.querySelector("[data-auth-page]");
  const formsWraps = Array.from(document.querySelectorAll("[data-auth-forms]"));
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
  // Roles that can open the admin dashboard (enforced again in the database).
  const ADMIN_ROLES = ["Founder", "Site Admin", "Site Tester"];

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
      // Set sizing inline so it beats role-based `background` shorthand rules
      // (those reset background-size/position and would crop to a corner).
      faceEl.style.backgroundImage = `url("${profile.avatar_url}")`;
      faceEl.style.backgroundSize = "cover";
      faceEl.style.backgroundPosition = "center";
      faceEl.style.backgroundRepeat = "no-repeat";
      faceEl.textContent = "";
      faceEl.classList.add("has-image");
    } else {
      faceEl.style.backgroundImage = "";
      faceEl.style.backgroundSize = "";
      faceEl.style.backgroundPosition = "";
      faceEl.style.backgroundRepeat = "";
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
      '<a class="account-panel-action account-panel-admin" data-panel-admin href="admin.html" hidden>⚙ Admin dashboard</a>' +
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

    const adminLink = panelEl.querySelector("[data-panel-admin]");
    if (adminLink) adminLink.hidden = !ADMIN_ROLES.includes(profile.role);

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
  const FOUNDER_CAP = 1000; // founders-edition pricing for the first N members
  const priceNote = document.querySelector("#pricingNote");
  const priceNoteDefault = priceNote ? priceNote.innerHTML : "";
  let plansCache = null;

  async function fetchPlans() {
    if (plansCache) return plansCache;
    try {
      const { data, error } = await sb.from("plans").select("id, price, founder_price");
      if (error || !data) return null;
      const map = {};
      data.forEach((p) => (map[p.id] = { price: p.price, founder_price: p.founder_price }));
      plansCache = map;
      return map;
    } catch (_e) {
      return null;
    }
  }

  // Public scarcity banner. Returns true while founder spots remain.
  async function updateFounderBanner() {
    const banner = document.querySelector("#founderBanner");
    let count = 0;
    try {
      const { data } = await sb.rpc("founder_count");
      count = data || 0;
    } catch (_e) {
      /* function not deployed yet */
    }
    const left = Math.max(0, FOUNDER_CAP - count);
    if (banner) {
      if (left > 0) {
        banner.textContent = `Founders Edition — ${left.toLocaleString()} of ${FOUNDER_CAP.toLocaleString()} founder spots left.`;
        banner.classList.remove("is-closed");
      } else {
        banner.textContent = "Founders Edition is fully claimed — standard pricing now applies.";
        banner.classList.add("is-closed");
      }
      banner.hidden = false;
    }
    return left > 0;
  }

  // Plans a logged-in member has asked to be notified about at launch.
  const notifiedPlans = new Set();

  async function loadInterests(userId) {
    notifiedPlans.clear();
    try {
      const { data } = await sb.from("launch_interest").select("plan").eq("user_id", userId);
      (data || []).forEach((row) => notifiedPlans.add(row.plan));
    } catch (_e) {
      /* table not deployed yet */
    }
  }

  // Logged-out: pre-launch CTAs. Logged-in: Free is included, paid plans become
  // a "Notify me at launch" action that records interest, then shows confirmed.
  function relabelCTAs(loggedIn) {
    document.querySelectorAll("[data-plan-cta]").forEach((btn) => {
      if (!btn.dataset.ctaDefault) btn.dataset.ctaDefault = btn.textContent.trim();
      const plan = btn.dataset.planCta;

      if (!loggedIn) {
        btn.textContent = btn.dataset.ctaDefault;
        btn.classList.remove("is-locked");
        btn.setAttribute("href", "#access");
      } else if (plan === "free") {
        btn.textContent = "Included free";
        btn.classList.add("is-locked");
        btn.setAttribute("href", "account.html");
      } else if (notifiedPlans.has(plan)) {
        btn.textContent = "✓ You'll be notified at launch";
        btn.classList.add("is-locked");
        btn.removeAttribute("href");
      } else {
        btn.textContent = "Notify me at launch";
        btn.classList.remove("is-locked");
        btn.setAttribute("href", "#");
      }
    });
  }

  async function registerInterest(btn) {
    const plan = btn.dataset.planCta;
    if (!currentUserId || plan === "free" || notifiedPlans.has(plan)) return;
    const previous = btn.textContent;
    btn.textContent = "Saving…";
    const { error } = await sb.from("launch_interest").insert({ user_id: currentUserId, plan });
    if (error && error.code !== "23505") {
      btn.textContent = previous;
      return;
    }
    notifiedPlans.add(plan);
    btn.textContent = "✓ You'll be notified at launch";
    btn.classList.add("is-locked");
    btn.removeAttribute("href");
  }

  async function revealPrices(loggedIn) {
    const priceEls = document.querySelectorAll(".plan-price[data-plan]");
    if (!priceEls.length) return;

    relabelCTAs(loggedIn);
    const founderOpen = await updateFounderBanner();
    const map = loggedIn ? await fetchPlans() : null;

    priceEls.forEach((el) => {
      const head = el.parentElement;
      const oldWas = head.querySelector(".plan-was");
      if (oldWas) oldWas.remove();

      const plan = map && map[el.dataset.plan];
      if (!loggedIn || !plan) {
        el.textContent = "Coming Soon";
        return;
      }
      const useFounder = founderOpen && plan.founder_price;
      el.textContent = useFounder ? plan.founder_price : plan.price;
      if (useFounder && plan.founder_price !== plan.price) {
        const was = document.createElement("span");
        was.className = "plan-was";
        was.textContent = "Founders Edition · was ";
        const old = document.createElement("s");
        old.textContent = plan.price;
        was.appendChild(old);
        head.appendChild(was);
      }
    });

    if (priceNote) {
      if (loggedIn && map) {
        priceNote.textContent = founderOpen
          ? "Founders Edition pricing — locked in for the first 1,000 members."
          : "Your Nulqor launch pricing.";
      } else {
        priceNote.innerHTML = priceNoteDefault;
      }
    }
  }

  /* --------------------------- Logged-in access CTAs ------------------------ */
  // Logged-in members shouldn't be prompted to "Request Access". Hide the
  // top-right nav CTA and turn the hero CTA into an account link.
  function updateAccessCTAs(loggedIn) {
    document.querySelectorAll(".nav-action").forEach((el) => {
      el.hidden = loggedIn;
    });
    document.querySelectorAll("[data-hero-cta]").forEach((el) => {
      if (!el.dataset.guestText) {
        el.dataset.guestText = el.textContent.trim();
        el.dataset.guestHref = el.getAttribute("href") || "#access";
      }
      if (loggedIn) {
        el.textContent = "Your account";
        el.setAttribute("href", "account.html");
      } else {
        el.textContent = el.dataset.guestText;
        el.setAttribute("href", el.dataset.guestHref);
      }
    });
  }

  // Replace the "Request Access" waitlist form with a confirmation for members.
  function updateAccessSection(loggedIn, profile) {
    const form = document.querySelector("#accessForm");
    if (!form) return;
    let msg = document.querySelector("[data-access-member]");
    if (loggedIn) {
      if (!msg) {
        msg = document.createElement("p");
        msg.setAttribute("data-access-member", "");
        msg.className = "form-note is-success";
        form.parentNode.insertBefore(msg, form);
      }
      msg.textContent = `You're signed in as ${displayNameOf(profile)} — you already have a Nulqor account. We'll email you the moment Forge Studio opens.`;
      msg.hidden = false;
      form.hidden = true;
    } else {
      if (msg) msg.hidden = true;
      form.hidden = false;
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

    if (loggedIn) await loadInterests(session.user.id);
    else notifiedPlans.clear();

    updateChip(loggedIn, profile);
    revealPrices(loggedIn);
    updateAccessCTAs(loggedIn);
    updateAccessSection(loggedIn, profile);
    if (loggedIn) renderPanel(profile);

    if (!page) return; // the rest is account-page only
    formsWraps.forEach((wrap) => {
      wrap.hidden = loggedIn;
    });
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

  // "Notify me at launch" clicks on the pricing cards.
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-plan-cta]");
    if (!btn) return;
    const plan = btn.dataset.planCta;
    if (!currentUserId || plan === "free" || notifiedPlans.has(plan)) return;
    event.preventDefault();
    registerInterest(btn);
  });

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
