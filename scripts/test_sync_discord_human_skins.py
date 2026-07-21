from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("sync-discord-human-skins.py")
SPEC = importlib.util.spec_from_file_location("sync_discord_human_skins", SCRIPT)
assert SPEC and SPEC.loader
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


def image(attachment_id: str, width: int, height: int) -> dict:
    return {
        "id": attachment_id,
        "filename": f"{attachment_id}.png",
        "content_type": "image/png",
        "width": width,
        "height": height,
        "url": f"https://cdn.example/{attachment_id}.png",
    }


class HumanSkinSyncTests(unittest.TestCase):
    def test_parses_existing_fenced_name_format(self) -> None:
        self.assertEqual(
            sync.parse_skin_name("```\nMasterChief (Halo)\n마스터치프 (헤일로)\n---\n```"),
            ("MasterChief (Halo)", "마스터치프 (헤일로)"),
        )
        self.assertIsNone(sync.parse_skin_name("MasterChief (Halo)"))

    def test_pairs_portrait_as_third_person_and_landscape_as_first_person(self) -> None:
        messages = [
            {
                "id": "100",
                "content": "```\nGayCat\n게이 고양이\n```",
                "timestamp": "2026-06-19T15:28:38+00:00",
                "attachments": [image("portrait", 800, 1000)],
            },
            {
                "id": "101",
                "content": "",
                "timestamp": "2026-06-19T15:28:40+00:00",
                "attachments": [image("landscape", 1920, 1080)],
            },
        ]
        records, warnings = sync.pair_skin_messages(messages)
        self.assertEqual(warnings, [])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["name_message_id"], "100")
        self.assertEqual(records[0]["third_person"]["id"], "portrait")
        self.assertEqual(records[0]["first_person"]["id"], "landscape")

    def test_first_run_seeds_state_without_reencoding_existing_assets(self) -> None:
        record = {
            "name": "GayCat",
            "nameKo": "게이 고양이",
            "name_message_id": "100",
            "image_message_id": "101",
            "timestamp": "2026-06-19T15:28:38+00:00",
            "edited_timestamp": "",
            "image_timestamp": "2026-06-19T15:28:40+00:00",
            "third_person": image("portrait", 800, 1000),
            "first_person": image("landscape", 1920, 1080),
        }
        catalog = {
            "version": 5,
            "category": "human",
            "updatedAt": "2026-06-19T15:28:40+00:00",
            "items": [
                {
                    "id": "001",
                    "order": 1,
                    "name": "GayCat CMS label",
                    "nameKo": "수동 이름",
                    "media": [
                        {"type": "image", "role": "thirdPerson", "src": "assets/skins/001-third.webp"},
                        {"type": "image", "role": "firstPerson", "src": "assets/skins/001-first.webp"},
                    ],
                    "sourceUrl": "https://discord.com/channels/574/151/100",
                }
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            assets = Path(directory)
            (assets / "001-third.webp").write_bytes(b"existing")
            (assets / "001-first.webp").write_bytes(b"existing")
            with patch.object(sync, "download_attachment") as download:
                result, state, catalog_changes, asset_changes = sync.synchronize(
                    [record], catalog, {"items": {}}, "574", "151", assets
                )
            download.assert_not_called()
        self.assertEqual(catalog_changes, 0)
        self.assertEqual(asset_changes, 0)
        self.assertEqual(result["items"][0]["id"], "001")
        self.assertEqual(result["items"][0]["name"], "GayCat CMS label")
        self.assertEqual(result["items"][0]["nameKo"], "수동 이름")
        self.assertEqual(state["items"]["100"]["attachmentIds"], ["portrait", "landscape"])

    def test_new_message_appends_without_touching_manual_items(self) -> None:
        record = {
            "name": "New Skin",
            "nameKo": "새 스킨",
            "name_message_id": "200",
            "image_message_id": "201",
            "timestamp": "2026-07-21T10:00:00+00:00",
            "edited_timestamp": "",
            "image_timestamp": "2026-07-21T10:00:01+00:00",
            "third_person": image("portrait-new", 800, 1000),
            "first_person": image("landscape-new", 1920, 1080),
        }
        catalog = {
            "version": 5,
            "category": "human",
            "updatedAt": "2026-06-19T15:28:40+00:00",
            "items": [{"id": "009", "order": 9, "name": "Manual", "media": [{"src": "manual.webp"}]}],
        }
        with tempfile.TemporaryDirectory() as directory, patch.object(
            sync, "download_attachment", return_value=b"image"
        ), patch.object(sync, "convert_image", side_effect=[(800, 1000), (1280, 720)]):
            result, state, catalog_changes, asset_changes = sync.synchronize(
                [record], catalog, {"items": {}}, "574", "151", Path(directory)
            )
        self.assertEqual(result["items"][0]["name"], "Manual")
        self.assertEqual(result["items"][1]["id"], "010")
        self.assertEqual(result["items"][1]["media"][0]["role"], "thirdPerson")
        self.assertEqual(catalog_changes, 1)
        self.assertEqual(asset_changes, 2)
        self.assertEqual(state["items"]["200"]["skinId"], "010")

    def test_updates_name_only_after_discord_changes_from_recorded_state(self) -> None:
        record = {
            "name": "Renamed Skin",
            "nameKo": "변경된 이름",
            "name_message_id": "300",
            "image_message_id": "301",
            "timestamp": "2026-07-21T10:00:00+00:00",
            "edited_timestamp": "2026-07-21T11:00:00+00:00",
            "image_timestamp": "2026-07-21T10:00:01+00:00",
            "third_person": image("portrait", 800, 1000),
            "first_person": image("landscape", 1920, 1080),
        }
        catalog = {
            "version": 5,
            "category": "human",
            "updatedAt": "2026-07-20T00:00:00+00:00",
            "items": [
                {
                    "id": "001",
                    "order": 1,
                    "name": "CMS label",
                    "nameKo": "CMS 이름",
                    "media": [{"src": "assets/skins/001-third.webp"}],
                    "sourceUrl": "https://discord.com/channels/574/151/300",
                }
            ],
        }
        state = {
            "items": {
                "300": {
                    "skinId": "001",
                    "attachmentIds": ["portrait", "landscape"],
                    "name": "Old Discord Name",
                    "nameKo": "이전 이름",
                }
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            assets = Path(directory)
            (assets / "001-third.webp").write_bytes(b"existing")
            (assets / "001-first.webp").write_bytes(b"existing")
            result, _, catalog_changes, asset_changes = sync.synchronize(
                [record], catalog, state, "574", "151", assets
            )
        self.assertEqual(result["items"][0]["name"], "Renamed Skin")
        self.assertEqual(result["items"][0]["nameKo"], "변경된 이름")
        self.assertEqual(catalog_changes, 1)
        self.assertEqual(asset_changes, 0)


if __name__ == "__main__":
    unittest.main()
