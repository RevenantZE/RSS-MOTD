import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const faq = JSON.parse(
  await readFile(new URL("../data/faq.json", import.meta.url), "utf8")
);
const commands = JSON.parse(
  await readFile(new URL("../data/commands.json", import.meta.url), "utf8")
);

const commandItems = commands.pages.flatMap(page =>
  page.sections.flatMap(section => section.commands)
);

test("adds the map music command as the sixth quick-start card", () => {
  assert.deepEqual(faq.quickStart[5], {
    type: "command",
    id: "/music <0~100>"
  });

  const music = commandItems.find(item => item.command === "/music <0~100>");
  assert.deepEqual(music?.description, {
    ko: "맵 노래소리 조절",
    en: "Adjust map music volume",
    jp: "マップの音楽音量を調整"
  });
});
