"""Synchronize the human skin catalog from one Discord thread.

The thread format matches the original human-skin extractor:

1. A message contains a fenced code block. Its first non-empty line is the
   English name and any remaining non-separator lines form the Korean name.
2. The following image attachments belong to that skin.
3. The most portrait-shaped image is the third-person preview and the most
   landscape-shaped image is the first-person preview.

Existing catalog entries are matched by their Discord source message id. Items
without a Discord source are preserved, and missing Discord messages are never
deleted automatically.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "data" / "skins" / "human.json"
DEFAULT_STATE = ROOT / "data" / "skins" / "discord-human-state.json"
DEFAULT_ASSET_DIR = ROOT / "assets" / "skins"
DISCORD_API = "https://discord.com/api/v10"
MAX_MESSAGES = 2_000
FETCH_ATTEMPTS = 4
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
SOURCE_MESSAGE_PATTERN = re.compile(r"/channels/\d+/\d+/(\d+)(?:[/?#]|$)")


def parse_skin_name(content: str) -> tuple[str, str] | None:
    """Extract English and Korean names from the first fenced code block."""
    match = re.search(r"```\s*(.*?)```", content, re.DOTALL)
    if not match:
        return None
    lines = [line.strip() for line in match.group(1).splitlines() if line.strip()]
    lines = [line for line in lines if not re.fullmatch(r"-+", line)]
    if not lines:
        return None
    return lines[0], " / ".join(lines[1:])


def is_image(attachment: dict[str, Any]) -> bool:
    content_type = str(attachment.get("content_type") or "")
    suffix = Path(str(attachment.get("filename") or "")).suffix.lower()
    return content_type.startswith("image/") or suffix in IMAGE_SUFFIXES


def pair_skin_messages(messages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Pair name messages with the next two or more image attachments."""
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    pending: dict[str, Any] | None = None

    for message in sorted(messages, key=lambda item: int(item["id"])):
        parsed = parse_skin_name(str(message.get("content") or ""))
        if parsed:
            if pending:
                warnings.append(
                    f"name message {pending['name_message_id']} has fewer than two following images"
                )
            pending = {
                "name": parsed[0],
                "nameKo": parsed[1],
                "name_message_id": str(message["id"]),
                "timestamp": str(message.get("timestamp") or ""),
                "edited_timestamp": str(message.get("edited_timestamp") or ""),
                "_images": [],
            }

        images = [item for item in message.get("attachments", []) if is_image(item)]
        if not images or not pending:
            continue

        pending["_images"].extend(images)
        if len(pending["_images"]) < 2:
            continue

        ordered = sorted(
            pending.pop("_images"),
            key=lambda item: float(item.get("width") or 0)
            / max(float(item.get("height") or 1), 1),
        )
        pending["third_person"] = ordered[0]
        pending["first_person"] = ordered[-1]
        pending["image_message_id"] = str(message["id"])
        pending["image_timestamp"] = str(message.get("edited_timestamp") or message.get("timestamp") or "")
        records.append(pending)
        pending = None

    if pending:
        warnings.append(
            f"name message {pending['name_message_id']} has fewer than two following images"
        )
    return records, warnings


def source_message_id(item: dict[str, Any]) -> str:
    match = SOURCE_MESSAGE_PATTERN.search(str(item.get("sourceUrl") or ""))
    return match.group(1) if match else ""


def next_human_id(items: list[dict[str, Any]]) -> str:
    numeric_ids = [
        int(str(item.get("id")))
        for item in items
        if str(item.get("id") or "").isdigit()
    ]
    return f"{max(numeric_ids, default=0) + 1:03d}"


def media_paths(item_id: str) -> tuple[str, str]:
    return (
        f"assets/skins/{item_id}-third.webp",
        f"assets/skins/{item_id}-first.webp",
    )


def attachment_signature(record: dict[str, Any]) -> list[str]:
    return [
        str(record["third_person"].get("id") or ""),
        str(record["first_person"].get("id") or ""),
    ]


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def stable_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def write_if_changed(path: Path, content: str) -> bool:
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def wait_for_retry(attempt: int, retry_after: str | None = None) -> None:
    try:
        delay = float(retry_after or 0)
    except ValueError:
        delay = 0
    time.sleep(delay if delay > 0 else 0.75 * (2 ** (attempt - 1)))


def discord_request(path: str, token: str) -> Any:
    request = urllib.request.Request(
        f"{DISCORD_API}{path}",
        headers={
            "Authorization": f"Bot {token}",
            "User-Agent": "RSS-MOTD-Skin-Sync/1.0",
        },
    )
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            retryable = error.code == 429 or error.code >= 500
            if retryable and attempt < FETCH_ATTEMPTS:
                retry_after = error.headers.get("retry-after")
                try:
                    payload = json.loads(body)
                    retry_after = str(payload.get("retry_after") or retry_after or "")
                except json.JSONDecodeError:
                    pass
                wait_for_retry(attempt, retry_after)
                continue
            raise RuntimeError(
                f"Discord API request failed for {path}: {error.code} {body}"
            ) from error
    raise RuntimeError(f"Discord API request exhausted retries for {path}")


def fetch_thread_messages(thread_id: str, token: str) -> list[dict[str, Any]]:
    messages: dict[str, dict[str, Any]] = {}
    before = ""
    while len(messages) < MAX_MESSAGES:
        query = {"limit": "100"}
        if before:
            query["before"] = before
        batch = discord_request(
            f"/channels/{thread_id}/messages?{urllib.parse.urlencode(query)}", token
        )
        if not isinstance(batch, list):
            raise RuntimeError("Discord returned a non-list message response")
        for message in batch:
            if isinstance(message, dict) and message.get("id"):
                messages[str(message["id"])] = message
        if len(batch) < 100:
            break
        before = str(batch[-1]["id"])
    return sorted(messages.values(), key=lambda item: int(item["id"]))


