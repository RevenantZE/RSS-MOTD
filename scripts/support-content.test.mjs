import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const supportPath = fileURLToPath(new URL("../data/support.json", import.meta.url));
const support = JSON.parse(await readFile(supportPath, "utf8"));

test("uses the configured KakaoTalk and Ko-fi support links", () => {
  const methods = Object.fromEntries(support.methods.map(method => [method.id, method]));
  assert.equal(methods.kakao.url, "https://open.kakao.com/o/sMXYCBBh");
  assert.equal(methods.kofi.url, "https://ko-fi.com/rssze");
});

test("shows Kakao only in Korean and Ko-fi only in English and Japanese", () => {
  const methods = Object.fromEntries(support.methods.map(method => [method.id, method]));
  assert.deepEqual(methods.kakao.languages, ["ko"]);
  assert.deepEqual(methods.kofi.languages, ["en", "jp"]);
});

test("explains direct KakaoPay transfer and the mobile-only restriction", () => {
  const kakao = support.methods.find(method => method.id === "kakao");
  assert.match(kakao.description.ko, /카카오톡 오픈채팅방/);
  assert.match(kakao.description.ko, /카카오페이로 직접 송금/);
  assert.match(kakao.description.ko, /웹 카드 결제는 제공하지 않습니다/);
  assert.match(kakao.notice.ko, /모바일에서만/);
});

test("keeps all configured VIP benefits in the correct groups", () => {
  const groups = Object.fromEntries(support.benefitGroups.map(group => [group.id, group]));
  assert.deepEqual(
    groups.included.items.map(item => item.id),
    ["model_color", "rainbow", "tracer", "chat_tag", "emote", "custom_radio"]
  );
  assert.deepEqual(
    groups.exclusive.items.map(item => item.id),
    ["reserved_slot", "spectator_kick", "skin_shuffle"]
  );
  assert.match(groups.exclusive.items.find(item => item.id === "reserved_slot").description.ko, /63\/64/);
  assert.match(groups.exclusive.items.find(item => item.id === "skin_shuffle").description.ko, /최대 5개/);
});
