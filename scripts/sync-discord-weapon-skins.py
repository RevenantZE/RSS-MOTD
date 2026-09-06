"""Synchronize weapon preview catalogs from four Discord threads.

Each weapon starts with a name message and has exactly one image or video in
the same message or the following message. Plain text and fenced code blocks
are accepted. Only the first meaningful line is used, and everything after
the first slash is discarded as metadata.
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

DEFAULT_CATALOG = ROOT / "data" / "skins" / "weapon.json"
DEFAULT_STATE = ROOT / "data" / "skins" / "discord-weapon-state.json"
DEFAULT_TYPES = ROOT / "data" / "skins" / "weapon-types.json"
DEFAULT_ASSET_ROOT = ROOT / "assets" / "skins" / "weapon"
THREAD_ENV = {
    "primary": "DISCORD_PRIMARY_WEAPON_SKIN_THREAD_ID",
    "secondary": "DISCORD_SECONDARY_WEAPON_SKIN_THREAD_ID",
    "melee": "DISCORD_MELEE_WEAPON_SKIN_THREAD_ID",
    "throwable": "DISCORD_THROWABLE_WEAPON_SKIN_THREAD_ID",
}
VIDEO_SUFFIXES = {".mp4", ".webm", ".mov", ".m4v"}
SEPARATOR_PATTERN = re.compile(r"[-=_]{3,}")
BASE_WEAPON_PATTERN = re.compile(r"\(([^()]*)\)\s*$")
SOURCE_MESSAGE_PATTERN = re.compile(r"/channels/\d+/\d+/(\d+)(?:[/?#]|$)")
MAX_NEW_PER_THREAD = 20


def meaningful_lines(content: str) -> list[str]:
    match = re.search(r"```\s*(.*?)```", content, re.DOTALL)
    source = match.group(1) if match else content
    lines = [line.strip().strip("`").strip() for line in source.splitlines()]
    lines = [line for line in lines if line and not SEPARATOR_PATTERN.fullmatch(line)]
    if len(lines) > 1 and lines[0].casefold() in {"text", "txt", "ini"}:
        lines.pop(0)
    return lines


def parse_weapon_name(content: str) -> str | None:
    lines = meaningful_lines(content)
    if not lines:
        return None
    first = re.sub(r"^(?:name|skin)\s*:\s*", "", lines[0], flags=re.IGNORECASE)
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


def pair_weapon_messages(
    messages: list[dict[str, Any]], subcategory: str
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    pending: dict[str, Any] | None = None

    for message in sorted(messages, key=lambda item: int(item["id"])):
        name = parse_weapon_name(str(message.get("content") or ""))
        if name:
            if pending:
                warnings.append(
                    f"{subcategory}: name message {pending['name_message_id']} has no following media"
                )
            pending = {
                "subcategory": subcategory,
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
                f"{subcategory}: message {message['id']} has {len(media)} media attachments; expected exactly one"
            )
        pending["media"] = media[0]
        pending["media_message_id"] = str(message["id"])
        pending["media_timestamp"] = str(
            message.get("edited_timestamp") or message.get("timestamp") or ""
        )
        records.append(pending)
        pending = None

    if pending:
        warnings.append(
            f"{subcategory}: name message {pending['name_message_id']} has no following media"
        )
    return records, warnings


def normalize_weapon_code(value: str) -> str:
    return re.sub(r"[-_\s]", "", value.casefold())


def load_weapon_types(path: Path) -> dict[str, str]:
    payload = common.read_json(path, {})
    aliases: dict[str, str] = {}
    for weapon_type, values in (payload.get("types") or {}).items():
        for value in values:
            normalized = normalize_weapon_code(str(value))
            if normalized in aliases and aliases[normalized] != weapon_type:
                raise ValueError(f"duplicate weapon alias {value!r}")
            aliases[normalized] = str(weapon_type)
    if not aliases:
        raise ValueError("weapon type configuration is empty")
    return aliases


def classify_primary(name: str, aliases: dict[str, str]) -> tuple[str, str] | None:
    match = BASE_WEAPON_PATTERN.search(name)
    if not match:
        return None
    code = normalize_weapon_code(match.group(1))
    weapon_type = aliases.get(code)
    return (weapon_type, code) if weapon_type else None


def source_message_id(item: dict[str, Any]) -> str:
    match = SOURCE_MESSAGE_PATTERN.search(str(item.get("sourceUrl") or ""))
    return match.group(1) if match else ""


def next_weapon_id(items: list[dict[str, Any]], subcategory: str) -> tuple[str, str]:
    prefix = f"weapon-{subcategory}-"
    values = [
        int(str(item.get("id") or "").removeprefix(prefix))
        for item in items
        if str(item.get("id") or "").startswith(prefix)
        and str(item.get("id") or "").removeprefix(prefix).isdigit()
    ]
    number = f"{max(values, default=0) + 1:03d}"
    return prefix + number, number


def existing_media_files_exist(
    item: dict[str, Any], asset_root: Path, subcategory: str
) -> bool:
    media = item.get("media") or []
    return bool(media) and all(
        (asset_root / subcategory / Path(str(entry.get("src") or "")).name).exists()
        for entry in media
    )


def attachment_signature(record: dict[str, Any]) -> list[str]:
    return [str(record["media"].get("id") or "")]


def write_media(
    attachment: dict[str, Any], destination_base: Path, relative_base: str
) -> dict[str, Any]:
    data = common.download_attachment(attachment)
    kind = media_kind(attachment)
    if kind == "image":
        destination = destination_base.with_suffix(".webp")
        width, height = common.convert_image(data, destination, 1280)
    else:
        suffix = Path(str(attachment.get("filename") or "")).suffix.casefold()
        if suffix not in VIDEO_SUFFIXES:
            suffix = ".mp4"
        destination = destination_base.with_suffix(suffix)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        width = int(attachment.get("width") or 0)
        height = int(attachment.get("height") or 0)
        if width <= 0 or height <= 0:
            raise RuntimeError(f"video attachment {attachment.get('id')} has no dimensions")
    return {
        "type": kind,
        "role": "preview",
        "src": relative_base + destination.suffix,
        "width": width,
        "height": height,
    }


def validate_new_records(
    records: list[dict[str, Any]],
    existing_by_message: dict[str, dict[str, Any]],
    aliases: dict[str, str],
    guild_id: str,
    thread_ids: dict[str, str],
) -> list[str]:
    problems: list[str] = []
    counts: dict[str, int] = {key: 0 for key in THREAD_ENV}
    for record in records:
        if record["name_message_id"] in existing_by_message:
            continue
        subcategory = record["subcategory"]
        counts[subcategory] += 1
        url = (
            f"https://discord.com/channels/{guild_id}/{thread_ids[subcategory]}/"
            f"{record['name_message_id']}"
        )
        if subcategory == "primary" and not classify_primary(record["name"], aliases):
            problems.append(
                f"primary: {record['name']!r} needs a recognized weapon name in final parentheses ({url})"
            )
    for subcategory, count in counts.items():
        if count > MAX_NEW_PER_THREAD:
            problems.append(
                f"{subcategory}: refusing {count} new records in one run (limit {MAX_NEW_PER_THREAD})"
            )
    return problems


def synchronize(
    records: list[dict[str, Any]],
    catalog: dict[str, Any],
    state: dict[str, Any],
    aliases: dict[str, str],
    guild_id: str,
    thread_ids: dict[str, str],
    asset_root: Path,
) -> tuple[dict[str, Any], dict[str, Any], int, int]:
    items = [dict(item) for item in catalog.get("items", [])]
    by_message = {source_message_id(item): item for item in items if source_message_id(item)}
    state_items = dict(state.get("items") or {})
    catalog_changes = 0
    asset_changes = 0

    problems = validate_new_records(records, by_message, aliases, guild_id, thread_ids)
    if problems:
        raise ValueError("\n".join(problems))

    for record in records:
        message_id = record["name_message_id"]
        subcategory = record["subcategory"]
        item = by_message.get(message_id)
        is_new = item is None
        if is_new:
            item_id, number = next_weapon_id(items, subcategory)
            item = {
                "id": item_id,
                "subcategory": subcategory,
                "order": max(
                    (
                        int(entry.get("order") or 0)
                        for entry in items
                        if entry.get("subcategory") == subcategory
                    ),
                    default=0,
                )
                + 1,
            }
            items.append(item)
            by_message[message_id] = item
        else:
            item_id = str(item["id"])
            number = item_id.rsplit("-", 1)[-1]

        old_item = json.loads(json.dumps(item, ensure_ascii=False))
        previous = state_items.get(message_id) if isinstance(state_items.get(message_id), dict) else {}
        discord_name_changed = bool(previous) and previous.get("name") != record["name"]
        slash_cleanup = "/" in str(item.get("name") or "")
        if is_new or discord_name_changed or slash_cleanup:
            item["name"] = record["name"]

        classification = classify_primary(record["name"], aliases) if subcategory == "primary" else None
        if subcategory == "primary" and (is_new or discord_name_changed) and classification:
            item["weaponType"] = classification[0]
        elif subcategory != "primary":
            item.pop("weaponType", None)
        item["subcategory"] = subcategory
        item["sourceUrl"] = (
            f"https://discord.com/channels/{guild_id}/{thread_ids[subcategory]}/{message_id}"
        )

        signature = attachment_signature(record)
        files_exist = existing_media_files_exist(item, asset_root, subcategory)
        must_download = is_new or not files_exist or (
            bool(previous) and previous.get("attachmentIds") != signature
        )
        if must_download:
            destination_base = asset_root / subcategory / f"{number}-01"
            relative_base = f"assets/skins/weapon/{subcategory}/{number}-01"
            with common.media_failure_context(
                guild_id, thread_ids[subcategory], message_id, record["media_message_id"],
            ):
                item["media"] = [write_media(record["media"], destination_base, relative_base)]
            asset_changes += 1
        elif not item.get("media"):
            raise RuntimeError(f"existing weapon skin {item_id} has no media metadata")

        if item != old_item:
            catalog_changes += 1
        state_items[message_id] = {
            "skinId": item_id,
            "subcategory": subcategory,
            "mediaMessageId": record["media_message_id"],
            "attachmentIds": signature,
            "name": record["name"],
        }

    if catalog_changes or asset_changes:
        catalog["updatedAt"] = common.newest_timestamp(records)
    catalog["version"] = max(int(catalog.get("version") or 0), 5)
    catalog["category"] = "weapon"
    catalog["items"] = items
    new_state = {"version": 1, "threadIds": thread_ids, "items": state_items}
    return catalog, new_state, catalog_changes, asset_changes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--types", type=Path, default=DEFAULT_TYPES)
    parser.add_argument("--asset-root", type=Path, default=DEFAULT_ASSET_ROOT)
    parser.add_argument("--messages-dir", type=Path, help="Use primary.json, secondary.json, melee.json and throwable.json offline")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    token = os.environ.get("DISCORD_BOT_TOKEN", "")
    guild_id = os.environ.get("DISCORD_SKIN_GUILD_ID") or os.environ.get("DISCORD_GUILD_ID", "")
    thread_ids = {subcategory: os.environ.get(env_name, "") for subcategory, env_name in THREAD_ENV.items()}
    missing = [THREAD_ENV[key] for key, value in thread_ids.items() if not value]
    if not guild_id or missing:
        raise SystemExit(
            "DISCORD_SKIN_GUILD_ID (or DISCORD_GUILD_ID) and thread variables are required: "
            + ", ".join(missing)
        )
    if not args.messages_dir and not token:
        raise SystemExit("DISCORD_BOT_TOKEN is required")

    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    for subcategory, thread_id in thread_ids.items():
        if args.messages_dir:
            messages = common.read_json(args.messages_dir / f"{subcategory}.json", [])
        else:
            messages = common.fetch_thread_messages(thread_id, token)
        paired, thread_warnings = pair_weapon_messages(messages, subcategory)
        if not paired:
            thread_warnings.append(f"{subcategory}: no complete weapon skin records found")
        records.extend(paired)
        warnings.extend(thread_warnings)

    for warning in warnings:
        common.print_message_warning(warning, guild_id, thread_ids.get(warning.split(":", 1)[0], ""))
    if warnings:
        raise SystemExit(f"Refusing weapon update: {len(warnings)} malformed record(s)")

    catalog = common.read_json(
        args.catalog, {"version": 5, "category": "weapon", "updatedAt": "", "items": []}
    )
    state = common.read_json(args.state, {"version": 1, "threadIds": thread_ids, "items": {}})
    aliases = load_weapon_types(args.types)
    try:
        catalog, state, catalog_changes, asset_changes = synchronize(
            records, catalog, state, aliases, guild_id, thread_ids, args.asset_root
        )
    except ValueError as error:
        print(f"Weapon sync validation failed:\n{error}", file=sys.stderr)
        raise SystemExit(1) from error
    catalog_written = common.write_if_changed(args.catalog, common.stable_json(catalog))
    state_written = common.write_if_changed(args.state, common.stable_json(state))
    counts = {key: sum(record["subcategory"] == key for record in records) for key in THREAD_ENV}
    print(
        f"Synced weapon skins {counts}; catalogChanges={catalog_changes}, "
        f"assetChanges={asset_changes}, catalogWritten={str(catalog_written).lower()}, "
        f"stateWritten={str(state_written).lower()}"
    )


if __name__ == "__main__":
    main()
