
import { getChoseong } from "../../vendor/es-hangul.mjs";
import {
  commandPageDeepLink,
  resolveFilterDeepLink,
  skinCategoryDeepLink,
  skinWeaponDeepLink
} from "./deep-link-state.mjs";
import {
  addRecentView,
  normalizeRecentViews,
  removeRecentView
} from "./recent-views.mjs";

// 1. 탭 전환 및 URL 해시 지원
const DEFAULT_LANG = "ko";
const SUPPORTED_LANGS = new Set(["ko", "en", "jp"]);
let commandGuideData = null;
let faqData = null;
let rulesData = null;
let termGuideData = null;
let newsData = null;
let skinData = null;
let supportData = null;
let supportCommandDialogTrigger = null;
let skinSearchQuery = "";
let skinCategoryFilter = "human";
let skinWeaponFilter = "primary";
let skinPrimaryTypeFilter = "all";
let skinImageObserver = null;
let skinCardsRendered = false;
let skinRenderTimer = null;
let skinCardCacheLanguage = "";
const skinCardCache = new Map();
let globalSearchQuery = "";
let commandPageFilter = "all";
let favoriteCommandsOnly = false;
let toastTimer = null;
const NEWS_WIDTH_STORAGE_KEY = "newsPanelWidth";
const RECENT_VIEWS_STORAGE_KEY = "recentViews";
const THEME_STORAGE_KEY = "themePreference";
const THEME_PREFERENCES = new Set(["default", "dark", "light"]);
const NEWS_DEFAULT_WIDTH = 1160;
const NEWS_MIN_WIDTH = 760;
const NEWS_MAX_WIDTH = 1600;
const PRIMARY_SKIN_TYPE_ORDER = ["smg", "rifle", "shotgun", "machinegun", "sniper", "other"];
const favoriteCommands = new Set(readStoredArray("favoriteCommands"));
let newsMarkdownRenderer = null;
const FAQ_FALLBACK = {
  version: 1,
  updatedAt: "",
  items: [
    {
      id: "store_bind",
      question: "How to use /store?",
      body: [
        { type: "text", text: "In CS2, open the console and type " },
        { type: "inlineCode", value: "exec menu_bind" },
        { type: "text", text: ", then press Enter." },
        { type: "break" },
        { type: "text", text: "Alternatively, copy and paste the following commands in the console." },
        { type: "break" },
        { type: "text", text: "Click 'Copy' on the top right, then paste (Ctrl+V) the commands into the console." },
        {
          type: "code",
          id: "bindCommands",
          copy: true,
          value: "bind 1 \"slot1; menuselect 1\";\nbind 2 \"slot2; menuselect 2\";\nbind 3 \"slot3; menuselect 3\";\nbind 4 \"slot4; menuselect 4\";\nbind 5 \"slot5; menuselect 5\";\nbind 6 \"slot6; menuselect 6\";\nbind 7 \"slot7; menuselect 7\";\nbind 8 \"slot8; menuselect 8\";\nbind 9 \"slot9; menuselect 9\";"
        }
      ]
    },
    {
      id: "low_fps",
      question: "My FPS is very low",
      body: [
        { type: "text", text: "Disable gun sounds or use hide to improve performance." },
        { type: "break" },
        { type: "inlineCode", value: "/stopsound" },
        { type: "text", text: " / " },
        { type: "inlineCode", value: "/hide 300" },
        { type: "text", text: " and try again." }
      ]
    },
    {
      id: "loud_sound",
      question: "Too loud sound",
      body: [
        { type: "text", text: "Music volume is too loud: " },
        { type: "inlineCode", value: "snd_musicvolume (0~2)" },
        { type: "text", text: "." },
        { type: "break" },
        { type: "text", text: "Other players' gun sounds are too loud: " },
        { type: "inlineCode", value: "/stopsound" },
        { type: "text", text: "." }
      ]
    },
    {
      id: "report_unban",
      question: "How can I report or unban?",
      body: [
        { type: "link", href: "https://discord.com/channels/850664390779731978/1321861335520120882/1384827886946484245", text: "Discord link" },
        { type: "text", text: " and please submit your request." }
      ]
    },
    {
      id: "server_rules",
      question: "Where can I check server rules?",
      body: [
        { type: "link", href: "https://discord.com/channels/850664390779731978/1321861335520120882/1384827886946484245", text: "Discord link" },
        { type: "text", text: " and check them there." }
      ]
    },
    {
      id: "console_howto",
      question: "How do I open the console?",
      body: [
        { type: "text", text: "Press (~, `) in game." },
        { type: "spacer" },
        { type: "text", text: "If it still doesn't open, go to Settings -> Game -> Enable Developer Console and turn it on." }
      ]
    }
  ]
};
const scriptBase = new URL("./", import.meta.url);
const siteBase = new URL("./", document.baseURI);

function readStorage(key, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_error) {
    // The site still works when storage is disabled or full.
  }
}

function readStoredArray(key) {
  try {
    const value = JSON.parse(readStorage(key, "[]"));
    return Array.isArray(value) ? value : [];
  } catch (_error) {
    return [];
  }
}

const systemThemeQuery = window.matchMedia("(prefers-color-scheme: light)");

function normalizeThemePreference(preference) {
  return THEME_PREFERENCES.has(preference) ? preference : "default";
}

function resolveTheme(preference) {
  return preference === "default" ? (systemThemeQuery.matches ? "light" : "dark") : preference;
}

function applyTheme(preference, persist = true) {
  const normalized = normalizeThemePreference(preference);
  const resolved = resolveTheme(normalized);
  document.documentElement.dataset.themePreference = normalized;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f7f9fc" : "#0b111c");
  document.querySelectorAll("[data-theme-choice]").forEach(button => {
    const isActive = button.dataset.themeChoice === normalized;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  if (persist) writeStorage(THEME_STORAGE_KEY, normalized);
}

document.querySelectorAll("[data-theme-choice]").forEach(button => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
});

systemThemeQuery.addEventListener?.("change", () => {
  if (normalizeThemePreference(readStorage(THEME_STORAGE_KEY, "default")) === "default") {
    applyTheme("default", false);
  }
});

applyTheme(readStorage(THEME_STORAGE_KEY, "default"), false);

function assetUrl(filename) {
  return new URL(filename, siteBase).toString();
}
function getJsonCandidateUrls(filename) {
  const candidates = new Set();
  const pageUrl = new URL(location.href);
  const pageDir = new URL("./", pageUrl);
  const scriptDir = new URL("./", scriptBase);

  const push = (base) => {
    if (!base) return;
    try {
      candidates.add(new URL(filename, base).toString());
    } catch (_err) {
      // ignore invalid urls
    }
  };

  push(pageUrl);
  push(pageDir);
  push(scriptBase);
  push(scriptDir);
  push(new URL(`./test/${filename}`, pageDir));
  push(new URL(`../test/${filename}`, pageDir));

  return [...candidates];
}

async function fetchJsonWithFallback(filename) {
  const urls = getJsonCandidateUrls(filename);
  const errors = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        errors.push(`${url} -> ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      errors.push(`${url} -> ${err.message || err}`);
    }
  }

  throw new Error(errors.join(" | "));
}

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
const newsResizeHandle = document.getElementById("newsResizeHandle");
let newsPanelWidth = Number(readStorage(NEWS_WIDTH_STORAGE_KEY)) || NEWS_DEFAULT_WIDTH;

function getNewsResizeBounds() {
  const available = Math.max(0, window.innerWidth - 36);
  const max = Math.min(NEWS_MAX_WIDTH, available);
  return { min: Math.min(NEWS_MIN_WIDTH, max), max };
}

function updateNewsResizeHandle(lang = getCurrentLang()) {
  if (!newsResizeHandle) return;
  const { min, max } = getNewsResizeBounds();
  const effectiveWidth = Math.min(max, Math.max(min, newsPanelWidth));
  const label = window.LANG?.[lang]?.news_resize || "Resize news width";
  newsResizeHandle.setAttribute("aria-label", label);
  newsResizeHandle.title = label;
  newsResizeHandle.setAttribute("aria-valuemin", String(Math.round(min)));
  newsResizeHandle.setAttribute("aria-valuemax", String(Math.round(max)));
  newsResizeHandle.setAttribute("aria-valuenow", String(Math.round(effectiveWidth)));
}

function setNewsPanelWidth(value, persist = false, clampToViewport = false) {
  if (!Number.isFinite(value)) return;
  const bounds = clampToViewport ? getNewsResizeBounds() : { min: NEWS_MIN_WIDTH, max: NEWS_MAX_WIDTH };
  newsPanelWidth = Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
  document.documentElement.style.setProperty("--news-panel-width", `${newsPanelWidth}px`);
  updateNewsResizeHandle();
  if (persist) writeStorage(NEWS_WIDTH_STORAGE_KEY, String(newsPanelWidth));
}

function initNewsResize() {
  if (!newsResizeHandle) return;
  setNewsPanelWidth(newsPanelWidth);
  let dragging = false;
  let startX = 0;
  let startWidth = NEWS_DEFAULT_WIDTH;

  newsResizeHandle.addEventListener("mousedown", event => {
    if (!window.matchMedia("(min-width: 701px)").matches) return;
    dragging = true;
    startX = event.clientX;
    startWidth = document.querySelector(".wrap")?.getBoundingClientRect().width || newsPanelWidth;
    document.body.classList.add("news-resizing");
    event.preventDefault();
  });

  window.addEventListener("mousemove", event => {
    if (!dragging) return;
    setNewsPanelWidth(startWidth + event.clientX - startX, false, true);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("news-resizing");
    writeStorage(NEWS_WIDTH_STORAGE_KEY, String(newsPanelWidth));
  });

  newsResizeHandle.addEventListener("keydown", event => {
    const { min, max } = getNewsResizeBounds();
    const next = event.key === "ArrowLeft" ? newsPanelWidth - 40
      : event.key === "ArrowRight" ? newsPanelWidth + 40
      : event.key === "Home" ? min
      : event.key === "End" ? max
      : null;
    if (next == null) return;
    event.preventDefault();
    setNewsPanelWidth(next, true, true);
  });

  newsResizeHandle.addEventListener("dblclick", () => setNewsPanelWidth(NEWS_DEFAULT_WIDTH, true, true));
  window.addEventListener("resize", () => updateNewsResizeHandle());
}

initNewsResize();

function openTab(name, pushHash = true) {
  document.body.dataset.activeTab = name;
  tabs.forEach(t => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
    t.tabIndex = active ? 0 : -1;
  });
  panels.forEach(p => {
    const active = p.id === name;
    p.classList.toggle("active", active);
    p.hidden = !active;
  });
  if (pushHash && location.hash !== `#${name}`) {
    const url = new URL(location.href);
    url.hash = name;
    history.pushState(null, "", url);
  }
  if (name === "skins" && skinData && !skinCardsRendered) renderSkins();
}

function pushLocationHash(hash) {
  if (!hash || location.hash === "#" + hash) return;
  const url = new URL(location.href);
  url.hash = hash;
  history.pushState(null, "", url);
}

function slugify(value) {
  return String(value || "item").normalize("NFKC").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "item";
}

function deepLinkId(type, value) {
  return `${type}-${slugify(value)}`;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (_error) {
    // Use the selection fallback below when clipboard permission is unavailable.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

function makeShareButton(targetId, itemLabel, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `share-button ${extraClass}`.trim();
  button.textContent = "#";
  const label = window.LANG?.[getCurrentLang()]?.share_link || "Copy link";
  button.title = label;
  button.setAttribute("aria-label", `${itemLabel} ${label}`.trim());
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const url = new URL(location.href);
    url.searchParams.set("lang", getCurrentLang());
    url.hash = targetId;
    copyText(url.toString()).then(() => {
      showToast(window.LANG?.[getCurrentLang()]?.share_done || "Link copied");
    }).catch(() => window.prompt("Copy link", url.toString()));
  });
  return button;
}

function applyDeepLink() {
  const hash = decodeURIComponent((location.hash || "").slice(1));
  if (!hash || validTabs.includes(hash)) return;
  const tab = hash.startsWith("faq-") ? "faq"
    : hash.startsWith("rule-") ? "rules"
    : hash.startsWith("command-") ? "cmds"
    : hash.startsWith("term-") ? "guide"
    : hash.startsWith("news-") ? "news"
    : hash.startsWith("skin-") ? "skins"
    : hash.startsWith("support-benefit") ? "support"
    : null;
  if (!tab) return;
  openTab(tab, false);
  if (tab === "cmds" && (commandPageFilter !== "all" || favoriteCommandsOnly)) {
    commandPageFilter = "all";
    favoriteCommandsOnly = false;
    const favoritesOnly = document.getElementById("favoriteCommandsOnly");
    if (favoritesOnly) favoritesOnly.checked = false;
    if (commandGuideData) {
      renderCommandGuide();
      return;
    }
  }
  if (tab === "skins") {
    let needsRender = false;
    if (skinSearchQuery) {
      skinSearchQuery = "";
      const search = document.getElementById("skinSearch");
      if (search) search.value = "";
      needsRender = true;
    }
    const targetItem = (skinData?.items || []).find(item => deepLinkId("skin", item.id || item.name) === hash);
    if (targetItem) {
      if (skinCategoryFilter !== targetItem.category) needsRender = true;
      skinCategoryFilter = targetItem.category || "human";
      if (targetItem.subcategory && skinWeaponFilter !== targetItem.subcategory) needsRender = true;
      if (targetItem.subcategory) skinWeaponFilter = targetItem.subcategory;
      if (targetItem.subcategory === "primary" && targetItem.weaponType) {
        if (skinPrimaryTypeFilter !== targetItem.weaponType) needsRender = true;
        skinPrimaryTypeFilter = targetItem.weaponType;
      }
    }
    if (skinData && (needsRender || !document.getElementById(hash))) {
      renderSkins();
      return;
    }
  }
  requestAnimationFrame(() => {
    const target = document.getElementById(hash);
    if (!target) return;
    recordRecentTargetElement(target);
    if (target.tagName === "DETAILS") target.open = true;
    document.querySelectorAll(".deep-link-target").forEach(el => el.classList.remove("deep-link-target"));
    target.classList.add("deep-link-target");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    setTimeout(() => target.classList.remove("deep-link-target"), 2200);
  });
}

function applyFilterDeepLink(state) {
  openTab(state.tab, false);

  if (state.tab === "cmds") {
    commandPageFilter = state.commandPage || "all";
    favoriteCommandsOnly = false;
    const favoritesOnly = document.getElementById("favoriteCommandsOnly");
    if (favoritesOnly) favoritesOnly.checked = false;
    if (commandGuideData) renderCommandGuide();
    return;
  }

  skinCategoryFilter = state.skinCategory || "human";
  skinSearchQuery = "";
  if (skinCategoryFilter === "weapon") {
    skinWeaponFilter = state.skinWeapon || "primary";
    skinPrimaryTypeFilter = "all";
  }
  const search = document.getElementById("skinSearch");
  if (search) search.value = "";
  if (skinData) renderSkins();
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => openTab(tab.dataset.tab));
  tab.addEventListener("keydown", event => {
    const current = [...tabs].indexOf(tab);
    const next = event.key === "ArrowRight" ? (current + 1) % tabs.length
      : event.key === "ArrowLeft" ? (current - 1 + tabs.length) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    openTab(tabs[next].dataset.tab);
    tabs[next].focus();
  });
});

