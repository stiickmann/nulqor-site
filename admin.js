// Admin dashboard: list members + access requests, change roles, accept/delete
// requests. Every privileged action is gated again in the database (is_admin()),
// so the UI gate is just UX.
(function () {
  const sb = window.nulqorSupabase;

  const ROLES = [
    "Founder",
    "App Admin",
    "Site Admin",
    "App Tester",
    "Site Tester",
    "Nulqor Enterprise",
    "Nulqor Teams",
    "Nulqor Creator",
    "Nulqor Free",
  ];
  const STAFF_ROLES = ["Founder", "App Admin", "Site Admin", "App Tester", "Site Tester"];
  const SITE_ACCESS_ROLES = ["Founder", "Site Admin"];
  // Only the Founder can change anyone's role (enforced again in the database).
  let canRole = false;
  let canViewMembers = false;
  let canManageRequests = false;
  let myRole = null;

  const gate = document.querySelector("#adminGate");
  const gateMsg = document.querySelector("#adminGateMsg");
  const gateAction = document.querySelector("#adminGateAction");
  const content = document.querySelector("#adminContent");
  const membersBody = document.querySelector("[data-members-body]");
  const waitlistBody = document.querySelector("[data-waitlist-body]");
  const membersCount = document.querySelector("[data-members-count]");
  const waitlistCount = document.querySelector("[data-waitlist-count]");
  const note = document.querySelector("#adminNote");

  let started = false; // admin content wired up once
  let settled = false; // we have a definitive auth answer

  function showGate(message, actionLabel, actionHref) {
    if (content) content.hidden = true;
    if (gate) gate.hidden = false;
    if (gateMsg) gateMsg.textContent = message;
    if (gateAction) {
      if (actionLabel) {
        gateAction.textContent = actionLabel;
        gateAction.href = actionHref || "#";
        gateAction.hidden = false;
      } else {
        gateAction.hidden = true;
      }
    }
  }

  function showNote(message, ok) {
    if (!note) return;
    note.textContent = message;
    note.classList.toggle("is-success", ok === true);
    note.classList.toggle("is-error", ok === false);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function fmtDate(value) {
    if (!value) return "--";
    try {
      return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (_e) {
      return "--";
    }
  }

  async function loadMembers() {
    if (!membersBody) return;
    membersBody.innerHTML = '<tr><td colspan="6" class="admin-empty">Loading...</td></tr>';
    const { data, error } = await sb.rpc("admin_list_members");
    if (error) {
      membersBody.innerHTML = `<tr><td colspan="6" class="admin-empty">${esc(error.message)}</td></tr>`;
      return;
    }
    const rows = data || [];
    if (membersCount) membersCount.textContent = `(${rows.length})`;
    if (!rows.length) {
      membersBody.innerHTML = '<tr><td colspan="6" class="admin-empty">No members yet.</td></tr>';
      return;
    }
    membersBody.innerHTML = "";
    rows.forEach((m) => {
      const tr = document.createElement("tr");
      const name = m.display_name || m.username || "Member";
      let roleCell;
      if (canRole) {
        const options = ROLES.map(
          (r) => `<option value="${esc(r)}"${r === m.role ? " selected" : ""}>${esc(r)}</option>`
        ).join("");
        roleCell = `<select class="admin-role-select" data-id="${esc(m.id)}" data-prev="${esc(m.role)}">${options}</select>`;
      } else {
        // Non-founders see the role but can't change it.
        roleCell = `<span class="admin-role-static">${esc(m.role || "Pending")}</span>`;
      }
      tr.innerHTML =
        `<td>${esc(name)}</td>` +
        `<td>${m.username ? "@" + esc(m.username) : "--"}</td>` +
        `<td class="admin-email">${esc(m.email)}</td>` +
        `<td>${roleCell}</td>` +
        `<td><span class="admin-role-static">${esc(m.access_status || "pending")}</span></td>` +
        `<td>${fmtDate(m.created_at)}</td>`;
      membersBody.appendChild(tr);
    });

    membersBody.querySelectorAll(".admin-role-select").forEach((sel) => {
      sel.addEventListener("change", () => setRole(sel));
    });
  }

  async function setRole(sel) {
    const id = sel.dataset.id;
    const role = sel.value;
    const previous = sel.dataset.prev || "";
    sel.disabled = true;
    showNote("Saving...");
    const { error } = await sb.rpc("admin_set_role", { target: id, new_role: role });
    sel.disabled = false;
    if (error) {
      showNote("Could not change role: " + error.message, false);
      if (previous) sel.value = previous;
      return;
    }
    sel.dataset.prev = role;
    showNote(`Role updated to "${role}".`, true);
  }

  async function loadWaitlist() {
    if (!waitlistBody) return;
    waitlistBody.innerHTML = '<tr><td colspan="5" class="admin-empty">Loading...</td></tr>';
    const { data, error } = await sb.rpc("admin_list_waitlist");
    if (error) {
      waitlistBody.innerHTML = `<tr><td colspan="5" class="admin-empty">${esc(error.message)}</td></tr>`;
      return;
    }
    const rows = data || [];
    if (waitlistCount) waitlistCount.textContent = `(${rows.length})`;
    if (!rows.length) {
      waitlistBody.innerHTML = '<tr><td colspan="5" class="admin-empty">No access requests yet.</td></tr>';
      return;
    }
    waitlistBody.innerHTML = "";
    rows.forEach((w) => {
      const tr = document.createElement("tr");
      const status = w.status || "pending";
      const action = status === "pending"
        ? `<button class="admin-action req-accept" data-id="${esc(w.id)}">Accept</button>` +
          ` <button class="admin-action req-deny" data-id="${esc(w.id)}">Deny</button>`
        : `<span class="req-accepted">${status === "accepted" ? "Accepted" : "Denied"}</span>`;
      tr.innerHTML =
        `<td>${esc(w.name || "--")}</td>` +
        `<td class="admin-email">${esc(w.email)}</td>` +
        `<td>${esc(w.role || "--")}</td>` +
        `<td>${fmtDate(w.created_at)}</td>` +
        `<td class="req-actions">${action}</td>`;
      waitlistBody.appendChild(tr);
    });

    waitlistBody.querySelectorAll(".req-accept").forEach((b) => {
      b.addEventListener("click", () => acceptRequest(b.dataset.id, b));
    });
    waitlistBody.querySelectorAll(".req-deny").forEach((b) => {
      b.addEventListener("click", () => setRequestStatus(b.dataset.id, "denied", b));
    });
  }

  async function acceptRequest(id, btn) {
    return setRequestStatus(id, "accepted", btn);
  }

  async function setRequestStatus(id, status, btn) {
    if (btn) btn.disabled = true;
    showNote(status === "accepted" ? "Accepting..." : "Denying...");
    const { error } = await sb.rpc("admin_set_waitlist_status", { target_id: id, new_status: status });
    if (error) {
      showNote(`Could not ${status === "accepted" ? "accept" : "deny"}: ${error.message}`, false);
      if (btn) btn.disabled = false;
      return;
    }
    showNote(`Access request ${status === "accepted" ? "accepted" : "denied"}.`, true);
    loadWaitlist();
  }

  function startAdmin() {
    if (started) return;
    started = true;
    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
    const memberSection = document.querySelector("[data-members-section]");
    const requestSection = document.querySelector("[data-waitlist-section]");
    if (memberSection) memberSection.hidden = !canViewMembers;
    if (requestSection) requestSection.hidden = !canManageRequests;
    const scopeTitle = document.querySelector("[data-scope-title]");
    const scopeCopy = document.querySelector("[data-scope-copy]");
    if (scopeTitle) scopeTitle.textContent = `${myRole} scope`;
    if (scopeCopy) {
      scopeCopy.textContent = canRole
        ? "Full command-center access, including role assignment and access decisions."
        : canManageRequests
          ? "Review account requests and inspect member access. Role assignment remains Founder-only."
          : myRole === "App Admin" || myRole === "App Tester"
            ? "App testing and Forge administration access only. Site access requests and role assignment are hidden."
            : "Site testing access only. Account approvals and role assignment are hidden.";
    }
    const hint = document.querySelector("#membersHint");
    if (hint && !canRole) {
      hint.textContent = "Only the Founder can change roles. Member access is read-only here.";
    }
    if (canViewMembers) loadMembers();
    if (canManageRequests) loadWaitlist();
    const rm = document.querySelector("[data-refresh-members]");
    const rw = document.querySelector("[data-refresh-waitlist]");
    if (rm && canViewMembers) rm.addEventListener("click", loadMembers);
    if (rw && canManageRequests) rw.addEventListener("click", loadWaitlist);
  }

  async function evaluate() {
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session || !session.user) return "anon";
    const { data: profile } = await sb
      .from("profiles")
      .select("role, access_status")
      .eq("id", session.user.id)
      .maybeSingle();
    myRole = (profile && profile.role) || "Pending";
    canRole = myRole === "Founder";
    canViewMembers = SITE_ACCESS_ROLES.includes(myRole);
    canManageRequests = SITE_ACCESS_ROLES.includes(myRole);
    return profile && profile.access_status === "active" && STAFF_ROLES.includes(myRole) ? "admin" : "denied";
  }

  // fromEvent = triggered by an auth state change (we now trust a null session).
  async function refreshGate(fromEvent) {
    const state = await evaluate();
    if (state === "admin") {
      settled = true;
      startAdmin();
      return;
    }
    // Once we're in as admin, ignore transient null-session blips from later
    // auth events (e.g. token refresh). A real logout is handled separately.
    if (started) return;
    if (state === "denied") {
      settled = true;
      showGate("You don't have access to the admin dashboard.", "Back to site", "index.html");
      return;
    }
    // anon: on a cold load the session may not be restored yet, so keep
    // "Checking access..." until an auth event (or the fallback) confirms it.
    if (fromEvent || settled) {
      showGate("You need to be logged in to view this page.", "Log in", "account.html");
    }
  }

  if (!sb) {
    showGate("Accounts aren't connected yet (missing Supabase keys).");
    return;
  }

  refreshGate(false);
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      started = false;
      showGate("You need to be logged in to view this page.", "Log in", "account.html");
      return;
    }
    settled = true;
    refreshGate(true);
  });
  // Final fallback so we never get stuck on "Checking access...".
  setTimeout(() => {
    if (!settled) refreshGate(true);
  }, 1800);
})();
