const canvas = document.querySelector("#particleField");
const ctx = canvas.getContext("2d");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let particles = [];
let animationFrame = null;

function sizeCanvas() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * pixelRatio);
  canvas.height = Math.floor(window.innerHeight * pixelRatio);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function createParticles() {
  const count = Math.min(90, Math.max(34, Math.floor(window.innerWidth / 18)));
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    radius: Math.random() * 1.6 + 0.4,
    speed: Math.random() * 0.18 + 0.04,
    alpha: Math.random() * 0.38 + 0.08,
  }));
}

function drawParticles() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  particles.forEach((particle) => {
    particle.y -= particle.speed;

    if (particle.y < -8) {
      particle.y = window.innerHeight + 8;
      particle.x = Math.random() * window.innerWidth;
    }

    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(80, 215, 255, ${particle.alpha})`;
    ctx.fill();
  });

  animationFrame = window.requestAnimationFrame(drawParticles);
}

function initializeParticles() {
  sizeCanvas();
  createParticles();
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  if (!prefersReducedMotion) {
    drawParticles();
  }
}

window.addEventListener("resize", () => {
  window.cancelAnimationFrame(animationFrame);
  initializeParticles();
});

initializeParticles();

function updateActiveNavigation() {
  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  const currentHash = window.location.hash;

  document.querySelectorAll(".nav-links a").forEach((link) => {
    const url = new URL(link.getAttribute("href"), window.location.href);
    const linkPath = url.pathname.split("/").pop() || "index.html";
    const isPolicy = currentPath === "policies.html" && linkPath === "policies.html";
    const isHashMatch =
      currentPath !== "policies.html" &&
      url.hash &&
      url.hash === currentHash &&
      linkPath !== "policies.html";
    const isActive = Boolean(isPolicy || isHashMatch);

    link.classList.toggle("is-active", isActive);

    if (isActive) {
      link.setAttribute("aria-current", isPolicy ? "page" : "location");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  const activePolicyHash = currentHash || "#terms";
  document.querySelectorAll(".policy-sidebar a").forEach((link) => {
    const isActive = link.hash === activePolicyHash;

    link.classList.toggle("is-active", isActive);

    if (isActive) {
      link.setAttribute("aria-current", "location");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

window.addEventListener("hashchange", updateActiveNavigation);
window.addEventListener("load", updateActiveNavigation);
window.addEventListener("pageshow", updateActiveNavigation);
document.querySelectorAll(".nav-links a, .policy-sidebar a").forEach((link) => {
  link.addEventListener("click", () => {
    window.requestAnimationFrame(updateActiveNavigation);
  });
});
updateActiveNavigation();

const customSelects = document.querySelectorAll("[data-select]");

function closeCustomSelects(exceptSelect = null) {
  customSelects.forEach((select) => {
    if (select === exceptSelect) {
      return;
    }

    select.classList.remove("is-open");
    select.querySelector(".select-trigger")?.setAttribute("aria-expanded", "false");
  });
}

customSelects.forEach((select) => {
  const trigger = select.querySelector(".select-trigger");
  const input = select.querySelector("[data-select-input]");
  const valueLabel = select.querySelector("[data-select-value]");
  const options = Array.from(select.querySelectorAll("[role='option']"));

  if (!trigger || !input || !valueLabel || options.length === 0) {
    return;
  }

  function openSelect() {
    closeCustomSelects(select);
    select.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
  }

  function closeSelect() {
    select.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  }

  function setValue(option) {
    const value = option.dataset.value || option.textContent.trim();

    input.value = value;
    valueLabel.textContent = value;
    select.classList.remove("is-invalid");

    options.forEach((item) => {
      item.setAttribute("aria-selected", String(item === option));
    });

    closeSelect();
    trigger.focus();
  }

  trigger.addEventListener("click", () => {
    if (select.classList.contains("is-open")) {
      closeSelect();
    } else {
      openSelect();
    }
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSelect();
      options[0].focus();
    }
  });

  options.forEach((option, index) => {
    option.setAttribute("aria-selected", "false");

    option.addEventListener("click", () => setValue(option));

    option.addEventListener("keydown", (event) => {
      const nextIndex = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : index;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setValue(option);
      }

      if (event.key === "Escape") {
        closeSelect();
        trigger.focus();
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        options[Math.max(0, Math.min(options.length - 1, nextIndex))].focus();
      }
    });
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-select]")) {
    closeCustomSelects();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCustomSelects();
  }
});

const accessForm = document.querySelector("#accessForm");
const formNote = document.querySelector("#formNote");

if (accessForm && formNote) {
  accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const roleInput = accessForm.querySelector("[data-select-input]");
    const roleSelect = roleInput?.closest("[data-select]");

    if (roleInput && !roleInput.value) {
      roleSelect?.classList.add("is-invalid");
      formNote.textContent = "Choose a use case before requesting access.";
      formNote.classList.remove("is-success", "is-error");
      return;
    }

    const formData = new FormData(accessForm);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const role = String(formData.get("role") || "").trim();

    // Save the signup to the Supabase "waitlist" table when the backend is configured.
    const sb = window.nulqorSupabase;
    if (sb) {
      const submitButton = accessForm.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = true;
      formNote.classList.remove("is-success", "is-error");
      formNote.textContent = "Sending your request…";

      const { data: sessionData } = await sb.auth.getSession();
      const { error } = await sb.from("waitlist").insert({
        name: name || null,
        email,
        role: role || null,
        user_id: sessionData?.session?.user?.id ?? null,
      });

      if (submitButton) submitButton.disabled = false;

      if (error) {
        // 23505 = unique violation -> this email is already on the waitlist.
        const alreadyJoined = error.code === "23505" || /duplicate key/i.test(error.message || "");
        if (alreadyJoined) {
          formNote.textContent = "This email is already on the Nulqor early access list.";
          formNote.classList.remove("is-error");
          formNote.classList.add("is-success");
          accessForm.reset();
          accessForm.querySelectorAll("[data-select]").forEach((select) => {
            select.querySelector("[data-select-input]").value = "";
            select.querySelector("[data-select-value]").textContent = "Select one";
            select.querySelectorAll("[role='option']").forEach((option) => {
              option.setAttribute("aria-selected", "false");
            });
          });
          return;
        }
        formNote.textContent = "Something went wrong — please try again.";
        formNote.classList.remove("is-success");
        formNote.classList.add("is-error");
        return;
      }
    }

    formNote.textContent = name
      ? `${name}, you are on the Nulqor early access list. Plan details and founder pricing are coming to your email.`
      : "You are on the Nulqor early access list. Plan details and founder pricing are coming to your email.";
    formNote.classList.remove("is-error");
    formNote.classList.add("is-success");
    accessForm.reset();
    accessForm.querySelectorAll("[data-select]").forEach((select) => {
      select.querySelector("[data-select-input]").value = "";
      select.querySelector("[data-select-value]").textContent = "Select one";
      select.querySelectorAll("[role='option']").forEach((option) => {
        option.setAttribute("aria-selected", "false");
      });
    });
  });
}
