// Admin dashboard: list members + waitlist, change roles. Every privileged
// action is gated again in the database (is_admin()), so the UI gate is just UX.
(function () {
  const sb = window.nulqorSupabase;

  const ROLES = ["Free", "Creator", "Studio", "Site Tester", "Site Creator", "Site Admin", "Founder"];
  const ADMIN_ROLES = ["Founder", "Site Admin"];

  const gate = document.querySelector("#adminGate");
  const gateMsg = document.querySelector("#adminGateMsg");
  const gateAction = document.querySelector("#adminGateAction");
  const content = document.querySelector("#adminContent");
  const membersBody = document.querySelector("[data-members-body]");
  const waitlistBody = document.querySelector("[data-waitlist-body]");
  const membersCount = document.querySelector("[data-members-count]");
  const waitlistCount = document.querySelector("[data-waitlist-count]");
  const note = document.querySelector("#adminNote");

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
    if (!value) return "—";
    try {
      return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (_e) {
      return "—";
    }
  }

  async function loadMembers() {
    if (!membersBody) return;
    membersBody.innerHTML = '<tr><td colspan="5" class="admin-empty">Loading…</td></tr>';
    const { data, error } = await sb.rpc("admin_list_members");
    if (error) {
      membersBody.innerHTML = `<tr><td colspan="5" class="admin-empty">${esc(error.message)}</td></tr>`;
      return;
    }
    const rows = data || [];
    if (membersCount) membersCount.textContent = `(${rows.length})`;
    if (!rows.length) {
      membersBody.innerHTML = '<tr><td colspan="5" class="admin-empty">No members yet.</td></tr>';
      return;
    }
    membersBody.innerHTML = "";
    rows.forEach((m) => {
      const tr = document.createElement("tr");
      const name = m.display_name || m.username || "Member";
      const options = ROLES.map(
        (r) => `<option value="${esc(r)}"${r === m.role ? " selected" : ""}>${esc(r)}</option>`
      ).join("");
      tr.innerHTML =
        `<td>${esc(name)}</td>` +
        `<td>${m.username ? "@" + esc(m.username) : "—"}</td>` +
        `<td class="admin-email">${esc(m.email)}</td>` +
        `<td><select class="admin-role-select" data-id="${esc(m.id)}">${options}</select></td>` +
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
    showNote("Saving…");
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
    waitlistBody.innerHTML = '<tr><td colspan="4" class="admin-empty">Loading…</td></tr>';
    const { data, error } = await sb.rpc("admin_list_waitlist");
    if (error) {
      waitlistBody.innerHTML = `<tr><td colspan="4" class="admin-empty">${esc(error.message)}</td></tr>`;
      return;
    }
    const rows = data || [];
    if (waitlistCount) waitlistCount.textContent = `(${rows.length})`;
    if (!rows.length) {
      waitlistBody.innerHTML = '<tr><td colspan="4" class="admin-empty">No access requests yet.</td></tr>';
      return;
    }
    waitlistBody.innerHTML = "";
    rows.forEach((w) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${esc(w.name || "—")}</td>` +
        `<td class="admin-email">${esc(w.email)}</td>` +
        `<td>${esc(w.role || "—")}</td>` +
        `<td>${fmtDate(w.created_at)}</td>`;
      waitlistBody.appendChild(tr);
    });
  }

  async function init() {
    if (!sb) {
      showGate("Accounts aren't connected yet (missing Supabase keys).");
      return;
    }

    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session || !session.user) {
      showGate("You need to be logged in to view this page.", "Log in", "account.html");
      return;
    }

    const { data: profile } = await sb
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .maybeSingle();

    const role = (profile && profile.role) || "Free";
    if (!ADMIN_ROLES.includes(role)) {
      showGate("You don't have access to the admin dashboard.", "Back to site", "index.html");
      return;
    }

    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
    loadMembers();
    loadWaitlist();

    const rm = document.querySelector("[data-refresh-members]");
    const rw = document.querySelector("[data-refresh-waitlist]");
    if (rm) rm.addEventListener("click", loadMembers);
    if (rw) rw.addEventListener("click", loadWaitlist);
  }

  init();
  if (sb) sb.auth.onAuthStateChange(() => init());
})();