const validTabs = [...tabs].map(tab => tab.dataset.tab);

function applyLocationState() {
  const hash = (location.hash || "").replace("#", "");
  const filterState = resolveFilterDeepLink(hash);
  if (filterState) applyFilterDeepLink(filterState);
  else if (validTabs.includes(hash)) openTab(hash, false);
  else if (/^(?:(?:faq|rule|command|term|news|skin)-|support-benefit)/.test(decodeURIComponent(hash))) applyDeepLink();
  else openTab("faq", false); // 기본은 FAQ
}
window.addEventListener("load", applyLocationState);
window.addEventListener("hashchange", applyLocationState);
window.addEventListener("popstate", applyLocationState);


// 2. GitHub 최신 커밋 날짜 반영 (현재 : 비활성화)
/*
async function setLastUpdateFromGitHub() {
  const owner = "sj58320";
  const repo  = "test";

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`);
    if (!res.ok) throw new Error(res.status);

    const data = await res.json();
    const iso = data[0]?.commit?.committer?.date;
    if (!iso) throw new Error("no date");

    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");

    document.getElementById("lastUpdate").textContent = `${yyyy}-${mm}-${dd}`;
  } catch (e) {
    console.warn("lastUpdate failed:", e);
  }
}
window.addEventListener("load", setLastUpdateFromGitHub);
*/


// 3. 다국어 스크립트
function getCurrentLang() {
  const lang = document.documentElement.lang || DEFAULT_LANG;
  return lang === "ja" ? "jp" : lang;
}

function localizeText(value, lang = getCurrentLang()) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[lang] || value[DEFAULT_LANG] || value.en || "";
}

function renderCommandGuide() {
  const guide = document.getElementById("commandGuide");
  if (!guide || !commandGuideData) return;
  renderCommandFilters();
  const rendered = commandGuideData.pages
    .filter(page => commandPageFilter === "all" || page.id === commandPageFilter)
    .map(createCommandPage)
    .filter(Boolean);
  const count = rendered.reduce((total, page) => total + Number(page.dataset.commandCount || 0), 0);
  const countLabel = document.getElementById("commandResultCount");
  if (countLabel) countLabel.textContent = (window.LANG?.[getCurrentLang()]?.command_result_count || "{count} commands").replace("{count}", count);
  if (!rendered.length) {
    const empty = document.createElement("p");
    empty.className = "term-empty";
    empty.textContent = window.LANG?.[getCurrentLang()]?.command_empty || "No matching commands.";
    guide.replaceChildren(empty);
    return;
  }
  guide.replaceChildren(...rendered);
  applyDeepLink();
}

function renderCommandFilters() {
  const container = document.getElementById("commandFilters");
  if (!container || !commandGuideData) return;
  const filters = [{ id: "all", title: window.LANG?.[getCurrentLang()]?.command_filter_all || "All" },
    ...commandGuideData.pages.map(page => ({ id: page.id, title: localizeText(page.title) }))];
  container.replaceChildren(...filters.map(filter => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `command-filter${commandPageFilter === filter.id ? " active" : ""}`;
    button.textContent = filter.title;
    button.setAttribute("aria-pressed", commandPageFilter === filter.id ? "true" : "false");
    button.addEventListener("click", () => {
      commandPageFilter = filter.id;
      pushLocationHash(commandPageDeepLink(filter.id));
      renderCommandGuide();
    });
    return button;
  }));
}

