import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONTENT_DIR = path.join(ROOT, "data");
const SKIN_CATALOG_FILES = {
  human: "skins/human.json",
  zombie: "skins/zombie.json",
  weapon: "skins/weapon.json"
};
const CONTENT_FILES = [
  "faq.json",
  "rules.json",
  "commands.json",
  "terms.json",
  "news.json",
  "support.json",
  ...Object.values(SKIN_CATALOG_FILES)
];
const failures = [];
const pendingFileChecks = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function checkUnique(values, label) {
  const seen = new Set();
  values.forEach(value => {
    check(isText(String(value ?? "")), label + " contains an empty value.");
    check(!seen.has(value), label + " contains a duplicate: " + value);
    seen.add(value);
  });
}

function checkLocalized(value, label) {
  check(value && typeof value === "object" && !Array.isArray(value), label + " must be a language object.");
  if (!value || typeof value !== "object") return;
  ["ko", "en", "jp"].forEach(lang => check(isText(value[lang]), label + "." + lang + " is required."));
}

function checkDate(value, label) {
  check(isText(value) && !Number.isNaN(Date.parse(value)), label + " must be a valid date.");
}

function checkUrl(value, label, optional = false) {
  if (optional && !value) return;
  try {
    const url = new URL(value);
    check(["http:", "https:"].includes(url.protocol), label + " must use http or https.");
  } catch (_error) {
    check(false, label + " must be a valid URL.");
  }
}

async function checkLocalFile(relativePath, label) {
  check(isText(relativePath), label + " path is required.");
  if (!isText(relativePath)) return;
  const absolutePath = path.resolve(ROOT, relativePath);
  check(absolutePath === ROOT || absolutePath.startsWith(ROOT + path.sep), label + " escapes the repository.");
  try {
    await access(absolutePath);
  } catch (_error) {
    check(false, label + " does not exist: " + relativePath);
  }
}

