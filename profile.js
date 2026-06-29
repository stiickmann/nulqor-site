(function () {
  const sb = window.nulqorSupabase;
  const form = document.querySelector("#lookup-form");
  const input = document.querySelector("#lookup-username");
  const state = document.querySelector("#lookup-state");
  const result = document.querySelector("#profile-result");
  const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

  function setState(message, tone) {
    state.textContent = message;
    state.style.color = tone === "error" ? "#ff9d9d" : "var(--muted)";
    state.hidden = false;
  }

  function text(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value == null || value === "" ? "--" : String(value);
  }

  function fmtDuration(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return "0m";
    const minutes = Math.round(value / 60000);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return `${hours}h ${rest}m`;
    return hours ? `${hours}h` : `${rest}m`;
  }

  function pretty(value) {
    return value == null || value === ""
      ? "--"
      : String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function row(label, value) {
    const item = document.createElement("div");
    item.className = "row";
    const name = document.createElement("span");
    name.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value == null || value === "" ? "--" : String(value);
    item.append(name, content);
    return item;
  }

  function card(title, detail) {
    const item = document.createElement("article");
    item.className = "item";
    const heading = document.createElement("strong");
    heading.textContent = title || "Untitled";
    const meta = document.createElement("span");
    meta.textContent = detail || "Public";
    item.append(heading, meta);
    return item;
  }

  function renderAvatar(profile) {
    const host = document.querySelector("#public-avatar");
    host.replaceChildren();
    if (profile.avatarUrl) {
      const image = document.createElement("img");
      image.src = profile.avatarUrl;
      image.alt = `${profile.displayName || profile.username} profile picture`;
      image.referrerPolicy = "no-referrer";
      host.appendChild(image);
    } else {
      host.textContent = (profile.displayName || profile.username || "N").charAt(0).toUpperCase();
    }
  }

  function renderWeek(activity) {
    const host = document.querySelector("#public-week");
    const days = activity?.weeklyActivity?.days || [];
    const max = Math.max(1, ...days.map((day) => Number(day.durationMs) || 0));
    host.replaceChildren(...days.map((day) => {
      const item = document.createElement("div");
      item.className = "day";
      const label = document.createElement("span");
      label.textContent = day.day || "--";
      const track = document.createElement("div");
      track.className = "track";
      const fill = document.createElement("i");
      fill.style.setProperty("--fill", `${Math.round(((Number(day.durationMs) || 0) / max) * 100)}%`);
      track.appendChild(fill);
      const value = document.createElement("strong");
      value.textContent = fmtDuration(day.durationMs);
      item.append(label, track, value);
      return item;
    }));
  }

  function renderProfile(data) {
    const profile = data.profile || {};
    const sections = data.sections || {};
    renderAvatar(profile);
    text("public-name", profile.displayName || profile.username || "Nulqor creator");
    text("public-handle", profile.username ? `@${profile.username}` : "@username");
    const role = document.querySelector("#public-role");
    role.hidden = !profile.role;
    role.textContent = profile.role || "";

    const identityPanel = document.querySelector("#public-account-identity");
    identityPanel.hidden = !sections.accountIdentity || !data.accountIdentity;
    if (!identityPanel.hidden) {
      const identity = data.accountIdentity;
      document.querySelector("#public-identity-rows").replaceChildren(
        row("Creator", identity.displayName),
        row("Handle", identity.username ? `@${identity.username}` : "--"),
        row("Product", identity.product || "Forge Studio"),
        row("Active Plan", identity.plan || "No active plan"),
        row("Account Status", identity.status || "pending"),
        row("Member Since", identity.memberSince ? new Date(identity.memberSince).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Unknown"),
      );
    }

    const activityPanel = document.querySelector("#public-activity");
    activityPanel.hidden = !sections.forgeActivity;
    if (sections.forgeActivity) {
      renderWeek(data.activity);
      document.querySelector("#public-activity-stats").replaceChildren(
        row("Total Forge time", fmtDuration(data.activity?.forgeTimeMs)),
        row("Projects created", data.activity?.projectsCreated ?? 0),
        row("Models exported", data.activity?.modelsExported ?? 0),
      );
    }

    const insightsPanel = document.querySelector("#public-insights");
    insightsPanel.hidden = !sections.creationInsights;
    if (sections.creationInsights) {
      const insights = data.insights || {};
      document.querySelector("#public-insight-rows").replaceChildren(
        row("Most used editor", pretty(insights.mostUsedEditor)),
        row("Most active project", insights.mostActiveProject),
        row("Favorite export", pretty(insights.favoriteExportType)),
        row("Creation style", pretty(insights.creationStyle)),
        row("Workflow", pretty(insights.workflowType)),
      );
    }

    const pluginsPanel = document.querySelector("#public-plugins");
    pluginsPanel.hidden = !sections.pluginStack;
    if (sections.pluginStack) {
      const plugins = Array.isArray(data.plugins) ? data.plugins : [];
      const host = document.querySelector("#public-plugin-list");
      host.replaceChildren(...(plugins.length
        ? plugins.map((plugin) => card(plugin.name || "Plugin", plugin.uses != null ? `${plugin.uses} uses` : plugin.status || "Installed"))
        : [card("No public plugin data yet", "Plugin Stack is visible")]
      ));
    }

    const projectsPanel = document.querySelector("#public-projects");
    projectsPanel.hidden = !sections.projectVault;
    if (sections.projectVault) {
      const projects = Array.isArray(data.projects) ? data.projects : [];
      document.querySelector("#public-project-list").replaceChildren(...(projects.length
        ? projects.map((project) => card(project.name, [project.editor ? pretty(project.editor) : "", project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : ""].filter(Boolean).join(" / ")))
        : [card("No public projects", "This creator has not published a project yet")]
      ));
    }

    const libraryPanel = document.querySelector("#public-library");
    libraryPanel.hidden = !sections.creatorLibrary;
    if (sections.creatorLibrary) {
      const library = data.library || {};
      document.querySelector("#public-library-list").replaceChildren(
        card(String(library.models ?? 0), "Models"),
        card(String(library.materials ?? 0), "Materials"),
        card(String(library.rigs ?? 0), "Rigs"),
        card(String(library.animations ?? 0), "Animations"),
      );
    }

    const corePanel = document.querySelector("#public-account-core");
    corePanel.hidden = !sections.accountCore || !data.accountCore;
    if (!corePanel.hidden) {
      const core = data.accountCore;
      document.querySelector("#public-account-rows").replaceChildren(
        row("Plan", core.plan || "No active plan"),
        row("Status", pretty(core.status)),
        row("Included products", (core.includedProducts || []).join(", ") || "None"),
        row("Cloud Storage", core.cloudSavesUsed == null ? "Not connected" : `${core.cloudSavesUsed} cloud saves`),
        row("AI Usage", core.aiUsage || "Not connected"),
        row("Email verified", core.emailVerified ? "Enabled" : "Not verified"),
        row("2FA", core.twoFactorEnabled ? "Enabled" : "Not enabled"),
        row("Active sessions", core.activeSessions ?? 0),
      );
    }

    const footprintPanel = document.querySelector("#public-studio-footprint");
    footprintPanel.hidden = !sections.studioFootprint || !data.studioFootprint;
    if (!footprintPanel.hidden) {
      const footprint = data.studioFootprint;
      document.querySelector("#public-studio-rows").replaceChildren(
        row("Forge root", footprint.forgeRoot || "Not connected"),
        row("Latest source change", footprint.updatedAt ? `Uploaded ${new Date(footprint.updatedAt).toLocaleString()}` : "No upload yet"),
        row("Latest release", footprint.latestRelease || "Waiting for release metadata"),
        row("Dist bundle", footprint.distBundle || "Not connected"),
        row("Saved project files", `${footprint.projectsTracked ?? 0} tracked`),
        row("User session tracking", footprint.trackingState || "Not connected"),
      );
    }

    state.hidden = true;
    result.hidden = false;
    document.title = `${profile.displayName || profile.username || "Creator"} - NULQOR`;
  }

  async function lookup(username) {
    result.hidden = true;
    setState("Searching public Nulqor profiles...");
    if (!USERNAME_RE.test(username)) {
      setState("Enter a valid 3-20 character username using letters, numbers, or underscores.", "error");
      return;
    }
    if (!sb) {
      setState("Account lookup is unavailable right now.", "error");
      return;
    }
    const { data, error } = await sb.rpc("public_account_lookup", { p_username: username });
    if (error) {
      setState("Account lookup could not be completed. Try again shortly.", "error");
      return;
    }
    if (!data || data.found !== true) {
      setState("No public profile was found for that username.");
      return;
    }
    renderProfile(data);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = input.value.trim();
    const url = new URL(window.location.href);
    url.searchParams.set("username", username);
    history.replaceState(null, "", url);
    lookup(username);
  });

  const requested = new URLSearchParams(window.location.search).get("username") || "";
  if (requested) {
    input.value = requested;
    lookup(requested);
  }
})();