function setLanguage(lang, syncUrl = true) {
  if (!SUPPORTED_LANGS.has(lang)) lang = DEFAULT_LANG;
  // 텍스트 교체
  document.querySelectorAll("[data-lang]").forEach(el => {
    const key = el.dataset.lang;
    const value = window.LANG?.[lang]?.[key];
    
    if (value != null) el.textContent = value;
  });

  document.querySelectorAll("[data-lang-placeholder]").forEach(el => {
    const key = el.dataset.langPlaceholder;
    const value = window.LANG?.[lang]?.[key];
    if (value != null) el.placeholder = value;
  });

  document.querySelectorAll("[data-lang-aria]").forEach(el => {
    const key = el.dataset.langAria;
    const value = window.LANG?.[lang]?.[key];
    if (value != null) {
      el.setAttribute("aria-label", value);
      el.title = value;
    }
  });

  // 버튼 상태 클래스 토글 (함수 내부로 격리)
  document.querySelectorAll(".langbtn").forEach(b => {
    const isActive = b.dataset.lang === lang;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  updateNewsResizeHandle(lang);

  // 선택한 언어 저장 및 HTML 문서속서를 반영
  writeStorage("lang", lang);
  document.documentElement.lang = lang === "jp" ? "ja" : lang;
  const strings = window.LANG?.[lang] || {};
  document.title = strings.document_title || strings.site_title || document.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", strings.meta_description || "");
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", strings.document_title || strings.site_title || "");
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", strings.meta_description || "");
  document.querySelector('meta[property="og:locale"]')?.setAttribute(
    "content",
    lang === "ko" ? "ko_KR" : lang === "jp" ? "ja_JP" : "en_US"
  );
  if (syncUrl) {
    const url = new URL(location.href);
    url.searchParams.set("lang", lang);
    history.replaceState(null, "", url);
  }
  renderCommandGuide();
  renderFaq();
  renderRules();
  renderTermGuide();
  renderNews();
  renderSupport();
  if (document.body.dataset.activeTab === "skins") renderSkins();
  else skinCardsRendered = false;
  renderGlobalSearch();
  renderRecentViews();
}

function faqAnswerText(item) {
  return (item.body || []).map(block => {
    if (block.type === "text" || block.type === "link") return localizeContent(block.text);
    if (block.type === "inlineCode" || block.type === "code") return block.value || "";
    return "";
  }).join(" ").trim();
}

function faqSearchText(item) {
  return [localizeContent(item.question), faqAnswerText(item)].join(" ");
}

function normalizeSearchText(value) {
  const locale = getCurrentLang() === "jp" ? "ja" : getCurrentLang();
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase(locale);
}

function normalizeCommandSearchText(value) {
  return normalizeSearchText(value).replace(/^[!/]/, "");
}

function normalizeCommandPrefixes(value) {
  return normalizeSearchText(value).replace(/(^|\s)[!/](?=\S)/g, "$1/");
}

function matchesSearch(text, query) {
  const normalized = normalizeCommandPrefixes(text);
  const normalizedQuery = normalizeCommandPrefixes(query);
  if (normalized.includes(normalizedQuery)) return true;
  const compact = normalizedQuery.replace(/\s+/g, "");
  return compact.length > 0 && /^[ㄱ-ㅎ]+$/.test(compact)
    && getChoseong(normalized).replace(/\s+/g, "").includes(compact);
}

function getSearchScore({ primary, aliases = [], details = [], query, command = false }) {
  const normalizePrimary = command ? normalizeCommandSearchText : normalizeSearchText;
  const normalizedQuery = normalizePrimary(query);
  const normalizedPrimary = normalizePrimary(primary);
  if (!normalizedQuery) return null;
  if (normalizedPrimary === normalizedQuery) return 0;
  if (normalizedPrimary.startsWith(normalizedQuery)) return 1;
  if (aliases.some(alias => matchesSearch(alias, query))) return 2;
  if (matchesSearch(primary, command ? normalizedQuery : query)) return 3;
  if (details.some(detail => matchesSearch(detail, query))) return 4;
  return null;
}

function makeGlobalSearchItem(type, title, snippet, tab, onOpen) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "global-search-item";
  button.dataset.searchType = type;

  const badge = document.createElement("span");
  badge.className = "global-search-type";
  badge.textContent = window.LANG?.[getCurrentLang()]?.[`search_type_${type}`] || type;

  const heading = document.createElement("span");
  heading.className = "global-search-title";
  heading.textContent = title;

  const description = document.createElement("span");
  description.className = "global-search-snippet";
  description.textContent = snippet;

  button.setAttribute("aria-label", [badge.textContent, title, snippet].filter(Boolean).join(" ").slice(0, 240));
  button.append(badge, heading, description);
  button.addEventListener("click", () => {
    openTab(tab);
    onOpen?.();
  });
  return button;
}

function makeGlobalSearchGroup(type, total, items) {
  if (!items.length) return null;

  const section = document.createElement("section");
  section.className = "global-search-group";
  section.dataset.searchType = type;

  const header = document.createElement("div");
  header.className = "global-search-group-header";
  const heading = document.createElement("h3");
  heading.textContent = window.LANG?.[getCurrentLang()]?.[`search_type_${type}`] || type;
  const count = document.createElement("span");
  count.className = "global-search-group-count";
  count.textContent = String(total);
  header.append(heading, count);

  const itemList = document.createElement("div");
  itemList.className = "global-search-group-list";
  itemList.append(...items);
  section.append(header, itemList);
  return section;
}

function setContentUpdatedAt(elementId, data) {
  const element = document.getElementById(elementId);
  if (element) element.textContent = formatContentDate(data?.updatedAt) || "-";
}

function navigateToDeepLink(targetId) {
  location.hash = targetId;
  applyDeepLink();
}

function renderGlobalSearch() {
  const results = document.getElementById("globalSearchResults");
  if (!results) return;
  const query = normalizeSearchText(globalSearchQuery);

  if (!query) {
    const hint = document.createElement("p");
    hint.className = "global-search-summary";
    hint.textContent = window.LANG?.[getCurrentLang()]?.global_search_hint || "Search across every guide.";
    results.replaceChildren(hint);
    return;
  }

  const faqMatches = (faqData?.items || []).map(item => ({
    item,
    score: getSearchScore({
      primary: localizeContent(item.question),
      details: [faqSearchText(item)],
      query
    })
  })).filter(result => result.score != null).sort((a, b) => a.score - b.score);
  const rulesLocale = getRulesLocale();
  const ruleMatches = (rulesLocale?.sections || []).flatMap(section =>
    (section.items || []).map(item => ({
      item,
      section,
      score: getSearchScore({
        primary: item.title,
        details: [item.description, section.title, section.note],
        query
      })
    }))
  ).filter(result => result.score != null).sort((a, b) => a.score - b.score);
  const commandMatches = (commandGuideData?.pages || []).flatMap(page =>
    (page.sections || []).flatMap(section => (section.commands || []).map(item => {
      const aliases = [...(item.aliases || []), ...(item.keywords || [])].map(value => localizeText(value));
      return {
        item,
        page,
        section,
        score: getSearchScore({
          primary: item.command,
          aliases,
          details: [
            localizeText(item.description),
            localizeText(item.note),
            localizeText(page.title),
            localizeText(section.title)
          ],
          query,
          command: true
        })
      };
    }))
  ).filter(result => result.score != null).sort((a, b) => a.score - b.score);
  const locale = termGuideData?.locales?.[getCurrentLang()];
  const termMatches = (locale?.sections || []).flatMap(section =>
    (section.terms || []).map(item => ({
      item,
      section,
      score: getSearchScore({
        primary: item.term,
        aliases: item.aliases || [],
        details: [item.description, section.title],
        query
      })
    }))
  ).filter(result => result.score != null).sort((a, b) => a.score - b.score);
  const newsMatches = (newsData?.items || []).map(item => ({
    item,
    score: getSearchScore({
      primary: item.title || "",
      details: [
        item.content,
        item.summary,
        item.author,
        item.channelName,
        ...(item.attachments || []).map(attachment => attachment.filename)
      ],
      query
    })
  })).filter(result => result.score != null).sort((a, b) => a.score - b.score);
  const skinMatches = (skinData?.items || []).map(item => ({
    item,
    score: getSearchScore({
      primary: getSkinDisplayName(item),
      aliases: [item.name, item.nameKo].filter(Boolean),
      details: [getSkinPathLabel(item)],
      query
    })
  })).filter(result => result.score != null).sort((a, b) => a.score - b.score);
  const summaryTemplate = window.LANG?.[getCurrentLang()]?.global_search_summary || "FAQ {faq} · Rules {rules} · Commands {commands} · Terms {terms} · News {news} · Skins {skins}";
  const summary = document.createElement("p");
  summary.className = "global-search-summary";
  summary.textContent = summaryTemplate
    .replace("{faq}", faqMatches.length)
    .replace("{rules}", ruleMatches.length)
    .replace("{commands}", commandMatches.length)
    .replace("{terms}", termMatches.length)
    .replace("{news}", newsMatches.length)
    .replace("{skins}", skinMatches.length);

  const list = document.createElement("div");
  list.className = "global-search-list";

  const groups = [
    makeGlobalSearchGroup("faq", faqMatches.length, faqMatches.slice(0, 6).map(({ item }) =>
      makeGlobalSearchItem(
        "faq", localizeContent(item.question), faqSearchText(item).slice(0, 140), "faq",
        () => navigateToDeepLink(deepLinkId("faq", item.id || localizeContent(item.question)))
      )
    )),
    makeGlobalSearchGroup("rule", ruleMatches.length, ruleMatches.slice(0, 10).map(({ item, section }) =>
      makeGlobalSearchItem(
        "rule",
        item.title,
        [section.title, item.description].filter(Boolean).join(" · "),
        "rules",
        () => navigateToDeepLink(deepLinkId("rule", item.id))
      )
    )),
    makeGlobalSearchGroup("command", commandMatches.length, commandMatches.slice(0, 10).map(({ item, page, section }) =>
      makeGlobalSearchItem(
        "command",
        item.command,
        `${localizeText(page.title)} · ${localizeText(section.title)} · ${localizeText(item.description)}`,
        "cmds",
        () => navigateToDeepLink(deepLinkId("command", item.command))
      )
    )),
    makeGlobalSearchGroup("term", termMatches.length, termMatches.slice(0, 10).map(({ item, section }) =>
      makeGlobalSearchItem(
        "term", item.term, `${section.title} · ${item.description}`, "guide",
        () => navigateToDeepLink(deepLinkId("term", item.term))
      )
    )),
    makeGlobalSearchGroup("news", newsMatches.length, newsMatches.slice(0, 10).map(({ item }) =>
      makeGlobalSearchItem(
        "news",
        item.title || "Announcement",
        normalizeSearchText(item.content || item.summary || item.author || "").slice(0, 180),
        "news",
        () => navigateToDeepLink(deepLinkId("news", item.id || item.title || item.publishedAt))
      )
    )),
    makeGlobalSearchGroup("skin", skinMatches.length, skinMatches.slice(0, 10).map(({ item }) =>
      makeGlobalSearchItem(
        "skin",
        getSkinDisplayName(item),
        getSkinPathLabel(item),
        "skins",
        () => navigateToDeepLink(deepLinkId("skin", item.id || item.name))
      )
    ))
  ].filter(Boolean);
  list.append(...groups);

  if (!list.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "term-empty";
    empty.textContent = window.LANG?.[getCurrentLang()]?.global_search_empty || "No matching results.";
    results.replaceChildren(summary, empty);
    return;
  }
  results.replaceChildren(summary, list);
}

document.getElementById("globalSearch")?.addEventListener("input", event => {
  globalSearchQuery = event.target.value || "";
  renderGlobalSearch();
});

document.addEventListener("keydown", event => {
  const target = event.target;
  const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  const search = document.getElementById("globalSearch");
  if (event.key === "/" && !isEditing && document.body.dataset.activeTab !== "skins") {
    event.preventDefault();
    search?.focus();
  } else if (event.key === "Escape" && document.activeElement === search && search?.value) {
    search.value = "";
    globalSearchQuery = "";
    renderGlobalSearch();
  }
});

// 언어 버튼 클릭 이벤트 바인딩
document.querySelectorAll(".langbtn").forEach(btn => {
  btn.addEventListener("click", () => {
    setLanguage(btn.dataset.lang);
  });
});

// 로드 시 기존에 저장된언어 자동적용
window.addEventListener("load", () => {
  const requested = new URL(location.href).searchParams.get("lang");
  const saved = readStorage("lang");
  const lang = SUPPORTED_LANGS.has(requested)
    ? requested
    : SUPPORTED_LANGS.has(saved) ? saved : DEFAULT_LANG;
  setLanguage(lang, !SUPPORTED_LANGS.has(requested));
});



// 4. FAQ from JSON
async function loadFaq() {
  const faqList = document.getElementById("faqList");
  if (!faqList) return;

  try {
    faqData = await fetchJsonWithFallback("data/faq.json");
    setContentUpdatedAt("faqLastUpdate", faqData);
    renderFaq();
    renderGlobalSearch();
  } catch (err) {
    console.error("FAQ load failed:", err);
    faqData = FAQ_FALLBACK;
    setContentUpdatedAt("faqLastUpdate", faqData);
    renderFaq();
    faqList.title = `data/faq.json load failed: ${err.message}`;
  }
}

function renderFaq() {
  const faqList = document.getElementById("faqList");
  if (!faqList || !faqData) return;

  faqList.replaceChildren(...faqData.items.map(createFaqItem));
  renderQuickStart();
  applyDeepLink();
}

function localizeContent(value, lang = getCurrentLang()) {
  if (value == null) return "";
  if (typeof value === "string") return value;

  const base = value.langKey
    ? (window.LANG?.[lang]?.[value.langKey] || window.LANG?.[DEFAULT_LANG]?.[value.langKey] || "")
    : localizeText(value, lang);

  return `${value.prefix || ""}${base}${value.suffix || ""}`;
}

function findCommandItem(commandId) {
  for (const page of commandGuideData?.pages || []) {
    for (const section of page.sections || []) {
      const item = (section.commands || []).find(command => command.command === commandId);
      if (item) return item;
    }
  }
  return null;
}

function resolveGuideReference(reference) {
  if (reference?.type === "faq") {
    const item = faqData?.items?.find(faq => faq.id === reference.id);
    if (!item) return null;
    return {
      type: "faq",
      typeLabel: window.LANG?.[getCurrentLang()]?.search_type_faq || "FAQ",
      title: localizeContent(item.question),
      snippet: faqAnswerText(item),
      targetId: deepLinkId("faq", item.id)
    };
  }
  if (reference?.type === "command") {
    const item = findCommandItem(reference.id);
    if (!item) return null;
    return {
      type: "command",
      typeLabel: window.LANG?.[getCurrentLang()]?.search_type_command || "Command",
      title: item.command,
      snippet: localizeText(item.description),
      targetId: deepLinkId("command", item.command)
    };
  }
  return null;
}

function createRelatedLinks(references, extraClass = "") {
  const items = (references || []).map(resolveGuideReference).filter(Boolean);
  if (!items.length) return null;

  const container = document.createElement("aside");
  container.className = `related-links ${extraClass}`.trim();
  const label = document.createElement("span");
  label.className = "related-label";
  label.textContent = window.LANG?.[getCurrentLang()]?.related_items || "Related";
  container.appendChild(label);
  items.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "related-link";
    button.textContent = item.title;
    button.title = `${item.typeLabel}: ${item.title}`;
    button.addEventListener("click", () => navigateToDeepLink(item.targetId));
    container.appendChild(button);
  });
  return container;
}

