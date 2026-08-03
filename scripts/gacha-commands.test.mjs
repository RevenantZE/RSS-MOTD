import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commands = JSON.parse(
  await readFile(new URL("../data/commands.json", import.meta.url), "utf8")
);

const store = commands.pages
  .find(page => page.id === "server")
  ?.sections.find(section => section.title.en === "Store");

test("adds gacha commands to the store section", () => {
  assert.ok(store);

  const expected = {
    "/gacha": {
      ko: "뽑기 스토어 열기",
      en: "Open the gacha store",
      jp: "ガチャストアを開く"
    },
    "/gachachance": {
      ko: "뽑기 확률 확인",
      en: "Check gacha rates",
      jp: "ガチャ確率を確認"
    }
  };

  Object.entries(expected).forEach(([command, description]) => {
    const matches = store.commands.filter(item => item.command === command);
    assert.equal(matches.length, 1, command);
    assert.deepEqual(matches[0].description, description);
  });
});
