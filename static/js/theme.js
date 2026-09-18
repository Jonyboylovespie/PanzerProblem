(() => {
  const storageKey = "panzer-theme";
  let savedTheme;
  try {
    savedTheme = localStorage.getItem(storageKey);
  } catch (_) {
    // The switch still works when browser storage is unavailable.
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    const dark = document.documentElement.dataset.theme === "dark";
    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.setAttribute("aria-checked", String(dark));
      toggle.firstElementChild.textContent = `Dark mode: ${dark ? "on" : "off"}`;
    }
    window.dispatchEvent(new Event("themechange"));
  }

  // Apply before the page paints, including a saved light-mode preference.
  applyTheme(savedTheme);
  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(document.documentElement.dataset.theme);
    document.getElementById("theme-toggle")?.addEventListener("click", () => {
      const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(theme);
      try {
        localStorage.setItem(storageKey, theme);
      } catch (_) {}
    });
  });
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) applyTheme(event.newValue);
  });
})();