function renderQuickStart() {
  const container = document.getElementById("quickStart");
  if (!container || !faqData?.quickStart) return;
  if (faqData.quickStart.some(item => item.type === "command") && !commandGuideData) {
    container.replaceChildren();
    return;
  }
  const items = faqData.quickStart.map(resolveGuideReference).filter(Boolean);
  if (!items.length) {
    container.replaceChildren();
    return;
  }

  const heading = document.createElement("div");
  heading.className = "quick-start-heading";
  const title = document.createElement("h3");
  title.id = "quickStartTitle";
  title.textContent = window.LANG?.[getCurrentLang()]?.quick_start_title || "Quick start";
  const description = document.createElement("p");
  description.textContent = window.LANG?.[getCurrentLang()]?.quick_start_description || "Start with these essentials.";
  heading.append(title, description);

  const list = document.createElement("div");
  list.className = "quick-start-list";
  items.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-start-item";
    const badge = document.createElement("span");
    badge.className = "quick-start-badge";
    badge.textContent = item.typeLabel;
    const itemTitle = document.createElement("strong");
    itemTitle.textContent = item.title;
    const snippet = document.createElement("span");
    snippet.className = "quick-start-snippet";
    snippet.textContent = item.snippet;
    button.append(badge, itemTitle, snippet);
    button.addEventListener("click", () => navigateToDeepLink(item.targetId));
    list.appendChild(button);
  });
  container.replaceChildren(heading, list);
}

function createFaqItem(item) {
  const details = document.createElement("details");
  details.dataset.faqId = item.id || "";
  details.id = deepLinkId("faq", item.id || localizeContent(item.question));

  const summary = document.createElement("summary");

  const question = document.createElement("span");
  question.textContent = localizeContent(item.question);
  markRecentTarget(details, "faq", question.textContent);

  const chev = document.createElement("span");
  chev.className = "chev";
  chev.textContent = localizeText({ langKey: "toggle" });
  chev.textContent = window.LANG?.[getCurrentLang()]?.toggle || window.LANG?.[DEFAULT_LANG]?.toggle || "Open / Close";

  summary.append(question, chev);

  const answer = document.createElement("div");
  answer.className = "answer";
  answer.appendChild(makeShareButton(details.id, localizeContent(item.question), "faq-share"));
  (item.body || []).forEach(block => answer.appendChild(createFaqBlock(block)));
  const related = createRelatedLinks(item.related, "faq-related");
  if (related) answer.appendChild(related);

  details.append(summary, answer);
  return details;
}

function createFaqBlock(block) {
  switch (block.type) {
    case "text": {
      const span = document.createElement("span");
      span.textContent = localizeContent(block.text);
      return span;
    }
    case "inlineCode": {
      const code = document.createElement("code");
      code.textContent = block.value || "";
      return code;
    }
    case "code": {
      const container = document.createElement("div");
      container.className = "code-container";
      container.style.marginTop = "10px";

      if (block.copy) {
        const button = document.createElement("button");
        button.className = "copy-btn";
        button.type = "button";
        button.textContent = window.LANG?.[getCurrentLang()]?.command_copy || "Copy";
        button.setAttribute("aria-label", button.textContent);
        button.addEventListener("click", () => copyCode(button));
        container.appendChild(button);
      }

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (block.id) code.id = block.id;
      code.textContent = block.value || "";
      pre.appendChild(code);
      container.appendChild(pre);
      return container;
    }
    case "link": {
      const link = document.createElement("a");
      link.href = block.href || "#";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = localizeContent(block.text);
      return link;
    }
    case "image": {
      const wrapper = document.createElement("div");
      wrapper.className = "guide-step console-guide-image";
      if (block.className) {
        String(block.className).split(/\s+/).filter(Boolean)
          .forEach(className => wrapper.classList.add(className));
      }

      const img = document.createElement("img");
      img.src = block.src || "";
      img.alt = localizeContent(block.alt);
      img.loading = "lazy";
      img.decoding = "async";
      wrapper.appendChild(img);
      return wrapper;
    }
    case "spacer": {
      const span = document.createElement("span");
      span.append(document.createElement("br"), document.createElement("br"));
      return span;
    }
    case "break":
    default:
      return document.createElement("br");
  }
}

window.addEventListener("load", loadFaq);

// 5. Server rules from JSON
function getRulesLocale(lang = getCurrentLang()) {
  return rulesData?.locales?.[lang]
    || rulesData?.locales?.[DEFAULT_LANG]
    || rulesData?.locales?.en
    || null;
}

function createRuleSection(section) {
  const container = document.createElement("section");
  container.className = "rules-section";
  container.id = deepLinkId("rule-section", section.id);

  const heading = document.createElement("h3");
  heading.textContent = section.title;

  const list = document.createElement(section.numbered === false ? "ul" : "ol");
  list.className = "rules-list";
  if (section.numbered === false) list.classList.add("rules-examples");

  (section.items || []).forEach(item => {
    const entry = document.createElement("li");
    entry.className = "rule-item";
    entry.id = deepLinkId("rule", item.id);

    const header = document.createElement("div");
    header.className = "rule-item-header";
    const title = document.createElement("h4");
    title.textContent = item.title;
    markRecentTarget(entry, "rule", title.textContent);
    header.append(title, makeShareButton(entry.id, item.title, "rule-share"));
    entry.appendChild(header);

    if (item.description) {
      const description = document.createElement("p");
      description.textContent = item.description;
      entry.appendChild(description);
    }
    list.appendChild(entry);
  });

  container.append(heading, list);
  if (section.note) {
    const note = document.createElement("p");
    note.className = "rules-note";
    note.textContent = section.note;
    container.appendChild(note);
  }
  return container;
}

function renderRules() {
  const content = document.getElementById("rulesContent");
  if (!content || !rulesData) return;
  const locale = getRulesLocale();
  if (!locale) {
    const unavailable = document.createElement("p");
    unavailable.className = "rules-loading";
    unavailable.textContent = window.LANG?.[getCurrentLang()]?.rules_unavailable || "Unable to load the server rules.";
    content.replaceChildren(unavailable);
    return;
  }

  const pageTitle = document.getElementById("rulesPageTitle");
  if (pageTitle) pageTitle.textContent = locale.title;

  const warning = document.createElement("aside");
  warning.className = "rules-warning";
  warning.textContent = locale.warning;

  const sections = (locale.sections || []).map(createRuleSection);
  const other = document.createElement("section");
  other.className = "rules-section rules-other";
  const otherTitle = document.createElement("h3");
  otherTitle.textContent = locale.footer?.title || "";
  const otherBody = document.createElement("p");
  otherBody.textContent = locale.footer?.body || "";
  other.append(otherTitle, otherBody);

  content.replaceChildren(warning, ...sections, other);
  applyDeepLink();
}

async function loadRules() {
  const content = document.getElementById("rulesContent");
  if (!content) return;
  try {
    rulesData = await fetchJsonWithFallback("data/rules.json");
    setContentUpdatedAt("rulesLastUpdate", rulesData);
    renderRules();
    renderGlobalSearch();
  } catch (err) {
    console.error("server rules load failed:", err);
    const unavailable = document.createElement("p");
    unavailable.className = "rules-loading";
    unavailable.textContent = window.LANG?.[getCurrentLang()]?.rules_unavailable || "Unable to load the server rules.";
    content.replaceChildren(unavailable);
    content.title = `data/rules.json load failed: ${err.message}`;
  }
}

window.addEventListener("load", loadRules);