def download_attachment(attachment: dict[str, Any]) -> bytes:
    url = str(attachment.get("url") or attachment.get("proxy_url") or "")
    if not url:
        raise RuntimeError(f"attachment {attachment.get('id')} has no download URL")
    request = urllib.request.Request(url, headers={"User-Agent": "RSS-MOTD-Skin-Sync/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def convert_image(data: bytes, destination: Path, max_width: int) -> tuple[int, int]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(io.BytesIO(data)) as image:
        has_alpha = image.mode in {"RGBA", "LA"} or (
            image.mode == "P" and "transparency" in image.info
        )
        image = image.convert("RGBA" if has_alpha else "RGB")
        if image.width > max_width:
            height = round(image.height * max_width / image.width)
            image = image.resize((max_width, height), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=82, method=4)
        return image.size


def newest_timestamp(records: list[dict[str, Any]]) -> str:
    values = [
        value
        for record in records
        for value in (
            record.get("edited_timestamp"),
            record.get("image_timestamp"),
            record.get("timestamp"),
        )
        if value
    ]
    if not values:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return max(values, key=lambda value: datetime.fromisoformat(str(value).replace("Z", "+00:00")))


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
            item_id = next_human_id(items)
            item = {"id": item_id, "order": max((int(x.get("order") or 0) for x in items), default=0) + 1}
            items.append(item)
            by_message[message_id] = item
        else:
            item_id = str(item["id"])

        old_item = json.loads(json.dumps(item, ensure_ascii=False))
        previous = state_items.get(message_id) if isinstance(state_items.get(message_id), dict) else {}
        discord_name_changed = bool(previous) and (
            previous.get("name") != record["name"]
            or previous.get("nameKo", "") != record["nameKo"]
        )
        if is_new or discord_name_changed:
            item["name"] = record["name"]
            if record["nameKo"]:
                item["nameKo"] = record["nameKo"]
            else:
                item.pop("nameKo", None)
        item["sourceUrl"] = f"https://discord.com/channels/{guild_id}/{thread_id}/{message_id}"

        third_src, first_src = media_paths(item_id)
        third_path = asset_dir / f"{item_id}-third.webp"
        first_path = asset_dir / f"{item_id}-first.webp"
        signature = attachment_signature(record)
        files_exist = third_path.exists() and first_path.exists()
        must_download = is_new or not files_exist or (
            bool(previous) and previous.get("attachmentIds") != signature
        )

        if must_download:
            third_size = convert_image(download_attachment(record["third_person"]), third_path, 800)
            first_size = convert_image(download_attachment(record["first_person"]), first_path, 1280)
            item["media"] = [
                {"type": "image", "role": "thirdPerson", "src": third_src, "width": third_size[0], "height": third_size[1]},
                {"type": "image", "role": "firstPerson", "src": first_src, "width": first_size[0], "height": first_size[1]},
            ]
            asset_changes += 2
        elif not item.get("media"):
            raise RuntimeError(f"existing skin {item_id} has no media metadata")

        if item != old_item:
            catalog_changes += 1
        state_items[message_id] = {
            "skinId": item_id,
            "imageMessageId": record["image_message_id"],
            "attachmentIds": signature,
            "name": record["name"],
            "nameKo": record["nameKo"],
        }

    if catalog_changes or asset_changes:
        catalog["updatedAt"] = newest_timestamp(records)
    catalog["version"] = max(int(catalog.get("version") or 0), 5)
    catalog["category"] = "human"
    catalog["items"] = items
    new_state = {"version": 1, "threadId": thread_id, "items": state_items}
    return catalog, new_state, catalog_changes, asset_changes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--asset-dir", type=Path, default=DEFAULT_ASSET_DIR)
    parser.add_argument("--messages-json", type=Path, help="Use an offline Discord message array")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    token = os.environ.get("DISCORD_BOT_TOKEN", "")
    guild_id = os.environ.get("DISCORD_SKIN_GUILD_ID") or os.environ.get("DISCORD_GUILD_ID", "")
    thread_id = os.environ.get("DISCORD_HUMAN_SKIN_THREAD_ID", "")
    if not guild_id or not thread_id:
        raise SystemExit("DISCORD_SKIN_GUILD_ID (or DISCORD_GUILD_ID) and DISCORD_HUMAN_SKIN_THREAD_ID are required")

    if args.messages_json:
        messages = read_json(args.messages_json, [])
    else:
        if not token:
            raise SystemExit("DISCORD_BOT_TOKEN is required")
        messages = fetch_thread_messages(thread_id, token)

    records, warnings = pair_skin_messages(messages)
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    if not records:
        raise SystemExit("No complete human skin records were found in the Discord thread")

    catalog = read_json(args.catalog, {"version": 5, "category": "human", "updatedAt": "", "items": []})
    state = read_json(args.state, {"version": 1, "threadId": thread_id, "items": {}})
    catalog, state, catalog_changes, asset_changes = synchronize(
        records, catalog, state, guild_id, thread_id, args.asset_dir
    )
    catalog_written = write_if_changed(args.catalog, stable_json(catalog))
    state_written = write_if_changed(args.state, stable_json(state))
    print(
        f"Synced {len(records)} human skins from thread {thread_id}; "
        f"catalogChanges={catalog_changes}, assetChanges={asset_changes}, "
        f"catalogWritten={str(catalog_written).lower()}, stateWritten={str(state_written).lower()}"
    )


if __name__ == "__main__":
    main()
