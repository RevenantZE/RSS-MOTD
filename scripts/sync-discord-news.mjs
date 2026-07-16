import { writeFile } from "node:fs/promises";
import process from "node:process";

const token = process.env.DISCORD_BOT_TOKEN;
const channelId = process.env.DISCORD_NEWS_CHANNEL_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const limit = Math.min(Math.max(Number(process.env.DISCORD_NEWS_LIMIT || 20), 1), 50);

if (!token || !channelId || !guildId) {
  throw new Error("DISCORD_BOT_TOKEN, DISCORD_NEWS_CHANNEL_ID and DISCORD_GUILD_ID are required.");
}

const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, {
  headers: {
    Authorization: `Bot ${token}`,
    "User-Agent": "RSS-MOTD-News-Sync/1.0"
  }
});

if (!response.ok) {
  throw new Error(`Discord API request failed: ${response.status} ${await response.text()}`);
}

const messages = await response.json();
const items = messages
  .filter(message => [0, 19].includes(message.type) && (message.content?.trim() || message.embeds?.length))
  .map(message => {
    const lines = String(message.content || "").split(/\r?\n/).map(line => line.trimEnd());
    const firstTextLine = lines.find(line => line.trim()) || "";
    const embed = message.embeds?.[0] || {};
    const title = (firstTextLine || embed.title || "공지")
      .replace(/^#{1,6}\s*/, "")
      .slice(0, 120);
    const firstLineIndex = lines.indexOf(firstTextLine);
    const remaining = firstLineIndex >= 0 ? lines.slice(firstLineIndex + 1).join("\n").trim() : "";
    const content = remaining || embed.description || firstTextLine || embed.title || "";

    const attachments = (message.attachments || []).map(attachment => ({
      filename: attachment.filename,
      url: attachment.url,
      contentType: attachment.content_type || ""
    }));
    if (embed.image?.url) {
      attachments.push({ filename: embed.title || "embed-image", url: embed.image.url, contentType: "image/unknown" });
    }

    return {
      id: message.id,
      title,
      content,
      publishedAt: message.timestamp,
      editedAt: message.edited_timestamp || null,
      author: message.author?.global_name || message.author?.username || "Discord",
      url: `https://discord.com/channels/${guildId}/${channelId}/${message.id}`,
      attachments
    };
  })
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

const updatedAt = items.reduce((latest, item) => {
  const candidate = item.editedAt || item.publishedAt;
  if (!candidate) return latest;
  return !latest || new Date(candidate) > new Date(latest) ? candidate : latest;
}, null);

const output = {
  version: 1,
  updatedAt,
  source: "discord",
  channelId,
  items
};

await writeFile(new URL("../news.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Synced ${items.length} Discord announcements.`);