// 6. Command guide from JSON
async function loadCommandGuide() {
  const guide = document.getElementById("commandGuide");
  if (!guide) return;

  try {
    commandGuideData = await fetchJsonWithFallback("data/commands.json");
    setContentUpdatedAt("commandLastUpdate", commandGuideData);
    renderCommandGuide();
    if (faqData) renderFaq();
    if (supportData) renderSupport();
    renderGlobalSearch();
  } catch (err) {
    console.error("command guide load failed:", err);
    guide.textContent = "Failed to load data/commands.json";
    guide.title = `data/commands.json load failed: ${err.message}`;
  }
}

function createCommandPage(page) {
  const pageEl = document.createElement("article");
  pageEl.className = "command-page";

  const title = document.createElement("h3");
  title.className = "command-page-title";
  title.textContent = localizeText(page.title);
  pageEl.appendChild(title);

  let commandCount = 0;
  page.sections.forEach(section => {
    const commands = section.commands.filter(item => !favoriteCommandsOnly || favoriteCommands.has(item.command));
    if (!commands.length) return;
    const sectionEl = document.createElement("section");
    sectionEl.className = "command-section";

    const heading = document.createElement("h4");
    heading.textContent = localizeText(section.title);
    sectionEl.appendChild(heading);

    const list = document.createElement("div");
    list.className = "command-list";

    commands.forEach(item => {
      commandCount += 1;
      const row = document.createElement("div");
      row.className = "command-row";
      row.id = deepLinkId("command", item.command);

      const command = document.createElement("code");
      command.className = "cmd command-name";
      command.textContent = item.command;

      const desc = document.createElement("div");
      desc.className = "command-desc";
      desc.textContent = localizeText(item.description);
      markRecentTarget(row, "command", item.command);

      const actions = document.createElement("div");
      actions.className = "command-actions";
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = `command-action${favoriteCommands.has(item.command) ? " favorite" : ""}`;
      favorite.textContent = favoriteCommands.has(item.command) ? "★" : "☆";
      favorite.title = window.LANG?.[getCurrentLang()]?.[favoriteCommands.has(item.command) ? "command_favorite_remove" : "command_favorite_add"] || "Favorite";
      favorite.setAttribute("aria-label", favorite.title);
      favorite.addEventListener("click", () => toggleFavoriteCommand(item.command));
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "command-action";
      copy.textContent = window.LANG?.[getCurrentLang()]?.command_copy || "Copy";
      copy.setAttribute("aria-label", `${copy.textContent}: ${item.command}`);
      copy.addEventListener("click", () => copyCommand(item.command));
      actions.append(favorite, copy, makeShareButton(row.id, item.command));

      row.append(command, desc, actions);
      list.appendChild(row);

      if (item.note) {
        const note = document.createElement("div");
        note.className = "command-note";
        note.textContent = localizeText(item.note);
        list.appendChild(note);
      }
    });

    sectionEl.appendChild(list);
    pageEl.appendChild(sectionEl);
  });
  if (!commandCount) return null;
  pageEl.dataset.commandCount = commandCount;
  return pageEl;
}

function toggleFavoriteCommand(command) {
  if (favoriteCommands.has(command)) favoriteCommands.delete(command);
  else favoriteCommands.add(command);
  writeStorage("favoriteCommands", JSON.stringify([...favoriteCommands]));
  renderCommandGuide();
}

function commandCopyText(command) {
  const name = String(command || "").trim().split(/\s+/, 1)[0].replace(/^[!/]/, "/");
  return name ? `${name} ` : "";
}

function copyCommand(command) {
  const text = commandCopyText(command);
  copyText(text).then(() => {
    showToast(window.LANG?.[getCurrentLang()]?.copy_done || "Copied to clipboard.");
  }).catch(() => window.prompt("Copy command", text));
}

document.getElementById("favoriteCommandsOnly")?.addEventListener("change", event => {
  favoriteCommandsOnly = event.target.checked;
  renderCommandGuide();
});

window.addEventListener("load", loadCommandGuide);

// 5. Glossary from JSON
async function loadTermGuide() {
  const guide = document.getElementById("termGuide");
  if (!guide) return;

  try {
    termGuideData = await fetchJsonWithFallback("data/terms.json");
    setContentUpdatedAt("termLastUpdate", termGuideData);
    renderTermGuide();
    renderGlobalSearch();
  } catch (err) {
    console.error("term guide load failed:", err);
    guide.textContent = window.LANG?.[getCurrentLang()]?.term_unavailable || "Glossary unavailable";
    guide.title = `data/terms.json load failed: ${err.message}`;
  }
}

function renderTermGuide() {
  const guide = document.getElementById("termGuide");
  if (!guide || !termGuideData) return;

  const lang = getCurrentLang();
  const locale = termGuideData.locales?.[lang];

  if (!locale) {
    const message = document.createElement("p");
    message.className = "term-empty";
    message.textContent = window.LANG?.[lang]?.term_unavailable || "Glossary unavailable";
    guide.replaceChildren(message);
    return;
  }

  const sections = locale.sections || [];

  const fragment = document.createDocumentFragment();
  sections.forEach(section => fragment.appendChild(createTermSection(section)));

  if (locale.notice) {
    const notice = document.createElement("p");
    notice.className = "term-notice";
    notice.textContent = locale.notice;
    fragment.appendChild(notice);
  }

  guide.replaceChildren(fragment);
  applyDeepLink();
}

function createTermSection(section) {
  const sectionEl = document.createElement("article");
  sectionEl.className = "term-section";
  sectionEl.dataset.termSection = section.id || "";

  const heading = document.createElement("h3");
  heading.textContent = section.title || "";
  sectionEl.appendChild(heading);

  const tableWrap = document.createElement("div");
  tableWrap.className = "term-table-wrap overflow-auto";

  const table = document.createElement("table");
  table.className = "term-table striped";

  const body = document.createElement("tbody");

  section.terms.forEach(item => {
    const row = document.createElement("tr");
    row.className = "term-row";
    row.id = deepLinkId("term", item.term);

    const name = document.createElement("th");
    name.scope = "row";

    const heading = document.createElement("div");
    heading.className = "term-heading";

    const label = document.createElement("div");
    label.className = "term-label";

    const termName = document.createElement("span");
    termName.className = "term-name";
    termName.textContent = item.term || "";
    label.appendChild(termName);

    if (item.aliases?.length) {
      const aliasWrap = document.createElement("span");
      aliasWrap.className = "term-alias-wrap";

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "term-alias-trigger";
      trigger.textContent = `+${item.aliases.length}`;
      const aliasLabel = window.LANG?.[getCurrentLang()]?.term_alias_label || "{count} aliases for {term}";
      trigger.setAttribute("aria-label", aliasLabel.replace("{term}", item.term).replace("{count}", item.aliases.length));
      trigger.setAttribute("aria-expanded", "false");

      const popover = document.createElement("span");
      popover.id = `${row.id}-aliases`;
      popover.className = "term-alias-popover";
      popover.setAttribute("role", "tooltip");
      popover.textContent = item.aliases.join(" · ");
      trigger.setAttribute("aria-describedby", popover.id);

      const toggleAliasPopover = () => {
        const willOpen = !aliasWrap.classList.contains("open");
        closeAliasPopovers(aliasWrap);
        aliasWrap.classList.toggle("open", willOpen);
        trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      };

      trigger.addEventListener("click", event => {
        event.stopPropagation();
        toggleAliasPopover();
      });
      trigger.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          toggleAliasPopover();
        } else if (event.key === "Escape") {
          aliasWrap.classList.remove("open");
          trigger.setAttribute("aria-expanded", "false");
        }
      });

      aliasWrap.append(trigger, popover);
      label.appendChild(aliasWrap);
    }
    heading.append(label, makeShareButton(row.id, item.term));
    name.appendChild(heading);

    const description = document.createElement("td");
    description.textContent = item.description || "";
    markRecentTarget(row, "term", item.term);

    row.append(name, description);
    body.appendChild(row);
  });

  table.appendChild(body);
  tableWrap.appendChild(table);
  sectionEl.appendChild(tableWrap);
  return sectionEl;
}

function closeAliasPopovers(except = null) {
  document.querySelectorAll(".term-alias-wrap.open").forEach(aliasWrap => {
    if (aliasWrap === except) return;
    aliasWrap.classList.remove("open");
    aliasWrap.querySelector(".term-alias-trigger")?.setAttribute("aria-expanded", "false");
  });
}

document.addEventListener("click", event => {
  if (!event.target.closest(".term-alias-wrap")) closeAliasPopovers();
});

window.addEventListener("load", loadTermGuide);

// 7. Discord announcements from data/news.json
async function loadNews() {
  const list = document.getElementById("newsList");
  if (!list) return;

  try {
    newsData = await fetchJsonWithFallback("data/news.json");
    const updatedAt = document.getElementById("newsLastUpdate");
    if (updatedAt) updatedAt.textContent = formatContentDate(newsData.updatedAt) || "-";
    renderNews();
    renderGlobalSearch();
  } catch (err) {
    console.error("news load failed:", err);
    newsData = { updatedAt: "", items: [] };
    renderNews();
    renderGlobalSearch();
    list.title = `data/news.json load failed: ${err.message}`;
  }
}

function formatContentDate(value) {
  if (!value) return "";
  const locale = getCurrentLang() === "jp" ? "ja-JP" : getCurrentLang() === "en" ? "en-US" : "ko-KR";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const date = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function getNewsMarkdownRenderer() {
  if (newsMarkdownRenderer) return newsMarkdownRenderer;
  if (typeof window.markdownit !== "function") return null;

  const renderer = window.markdownit({
    html: false,
    breaks: true,
    linkify: true,
    typographer: false
  });
  renderer.disable("image");

  const defaultLinkOpen = renderer.renderer.rules.link_open
    || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, index, options, env, self);
  };

  newsMarkdownRenderer = renderer;
  return renderer;
}

function renderNewsMarkdown(container, value) {
  const renderer = getNewsMarkdownRenderer();
  if (!renderer) {
    container.textContent = String(value || "");
    return;
  }
  container.innerHTML = renderer.render(String(value || ""));
}

