"""Build lightweight GitHub Pages assets from Human_Skin_List_Extract."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "Human_Skin_List_Extract"
SOURCE_JSON = SOURCE_DIR / "skins.json"
OUTPUT_DIR = ROOT / "skin_images"
OUTPUT_JSON = ROOT / "skins.json"


def convert_image(source: Path, destination: Path, max_width: int) -> tuple[int, int]:
    if destination.exists() and destination.stat().st_mtime >= source.stat().st_mtime:
        with Image.open(destination) as image:
            return image.size
    with Image.open(source) as image:
        image = image.convert("RGB")
        if image.width > max_width:
            height = round(image.height * max_width / image.width)
            image = image.resize((max_width, height), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=82, method=4)
        return image.size


def main() -> None:
    items = json.loads(SOURCE_JSON.read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(exist_ok=True)

    generated = set()
    output_items = []
    for item in items:
        order = int(item["order"])
        third_name = f"{order:03d}-third.webp"
        first_name = f"{order:03d}-first.webp"
        third_size = convert_image(
            SOURCE_DIR / item["third_person_file"], OUTPUT_DIR / third_name, 800
        )
        first_size = convert_image(
            SOURCE_DIR / item["first_person_file"], OUTPUT_DIR / first_name, 1280
        )
        generated.update((third_name, first_name))
        output_items.append(
            {
                "id": f"{order:03d}",
                "order": order,
                "name": item["skin_name"],
                "nameKo": item.get("skin_name_ko", ""),
                "thirdPerson": {
                    "src": f"skin_images/{third_name}",
                    "width": third_size[0],
                    "height": third_size[1],
                },
                "firstPerson": {
                    "src": f"skin_images/{first_name}",
                    "width": first_size[0],
                    "height": first_size[1],
                },
                "sourceUrl": item.get("message_url", ""),
            }
        )

    for old_file in OUTPUT_DIR.glob("*.webp"):
        if old_file.name not in generated:
            old_file.unlink()

    updated_at = max((item.get("timestamp", "") for item in items), default="")
    payload = {"version": 1, "updatedAt": updated_at, "items": output_items}
    OUTPUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Built {len(output_items)} skins and {len(generated)} preview images.")


if __name__ == "__main__":
    main()
