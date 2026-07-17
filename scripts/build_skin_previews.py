"""Build the complete skin preview catalog for GitHub Pages."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "assets" / "skins"
OUTPUT_JSON = ROOT / "data" / "skins.json"
BUILD_VERSION = "skin-catalog-v2-webp-q82-max800-1280"
BUILD_VERSION_FILE = OUTPUT_DIR / ".build-version"
VIDEO_SUFFIXES = {".mp4", ".webm", ".mov"}
ANIMATED_IMAGE_SUFFIXES = {".gif"}

CHARACTER_SOURCES = [
    {
        "category": "human",
        "root": "Human_Skin_List_Extract",
        "json": "skins.json",
        "output": "",
        "id_prefix": "",
    },
    {
        "category": "zombie",
        "root": "Zombie_Skin_List_Extract",
        "json": "skins.json",
        "output": "zombie",
        "id_prefix": "zombie-",
    },
]

WEAPON_SOURCES = [
    ("primary", "Primary_Weapon_Skin_List_Extract"),
    ("secondary", "Secondary_Weapon_Skin_List_Extract"),
    ("melee", "Knife_Skin_List_Extract"),
    ("throwable", "Throwing_Weapon_Skin_List_Extract"),
]

PRIMARY_WEAPON_TYPES = [
    ("smg", ("mp5", "mp7", "mp9", "p90", "ump", "bizon", "mac10")),
    ("rifle", ("ak47", "m4a1", "m4a4", "famas", "aug", "galil")),
    ("shotgun", ("xm1014", "sawedoff")),
    ("machinegun", ("m249", "mg42", "mg3", "negev")),
    ("sniper", ("awp", "m200")),
]


def classify_primary_weapon(name: str) -> str:
    normalized = name.casefold().replace("-", "").replace("_", "").replace(" ", "")
    for weapon_type, aliases in PRIMARY_WEAPON_TYPES:
        if any(alias in normalized for alias in aliases):
            return weapon_type
    return "other"


def find_source_dir(root_name: str, json_name: str) -> Path:
    root = ROOT / root_name
    direct = root / json_name
    if direct.exists():
        return root
    matches = sorted(root.rglob(json_name))
    if not matches:
        raise FileNotFoundError(f"{json_name} was not found under {root}")
    return matches[0].parent


def read_items(source_dir: Path, json_name: str) -> list[dict[str, Any]]:
    data = json.loads((source_dir / json_name).read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{source_dir / json_name} must contain a JSON array")
    return data


def convert_image(
    source: Path, destination: Path, max_width: int, force: bool = False
) -> tuple[int, int]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if (
        not force
        and destination.exists()
        and destination.stat().st_mtime >= source.stat().st_mtime
    ):
        with Image.open(destination) as image:
            return image.size

    with Image.open(source) as image:
        has_alpha = image.mode in {"RGBA", "LA"} or (
            image.mode == "P" and "transparency" in image.info
        )
        image = image.convert("RGBA" if has_alpha else "RGB")
        if image.width > max_width:
            height = round(image.height * max_width / image.width)
            image = image.resize((max_width, height), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=82, method=4)
        return image.size


def copy_media(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if (
        destination.exists()
        and destination.stat().st_size == source.stat().st_size
        and destination.stat().st_mtime >= source.stat().st_mtime
    ):
        return
    shutil.copy2(source, destination)


def relative_output(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def build_character_items(
    config: dict[str, str], force_rebuild: bool
) -> tuple[list[dict[str, Any]], set[str], list[str]]:
    category = config["category"]
    source_dir = find_source_dir(config["root"], config["json"])
    source_items = read_items(source_dir, config["json"])
    output_subdir = Path(config["output"]) if config["output"] else Path()
    generated: set[str] = set()
    timestamps: list[str] = []
    output_items: list[dict[str, Any]] = []

    for item in source_items:
        order = int(item["order"])
        media = []
        for role, file_key, max_width in [
            ("thirdPerson", "third_person_file", 800),
            ("firstPerson", "first_person_file", 1280),
        ]:
            filename = f"{order:03d}-{'third' if role == 'thirdPerson' else 'first'}.webp"
            destination = OUTPUT_DIR / output_subdir / filename
            size = convert_image(
                source_dir / item[file_key], destination, max_width, force_rebuild
            )
            generated.add(destination.relative_to(OUTPUT_DIR).as_posix())
            media.append(
                {
                    "type": "image",
                    "role": role,
                    "src": relative_output(destination),
                    "width": size[0],
                    "height": size[1],
                }
            )

        timestamp = item.get("timestamp", "")
        if timestamp:
            timestamps.append(timestamp)
        output_items.append(
            {
                "id": f"{config['id_prefix']}{order:03d}",
                "category": category,
                "subcategory": None,
                "order": order,
                "name": item["skin_name"],
                "nameKo": item.get("skin_name_ko", ""),
                "media": media,
                "sourceUrl": item.get("message_url", ""),
            }
        )

    return output_items, generated, timestamps


def build_weapon_items(
    subcategory: str, root_name: str, force_rebuild: bool
) -> tuple[list[dict[str, Any]], set[str], list[str]]:
    source_dir = find_source_dir(root_name, "items.json")
    source_items = read_items(source_dir, "items.json")
    generated: set[str] = set()
    timestamps: list[str] = []
    output_items: list[dict[str, Any]] = []

    for item in source_items:
        order = int(item["order"])
        source_media = item.get("media_files", [])
        metadata = item.get("media", [])
        media = []
        for media_index, relative_source in enumerate(source_media, start=1):
            source = source_dir / relative_source
            suffix = source.suffix.lower()
            metadata_item = metadata[media_index - 1] if media_index <= len(metadata) else {}
            output_base = OUTPUT_DIR / "weapon" / subcategory / f"{order:03d}-{media_index:02d}"

            if suffix in VIDEO_SUFFIXES:
                destination = output_base.with_suffix(suffix)
                copy_media(source, destination)
                media_type = "video"
                width = int(metadata_item.get("width") or 1920)
                height = int(metadata_item.get("height") or 1080)
            elif suffix in ANIMATED_IMAGE_SUFFIXES:
                destination = output_base.with_suffix(suffix)
                copy_media(source, destination)
                media_type = "image"
                width = int(metadata_item.get("width") or 800)
                height = int(metadata_item.get("height") or 800)
            else:
                destination = output_base.with_suffix(".webp")
                width, height = convert_image(
                    source, destination, 1280, force_rebuild
                )
                media_type = "image"

            generated.add(destination.relative_to(OUTPUT_DIR).as_posix())
            media.append(
                {
                    "type": media_type,
                    "role": "preview",
                    "src": relative_output(destination),
                    "width": width,
                    "height": height,
                }
            )

        if not media:
            raise ValueError(f"{item.get('item_name', order)} has no preview media")

        timestamp = item.get("timestamp", "")
        if timestamp:
            timestamps.append(timestamp)
        output_items.append(
            {
                "id": f"weapon-{subcategory}-{order:03d}",
                "category": "weapon",
                "subcategory": subcategory,
                "weaponType": (
                    classify_primary_weapon(item["item_name"])
                    if subcategory == "primary"
                    else None
                ),
                "order": order,
                "name": item["item_name"],
                "nameKo": "",
                "media": media,
                "sourceUrl": item.get("message_url", ""),
            }
        )

    return output_items, generated, timestamps


def remove_stale_media(generated: set[str]) -> None:
    managed_suffixes = {".webp", ".gif", *VIDEO_SUFFIXES}
    for old_file in OUTPUT_DIR.rglob("*"):
        if not old_file.is_file() or old_file == BUILD_VERSION_FILE:
            continue
        relative = old_file.relative_to(OUTPUT_DIR).as_posix()
        if old_file.suffix.lower() in managed_suffixes and relative not in generated:
            old_file.unlink()
    for directory in sorted(
        (path for path in OUTPUT_DIR.rglob("*") if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    ):
        if not any(directory.iterdir()):
            directory.rmdir()


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    previous_version = (
        BUILD_VERSION_FILE.read_text(encoding="utf-8").strip()
        if BUILD_VERSION_FILE.exists()
        else ""
    )
    force_rebuild = previous_version != BUILD_VERSION

    all_items: list[dict[str, Any]] = []
    generated: set[str] = set()
    timestamps: list[str] = []

    for config in CHARACTER_SOURCES:
        items, files, item_timestamps = build_character_items(config, force_rebuild)
        all_items.extend(items)
        generated.update(files)
        timestamps.extend(item_timestamps)

    for subcategory, root_name in WEAPON_SOURCES:
        items, files, item_timestamps = build_weapon_items(
            subcategory, root_name, force_rebuild
        )
        all_items.extend(items)
        generated.update(files)
        timestamps.extend(item_timestamps)

    remove_stale_media(generated)
    categories = [
        {"id": "human", "count": sum(item["category"] == "human" for item in all_items)},
        {"id": "zombie", "count": sum(item["category"] == "zombie" for item in all_items)},
        {
            "id": "weapon",
            "count": sum(item["category"] == "weapon" for item in all_items),
            "subcategories": [
                {
                    "id": subcategory,
                    "count": sum(
                        item["subcategory"] == subcategory for item in all_items
                    ),
                    **(
                        {
                            "types": [
                                {
                                    "id": weapon_type,
                                    "count": sum(
                                        item.get("weaponType") == weapon_type
                                        for item in all_items
                                    ),
                                }
                                for weapon_type in [
                                    *(rule[0] for rule in PRIMARY_WEAPON_TYPES),
                                    "other",
                                ]
                            ]
                        }
                        if subcategory == "primary"
                        else {}
                    ),
                }
                for subcategory, _root_name in WEAPON_SOURCES
            ],
        },
    ]
    payload = {
        "version": 3,
        "updatedAt": max(timestamps, default=""),
        "categories": categories,
        "items": all_items,
    }
    OUTPUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    BUILD_VERSION_FILE.write_text(BUILD_VERSION + "\n", encoding="utf-8")
    print(
        f"Built {len(all_items)} skins and {len(generated)} media files "
        f"({sum(item['category'] == 'weapon' for item in all_items)} weapons)."
    )


if __name__ == "__main__":
    main()