const content = {};
for (const filename of CONTENT_FILES) {
  try {
    content[filename] = JSON.parse(await readFile(path.join(CONTENT_DIR, filename), "utf8"));
  } catch (error) {
    failures.push(filename + " is not valid JSON: " + error.message);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

for (const [filename, data] of Object.entries(content)) {
  check(Number.isInteger(data.version) && data.version > 0, filename + ".version must be a positive integer.");
  checkDate(data.updatedAt, filename + ".updatedAt");
}

const langSource = await readFile(path.join(ROOT, "assets", "js", "lang.js"), "utf8");
const langContext = { window: {} };
vm.runInNewContext(langSource, langContext, { filename: "lang.js" });
const languages = langContext.window.LANG;
check(languages && typeof languages === "object", "lang.js must expose window.LANG.");
const languageKeys = Object.keys(languages?.ko || {});
["en", "jp"].forEach(lang => {
  languageKeys.forEach(key => check(key in (languages?.[lang] || {}), "lang.js " + lang + " is missing key: " + key));
  Object.keys(languages?.[lang] || {}).forEach(key => check(key in (languages?.ko || {}), "lang.js " + lang + " has an extra key: " + key));
});

const indexSource = await readFile(path.join(ROOT, "index.html"), "utf8");
const staticLangKeys = [...indexSource.matchAll(/data-lang(?:-(?:placeholder|aria))?="([^"]+)"/g)]
  .map(match => match[1])
  .filter(key => !["ko", "en", "jp"].includes(key));
staticLangKeys.forEach(key => {
  ["ko", "en", "jp"].forEach(lang => check(key in (languages?.[lang] || {}), "index.html key " + key + " is missing from lang.js " + lang + "."));
});

const faq = content["faq.json"];
check(Array.isArray(faq.items), "faq.json.items must be an array.");
const faqIds = (faq.items || []).map(item => item.id);
checkUnique(faqIds, "FAQ ids");
const faqIdSet = new Set(faqIds);
const allowedFaqBlocks = new Set(["text", "inlineCode", "code", "link", "image", "break", "spacer"]);
function checkLangKey(value, label) {
  if (!value || typeof value !== "object" || !value.langKey) return;
  ["ko", "en", "jp"].forEach(lang => check(value.langKey in (languages?.[lang] || {}), label + " references missing " + lang + " key: " + value.langKey));
}
(faq.items || []).forEach((item, itemIndex) => {
  const label = "faq.json.items[" + itemIndex + "]";
  check(isText(item.id), label + ".id is required.");
  check(typeof item.question === "string" || (item.question && typeof item.question === "object"), label + ".question is required.");
  checkLangKey(item.question, label + ".question");
  check(Array.isArray(item.body) && item.body.length > 0, label + ".body must not be empty.");
  (item.body || []).forEach((block, blockIndex) => {
    const blockLabel = label + ".body[" + blockIndex + "]";
    check(allowedFaqBlocks.has(block.type), blockLabel + " has unsupported type: " + block.type);
    checkLangKey(block.text, blockLabel + ".text");
    if (block.type === "link") checkUrl(block.href, blockLabel + ".href");
    if (block.type === "image") {
      pendingFileChecks.push(checkLocalFile(block.src, blockLabel + ".src"));
      checkLangKey(block.alt, blockLabel + ".alt");
    }
  });
});

const rules = content["rules.json"];
check(rules.locales && typeof rules.locales === "object", "rules.json.locales is required.");
const ruleSignatures = {};
let ruleCount = 0;
["ko", "en", "jp"].forEach(lang => {
  const locale = rules.locales?.[lang];
  const localeLabel = "rules.json.locales." + lang;
  check(locale && typeof locale === "object", localeLabel + " is required.");
  if (!locale) return;
  check(isText(locale.title), localeLabel + ".title is required.");
  check(isText(locale.warning), localeLabel + ".warning is required.");
  check(Array.isArray(locale.sections) && locale.sections.length > 0, localeLabel + ".sections must not be empty.");
  checkUnique((locale.sections || []).map(section => section.id), "Rule section ids for " + lang);
  const itemIds = [];
  (locale.sections || []).forEach((section, sectionIndex) => {
    const sectionLabel = localeLabel + ".sections[" + sectionIndex + "]";
    check(isText(section.id), sectionLabel + ".id is required.");
    check(isText(section.title), sectionLabel + ".title is required.");
    check(typeof section.numbered === "boolean", sectionLabel + ".numbered must be a boolean.");
    check(Array.isArray(section.items) && section.items.length > 0, sectionLabel + ".items must not be empty.");
    (section.items || []).forEach((item, itemIndex) => {
      const itemLabel = sectionLabel + ".items[" + itemIndex + "]";
      check(isText(item.id), itemLabel + ".id is required.");
      check(isText(item.title), itemLabel + ".title is required.");
      if (item.description != null) check(isText(item.description), itemLabel + ".description must not be empty.");
      itemIds.push(item.id);
    });
    if (section.note != null) check(isText(section.note), sectionLabel + ".note must not be empty.");
  });
  checkUnique(itemIds, "Rule item ids for " + lang);
  check(isText(locale.footer?.title), localeLabel + ".footer.title is required.");
  check(isText(locale.footer?.body), localeLabel + ".footer.body is required.");
  ruleSignatures[lang] = JSON.stringify(
    (locale.sections || []).map(section => ({
      id: section.id,
      items: (section.items || []).map(item => item.id)
    }))
  );
  if (lang === "ko") ruleCount = itemIds.length;
});
["en", "jp"].forEach(lang => {
  check(ruleSignatures[lang] === ruleSignatures.ko, "rules.json " + lang + " must use the same section and item ids as ko.");
});

const commands = content["commands.json"];
check(Array.isArray(commands.pages), "commands.json.pages must be an array.");
checkUnique((commands.pages || []).map(page => page.id), "Command page ids");
const commandItems = (commands.pages || []).flatMap((page, pageIndex) => {
  checkLocalized(page.title, "commands.json.pages[" + pageIndex + "].title");
  check(Array.isArray(page.sections), "commands.json.pages[" + pageIndex + "].sections must be an array.");
  return (page.sections || []).flatMap((section, sectionIndex) => {
    checkLocalized(section.title, "commands.json.pages[" + pageIndex + "].sections[" + sectionIndex + "].title");
    check(Array.isArray(section.commands), "Command section commands must be an array.");
    return section.commands || [];
  });
});
checkUnique(commandItems.map(item => item.command), "Commands");
commandItems.forEach((item, index) => {
  check(isText(item.command) && /^[!/]/.test(item.command), "commands.json command " + index + " must start with ! or /.");
  checkLocalized(item.description, "commands.json command " + item.command + " description");
});
const commandSet = new Set(commandItems.map(item => item.command));

function checkReference(reference, label) {
  check(reference && ["faq", "command"].includes(reference.type), label + " has an unsupported type.");
  if (!reference) return;
  if (reference.type === "faq") check(faqIdSet.has(reference.id), label + " references unknown FAQ: " + reference.id);
  if (reference.type === "command") check(commandSet.has(reference.id), label + " references unknown command: " + reference.id);
}
(faq.quickStart || []).forEach((reference, index) => checkReference(reference, "faq.json.quickStart[" + index + "]"));
(faq.items || []).forEach((item, itemIndex) => (item.related || []).forEach((reference, index) => {
  checkReference(reference, "faq.json.items[" + itemIndex + "].related[" + index + "]");
}));

const terms = content["terms.json"];
check(terms.locales && typeof terms.locales === "object", "terms.json.locales is required.");
Object.entries(terms.locales || {}).forEach(([lang, locale]) => {
  check(["ko", "en", "jp"].includes(lang), "terms.json has unsupported locale: " + lang);
  check(isText(locale.title), "terms.json " + lang + " title is required.");
  check(Array.isArray(locale.sections), "terms.json " + lang + " sections must be an array.");
  checkUnique((locale.sections || []).map(section => section.id), "Term section ids for " + lang);
  const localeTerms = (locale.sections || []).flatMap(section => section.terms || []);
  checkUnique(localeTerms.map(item => item.term), "Terms for " + lang);
  localeTerms.forEach((item, index) => {
    check(isText(item.description), "terms.json " + lang + " term " + index + " description is required.");
    if (item.aliases != null) check(Array.isArray(item.aliases), "terms.json " + lang + " aliases must be an array.");
  });
});

const news = content["news.json"];
check(Array.isArray(news.items), "news.json.items must be an array.");
checkUnique((news.items || []).map(item => item.id), "News ids");
(news.items || []).forEach((item, index) => {
  const label = "news.json.items[" + index + "]";
  check(isText(item.title), label + ".title is required.");
  check(!/^(?:<@|@(?:everyone|here)\b)/i.test(item.title || ""), label + ".title must not start with a Discord mention.");
  check(isText(item.content), label + ".content is required.");
  checkDate(item.publishedAt, label + ".publishedAt");
  checkUrl(item.url, label + ".url");
  (item.attachments || []).forEach((attachment, attachmentIndex) => checkUrl(attachment.url, label + ".attachments[" + attachmentIndex + "].url"));
});

const support = content["support.json"];
check(Array.isArray(support.methods) && support.methods.length > 0, "support.json.methods must not be empty.");
checkUnique((support.methods || []).map(method => method.id), "Support method ids");
(support.methods || []).forEach((method, index) => {
  const label = "support.json.methods[" + index + "]";
  check(Array.isArray(method.languages) && method.languages.length > 0, label + ".languages must not be empty.");
  checkUnique(method.languages || [], label + ".languages");
  (method.languages || []).forEach(lang => check(["ko", "en", "jp"].includes(lang), label + " has unsupported language: " + lang));
  checkLocalized(method.audience, label + ".audience");
  checkLocalized(method.title, label + ".title");
  checkLocalized(method.description, label + ".description");
  checkLocalized(method.notice, label + ".notice");
  checkUrl(method.url, label + ".url");
});
check((support.methods || []).find(method => method.id === "kakao")?.url === "https://open.kakao.com/o/sMXYCBBh",
  "support.json kakao method must use the configured KakaoTalk URL.");
check((support.methods || []).find(method => method.id === "kofi")?.url === "https://ko-fi.com/rssze",
  "support.json kofi method must use the configured Ko-fi URL.");
const kakaoMethod = (support.methods || []).find(method => method.id === "kakao");
const kofiMethod = (support.methods || []).find(method => method.id === "kofi");
check(JSON.stringify(kakaoMethod?.languages) === JSON.stringify(["ko"]),
  "support.json Kakao method must be visible only in Korean.");
check(JSON.stringify(kofiMethod?.languages) === JSON.stringify(["en", "jp"]),
  "support.json Ko-fi method must be visible only in English and Japanese.");
check(/카카오페이/.test(kakaoMethod?.description?.ko || ""), "support.json Kakao description must explain direct KakaoPay transfer.");
check(/모바일/.test(kakaoMethod?.notice?.ko || ""), "support.json Kakao notice must state that transfer is mobile-only.");

check(Array.isArray(support.benefitGroups) && support.benefitGroups.length > 0,
  "support.json.benefitGroups must not be empty.");
checkUnique((support.benefitGroups || []).map(group => group.id), "Support benefit group ids");
const supportBenefitItems = (support.benefitGroups || []).flatMap((group, groupIndex) => {
  const label = "support.json.benefitGroups[" + groupIndex + "]";
  checkLocalized(group.title, label + ".title");
  checkLocalized(group.description, label + ".description");
  check(Array.isArray(group.items) && group.items.length > 0, label + ".items must not be empty.");
  return (group.items || []).map((item, itemIndex) => {
    check(isText(item.id), label + ".items[" + itemIndex + "].id is required.");
    checkLocalized(item.title, label + ".items[" + itemIndex + "].title");
    if (item.description != null) checkLocalized(item.description, label + ".items[" + itemIndex + "].description");
    return item;
  });
});
checkUnique(supportBenefitItems.map(item => item.id), "Support benefit ids");
const includedBenefitIds = new Set(["model_color", "rainbow", "tracer", "chat_tag", "emote", "custom_radio"]);
const exclusiveBenefitIds = new Set(["reserved_slot", "spectator_kick", "skin_shuffle"]);
const includedGroup = (support.benefitGroups || []).find(group => group.id === "included");
const exclusiveGroup = (support.benefitGroups || []).find(group => group.id === "exclusive");
check((includedGroup?.items || []).length === includedBenefitIds.size
  && (includedGroup?.items || []).every(item => includedBenefitIds.has(item.id)),
"support.json included group must contain all six configured VIP features.");
check((exclusiveGroup?.items || []).length === exclusiveBenefitIds.size
  && (exclusiveGroup?.items || []).every(item => exclusiveBenefitIds.has(item.id)),
"support.json exclusive group must contain reserved slot, spectator kick, and skin shuffle.");

const skinCatalogs = Object.entries(SKIN_CATALOG_FILES).map(([category, filename]) => {
  const catalog = content[filename];
  check(catalog.version === 5, filename + ".version must be 5.");
  check(catalog.category === category, filename + ".category must be " + category + ".");
  check(Array.isArray(catalog.items), filename + ".items must be an array.");
  (catalog.items || []).forEach((item, index) => {
    check(item.category == null, filename + ".items[" + index + "].category must be omitted.");
  });
  return {
    category,
    filename,
    items: (catalog.items || []).map(item => ({ ...item, category }))
  };
});
const skinItems = skinCatalogs.flatMap(catalog => catalog.items);
checkUnique(skinItems.map(item => item.id), "Skin ids");
checkUnique(
  skinItems.map(item => [item.category, item.subcategory || "", item.order].join(":")),
  "Skin category order values"
);
const skinCategories = new Set(["human", "zombie", "weapon"]);
const weaponCategories = new Set(["primary", "secondary", "melee", "throwable"]);
const primaryWeaponTypes = new Set(["smg", "rifle", "shotgun", "machinegun", "sniper", "other"]);
for (const [index, item] of skinItems.entries()) {
  const label = "skin items[" + index + "]";
  check(isText(item.name), label + ".name is required.");
  check(skinCategories.has(item.category), label + ".category is unsupported: " + item.category);
  ["nameKo", "sourceUrl"].forEach(field => {
    if (item[field] != null) check(isText(item[field]), label + "." + field + " must be omitted when empty.");
  });
  if (item.category === "weapon") {
    check(weaponCategories.has(item.subcategory), label + ".subcategory is unsupported: " + item.subcategory);
    if (item.subcategory === "primary") {
      check(primaryWeaponTypes.has(item.weaponType), label + ".weaponType is unsupported: " + item.weaponType);
    } else {
      check(item.weaponType == null, label + ".weaponType must be null outside primary weapons.");
    }
  } else {
    check(item.subcategory == null, label + ".subcategory must be null for character skins.");
    check(item.weaponType == null, label + ".weaponType must be absent for character skins.");
  }
  checkUrl(item.sourceUrl, label + ".sourceUrl", true);
  check(Array.isArray(item.media) && item.media.length > 0, label + ".media must not be empty.");
  for (const [mediaIndex, media] of (item.media || []).entries()) {
    const mediaLabel = label + ".media[" + mediaIndex + "]";
    check(["image", "video"].includes(media.type), mediaLabel + ".type is unsupported: " + media.type);
    check(["thirdPerson", "firstPerson", "preview"].includes(media.role), mediaLabel + ".role is unsupported: " + media.role);
    await checkLocalFile(media.src, mediaLabel + ".src");
    check(String(media.src || "").startsWith("assets/skins/"), mediaLabel + ".src must be under assets/skins/. ");
    check(Number(media.width) > 0 && Number(media.height) > 0, mediaLabel + " dimensions must be positive.");
    if (isText(media.src)) {
      try {
        const mediaStat = await stat(path.resolve(ROOT, media.src));
        check(mediaStat.size < 100 * 1024 * 1024, mediaLabel + " exceeds GitHub's 100 MiB file limit.");
      } catch (_error) {
        // checkLocalFile reports the missing path above.
      }
    }
  }
}
async function directorySize(relativeDirectory) {
  const directory = path.join(ROOT, relativeDirectory);
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    total += entry.isDirectory() ? await directorySize(path.relative(ROOT, entryPath)) : (await stat(entryPath)).size;
  }
  return total;
}

const skinBytes = await directorySize("assets/skins");
await Promise.all(pendingFileChecks);
if (failures.length) {
  console.error("Content validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Validated " + CONTENT_FILES.length + " JSON files, " + ruleCount + " rules, "
  + commandItems.length + " commands, " + (news.items || []).length + " news items, and "
  + skinItems.length + " skins.");
console.log("Skin preview assets: " + (skinBytes / 1024 / 1024).toFixed(1) + " MiB.");
