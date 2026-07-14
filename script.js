
import { getChoseong } from "https://cdn.jsdelivr.net/npm/es-hangul@2.4.0/+esm";

// 1. 탭 전환 및 URL 해시 지원
const DEFAULT_LANG = "ko";
const SUPPORTED_LANGS = new Set(["ko", "en", "jp"]);
let commandGuideData = null;
let faqData = null;
let termGuideData = null;
let termSearchQuery = "";
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
  });
  panels.forEach(p => p.classList.toggle("active", p.id === name));
  if (pushHash) location.hash = name;
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => openTab(tab.dataset.tab));
});

const validTabs = [...tabs].map(tab => tab.dataset.tab);

window.addEventListener("load", () => {
  const hash = (location.hash || "").replace("#", "");
  if (validTabs.includes(hash)) openTab(hash, false);
  else openTab("faq", false); // 기본은 FAQ
});


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
  guide.replaceChildren(...commandGuideData.pages.map(createCommandPage));
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
}

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
    renderFaq();
  } catch (err) {
    console.error("FAQ load failed:", err);
    faqData = FAQ_FALLBACK;
    renderFaq();
    faqList.title = `faq.json load failed: ${err.message}`;
  }
}

function renderFaq() {
  const faqList = document.getElementById("faqList");
  if (!faqList || !faqData) return;

  faqList.replaceChildren(...faqData.items.map(createFaqItem));
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
        button.textContent = window.LANG?.[getCurrentLang()]?.copy || "Copy";
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
    renderCommandGuide();
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

  page.sections.forEach(section => {
    const sectionEl = document.createElement("section");
    sectionEl.className = "command-section";

    const heading = document.createElement("h4");
    heading.textContent = localizeText(section.title);
    sectionEl.appendChild(heading);

    const list = document.createElement("div");
    list.className = "command-list";

    section.commands.forEach(item => {
      const row = document.createElement("div");
      row.className = "command-row";

      const command = document.createElement("code");
      command.className = "cmd command-name";
      command.textContent = item.command;

      const desc = document.createElement("div");
      desc.className = "command-desc";
      desc.textContent = localizeText(item.description);

      row.append(command, desc);
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

  return pageEl;
}

window.addEventListener("load", loadCommandGuide);

// 5. Glossary from JSON
async function loadTermGuide() {
  const guide = document.getElementById("termGuide");
  if (!guide) return;

  try {
    termGuideData = await fetchJsonWithFallback("terms.json");
    renderTermGuide();
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

  const query = termSearchQuery.trim().toLocaleLowerCase(lang);
  const sections = (locale.sections || []).map(section => ({
    ...section,
    terms: (section.terms || []).filter(item => {
      if (!query) return true;
      const names = [item.term, ...(item.aliases || [])].join(" ").toLocaleLowerCase(lang);
      const searchable = [names, item.description].join(" ").toLocaleLowerCase(lang);
      const choseongQuery = query.replace(/\s+/g, "");
      const isChoseongQuery = choseongQuery.length > 0 && /^[ㄱ-ㅎ]+$/.test(choseongQuery);
      return searchable.includes(query) || (isChoseongQuery && getChoseong(names).replace(/\s+/g, "").includes(choseongQuery));
    })
  })).filter(section => section.terms.length > 0);

  if (sections.length === 0) {
    const message = document.createElement("p");
    message.className = "term-empty";
    message.textContent = window.LANG?.[lang]?.term_empty || "No matching terms";
    guide.replaceChildren(message);
    return;
  }

  const fragment = document.createDocumentFragment();
  sections.forEach(section => fragment.appendChild(createTermSection(section)));

  if (!query && locale.notice) {
    const notice = document.createElement("p");
    notice.className = "term-notice";
    notice.textContent = locale.notice;
    fragment.appendChild(notice);
  }

  guide.replaceChildren(fragment);
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

    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = item.term || "";

    if (item.aliases?.length) {
      const aliases = document.createElement("span");
      aliases.className = "term-aliases";
      aliases.textContent = item.aliases.join(" · ");
      name.appendChild(aliases);
    }

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

document.getElementById("termSearch")?.addEventListener("input", event => {
  termSearchQuery = event.target.value || "";
  renderTermGuide();
});

window.addEventListener("load", loadTermGuide);
// 5. 클립보드 명령어 복사 기능
function copyCode(button) {
  const code = button.closest(".code-container")?.querySelector("pre code") || document.getElementById("bindCommands");
  const codeText = code?.innerText || "";
  const originalText = button.textContent;

  navigator.clipboard.writeText(codeText).then(() => {
    button.textContent = window.LANG?.[getCurrentLang()]?.copy_done || "Copied!";
    button.classList.add("copied");

    setTimeout(() => {
      button.textContent = originalText || window.LANG?.[getCurrentLang()]?.copy || "Copy";
      button.classList.remove("copied");
    }, 2000);
  }).catch(err => {
    console.error("copy failed:", err);
    alert("Copy failed. Please copy manually.");
  });
}


