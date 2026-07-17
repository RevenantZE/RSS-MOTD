import assert from "node:assert/strict";
import test from "node:test";

import { cleanDiscordText, convertDiscordAnnouncement } from "./discord-news-converter.mjs";

test("uses the first non-mention line as the title", () => {
  const result = convertDiscordAnnouncement({
    rawContent: "<@&123>\n# 패치노트\n서버가 업데이트되었습니다.",
    resolvedContent: "@RSS Player\n# 패치노트\n서버가 업데이트되었습니다."
  });
  assert.deepEqual(result, {
    title: "패치노트",
    content: "@RSS Player\n서버가 업데이트되었습니다."
  });
});

test("skips consecutive leading mention lines", () => {
  const result = convertDiscordAnnouncement({
    rawContent: "<@&123>\n<@456>\n공지 제목\n공지 본문",
    resolvedContent: "@RSS Player\n@관리자\n공지 제목\n공지 본문"
  });
  assert.equal(result.title, "공지 제목");
  assert.equal(result.content, "@RSS Player\n@관리자\n공지 본문");
});

test("removes Discord heading markers from titles", () => {
  const result = convertDiscordAnnouncement({
    rawContent: "## 점검 안내 ##\n03:00부터 점검합니다.",
    resolvedContent: "## 점검 안내 ##\n03:00부터 점검합니다."
  });
  assert.equal(result.title, "점검 안내");
});

test("falls back to embed content for empty messages", () => {
  const result = convertDiscordAnnouncement({
    rawContent: "",
    resolvedContent: "",
    embedTitle: "이벤트 안내",
    embedDescription: "이벤트가 시작되었습니다."
  });
  assert.deepEqual(result, {
    title: "이벤트 안내",
    content: "이벤트가 시작되었습니다."
  });
});

test("preserves meaningful Markdown indentation", () => {
  assert.equal(
    cleanDiscordText("제목  \n> 인용\n  들여쓰기\n\n\n\n끝"),
    "제목\n> 인용\n  들여쓰기\n\n끝"
  );
});
