
import { getChoseong } from "./vendor/es-hangul.mjs";

// 1. 탭 전환 및 URL 해시 지원
const DEFAULT_LANG = "ko";
const SUPPORTED_LANGS = new Set(["ko", "en", "jp"]);
let commandGuideData = null;
let faqData = null;
let termGuideData = null;
let newsData = null;
let globalSearchQuery = "";
let commandPageFilter = "all";
let favoriteCommandsOnly = false;
let toastTimer = null;
const NEWS_WIDTH_STORAGE_KEY = "newsPanelWidth";
const NEWS_DEFAULT_WIDTH = 1160;
const NEWS_MIN_WIDTH = 760;
const NEWS_MAX_WIDTH = 1600;
const favoriteCommands = new Set(JSON.parse(localStorage.getItem("favoriteCommands") || "[]"));
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

function assetUrl(filename) {
  return new URL(filename, scriptBase).toString();
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
let newsPanelWidth = Number(localStorage.getItem(NEWS_WIDTH_STORAGE_KEY)) || NEWS_DEFAULT_WIDTH;

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
  if (persist) localStorage.setItem(NEWS_WIDTH_STORAGE_KEY, String(newsPanelWidth));
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
    localStorage.setItem(NEWS_WIDTH_STORAGE_KEY, String(newsPanelWidth));
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
  if (pushHash) location.hash = name;
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
    : hash.startsWith("command-") ? "cmds"
    : hash.startsWith("term-") ? "guide"
    : hash.startsWith("news-") ? "news"
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
  requestAnimationFrame(() => {
    const target = document.getElementById(hash);
    if (!target) return;
    if (target.tagName === "DETAILS") target.open = true;
    document.querySelectorAll(".deep-link-target").forEach(el => el.classList.remove("deep-link-target"));
    target.classList.add("deep-link-target");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => target.classList.remove("deep-link-target"), 2200);
  });
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
  if (validTabs.includes(hash)) openTab(hash, false);
  else if (/^(faq|command|term|news)-/.test(decodeURIComponent(hash))) applyDeepLink();
  else openTab("faq", false); // 기본은 FAQ
}
window.addEventListener("load", applyLocationState);
window.addEventListener("hashchange", applyLocationState);


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
  return document.documentElement.lang || DEFAULT_LANG;
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
    button.addEventListener("click", () => { commandPageFilter = filter.id; renderCommandGuide(); });
    return button;
  }));
}