function renderNews() {
  const list = document.getElementById("newsList");
  if (!list || !newsData) return;
  setContentUpdatedAt("newsLastUpdate", newsData);

  const items = Array.isArray(newsData.items) ? newsData.items : [];
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "news-empty";
    empty.textContent = window.LANG?.[getCurrentLang()]?.news_empty || "No announcements yet.";
    list.replaceChildren(empty);
    return;
  }

  const cards = items.map(item => {
    const article = document.createElement("article");
    article.className = "news-item";
    article.id = deepLinkId("news", item.id || item.title || item.publishedAt);

    const header = document.createElement("div");
    header.className = "news-item-header";

    const heading = document.createElement("h3");
    heading.textContent = item.title || "Announcement";
    markRecentTarget(article, "news", heading.textContent);
    header.append(heading, makeShareButton(article.id, heading.textContent));

    const meta = document.createElement("div");
    meta.className = "news-meta";
    if (item.channelName) {
      const channel = document.createElement("span");
      channel.className = "news-channel";
      channel.textContent = `#${item.channelName}`;
      meta.appendChild(channel);
    }
    const published = document.createElement("time");
    published.dateTime = item.publishedAt || "";
    published.textContent = formatContentDate(item.publishedAt);
    meta.appendChild(published);
    if (item.author) {
      const author = document.createElement("span");
      author.textContent = item.author;
      meta.appendChild(author);
    }

    const content = document.createElement("div");
    content.className = "news-content";
    renderNewsMarkdown(content, item.content || item.summary || "");

    const attachments = document.createElement("div");
    attachments.className = "news-attachments";
    (item.attachments || []).forEach(attachment => {
      const href = safeHttpUrl(attachment.url);
      if (!href) return;
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (String(attachment.contentType || "").startsWith("image/")) {
        const image = document.createElement("img");
        image.src = href;
        image.alt = attachment.filename || "Announcement image";
        image.loading = "lazy";
        link.appendChild(image);
      } else {
        link.textContent = attachment.filename || href;
      }
      attachments.appendChild(link);
    });

    const originalUrl = safeHttpUrl(item.url);
    const original = document.createElement("a");
    original.className = "news-original";
    original.href = originalUrl || "https://discord.gg/rssze";
    original.target = "_blank";
    original.rel = "noopener noreferrer";
    original.textContent = window.LANG?.[getCurrentLang()]?.news_original || "View original";

    article.append(header, meta, content);
    if (attachments.childElementCount) article.appendChild(attachments);
    article.appendChild(original);
    return article;
  });

  list.replaceChildren(...cards);
  applyDeepLink();
}

window.addEventListener("load", loadNews);

const SKIN_CATALOGS = [
  ["human", "data/skins/human.json"],
  ["zombie", "data/skins/zombie.json"],
  ["weapon", "data/skins/weapon.json"],
  ["spray", "data/skins/spray.json"]
];

function clearSkinCardCache() {
  skinImageObserver?.disconnect();
  skinCardCache.forEach(card => card.querySelectorAll("video").forEach(video => video.pause()));
  skinCardCache.clear();
  skinCardCacheLanguage = getCurrentLang();
}

// 8. Skin preview gallery from category catalogs under data/skins/
async function loadSkins() {
  const grid = document.getElementById("skinGrid");
  if (!grid) return;

  try {
    const catalogs = await Promise.all(SKIN_CATALOGS.map(async ([category, filename]) => {
      const catalog = await fetchJsonWithFallback(filename);
      if (catalog.category !== category || !Array.isArray(catalog.items)) {
        throw new Error(`${filename} has an invalid category or items array`);
      }
      return catalog;
    }));
    skinData = {
      version: Math.max(...catalogs.map(catalog => Number(catalog.version) || 0)),
      updatedAt: catalogs.map(catalog => catalog.updatedAt || "").sort().at(-1) || "",
      items: catalogs.flatMap(catalog =>
        catalog.items.map(item => ({ ...item, category: catalog.category }))
      )
    };
    clearSkinCardCache();
    skinCardsRendered = false;
    const updatedAt = document.getElementById("skinLastUpdate");
    if (updatedAt) updatedAt.textContent = formatContentDate(skinData.updatedAt) || "-";
    if (document.body.dataset.activeTab === "skins") renderSkins();
    renderGlobalSearch();
  } catch (err) {
    console.error("skins load failed:", err);
    skinData = { updatedAt: "", items: [] };
    skinCardsRendered = false;
    if (document.body.dataset.activeTab === "skins") renderSkins();
    renderGlobalSearch();
    grid.title = `skin catalogs load failed: ${err.message}`;
  }
}

function getSkinCategoryLabel(category) {
  const key = category === "zombie" ? "skins_category_zombie"
    : category === "weapon" ? "skins_category_weapon"
    : category === "spray" ? "skins_category_spray"
    : "skins_category_human";
  return window.LANG?.[getCurrentLang()]?.[key] || category;
}

function getSkinWeaponLabel(subcategory) {
  const key = {
    primary: "skins_weapon_primary",
    secondary: "skins_weapon_secondary",
    melee: "skins_weapon_melee",
    throwable: "skins_weapon_throwable"
  }[subcategory];
  return window.LANG?.[getCurrentLang()]?.[key] || subcategory || "";
}

function getSkinPrimaryTypeLabel(weaponType) {
  const key = {
    smg: "skins_primary_type_smg",
    rifle: "skins_primary_type_rifle",
    shotgun: "skins_primary_type_shotgun",
    machinegun: "skins_primary_type_machinegun",
    sniper: "skins_primary_type_sniper",
    other: "skins_primary_type_other"
  }[weaponType];
  return window.LANG?.[getCurrentLang()]?.[key] || weaponType || "";
}

function getSkinDisplayName(item) {
  if (getCurrentLang() === "ko" && item.nameKo) return item.nameKo;
  return item.name || item.nameKo || "Skin";
}

function getSkinPathLabel(item) {
  return [
    getSkinCategoryLabel(item.category),
    item.category === "weapon" ? getSkinWeaponLabel(item.subcategory) : "",
    item.subcategory === "primary" ? getSkinPrimaryTypeLabel(item.weaponType) : ""
  ].filter(Boolean).join(" · ");
}

function getSkinMediaLabel(media, index, total) {
  if (media.role === "thirdPerson") {
    return window.LANG?.[getCurrentLang()]?.skins_third_person || "Third-person";
  }
  if (media.role === "firstPerson") {
    return window.LANG?.[getCurrentLang()]?.skins_first_person || "First-person";
  }
  const base = media.type === "video"
    ? window.LANG?.[getCurrentLang()]?.skins_video || "Video"
    : window.LANG?.[getCurrentLang()]?.skins_preview || "Preview";
  return total > 1 ? `${base} ${index + 1}` : base;
}

