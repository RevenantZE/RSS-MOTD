"""Synchronize spray previews from one Discord thread.

Each spray starts with a name message and has exactly one image, animated GIF,
or video in the same message or the following message. Plain text and fenced
code blocks are accepted. The first meaningful line is used as the name, and
everything after the first slash is treated as metadata.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COMMON_SCRIPT = Path(__file__).with_name("sync-discord-human-skins.py")
COMMON_SPEC = importlib.util.spec_from_file_location("discord_character_sync", COMMON_SCRIPT)
assert COMMON_SPEC and COMMON_SPEC.loader
common = importlib.util.module_from_spec(COMMON_SPEC)
COMMON_SPEC.loader.exec_module(common)

DEFAULT_CATALOG = ROOT / "data" / "skins" / "spray.json"
DEFAULT_STATE = ROOT / "data" / "skins" / "discord-spray-state.json"
DEFAULT_ASSET_DIR = ROOT / "assets" / "skins" / "spray"
THREAD_ENV = "DISCORD_SPRAY_THREAD_ID"
VIDEO_SUFFIXES = {".mp4", ".webm", ".mov", ".m4v"}
SEPARATOR_PATTERN = re.compile(r"[-=_]{3,}")
SOURCE_MESSAGE_PATTERN = re.compile(r"/channels/\d+/\d+/(\d+)(?:[/?#]|$)")


def meaningful_lines(content: str) -> list[str]:
    match = re.search(r"```\s*(.*?)```", content, re.DOTALL)
    source = match.group(1) if match else content
    lines = [line.strip().strip("`").strip() for line in source.splitlines()]
    lines = [line for line in lines if line and not SEPARATOR_PATTERN.fullmatch(line)]
    if len(lines) > 1 and lines[0].casefold() in {"text", "txt", "ini"}:
        lines.pop(0)
    return lines


def parse_spray_name(content: str) -> str | None:
    lines = meaningful_lines(content)
    if not lines:
        return None
    first = re.sub(r"^(?:name|spray)\s*:\s*", "", lines[0], flags=re.IGNORECASE)
    if re.match(r"^(?:credit|credits|token)\s*:", first, re.IGNORECASE):
        return None
    name = first.split("/", 1)[0].strip()
    return name or None


def is_media(attachment: dict[str, Any]) -> bool:
    content_type = str(attachment.get("content_type") or "").casefold()
    suffix = Path(str(attachment.get("filename") or "")).suffix.casefold()
    return common.is_image(attachment) or content_type.startswith("video/") or suffix in VIDEO_SUFFIXES


def media_kind(attachment: dict[str, Any]) -> str:
    return "image" if common.is_image(attachment) else "video"


def pair_spray_messages(
    messages: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    pending: dict[str, Any] | None = None

    for message in sorted(messages, key=lambda item: int(item["id"])):
        name = parse_spray_name(str(message.get("content") or ""))
        if name:
            if pending:
                warnings.append(
                    f"spray name message {pending['name_message_id']} has no following media"
                )
            pending = {
                "name": name,
                "name_message_id": str(message["id"]),
                "timestamp": str(message.get("timestamp") or ""),
                "edited_timestamp": str(message.get("edited_timestamp") or ""),
            }

        media = [item for item in message.get("attachments", []) if is_media(item)]
        if not media or not pending:
            continue
        if len(media) != 1:
            warnings.append(
                f"spray media message {message['id']} has {len(media)} attachments; expected exactly one"
            )
        pending["media"] = media[0]
        pending["media_message_id"] = str(message["id"])
        pending["image_timestamp"] = str(
            message.get("edited_timestamp") or message.get("timestamp") or ""
        )
        records.append(pending)
        pending = None

    if pending:
        warnings.append(
            f"spray name message {pending['name_message_id']} has no following media"
        )
    return records, warnings


def source_message_id(item: dict[str, Any]) -> str:
    match = SOURCE_MESSAGE_PATTERN.search(str(item.get("sourceUrl") or ""))
    return match.group(1) if match else ""


def next_spray_id(items: list[dict[str, Any]]) -> tuple[str, str]:
    prefix = "spray-"
    values = [
        int(str(item.get("id") or "").removeprefix(prefix))
        for item in items
        if str(item.get("id") or "").startswith(prefix)
        and str(item.get("id") or "").removeprefix(prefix).isdigit()
    ]
    number = f"{max(values, default=0) + 1:03d}"
    return f"{prefix}{number}", number


def attachment_signature(record: dict[str, Any]) -> str:
    return str(record["media"].get("id") or "")


def existing_media_file_exists(item: dict[str, Any]) -> bool:
    media = item.get("media") or []
    return bool(media) and (ROOT / str(media[0].get("src") or "")).exists()


def save_media(
    attachment: dict[str, Any], destination_base: Path, relative_base: str
) -> dict[str, Any]:
    data = common.download_attachment(attachment)
    suffix = Path(str(attachment.get("filename") or "")).suffix.casefold()
    kind = media_kind(attachment)
    if kind == "image" and suffix != ".gif":
        destination = destination_base.with_suffix(".webp")
        width, height = common.convert_image(data, destination, 1280)
        relative = relative_base + ".webp"
    else:
        safe_suffix = suffix if suffix == ".gif" or suffix in VIDEO_SUFFIXES else ".mp4"
        destination = destination_base.with_suffix(safe_suffix)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        width = int(attachment.get("width") or 1920)
        height = int(attachment.get("height") or 1080)
        relative = relative_base + safe_suffix
    return {
        "type": kind,
        "role": "preview",
        "src": relative,
        "width": width,
        "height": height,
    }


def synchronize(
    records: list[dict[str, Any]],
    catalog: dict[str, Any],
    state: dict[str, Any],
    guild_id: str,
    thread_id: str,
    asset_dir: Path,
) -> tuple[dict[str, Any], dict[str, Any], int, int]:
    items = [dict(item) for item in catalog.get("items", [])]
    by_message = {source_message_id(item): item for item in items if source_message_id(item)}
    state_items = dict(state.get("items") or {})
    catalog_changes = 0
    asset_changes = 0

    for record in records:
        message_id = record["name_message_id"]
        item = by_message.get(message_id)
        is_new = item is None
        if is_new:
            item_id, number = next_spray_id(items)
            item = {
                "id": item_id,
                "order": max((int(entry.get("order") or 0) for entry in items), default=0) + 1,
            }
            items.append(item)
            by_message[message_id] = item
        else:
            item_id = str(item["id"])
            number = item_id.removeprefix("spray-")

        old_item = json.loads(json.dumps(item, ensure_ascii=False))
        previous = state_items.get(message_id) if isinstance(state_items.get(message_id), dict) else {}
        discord_name_changed = bool(previous) and previous.get("name") != record["name"]
        if is_new or discord_name_changed:
            item["name"] = record["name"]
        item["sourceUrl"] = f"https://discord.com/channels/{guild_id}/{thread_id}/{message_id}"

        signature = attachment_signature(record)
        must_download = is_new or not existing_media_file_exists(item) or (
            bool(previous) and previous.get("attachmentId") != signature
        )
        if must_download:
            with common.media_failure_context(guild_id, thread_id, message_id, record["media_message_id"]):
                item["media"] = [save_media(
                    record["media"],
                    asset_dir / f"{number}-01",
                    f"assets/skins/spray/{number}-01",
                )]
            asset_changes += 1
        elif not item.get("media"):
            raise RuntimeError(f"existing spray {item_id} has no media metadata")

        if item != old_item:
            catalog_changes += 1
        state_items[message_id] = {
            "sprayId": item_id,
            "mediaMessageId": record["media_message_id"],
            "attachmentId": signature,
            "name": record["name"],
        }

    if catalog_changes or asset_changes:
        catalog["updatedAt"] = common.newest_timestamp(records)
    catalog["version"] = max(int(catalog.get("version") or 0), 5)
    catalog["category"] = "spray"
    catalog["items"] = items
    new_state = {"version": 1, "threadId": thread_id, "items": state_items}
    return catalog, new_state, catalog_changes, asset_changes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--asset-dir", type=Path, default=DEFAULT_ASSET_DIR)
    parser.add_argument("--messages-json", type=Path, help="Use an offline Discord message array")
    parser.add_argument("--allow-warnings", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    token = os.environ.get("DISCORD_BOT_TOKEN", "")
    guild_id = os.environ.get("DISCORD_SKIN_GUILD_ID") or os.environ.get("DISCORD_GUILD_ID", "")
    thread_id = os.environ.get(THREAD_ENV, "")
    if not guild_id or not thread_id:
        raise SystemExit(
            "DISCORD_SKIN_GUILD_ID (or DISCORD_GUILD_ID) and " + THREAD_ENV + " are required"
        )
    if args.messages_json:
        messages = common.read_json(args.messages_json, [])
    else:
        if not token:
            raise SystemExit("DISCORD_BOT_TOKEN is required")
        messages = common.fetch_thread_messages(thread_id, token)

    records, warnings = pair_spray_messages(messages)
    for warning in warnings:
        common.print_message_warning(warning, guild_id, thread_id)
    if warnings and not args.allow_warnings:
        raise SystemExit(f"Refusing spray update: {len(warnings)} malformed record(s)")
    if not records:
        raise SystemExit("No complete spray records were found in the Discord thread")

    catalog = common.read_json(
        args.catalog, {"version": 5, "category": "spray", "updatedAt": "", "items": []}
    )
    state = common.read_json(args.state, {"version": 1, "threadId": thread_id, "items": {}})
    catalog, state, catalog_changes, asset_changes = synchronize(
        records, catalog, state, guild_id, thread_id, args.asset_dir
    )
    catalog_written = common.write_if_changed(args.catalog, common.stable_json(catalog))
    state_written = common.write_if_changed(args.state, common.stable_json(state))
    print(
        f"Synced {len(records)} sprays from thread {thread_id}; "
        f"catalogChanges={catalog_changes}, assetChanges={asset_changes}, "
        f"catalogWritten={str(catalog_written).lower()}, stateWritten={str(state_written).lower()}"
    )


if __name__ == "__main__":
    main()
