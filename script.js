
import { getChoseong } from "./vendor/es-hangul.mjs";

// 1. 탭 전환 및 URL 해시 지원
const DEFAULT_LANG = "ko";
const SUPPORTED_LANGS = new Set(["ko", "en", "jp"]);
let commandGuideData = null;
let faqData = null;
let termGuideData = null;
let globalSearchQuery = "";
let commandPageFilter = "all";
let favoriteCommandsOnly = false;
let toastTimer = null;
const favoriteCommands = new Set(JSON.parse(localStorage.getItem("favoriteCommands") || "[]"));
const FAQ_FALLBACK = {
  version: 1,
  updatedAt: "",
  items: [
    {
      id: "store_bind",
      question: "How to use !store?",
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
        { type: "inlineCode", value: "!stopsound" },
        { type: "text", text: " / " },
        { type: "inlineCode", value: "!hide 300" },
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
        { type: "inlineCode", value: "!stopsound" },
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

function openTab(name, pushHash = true) {
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
  const tab = hash.startsWith("faq-") ? "faq" : hash.startsWith("command-") ? "cmds" : hash.startsWith("term-") ? "guide" : null;
  if (!tab) return;
  openTab(tab, false);
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

window.addEventListener("load", () => {
  const hash = (location.hash || "").replace("#", "");
  if (validTabs.includes(hash)) openTab(hash, false);
  else if (/^(faq|command|term)-/.test(decodeURIComponent(hash))) applyDeepLink();
  else openTab("faq", false); // 기본은 FAQ
});
window.addEventListener("hashchange", applyDeepLink);


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

function setLanguage(lang) {
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
    b.classList.toggle("active", b.dataset.lang === lang);
  });

  // 선택한 언어 저장 및 HTML 문서속서를 반영
  localStorage.setItem("lang", lang);
  document.documentElement.lang = lang;
  renderCommandGuide();
  renderFaq();
  renderTermGuide();
  renderGlobalSearch();
}

function faqSearchText(item) {
  const blocks = (item.body || []).map(block => {
    if (block.type === "text" || block.type === "link") return localizeContent(block.text);
    if (block.type === "inlineCode" || block.type === "code") return block.value || "";
    return "";
  });
  return [localizeContent(item.question), ...blocks].join(" ");
}

function matchesSearch(text, query) {
  const normalized = String(text || "").toLocaleLowerCase(getCurrentLang());
  if (normalized.includes(query)) return true;
  const compact = query.replace(/\s+/g, "");
  return compact.length > 0 && /^[ㄱ-ㅎ]+$/.test(compact)
    && getChoseong(normalized).replace(/\s+/g, "").includes(compact);
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
  const query = globalSearchQuery.trim().toLocaleLowerCase(getCurrentLang());

  if (!query) {
    const hint = document.createElement("p");
    hint.className = "global-search-summary";
    hint.textContent = window.LANG?.[getCurrentLang()]?.global_search_hint || "Search across every guide.";
    results.replaceChildren(hint);
    return;
  }

  const faqMatches = (faqData?.items || []).filter(item => matchesSearch(faqSearchText(item), query));
  const commandMatches = (commandGuideData?.pages || []).flatMap(page =>
    (page.sections || []).flatMap(section => (section.commands || []).map(item => ({ item, section })))
  ).filter(({ item }) => matchesSearch([item.command, localizeText(item.description), localizeText(item.note)].join(" "), query));
  const locale = termGuideData?.locales?.[getCurrentLang()];
  const termMatches = (locale?.sections || []).flatMap(section =>
    (section.terms || []).map(item => ({ item, section }))
  ).filter(({ item }) => matchesSearch([item.term, ...(item.aliases || []), item.description].join(" "), query));

  const summaryTemplate = window.LANG?.[getCurrentLang()]?.global_search_summary || "FAQ {faq} · Commands {commands} · Terms {terms}";
  const summary = document.createElement("p");
  summary.className = "global-search-summary";
  summary.textContent = summaryTemplate
    .replace("{faq}", faqMatches.length)
    .replace("{commands}", commandMatches.length)
    .replace("{terms}", termMatches.length);

  const list = document.createElement("div");
  list.className = "global-search-list";

  faqMatches.slice(0, 6).forEach(item => list.appendChild(makeGlobalSearchItem(
    "faq", localizeContent(item.question), faqSearchText(item).slice(0, 140), "faq",
    () => navigateToDeepLink(deepLinkId("faq", item.id || localizeContent(item.question)))
  )));
  commandMatches.slice(0, 10).forEach(({ item, section }) => list.appendChild(makeGlobalSearchItem(
    "command", item.command, `${localizeText(section.title)} · ${localizeText(item.description)}`, "cmds",
    () => navigateToDeepLink(deepLinkId("command", item.command))
  )));
  termMatches.slice(0, 10).forEach(({ item, section }) => list.appendChild(makeGlobalSearchItem(
    "term", item.term, `${section.title} · ${item.description}`, "guide", () => {
      navigateToDeepLink(deepLinkId("term", item.term));
    }
  )));

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
  if (!event.defaultPrevented && !isEditing && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    const current = [...tabs].findIndex(tab => tab.getAttribute("aria-selected") === "true");
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = (current + offset + tabs.length) % tabs.length;
    event.preventDefault();
    openTab(tabs[next].dataset.tab);
    tabs[next].focus();
  } else if (event.key === "/" && !isEditing) {
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
  const saved = localStorage.getItem("lang");
  setLanguage(SUPPORTED_LANGS.has(saved) ? saved : DEFAULT_LANG);
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

function copyCommand(command) {
  copyText(command).then(() => {
    showToast(window.LANG?.[getCurrentLang()]?.copy_done || "Copied to clipboard.");
  }).catch(() => window.prompt("Copy command", command));
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
    name.textContent = item.term || "";

    if (item.aliases?.length) {
      const aliases = document.createElement("span");
      aliases.className = "term-aliases";
      aliases.textContent = item.aliases.join(" · ");
      name.appendChild(aliases);
    }
    name.appendChild(makeShareButton(row.id, item.term));

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

window.addEventListener("load", loadTermGuide);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error => console.warn("service worker registration failed:", error));
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


