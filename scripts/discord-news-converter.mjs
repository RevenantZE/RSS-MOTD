const DISCORD_MENTION_AT_START = /^(?:(?:<@!?\d+>|<@&\d+>|@everyone\b|@here\b)\s*)+/i;

export function cleanDiscordText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function startsWithDiscordMention(value) {
  return DISCORD_MENTION_AT_START.test(String(value || "").trimStart());
}

function stripMarkdownHeading(value) {
  return String(value || "")
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/\s+#{1,6}\s*$/, "")
    .trim();
}

export function convertDiscordAnnouncement({
  rawContent,
  resolvedContent,
  embedTitle = "",
  embedDescription = ""
}) {
  const rawLines = String(rawContent || "").replace(/\r\n?/g, "\n").split("\n");
  const resolvedLines = String(resolvedContent || "").replace(/\r\n?/g, "\n").split("\n");
  const nonEmptyIndexes = resolvedLines
    .map((line, index) => line.trim() ? index : -1)
    .filter(index => index >= 0);

  let titleIndex = nonEmptyIndexes[0] ?? -1;
  let candidatePosition = 0;
  while (titleIndex >= 0 && startsWithDiscordMention(rawLines[titleIndex])) {
    candidatePosition += 1;
    titleIndex = nonEmptyIndexes[candidatePosition] ?? -1;
  }

  const firstTextLine = nonEmptyIndexes.length ? resolvedLines[nonEmptyIndexes[0]].trim() : "";
  const titleSource = titleIndex >= 0 ? resolvedLines[titleIndex] : embedTitle || embedDescription || "공지";
  const title = (stripMarkdownHeading(titleSource) || "공지").slice(0, 120);
  const bodyLines = titleIndex >= 0
    ? resolvedLines.filter((_line, index) => index !== titleIndex)
    : resolvedLines;
  const content = cleanDiscordText(bodyLines.join("\n"))
    || cleanDiscordText(embedDescription)
    || firstTextLine
    || cleanDiscordText(embedTitle);

  return { title, content };
}