function openSkinImageDialog(src, alt, caption) {
  const dialog = document.getElementById("skinImageDialog");
  const image = document.getElementById("skinImageDialogImage");
  const captionElement = document.getElementById("skinImageDialogCaption");
  if (!dialog || !image || !captionElement) return;
  image.src = src;
  image.alt = alt;
  captionElement.textContent = caption;
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function closeSkinImageDialog() {
  const dialog = document.getElementById("skinImageDialog");
  if (dialog?.open) dialog.close();
}

document.getElementById("skinImageDialogClose")?.addEventListener("click", closeSkinImageDialog);
document.getElementById("skinImageDialog")?.addEventListener("click", event => {
  if (event.target === event.currentTarget) closeSkinImageDialog();
});

function createSkinFigure(media, label, skinName, eager = false) {
  const figure = document.createElement("figure");
  figure.className = "skin-preview";

  if (media.type === "video") {
    const frame = document.createElement("div");
    frame.className = "skin-media-frame";
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    const videoUrl = new URL(assetUrl(media.src));
    videoUrl.hash = "t=0.1";
    video.src = videoUrl.toString();
    video.width = Number(media.width) || 1920;
    video.height = Number(media.height) || 1080;
    video.setAttribute("aria-label", `${skinName} - ${label}`);
    frame.appendChild(video);
    figure.appendChild(frame);
  } else {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skin-media-frame skin-image-button";

    const image = document.createElement("img");
    image.loading = eager ? "eager" : "lazy";
    image.decoding = "async";
    const imageUrl = assetUrl(media.src);
    if (eager) image.src = imageUrl;
    else image.dataset.src = imageUrl;
    image.width = Number(media.width) || 800;
    image.height = Number(media.height) || 800;
    image.alt = `${skinName} - ${label}`;
    button.appendChild(image);
    button.addEventListener("click", () => openSkinImageDialog(
      imageUrl,
      image.alt,
      `${skinName} · ${label}`
    ));
    figure.appendChild(button);
  }

  const caption = document.createElement("figcaption");
  caption.textContent = label;
  figure.appendChild(caption);
  return figure;
}

function createSkinCard(item, index) {
  const article = document.createElement("article");
  article.className = "skin-card";
  article.id = deepLinkId("skin", item.id || item.name);

  const header = document.createElement("div");
  header.className = "skin-card-header";

  const number = document.createElement("span");
  number.className = "skin-number";
  number.textContent = String(item.order || index + 1).padStart(2, "0");

  const names = document.createElement("div");
  names.className = "skin-names";
  const heading = document.createElement("h3");
  heading.textContent = getSkinDisplayName(item);
  markRecentTarget(article, "skin", heading.textContent);
  names.appendChild(heading);

  const actions = document.createElement("div");
  actions.className = "skin-actions";
  actions.appendChild(makeShareButton(article.id, heading.textContent));
  const sourceUrl = safeHttpUrl(item.sourceUrl);
  if (sourceUrl) {
    const source = document.createElement("a");
    source.href = sourceUrl;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.textContent = window.LANG?.[getCurrentLang()]?.skins_original || "View on Discord";
    actions.appendChild(source);
  }
  header.append(number, names, actions);

  const previews = document.createElement("div");
  previews.className = "skin-previews";
  if (item.category !== "weapon") previews.classList.add("skin-character-previews");
  if ((item.media || []).length === 1) previews.classList.add("skin-single-preview");
  const skinName = getSkinDisplayName(item);
  const mediaItems = item.media || [];
  previews.append(...mediaItems.map((media, mediaIndex) => createSkinFigure(
    media,
    getSkinMediaLabel(media, mediaIndex, mediaItems.length),
    skinName,
    index < 2
  )));

  article.append(header, previews);
  return article;
}

function getSkinCard(item, index) {
  const language = getCurrentLang();
  if (skinCardCacheLanguage !== language) clearSkinCardCache();
  const key = item.id || `${item.category}:${item.name}:${item.order}`;
  let card = skinCardCache.get(key);
  if (!card) {
    card = createSkinCard(item, index);
    skinCardCache.set(key, card);
  }
  return card;
}

function createSkinTypeSection(weaponType, items, startIndex) {
  const section = document.createElement("section");
  section.className = "skin-type-section";

  const headingId = `skin-type-${weaponType}`;
  const heading = document.createElement("div");
  heading.className = "skin-type-heading";

  const title = document.createElement("h3");
  title.id = headingId;
  title.textContent = getSkinPrimaryTypeLabel(weaponType);

  const count = document.createElement("span");
  count.className = "skin-type-count";
  count.textContent = String(items.length);

  const typeGrid = document.createElement("div");
  typeGrid.className = "skin-grid skin-type-grid";
  typeGrid.append(...items.map((item, index) => getSkinCard(item, startIndex + index)));

  heading.append(title, count);
  section.setAttribute("aria-labelledby", headingId);
  section.append(heading, typeGrid);
  return section;
}

function skinCategoryCount(category, subcategory = null) {
  return (skinData?.items || []).filter(item =>
    item.category === category && (!subcategory || item.subcategory === subcategory)
  ).length;
}

function skinPrimaryTypeCount(weaponType) {
  return (skinData?.items || []).filter(item =>
    item.subcategory === "primary" && (weaponType === "all" || item.weaponType === weaponType)
  ).length;
}

function updateSkinFilterControls() {
  document.querySelectorAll("[data-skin-category]").forEach(button => {
    const active = button.dataset.skinCategory === skinCategoryFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  document.querySelectorAll("[data-skin-weapon]").forEach(button => {
    const active = button.dataset.skinWeapon === skinWeaponFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  document.querySelectorAll("[data-skin-primary-type]").forEach(button => {
    const active = button.dataset.skinPrimaryType === skinPrimaryTypeFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const weaponFilters = document.getElementById("skinWeaponFilterGroup");
  if (weaponFilters) weaponFilters.hidden = skinCategoryFilter !== "weapon";
  const primaryTypeFilters = document.getElementById("skinPrimaryTypeFilterGroup");
  if (primaryTypeFilters) {
    primaryTypeFilters.hidden = !(
      skinCategoryFilter === "weapon" && skinWeaponFilter === "primary"
    );
  }

  const counts = {
    skinCountHuman: skinCategoryCount("human"),
    skinCountZombie: skinCategoryCount("zombie"),
    skinCountWeapon: skinCategoryCount("weapon"),
    skinCountSpray: skinCategoryCount("spray"),
    skinCountPrimary: skinCategoryCount("weapon", "primary"),
    skinCountSecondary: skinCategoryCount("weapon", "secondary"),
    skinCountMelee: skinCategoryCount("weapon", "melee"),
    skinCountThrowable: skinCategoryCount("weapon", "throwable"),
    skinCountPrimaryAll: skinPrimaryTypeCount("all"),
    skinCountPrimarySmg: skinPrimaryTypeCount("smg"),
    skinCountPrimaryRifle: skinPrimaryTypeCount("rifle"),
    skinCountPrimaryShotgun: skinPrimaryTypeCount("shotgun"),
    skinCountPrimaryMachinegun: skinPrimaryTypeCount("machinegun"),
    skinCountPrimarySniper: skinPrimaryTypeCount("sniper"),
    skinCountPrimaryOther: skinPrimaryTypeCount("other")
  };
  Object.entries(counts).forEach(([id, count]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(count);
  });
  const otherFilter = document.querySelector('[data-skin-primary-type="other"]');
  if (otherFilter) otherFilter.hidden = counts.skinCountPrimaryOther === 0;
}

function clearSkinItemHash() {
  if (!location.hash.startsWith("#skin-") || location.hash === "#skins") return;
  const url = new URL(location.href);
  url.hash = "skins";
  history.replaceState(null, "", url);
}

function renderSkins() {
  const grid = document.getElementById("skinGrid");
  if (!grid || !skinData) return;
  setContentUpdatedAt("skinLastUpdate", skinData);
  skinCardsRendered = true;
  updateSkinFilterControls();

  const query = normalizeSearchText(skinSearchQuery);
  const items = (skinData.items || []).filter(item => {
    if (item.category !== skinCategoryFilter) return false;
    if (skinCategoryFilter === "weapon" && item.subcategory !== skinWeaponFilter) return false;
    if (
      item.subcategory === "primary"
      && skinPrimaryTypeFilter !== "all"
      && item.weaponType !== skinPrimaryTypeFilter
    ) return false;
    return !query || matchesSearch(
      `${item.name || ""} ${item.nameKo || ""} ${getSkinPathLabel(item)}`,
      query
    );
  });
  skinImageObserver?.disconnect();
  grid.querySelectorAll("video").forEach(video => video.pause());
  const count = document.getElementById("skinResultCount");
  if (count) {
    const template = window.LANG?.[getCurrentLang()]?.skins_result_count || "{count} skins";
    count.textContent = template.replace("{count}", items.length);
  }

  if (!items.length) {
    grid.classList.remove("skin-grid-grouped");
    const empty = document.createElement("p");
    empty.className = "skin-empty";
    empty.textContent = window.LANG?.[getCurrentLang()]?.skins_empty || "No matching skins.";
    grid.replaceChildren(empty);
    return;
  }

  const groupedPrimaryView = skinCategoryFilter === "weapon"
    && skinWeaponFilter === "primary"
    && skinPrimaryTypeFilter === "all";
  grid.classList.toggle("skin-grid-grouped", groupedPrimaryView);
  if (groupedPrimaryView) {
    let cardIndex = 0;
    const sections = PRIMARY_SKIN_TYPE_ORDER.flatMap(weaponType => {
      const typeItems = items.filter(item => item.weaponType === weaponType);
      if (!typeItems.length) return [];
      const section = createSkinTypeSection(weaponType, typeItems, cardIndex);
      cardIndex += typeItems.length;
      return section;
    });
    grid.replaceChildren(...sections);
  } else {
    grid.replaceChildren(...items.map(getSkinCard));
  }
  const lazyImages = grid.querySelectorAll("img[data-src]");
  if ("IntersectionObserver" in window) {
    skinImageObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const image = entry.target;
        image.src = image.dataset.src;
        delete image.dataset.src;
        skinImageObserver.unobserve(image);
      });
    }, { rootMargin: "900px 0px" });
    lazyImages.forEach(image => skinImageObserver.observe(image));
  } else {
    lazyImages.forEach(image => {
      image.src = image.dataset.src;
      delete image.dataset.src;
    });
  }
  applyDeepLink();
}

document.getElementById("skinSearch")?.addEventListener("input", event => {
  skinSearchQuery = event.target.value || "";
  clearSkinItemHash();
  clearTimeout(skinRenderTimer);
  skinRenderTimer = setTimeout(() => {
    skinRenderTimer = null;
    renderSkins();
  }, 120);
});

document.querySelectorAll("[data-skin-category]").forEach(button => {
  button.addEventListener("click", () => {
    skinCategoryFilter = button.dataset.skinCategory;
    pushLocationHash(skinCategoryDeepLink(skinCategoryFilter));
    renderSkins();
  });
});

document.querySelectorAll("[data-skin-weapon]").forEach(button => {
  button.addEventListener("click", () => {
    skinWeaponFilter = button.dataset.skinWeapon;
    skinPrimaryTypeFilter = "all";
    pushLocationHash(skinWeaponDeepLink(skinWeaponFilter));
    renderSkins();
  });
});

document.querySelectorAll("[data-skin-primary-type]").forEach(button => {
  button.addEventListener("click", () => {
    skinPrimaryTypeFilter = button.dataset.skinPrimaryType;
    clearSkinItemHash();
    renderSkins();
  });
});

function addFilterKeyboardNavigation(containerId, selector) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.addEventListener("keydown", event => {
    const buttons = [...container.querySelectorAll(selector)];
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    const next = event.key === "ArrowRight" ? (current + 1) % buttons.length
      : event.key === "ArrowLeft" ? (current - 1 + buttons.length) % buttons.length
      : event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next].focus();
    buttons[next].click();
  });
}

addFilterKeyboardNavigation("skinCategoryFilters", "[data-skin-category]");
addFilterKeyboardNavigation("skinWeaponFilters", "[data-skin-weapon]");
addFilterKeyboardNavigation("skinPrimaryTypeFilters", "[data-skin-primary-type]:not([hidden])");

window.addEventListener("load", loadSkins);

// 9. Support methods and VIP benefits from data/support.json
async function loadSupport() {
  const container = document.getElementById("supportContent");
  if (!container) return;

  try {
    supportData = await fetchJsonWithFallback("data/support.json");
    setContentUpdatedAt("supportLastUpdate", supportData);
    renderSupport();
  } catch (err) {
    console.error("support load failed:", err);
    supportData = null;
    const empty = document.createElement("p");
    empty.className = "support-empty";
    empty.textContent = window.LANG?.[getCurrentLang()]?.support_unavailable || "Unable to load support information.";
    container.replaceChildren(empty);
    container.title = `data/support.json load failed: ${err.message}`;
  }
}

function recentViewsStorageKey(lang = getCurrentLang()) {
  return `${RECENT_VIEWS_STORAGE_KEY}:${lang}`;
}

function readRecentViews() {
  try {
    return normalizeRecentViews(JSON.parse(readStorage(recentViewsStorageKey(), "[]")));
  } catch (_error) {
    return [];
  }
}

function saveRecentViews(items) {
  writeStorage(recentViewsStorageKey(), JSON.stringify(normalizeRecentViews(items)));
}

function recentTypeLabel(type) {
  return window.LANG?.[getCurrentLang()]?.[`search_type_${type}`] || type;
}

function renderRecentViews() {
  const list = document.getElementById("recentViewsList");
  const empty = document.getElementById("recentViewsEmpty");
  const clear = document.getElementById("recentViewsClear");
  if (!list || !empty || !clear) return;

  const items = readRecentViews();
  const rows = items.map(item => {
    const row = document.createElement("li");
    row.className = "recent-view-item";
    row.dataset.recentType = item.type;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "recent-view-open";
    const badge = document.createElement("span");
    badge.className = "recent-view-type";
    badge.textContent = recentTypeLabel(item.type);
    const title = document.createElement("span");
    title.className = "recent-view-title";
    title.textContent = item.title;
    open.append(badge, title);
    open.addEventListener("click", () => {
      closeRecentViewsPanel(false);
      navigateToDeepLink(item.targetId);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "recent-view-remove";
    remove.textContent = "×";
    const removeLabel = window.LANG?.[getCurrentLang()]?.recent_views_remove || "Remove from history";
    remove.title = removeLabel;
    remove.setAttribute("aria-label", `${item.title}: ${removeLabel}`);
    remove.addEventListener("click", () => {
      saveRecentViews(removeRecentView(readRecentViews(), item.targetId));
      renderRecentViews();
    });

    row.append(open, remove);
    return row;
  });

  list.replaceChildren(...rows);
  empty.hidden = items.length > 0;
  clear.hidden = items.length === 0;
}

function recordRecentView(targetId, type, title) {
  const entry = { targetId, type, title, visitedAt: Date.now() };
  saveRecentViews(addRecentView(readRecentViews(), entry));
  renderRecentViews();
}

function markRecentTarget(element, type, title) {
  if (!element?.id || !type || !title) return element;
  element.dataset.recentTarget = element.id;
  element.dataset.recentType = type;
  element.dataset.recentTitle = title;
  return element;
}

function recordRecentTargetElement(element) {
  const target = element?.closest?.("[data-recent-target]") || element;
  if (!target?.dataset?.recentTarget) return;
  recordRecentView(target.dataset.recentTarget, target.dataset.recentType, target.dataset.recentTitle);
}

function openRecentViewsPanel() {
  const panel = document.getElementById("recentViewsPanel");
  const toggle = document.getElementById("recentViewsToggle");
  if (!panel || !toggle) return;
  renderRecentViews();
  document.body.classList.add("recent-views-open");
  panel.setAttribute("aria-hidden", "false");
  toggle.setAttribute("aria-expanded", "true");
  document.getElementById("recentViewsClose")?.focus();
}

function closeRecentViewsPanel(restoreFocus = true) {
  const panel = document.getElementById("recentViewsPanel");
  const toggle = document.getElementById("recentViewsToggle");
  if (!panel || !toggle || !document.body.classList.contains("recent-views-open")) return;
  document.body.classList.remove("recent-views-open");
  panel.setAttribute("aria-hidden", "true");
  toggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) toggle.focus();
}

document.getElementById("recentViewsToggle")?.addEventListener("click", openRecentViewsPanel);
document.getElementById("recentViewsClose")?.addEventListener("click", () => closeRecentViewsPanel());
document.getElementById("recentViewsBackdrop")?.addEventListener("click", () => closeRecentViewsPanel());
document.getElementById("recentViewsClear")?.addEventListener("click", () => {
  saveRecentViews([]);
  renderRecentViews();
});
document.addEventListener("click", event => {
  const target = event.target.closest?.("[data-recent-target]");
  if (target) recordRecentTargetElement(target);
});
document.addEventListener("keydown", event => {
  if (!document.body.classList.contains("recent-views-open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeRecentViewsPanel();
    return;
  }
  if (event.key !== "Tab") return;
  const panel = document.getElementById("recentViewsPanel");
  const focusable = [...(panel?.querySelectorAll("button:not([hidden])") || [])];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
renderRecentViews();

function createSupportMethodCard(method) {
  const article = document.createElement("article");
  article.className = `support-method-card support-method-${method.id || "default"}`;

  const title = document.createElement("h4");
  title.textContent = localizeText(method.title);

  const description = document.createElement("p");
  description.className = "support-method-description";
  description.textContent = localizeText(method.description);

  const notice = document.createElement("p");
  notice.className = "support-notice";
  notice.textContent = localizeText(method.notice);

  const url = safeHttpUrl(method.url);
  const actions = document.createElement("div");
  actions.className = "support-method-actions";

  const open = document.createElement("a");
  open.className = "support-open-link";
  open.href = url;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = window.LANG?.[getCurrentLang()]?.support_open_link || "Open link";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "support-copy-button";
  copy.textContent = window.LANG?.[getCurrentLang()]?.support_copy_link || "Copy link";
  copy.addEventListener("click", () => {
    copyText(url).then(() => {
      showToast(window.LANG?.[getCurrentLang()]?.support_copy_done || "Support link copied.");
    }).catch(() => window.prompt("Copy link", url));
  });

  actions.append(open, copy);
  article.append(title, description, notice, actions);
  return article;
}

function createBenefitGroup(group) {
  const article = document.createElement("article");
  article.className = `support-benefit-group support-benefit-${group.id || "default"}`;

  const title = document.createElement("h4");
  title.textContent = localizeText(group.title);

  const description = document.createElement("p");
  description.className = "support-benefit-description";
  description.textContent = localizeText(group.description);

  const list = document.createElement("ul");
  list.className = "support-benefit-list";
  (group.items || []).forEach(item => {
    const row = document.createElement("li");
    row.id = deepLinkId("support-benefit", item.id || localizeText(item.title));

    const itemHeading = document.createElement("div");
    itemHeading.className = "support-benefit-heading";
    const itemTitle = document.createElement("strong");
    itemTitle.textContent = localizeText(item.title);
    markRecentTarget(row, "support", itemTitle.textContent);
    itemHeading.append(itemTitle, makeShareButton(row.id, itemTitle.textContent, "support-benefit-share"));
    row.appendChild(itemHeading);
    const itemDescription = localizeText(item.description);
    if (itemDescription) {
      const detail = document.createElement("p");
      detail.textContent = itemDescription;
      row.appendChild(detail);
    }
    const referencedCommands = (item.commandRefs || [])
      .map(commandId => findCommandById(commandId))
      .filter(Boolean);
    if (referencedCommands.length) {
      const commandButton = document.createElement("button");
      commandButton.type = "button";
      commandButton.className = "support-command-trigger";
      commandButton.textContent = window.LANG?.[getCurrentLang()]?.support_commands_toggle || "Show commands";
      commandButton.setAttribute("aria-haspopup", "dialog");
      commandButton.setAttribute("aria-controls", "supportCommandDialog");
      commandButton.addEventListener("click", () => {
        openSupportCommandDialog(commandButton, item, referencedCommands);
      });
      row.appendChild(commandButton);
    }
    list.appendChild(row);
  });

  article.append(title, description, list);
  return article;
}

function createSupportCommandRow(commandItem) {
  const commandRow = document.createElement("div");
  commandRow.className = "support-benefit-command";

  const command = document.createElement("code");
  command.textContent = commandItem.command;

  const commandDescription = document.createElement("span");
  commandDescription.textContent = localizeText(commandItem.description);

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "support-command-copy";
  copy.textContent = window.LANG?.[getCurrentLang()]?.command_copy || "Copy";
  copy.setAttribute("aria-label", `${copy.textContent}: ${commandItem.command}`);
  copy.addEventListener("click", () => copyCommand(commandItem.command));

  commandRow.append(command, commandDescription, copy);
  return commandRow;
}

function openSupportCommandDialog(trigger, item, commandItems) {
  const dialog = document.getElementById("supportCommandDialog");
  const title = document.getElementById("supportCommandDialogTitle");
  const description = document.getElementById("supportCommandDialogDescription");
  const content = document.getElementById("supportCommandDialogContent");
  if (!dialog || !title || !description || !content) return;

  supportCommandDialogTrigger = trigger;
  title.textContent = localizeText(item.title);
  description.textContent = localizeText(item.description);
  content.replaceChildren(...commandItems.map(createSupportCommandRow));
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

const supportCommandDialog = document.getElementById("supportCommandDialog");
document.getElementById("supportCommandDialogClose")?.addEventListener("click", () => supportCommandDialog?.close());
supportCommandDialog?.addEventListener("click", event => {
  const rect = supportCommandDialog.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) supportCommandDialog.close();
});
supportCommandDialog?.addEventListener("close", () => {
  supportCommandDialogTrigger?.focus();
  supportCommandDialogTrigger = null;
});

function findCommandById(commandId) {
  if (!commandGuideData || !commandId) return null;
  for (const page of commandGuideData.pages || []) {
    for (const section of page.sections || []) {
      const command = (section.commands || []).find(item => item.id === commandId);
      if (command) return command;
    }
  }
  return null;
}

function renderSupport() {
  const container = document.getElementById("supportContent");
  if (!container || !supportData) return;

  const methodsSection = document.createElement("section");
  methodsSection.className = "support-section";
  const methodsTitle = document.createElement("h3");
  methodsTitle.textContent = window.LANG?.[getCurrentLang()]?.support_methods_title || "Support methods";
  const methodGrid = document.createElement("div");
  methodGrid.className = "support-method-grid";
  const currentLang = getCurrentLang();
  const visibleMethods = (supportData.methods || []).filter(method => method.languages?.includes(currentLang));
  methodGrid.append(...visibleMethods.map(createSupportMethodCard));
  methodsSection.append(methodsTitle, methodGrid);

  const benefitsSection = document.createElement("section");
  benefitsSection.className = "support-section";
  benefitsSection.id = "support-benefits";
  const benefitsHeading = document.createElement("div");
  benefitsHeading.className = "support-section-heading";
  const benefitsTitle = document.createElement("h3");
  benefitsTitle.textContent = window.LANG?.[getCurrentLang()]?.support_benefits_title || "VIP benefits";
  benefitsHeading.append(
    benefitsTitle,
    makeShareButton(benefitsSection.id, benefitsTitle.textContent, "support-benefits-share")
  );
  const benefitGrid = document.createElement("div");
  benefitGrid.className = "support-benefit-grid";
  benefitGrid.append(...(supportData.benefitGroups || []).map(createBenefitGroup));
  benefitsSection.append(benefitsHeading, benefitGrid);

  container.replaceChildren(methodsSection, benefitsSection);
  if (decodeURIComponent(location.hash).startsWith("#support-benefit")) applyDeepLink();
}

window.addEventListener("load", loadSupport);

const backToTop = document.getElementById("backToTop");

function updateBackToTop() {
  if (!backToTop) return;
  const visible = window.scrollY > 480;
  backToTop.classList.toggle("show", visible);
  backToTop.setAttribute("aria-hidden", visible ? "false" : "true");
  backToTop.tabIndex = visible ? 0 : -1;
}

backToTop?.addEventListener("click", () => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  window.setTimeout(() => document.getElementById("mainContent")?.focus({ preventScroll: true }), reduceMotion ? 0 : 450);
});

window.addEventListener("scroll", updateBackToTop, { passive: true });
window.addEventListener("load", updateBackToTop);
updateBackToTop();

// 5. 클립보드 명령어 복사 기능
function copyCode(button) {
  const code = button.closest(".code-container")?.querySelector("pre code") || document.getElementById("bindCommands");
  const codeText = code?.innerText || "";

  copyText(codeText).then(() => {
    button.classList.add("copied");
    showToast(window.LANG?.[getCurrentLang()]?.copy_done || "Copied to clipboard.");
    setTimeout(() => {
      button.classList.remove("copied");
    }, 1500);
  }).catch(err => {
    console.error("copy failed:", err);
    alert("Copy failed. Please copy manually.");
  });
}