function setLanguage(lang, syncUrl = true) {
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

  // 버튼 상태 클래스 토글 (함수 내부로 격리)
  document.querySelectorAll(".langbtn").forEach(b => {
    const isActive = b.dataset.lang === lang;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  updateNewsResizeHandle(lang);

  // 선택한 언어 저장 및 HTML 문서속서를 반영
  localStorage.setItem("lang", lang);
  document.documentElement.lang = lang;
  if (syncUrl) {
    const url = new URL(location.href);
    url.searchParams.set("lang", lang);
    history.replaceState(null, "", url);
  }
  renderCommandGuide();
  renderFaq();
  renderTermGuide();
  renderNews();
  renderGlobalSearch();
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

function setContentUpdatedAt(elementId, data) {
  const element = document.getElementById(elementId);
  if (element) element.textContent = data?.updatedAt || "-";
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

  const summaryTemplate = window.LANG?.[getCurrentLang()]?.global_search_summary || "FAQ {faq} · Commands {commands} · Terms {terms} · News {news}";
  const summary = document.createElement("p");
  summary.className = "global-search-summary";
  summary.textContent = summaryTemplate
    .replace("{faq}", faqMatches.length)
    .replace("{commands}", commandMatches.length)
    .replace("{terms}", termMatches.length)
    .replace("{news}", newsMatches.length);

  const list = document.createElement("div");
  list.className = "global-search-list";

  const displayedMatches = [
    ...faqMatches.slice(0, 6).map(({ item, score }) => ({
      score,
      element: makeGlobalSearchItem(
        "faq", localizeContent(item.question), faqSearchText(item).slice(0, 140), "faq",
        () => navigateToDeepLink(deepLinkId("faq", item.id || localizeContent(item.question)))
      )
    })),
    ...commandMatches.slice(0, 10).map(({ item, page, section, score }) => ({
      score,
      element: makeGlobalSearchItem(
        "command",
        item.command,
        `${localizeText(page.title)} · ${localizeText(section.title)} · ${localizeText(item.description)}`,
        "cmds",
        () => navigateToDeepLink(deepLinkId("command", item.command))
      )
    })),
    ...termMatches.slice(0, 10).map(({ item, section, score }) => ({
      score,
      element: makeGlobalSearchItem(
        "term", item.term, `${section.title} · ${item.description}`, "guide",
        () => navigateToDeepLink(deepLinkId("term", item.term))
      )
    })),
    ...newsMatches.slice(0, 10).map(({ item, score }) => ({
      score,
      element: makeGlobalSearchItem(
        "news",
        item.title || "Announcement",
        normalizeSearchText(item.content || item.summary || item.author || "").slice(0, 180),
        "news",
        () => navigateToDeepLink(deepLinkId("news", item.id || item.title || item.publishedAt))
      )
    }))
  ].sort((a, b) => a.score - b.score);
  list.append(...displayedMatches.map(result => result.element));

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
  if (event.key === "/" && !isEditing) {
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
  const saved = localStorage.getItem("lang");
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
    faqData = await fetchJsonWithFallback("faq.json");
    setContentUpdatedAt("faqLastUpdate", faqData);
    renderFaq();
    renderGlobalSearch();
  } catch (err) {
    console.error("FAQ load failed:", err);
    faqData = FAQ_FALLBACK;
    setContentUpdatedAt("faqLastUpdate", faqData);
    renderFaq();
    faqList.title = `faq.json load failed: ${err.message}`;
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

      const img = document.createElement("img");
      img.src = block.src || "";
      img.alt = localizeContent(block.alt);
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
// 4. Command guide from JSON
async function loadCommandGuide() {
  const guide = document.getElementById("commandGuide");
  if (!guide) return;

  try {
    commandGuideData = await fetchJsonWithFallback("commands.json");
    setContentUpdatedAt("commandLastUpdate", commandGuideData);
    renderCommandGuide();
    if (faqData) renderFaq();
    renderGlobalSearch();
  } catch (err) {
    console.error("command guide load failed:", err);
    guide.textContent = "Failed to load commands.json";
    guide.title = `commands.json load failed: ${err.message}`;
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
  localStorage.setItem("favoriteCommands", JSON.stringify([...favoriteCommands]));
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
    termGuideData = await fetchJsonWithFallback("terms.json");
    setContentUpdatedAt("termLastUpdate", termGuideData);
    renderTermGuide();
    renderGlobalSearch();
  } catch (err) {
    console.error("term guide load failed:", err);
    guide.textContent = window.LANG?.[getCurrentLang()]?.term_unavailable || "Glossary unavailable";
    guide.title = `terms.json load failed: ${err.message}`;
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

// 7. Discord announcements from news.json
async function loadNews() {
  const list = document.getElementById("newsList");
  if (!list) return;

  try {
    newsData = await fetchJsonWithFallback("news.json");
    const updatedAt = document.getElementById("newsLastUpdate");
    if (updatedAt) updatedAt.textContent = formatNewsDate(newsData.updatedAt) || "-";
    renderNews();
    renderGlobalSearch();
  } catch (err) {
    console.error("news load failed:", err);
    newsData = { updatedAt: "", items: [] };
    renderNews();
    renderGlobalSearch();
    list.title = `news.json load failed: ${err.message}`;
  }
}

function formatNewsDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = getCurrentLang() === "jp" ? "ja-JP" : getCurrentLang() === "en" ? "en-US" : "ko-KR";
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
    published.textContent = formatNewsDate(item.publishedAt);
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

// Remove service workers and caches created by older versions of this site.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const siteScope = new URL("./", document.baseURI).href;
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.filter(registration => registration.scope === siteScope).map(registration => registration.unregister()));
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.filter(name => name.startsWith("rss-ze-guide-")).map(name => caches.delete(name)));
      }
    } catch (error) {
      console.warn("legacy cache cleanup failed:", error);
    }
  });
}

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


