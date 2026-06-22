(function () {
  const looks = {
    "copper-flow": ["#060403", "#24110A", "#C46A3A", "#FFC49A", "#20100a"],
    "emerald-enterprise": ["#000604", "#01120C", "#39D985", "#8DFFC2", "#061b11"],
    "red-flagship-car": ["#070003", "#25000D", "#FF2D6A", "#FF9AB8", "#260611"],
    "royal-blue-crystal": ["#020714", "#061D5A", "#1F7BFF", "#A8D4FF", "#06132c"],
    "champagne-black": ["#050403", "#1B140C", "#D9B06A", "#FFE7B0", "#21170a"],
    "molten-gold-ambition": ["#050400", "#241400", "#E7A51A", "#FFE08A", "#211600"],
    "violet-rose-editorial": ["#08030E", "#281044", "#A855F7", "#FFC0D9", "#1f0b2c"],
    "ice-blue-chrome": ["#03070B", "#111C28", "#BFDFFF", "#6AB8FF", "#071320"],
    "molten-gold-ambition-alt": ["#050400", "#241400", "#E7A51A", "#FFE08A", "#211600"]
  };
  const aliases = {
    copper: "copper-flow",
    green: "emerald-enterprise",
    emerald: "emerald-enterprise",
    rose: "violet-rose-editorial",
    pink: "violet-rose-editorial",
    red: "red-flagship-car",
    blue: "royal-blue-crystal",
    gold: "molten-gold-ambition",
    champagne: "champagne-black",
    ice: "ice-blue-chrome",
    "violet-rose": "violet-rose-editorial"
  };

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    const value = parseInt(clean, 16);
    return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
  }

  function savedTheme() {
    try {
      return localStorage.getItem("nulqor-theme");
    } catch (_error) {
      return null;
    }
  }

  const params = new URLSearchParams(window.location.search);
  const requested = params.get("theme");
  const selected = aliases[requested] || requested || aliases[savedTheme()] || savedTheme() || "copper-flow";
  const theme = looks[selected] ? selected : "copper-flow";
  const [shadow, core, accent, glow, buttonText] = looks[theme];
  const root = document.documentElement;

  root.dataset.themeBoot = theme;
  root.style.setProperty("--bg", shadow);
  root.style.setProperty("--bg-2", core);
  root.style.setProperty("--panel", `color-mix(in srgb, ${core} 58%, black)`);
  root.style.setProperty("--panel-strong", `color-mix(in srgb, ${core} 76%, black)`);
  root.style.setProperty("--panel-soft", `color-mix(in srgb, ${core} 46%, black)`);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-2", glow);
  root.style.setProperty("--accent-3", core);
  root.style.setProperty("--button-text", buttonText);
  root.style.setProperty("--accent-rgb", hexToRgb(accent));
  root.style.setProperty("--glow-rgb", hexToRgb(glow));
})();
