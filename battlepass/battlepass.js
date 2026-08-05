(() => {
  const supportedLanguages = new Set(["ko", "en", "jp"]);

  function getStoredLanguage() {
    try { return localStorage.getItem("lang"); } catch (_error) { return null; }
  }

  function storeLanguage(language) {
    try { localStorage.setItem("lang", language); } catch (_error) { /* Storage is optional. */ }
  }

  function setLanguage(language, syncUrl = true) {
    const lang = supportedLanguages.has(language) ? language : "ko";
    const strings = window.BATTLEPASS_LANG?.[lang] || window.BATTLEPASS_LANG?.ko || {};
    document.documentElement.lang = lang === "jp" ? "ja" : lang;
    document.querySelectorAll("[data-lang]").forEach(element => {
      const value = strings[element.dataset.lang];
      if (value != null) element.textContent = value;
    });
    document.querySelectorAll("[data-language]").forEach(button => {
      const active = button.dataset.language === lang;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const backLink = document.getElementById("motdBackLink");
    if (backLink) backLink.href = `../?lang=${encodeURIComponent(lang)}#faq`;
    document.title = strings.bp_title || "RSS Battle Pass";
    storeLanguage(lang);
    if (syncUrl) {
      const url = new URL(location.href);
      url.searchParams.set("lang", lang);
      history.replaceState(null, "", url);
    }
  }

  document.querySelectorAll("[data-language]").forEach(button => {
    button.addEventListener("click", () => setLanguage(button.dataset.language));
  });

  const requestedLanguage = new URL(location.href).searchParams.get("lang");
  setLanguage(supportedLanguages.has(requestedLanguage) ? requestedLanguage : getStoredLanguage(), true);
})();