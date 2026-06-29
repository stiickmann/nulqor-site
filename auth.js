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
  const DASHBOARD_ROLES = ["Founder", "App Admin", "Site Admin", "App Tester", "Site Tester"];
  const STAFF_ACCOUNT_ROLES = ["Founder", "App Admin", "Site Admin", "App Tester", "Site Tester"];

  let currentUserId = null;
  let currentProfile = {
    username: "",
    role: "",
    access_status: "pending",
    display_name: "",
    avatar_url: "",
    profile_visibility: "private",
    show_on_marketplace: false,
    show_forge_stats: false,
    show_uploaded_assets: false,
    allow_public_lookup: false,
    show_role: true,
    show_project_vault: false,
    hide_plugin_stack: false,
    show_forge_activity: false,
  };
  let currentAccessRequest = null;
  const visibilityInputs = Array.from(document.querySelectorAll("[data-visibility-input]"));
  const pageAvatarInput = document.querySelector("#avatar-input");

  function clearLegacySharedAvatar() {
    try {
      localStorage.removeItem("nulqor-profile-avatar");
      const raw = localStorage.getItem("nulqor-account-state");
      if (!raw) return;
      const state = JSON.parse(raw);
      if (!state || !state.profile || !Object.prototype.hasOwnProperty.call(state.profile, "avatarUrl")) return;
      delete state.profile.avatarUrl;
      if (!Object.keys(state.profile).length) delete state.profile;
      localStorage.setItem("nulqor-account-state", JSON.stringify(state));
    } catch (_error) {
      // Legacy browser state is optional; Supabase remains the avatar source.
    }
  }

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
      return "Username must be 3-20 characters: letters, numbers, or underscores.";
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
    const empty = {
      username: "",
      role: "",
      access_status: "pending",
      display_name: "",
      avatar_url: "",
      profile_visibility: "private",
      show_on_marketplace: false,
      show_forge_stats: false,
      show_uploaded_assets: false,
      allow_public_lookup: false,
      show_role: true,
      show_project_vault: false,
      hide_plugin_stack: false,
      show_forge_activity: false,
    };
    try {
      let { data, error } = await sb
        .from("profiles")
        .select("username, role, access_status, display_name, avatar_url, profile_visibility, show_on_marketplace, show_forge_stats, show_uploaded_assets, allow_public_lookup, show_role, show_project_vault, hide_plugin_stack, show_forge_activity")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        const res = await sb.from("profiles").select("username, role").eq("id", userId).maybeSingle();
        data = res.data;
      }
      if (!data) return empty;
      return {
        username: data.username || "",
        role: data.role || "",
        access_status: data.access_status || (data.role ? "active" : "pending"),
        display_name: data.display_name || "",
        avatar_url: data.avatar_url || "",
        profile_visibility: data.profile_visibility || "private",
        show_on_marketplace: Boolean(data.show_on_marketplace),
        show_forge_stats: Boolean(data.show_forge_stats),
        show_uploaded_assets: Boolean(data.show_uploaded_assets),
        allow_public_lookup: Boolean(data.allow_public_lookup),
        show_role: data.show_role !== false,
        show_project_vault: Boolean(data.show_project_vault),
        hide_plugin_stack: Boolean(data.hide_plugin_stack),
        show_forge_activity: Boolean(data.show_forge_activity),
      };
    } catch (_e) {
      return empty;
    }
  }

  function displayNameOf(profile) {
    return profile.display_name || profile.username || "Member";
  }

  function applyAvatar(faceEl, profile) {
    if (!faceEl) return;
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

  function setText(id, value) {
    const el = document.querySelector(`#${id}`);
    if (el) el.textContent = value;
  }

  function monthYear(value) {
    if (!value) return "Unknown";
    try {
      return new Date(value).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    } catch (_e) {
      return "Unknown";
    }
  }

  function hasActiveAccess(profile) {
    return profile && profile.access_status === "active" && Boolean(profile.role);
  }

  function planLabel(profile) {
    if (!profile) return "Access pending";
    if (profile.access_status === "denied") return "Access denied";
    if (profile.access_status === "suspended") return "Access suspended";
    if (!hasActiveAccess(profile)) return "Access pending";
    return profile.role;
  }

  function visibilityStatus(input, profile) {
    const field = input.dataset.visibilityField;
    if (field === "profile_visibility") {
      return (profile.profile_visibility || "private") === "public" ? "Public" : "Private";
    }
    if (field === "hide_plugin_stack") return profile.hide_plugin_stack ? "Hidden" : "Visible";
    if (field === "allow_public_lookup") return profile.allow_public_lookup ? "Allowed" : "Blocked";
    return profile[field] ? "On" : "Off";
  }

  function syncVisibilityControl(input, loggedIn, profile) {
    const field = input.dataset.visibilityField;
    if (field === "profile_visibility") {
      input.checked = (profile.profile_visibility || "private") === "public";
    } else {
      input.checked = Boolean(profile[field]);
    }
    input.disabled = !loggedIn;
    const row = input.closest(".toggle-row");
    if (row) row.classList.toggle("is-disabled", !loggedIn);
    const status = input.closest(".switch-control")?.querySelector(".toggle-status");
    if (status) status.textContent = loggedIn ? visibilityStatus(input, profile) : "Sign in";
  }

  function updateVisibilityControls(loggedIn, profile) {
    visibilityInputs.forEach((input) => syncVisibilityControl(input, loggedIn, profile));
  }

  async function saveVisibility(input) {
    if (!currentUserId) {
      updateVisibilityControls(false, currentProfile);
      return;
    }
    const field = input.dataset.visibilityField;
    const update = { updated_at: new Date().toISOString() };
    update[field] = field === "profile_visibility"
      ? (input.checked ? (input.dataset.on || "public") : (input.dataset.off || "private"))
      : input.checked;

    const previous = currentProfile[field];
    currentProfile[field] = update[field];
    updateVisibilityControls(true, currentProfile);

    const { error } = await sb.from("profiles").update(update).eq("id", currentUserId);
    if (error) {
      currentProfile[field] = previous;
      updateVisibilityControls(true, currentProfile);
      showNote("Could not save visibility setting: " + error.message, false);
      return;
    }
    showNote("Visibility setting saved.", true);
  }

  function updateDashboardLinks(loggedIn, profile) {
    const allowed = loggedIn && hasActiveAccess(profile) && DASHBOARD_ROLES.includes(profile.role);
    document.querySelectorAll("[data-admin-dashboard-link]").forEach((link) => {
      link.hidden = !allowed;
    });
  }

  function renderAccountPage(loggedIn, profile, session) {
    if (!page) return;
    const name = loggedIn ? displayNameOf(profile) : "Account";
    const handle = loggedIn && profile.username ? `@${profile.username}` : "@username";
    const role = profile.role || "";
    const isDashboardUser = loggedIn && hasActiveAccess(profile) && DASHBOARD_ROLES.includes(role);
    const isStaffAccount = loggedIn && hasActiveAccess(profile) && STAFF_ACCOUNT_ROLES.includes(role);
    const verified = Boolean(session && session.user && session.user.email_confirmed_at);

    setText("profile-title", name);
    setText("profile-handle", handle);
    setText("avatar-initial", loggedIn ? (name.charAt(0) || "N").toUpperCase() : "N");
    setText("profile-role-pill", planLabel(profile));
    setText("profile-member-line", loggedIn ? `Nulqor user since ${monthYear(session.user.created_at)}` : "Sign in to connect your Nulqor profile.");
    setText("id-creator", name);
    setText("id-handle", handle);
    setText("id-plan", loggedIn ? planLabel(profile) : "Not signed in");
    setText("id-status", loggedIn ? (profile.access_status || "pending") : "Signed out");
    setText("id-member-since", loggedIn ? monthYear(session.user.created_at) : "Not signed in");
    setText("sec-plan", loggedIn ? planLabel(profile) : "Sign in to connect");
    setText("sec-status", loggedIn ? (profile.access_status || "pending") : "Signed out");
    setText("sec-email", loggedIn ? (verified ? "Verified" : "Unverified") : "Not connected");
    setText("sec-2fa", loggedIn ? "Not enabled" : "Not connected");
    setText("sec-sessions", loggedIn ? "This device" : "Not connected");

    const preview = document.querySelector("#avatar-preview");
    const avatarButton = document.querySelector("#avatar-upload-button");
    if (avatarButton) avatarButton.disabled = !loggedIn;
    if (preview) {
      if (loggedIn && profile.avatar_url) {
        preview.src = profile.avatar_url;
        preview.hidden = false;
        avatarButton?.classList.add("has-image");
        avatarButton?.setAttribute("aria-label", "Change profile picture");
        if (avatarButton) avatarButton.title = "Change profile picture";
      } else {
        preview.removeAttribute("src");
        preview.hidden = true;
        avatarButton?.classList.remove("has-image");
        avatarButton?.setAttribute("aria-label", loggedIn ? "Upload profile picture" : "Log in to upload a profile picture");
        if (avatarButton) avatarButton.title = loggedIn ? "Upload profile picture" : "Log in to upload a profile picture";
      }
    }

    const adminLink = document.querySelector("#account-admin-link");
    if (adminLink) adminLink.hidden = !isDashboardUser;
    updateDashboardLinks(loggedIn, profile);
    document.querySelectorAll("[data-staff-only]").forEach((section) => {
      section.hidden = !isStaffAccount;
    });
    document.querySelectorAll("[data-owner-only]").forEach((section) => {
      section.hidden = !loggedIn;
    });

    const publicLink = document.querySelector("#profile-public-link");
    if (publicLink) {
      publicLink.hidden = !loggedIn || !profile.username;
      if (profile.username) publicLink.href = `profile.html?username=${encodeURIComponent(profile.username)}`;
    }

    updateVisibilityControls(loggedIn, profile);
  }

  function productsForRole(profile) {
    const forge = hasActiveAccess(profile);
    const status = forge ? "Active" : (profile.access_status === "denied" ? "Not approved" : "Pending approval");
    return [{ name: "Forge Studio", status, active: forge }];
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
      '<a class="account-panel-action account-panel-admin" data-panel-admin href="admin.html" hidden>Admin dashboard</a>' +
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
    plan.textContent = planLabel(profile);
    plan.setAttribute("data-role", profile.role || "Pending");
    applyAvatar(panelEl.querySelector("[data-panel-face]"), profile);

    const list = panelEl.querySelector("[data-panel-products]");
    list.innerHTML = "";
    productsForRole(profile).forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${p.name}</span><span class="product-status${p.active ? " is-active" : ""}">${p.status}</span>`;
      list.appendChild(li);
    });

    const adminLink = panelEl.querySelector("[data-panel-admin]");
    if (adminLink) adminLink.hidden = !hasActiveAccess(profile) || !DASHBOARD_ROLES.includes(profile.role);

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
    chipEl.querySelector("[data-chip-role]").textContent = planLabel(profile);
    chipEl.setAttribute("data-role", profile.role || "Pending");
    applyAvatar(chipEl.querySelector("[data-chip-face]"), profile);
    chipEl.hidden = false;
  }

  /* ------------------------------ Profile edits ----------------------------- */

  async function onAvatarPicked(event) {
    const file = event.target.files && event.target.files[0];
    if (!file || !currentUserId) return;
    if (!file.type.startsWith("image/")) {
      panelNote("Choose a PNG, JPG, GIF, or WebP image.", false);
      event.target.value = "";
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      panelNote("Image must be under 3 MB.", false);
      event.target.value = "";
      return;
    }
    panelNote("Uploading avatar...");
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `${currentUserId}/avatar.${ext}`;
    const up = await sb.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (up.error) {
      panelNote("Avatar upload failed: " + up.error.message, false);
      event.target.value = "";
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
      event.target.value = "";
      return;
    }
    event.target.value = "";
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

    panelNote("Saving...");
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
        banner.textContent = `Founders Edition - ${left.toLocaleString()} of ${FOUNDER_CAP.toLocaleString()} founder spots left.`;
        banner.classList.remove("is-closed");
      } else {
        banner.textContent = "Founders Edition is fully claimed - standard pricing now applies.";
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

  // Pending/guest accounts keep request CTAs. Approved accounts can register
  // a "Notify me at launch" action that records interest, then shows confirmed.
  function relabelCTAs(hasAccess) {
    document.querySelectorAll("[data-plan-cta]").forEach((btn) => {
      if (!btn.dataset.ctaDefault) btn.dataset.ctaDefault = btn.textContent.trim();
      const plan = btn.dataset.planCta;

      if (!hasAccess) {
        btn.textContent = btn.dataset.ctaDefault;
        btn.classList.remove("is-locked");
        btn.setAttribute("href", "#access");
      } else if (plan === "free") {
        btn.textContent = "Included free";
        btn.classList.add("is-locked");
        btn.setAttribute("href", "account.html");
      } else if (notifiedPlans.has(plan)) {
        btn.textContent = "You'll be notified at launch";
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
    if (!currentUserId || !hasActiveAccess(currentProfile) || plan === "free" || notifiedPlans.has(plan)) return;
    const previous = btn.textContent;
    btn.textContent = "Saving...";
    const { error } = await sb.from("launch_interest").insert({ user_id: currentUserId, plan });
    if (error && error.code !== "23505") {
      btn.textContent = previous;
      return;
    }
    notifiedPlans.add(plan);
    btn.textContent = "You'll be notified at launch";
    btn.classList.add("is-locked");
    btn.removeAttribute("href");
  }

  async function revealPrices(hasAccess) {
    const priceEls = document.querySelectorAll(".plan-price[data-plan]");
    if (!priceEls.length) return;

    relabelCTAs(hasAccess);
    const founderOpen = await updateFounderBanner();
    const map = hasAccess ? await fetchPlans() : null;

    priceEls.forEach((el) => {
      const head = el.parentElement;
      const oldWas = head.querySelector(".plan-was");
      if (oldWas) oldWas.remove();

      const plan = map && map[el.dataset.plan];
      if (!hasAccess || !plan) {
        el.textContent = "Coming Soon";
        return;
      }
      const useFounder = founderOpen && plan.founder_price;
      el.textContent = useFounder ? plan.founder_price : plan.price;
      if (useFounder && plan.founder_price !== plan.price) {
        const was = document.createElement("span");
        was.className = "plan-was";
        was.textContent = "Founders Edition - was ";
        const old = document.createElement("s");
        old.textContent = plan.price;
        was.appendChild(old);
        head.appendChild(was);
      }
    });

    if (priceNote) {
      if (hasAccess && map) {
        priceNote.textContent = founderOpen
          ? "Founders Edition pricing - locked in for the first 1,000 members."
          : "Your Nulqor launch pricing.";
      } else {
        priceNote.innerHTML = priceNoteDefault;
      }
    }
  }

  /* --------------------------- Logged-in access CTAs ------------------------ */
  // Approved members should not be prompted to request access again.
  // top-right nav CTA and turn the hero CTA into an account link.
  function updateAccessCTAs(hasAccess) {
    document.querySelectorAll(".nav-action").forEach((el) => {
      el.hidden = hasAccess;
    });
    document.querySelectorAll("[data-hero-cta]").forEach((el) => {
      if (!el.dataset.guestText) {
        el.dataset.guestText = el.textContent.trim();
        el.dataset.guestHref = el.getAttribute("href") || "#access";
      }
      if (hasAccess) {
        el.textContent = "Your account";
        el.setAttribute("href", "account.html");
      } else {
        el.textContent = el.dataset.guestText;
        el.setAttribute("href", el.dataset.guestHref);
      }
    });
  }

  async function loadAccessRequest(userId) {
    if (!userId) return null;
    try {
      const { data, error } = await sb
        .from("waitlist")
        .select("id, role, status, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return error ? null : data;
    } catch (_error) {
      return null;
    }
  }

  function updateAccessSection(loggedIn, profile, session, request) {
    const form = document.querySelector("#accessForm");
    if (!form) return;
    let msg = document.querySelector("[data-access-member]");
    const active = loggedIn && hasActiveAccess(profile);
    const denied = loggedIn && profile.access_status === "denied";
    const pendingRequest = loggedIn && request && request.status === "pending";

    if (active || denied || pendingRequest) {
      if (!msg) {
        msg = document.createElement("p");
        msg.setAttribute("data-access-member", "");
        form.parentNode.insertBefore(msg, form);
      }
      msg.className = `form-note ${denied ? "is-error" : "is-success"}`;
      msg.textContent = active
        ? `${displayNameOf(profile)}, your ${profile.role} access is active.`
        : denied
          ? "Your access request was not approved. Contact Nulqor support if you believe this is a mistake."
          : `Your request for ${request.role || "Nulqor access"} is pending review.`;
      msg.hidden = false;
      form.hidden = true;
    } else {
      if (msg) msg.hidden = true;
      form.hidden = false;
      if (loggedIn && session && session.user) {
        const email = form.querySelector('[name="email"]');
        const name = form.querySelector('[name="name"]');
        if (email) {
          email.value = session.user.email || "";
          email.readOnly = true;
        }
        if (name && !name.value) name.value = displayNameOf(profile);
      }
    }
  }

  /* -------------------------------- Session -------------------------------- */

  async function renderSession(session) {
    setNav(session);
    const loggedIn = Boolean(session && session.user);
    let profile = {
      username: "",
      role: "",
      access_status: "pending",
      display_name: "",
      avatar_url: "",
      profile_visibility: "private",
      show_on_marketplace: false,
      show_forge_stats: false,
      show_uploaded_assets: false,
      allow_public_lookup: false,
      show_role: true,
      show_project_vault: false,
      hide_plugin_stack: false,
      show_forge_activity: false,
    };
    if (loggedIn) profile = await loadProfile(session.user.id);
    currentProfile = profile;
    currentUserId = loggedIn ? session.user.id : null;
    currentAccessRequest = loggedIn ? await loadAccessRequest(session.user.id) : null;
    const active = loggedIn && hasActiveAccess(profile);

    if (active) await loadInterests(session.user.id);
    else notifiedPlans.clear();

    updateChip(loggedIn, profile);
    updateDashboardLinks(loggedIn, profile);
    revealPrices(active);
    updateAccessCTAs(active);
    updateAccessSection(loggedIn, profile, session, currentAccessRequest);
    renderAccountPage(loggedIn, profile, session);
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

  visibilityInputs.forEach((input) => {
    input.addEventListener("change", () => {
      saveVisibility(input);
    });
  });

  if (pageAvatarInput) pageAvatarInput.addEventListener("change", onAvatarPicked);

  window.addEventListener("nulqor:access-requested", refresh);

  clearLegacySharedAvatar();

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
    if (!currentUserId || !hasActiveAccess(currentProfile) || plan === "free" || notifiedPlans.has(plan)) return;
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
      if (password.length < 8) {
        showNote("Password must be at least 8 characters.", false);
        return;
      }

      showNote("Checking username...", undefined);
      if (await usernameTaken(username)) {
        showNote(`The username "${username}" is already taken.`, false);
        return;
      }

      showNote("Creating your account...", undefined);
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
        showNote("Account created - you're logged in.", true);
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

      showNote("Logging in...", undefined);
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
