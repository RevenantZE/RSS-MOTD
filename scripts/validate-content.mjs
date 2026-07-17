import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONTENT_DIR = path.join(ROOT, "data");
const CONTENT_FILES = ["faq.json", "commands.json", "terms.json", "news.json", "skins.json"];
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

const skins = content["skins.json"];
check(skins.version === 3, "skins.json.version must be 3.");
check(Array.isArray(skins.items), "skins.json.items must be an array.");
check(Array.isArray(skins.categories), "skins.json.categories must be an array.");
checkUnique((skins.items || []).map(item => item.id), "Skin ids");
checkUnique(
  (skins.items || []).map(item => [item.category, item.subcategory || "", item.order].join(":")),
  "Skin category order values"
);
const skinCategories = new Set(["human", "zombie", "weapon"]);
const weaponCategories = new Set(["primary", "secondary", "melee", "throwable"]);
const primaryWeaponTypes = new Set(["smg", "rifle", "shotgun", "machinegun", "sniper", "other"]);
for (const [index, item] of (skins.items || []).entries()) {
  const label = "skins.json.items[" + index + "]";
  check(isText(item.name), label + ".name is required.");
  check(skinCategories.has(item.category), label + ".category is unsupported: " + item.category);
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
(skins.categories || []).forEach((category, categoryIndex) => {
  const label = "skins.json.categories[" + categoryIndex + "]";
  check(skinCategories.has(category.id), label + ".id is unsupported: " + category.id);
  check(category.count === (skins.items || []).filter(item => item.category === category.id).length, label + ".count does not match its items.");
  if (category.id === "weapon") {
    check(Array.isArray(category.subcategories), label + ".subcategories must be an array.");
    (category.subcategories || []).forEach(subcategory => {
      check(weaponCategories.has(subcategory.id), label + " has unsupported weapon category: " + subcategory.id);
      check(
        subcategory.count === (skins.items || []).filter(item => item.subcategory === subcategory.id).length,
        label + " count does not match weapon category: " + subcategory.id
      );
      if (subcategory.id === "primary") {
        check(Array.isArray(subcategory.types), label + " primary.types must be an array.");
        (subcategory.types || []).forEach(type => {
          check(primaryWeaponTypes.has(type.id), label + " has unsupported primary weapon type: " + type.id);
          check(
            type.count === (skins.items || []).filter(item => item.weaponType === type.id).length,
            label + " count does not match primary weapon type: " + type.id
          );
        });
      }
    });
  }
});

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

console.log("Validated " + CONTENT_FILES.length + " JSON files, " + commandItems.length + " commands, "
  + (news.items || []).length + " news items, and " + (skins.items || []).length + " skins.");
console.log("Skin preview assets: " + (skinBytes / 1024 / 1024).toFixed(1) + " MiB.");
