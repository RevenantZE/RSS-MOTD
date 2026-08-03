import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commands = JSON.parse(
  await readFile(new URL("../data/commands.json", import.meta.url), "utf8")
);

const utility = commands.pages
  .find(page => page.id === "basic")
  ?.sections.find(section => section.title.en === "Utility");

test("adds self gag commands to the utility section", () => {
  assert.ok(utility);

  const expected = {
    "/selfgag": {
      ko: "대상자 채팅 차단",
      en: "Mute the target player's chat",
      jp: "対象プレイヤーのチャットをミュート"
    },
    "/selfungag": {
      ko: "대상자 채팅 차단 해제",
      en: "Unmute the target player's chat",
      jp: "対象プレイヤーのチャットミュートを解除"
    }
  };

  Object.entries(expected).forEach(([command, description]) => {
    const matches = utility.commands.filter(item => item.command === command);
    assert.equal(matches.length, 1, command);
    assert.deepEqual(matches[0].description, description);
  });
});
