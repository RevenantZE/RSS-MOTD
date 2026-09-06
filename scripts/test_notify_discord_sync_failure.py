from __future__ import annotations

from copy import deepcopy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request


SPEC = importlib.util.spec_from_file_location("notify_sync_failure", Path(__file__).with_name("notify-discord-sync-failure.py"))
assert SPEC and SPEC.loader
notify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notify)

REPOSITORY = "revenantze/rss-motd"
MESSAGE_URL = "https://discord.com/channels/574971804712435722/1476635405691654438/1517551693267599462"
MEDIA_URL = "https://discord.com/channels/574971804712435722/1476635405691654438/1517551693267599463"
EVENT = {
    "action": "completed",
    "workflow_run": {
        "id": 123456789, "run_number": 42, "run_attempt": 2,
        "name": "Sync Discord skins", "conclusion": "failure", "head_branch": "main",
        "head_repository": {"full_name": REPOSITORY},
    },
}


class NotificationTests(unittest.TestCase):
    def test_ignores_success_cancellation_other_workflows_and_untrusted_branches(self):
        self.assertTrue(notify.should_notify(EVENT, REPOSITORY))
        for field, value in [
            ("conclusion", "success"), ("conclusion", "cancelled"),
            ("name", "Validate site content"), ("head_branch", "feature/test"),
            ("head_repository", {"full_name": "someone/fork"}),
        ]:
            with self.subTest(field=field, value=value):
                event = deepcopy(EVENT)
                event["workflow_run"][field] = value
                self.assertFalse(notify.should_notify(event, REPOSITORY))
        event = deepcopy(EVENT)
        event["workflow_run"]["conclusion"] = "timed_out"
        self.assertTrue(notify.should_notify(event, REPOSITORY))

    def test_known_post_errors_include_exact_message_without_copying_content(self):
        cases = [
            (f"warning: primary: name message 1517551693267599462 has no following media ({MESSAGE_URL})", "연결할 이미지"),
            (f"warning: name message 1517551693267599462 has fewer than two following images ({MESSAGE_URL})", "2개 미만"),
            (f"warning: spray media message 1517551693267599462 has 2 attachments; expected exactly one ({MESSAGE_URL})", "첨부파일이 여러 개"),
            (f"primary: 'PRIVATE_POST_TEXT @everyone secret=FAKE_TOKEN' needs a recognized weapon name in final parentheses ({MESSAGE_URL})", "등록된 무기명"),
        ]
        for line, reason in cases:
            with self.subTest(line=line):
                problems = notify.extract_problems(line + "\n##[error]Process completed with exit code 1.", {})
                self.assertIn(reason, problems[0]["reason"])
                self.assertEqual(problems[0]["urls"], [MESSAGE_URL])
                payload = notify.build_payload(REPOSITORY, EVENT["workflow_run"], [{"step": "무기 스킨 다운로드", "problems": problems}])
                for forbidden in ["PRIVATE_POST_TEXT", "@everyone", "FAKE_TOKEN", "Process completed"]:
                    self.assertNotIn(forbidden, payload["content"])

    def test_media_error_points_to_name_and_actual_attachment_messages(self):
        log = f"RSS_MOTD_MEDIA_FAILURE {MESSAGE_URL}\nRSS_MOTD_MEDIA_FAILURE {MEDIA_URL}\nRSS_MOTD_MEDIA_FAILURE {MEDIA_URL}\nPIL.UnidentifiedImageError: cannot identify image file"
        problems = notify.extract_problems(log, {})
        self.assertEqual(problems[0]["urls"], [MESSAGE_URL, MEDIA_URL])
        self.assertIn("정상적인 이미지", problems[0]["reason"])

    def test_unrelated_links_and_secret_log_lines_are_not_forwarded(self):
        log = f"ENV_SECRET=FAKE_SECRET\nhttps://untrusted.example/private\nRSS_MOTD_MEDIA_FAILURE https://discord.com.evil.example/channels/1/2/3\nA post linked to {MESSAGE_URL}"
        problems = notify.extract_problems(log, {})
        self.assertEqual(problems[0]["urls"], [])
        self.assertNotIn("FAKE_SECRET", json.dumps(problems))
        self.assertNotIn("untrusted", json.dumps(problems))

    def test_git_failure_has_no_invented_message_link(self):
        problems = notify.extract_problems("! [rejected] HEAD -> main (fetch first)\nerror: failed to push some refs", {})
        self.assertIn("원격 저장소에 새 변경", problems[0]["reason"])
        self.assertEqual(problems[0]["urls"], [])

    def test_only_failed_step_time_window_contributes_errors(self):
        step = {"started_at": "2026-09-06T12:01:00Z", "completed_at": "2026-09-06T12:01:05Z"}
        log = ("2026-09-06T12:00:01.123Z RuntimeError: Discord API request failed for /channels/123: 403 denied\n"
               "2026-09-06T12:01:03.123Z ! [rejected] HEAD -> main (fetch first)\n"
               "2026-09-06T12:02:00.123Z RuntimeError: Discord API request failed for /channels/123: 401 denied")
        self.assertIn("원격 저장소에 새 변경", notify.extract_problems(log, step)[0]["reason"])

    def test_permissions_and_timeouts_have_useful_reasons(self):
        for code, expected in [(401, "인증"), (403, "접근 권한"), (404, "찾지 못"), (429, "요청 제한"), (502, "서버 오류")]:
            with self.subTest(code=code):
                reason = notify.general_reason([f"RuntimeError: Discord API request failed for /channels/123/messages?limit=100: {code} body"], {})
                self.assertIn(expected, reason)
        self.assertIn("제한 시간", notify.general_reason([], {"conclusion": "timed_out"}))

    def test_payload_limits_length_preserves_links_and_disables_mentions(self):
        problems = [{"reason": "이미지가 없습니다.", "urls": [MESSAGE_URL, MEDIA_URL]}] * 30
        payload = notify.build_payload(REPOSITORY, EVENT["workflow_run"], [{"step": "스킨 다운로드", "problems": problems}])
        self.assertLessEqual(len(payload["content"].encode("utf-16-le")) // 2, 2000)
        self.assertIn("추가 오류", payload["content"])
        self.assertIn("actions/runs/123456789/attempts/2", payload["content"])
        self.assertEqual(payload["allowed_mentions"], {"parse": []})
        self.assertTrue(payload["enforce_nonce"])
        rerun = {**EVENT["workflow_run"], "run_attempt": 3}
        self.assertNotEqual(payload["nonce"], notify.build_payload(REPOSITORY, rerun, [])["nonce"])

    def test_job_lookup_uses_failed_attempt_and_includes_deployment_failures(self):
        jobs = {"jobs": [
            {"id": 1, "conclusion": "success", "steps": []},
            {"id": 2, "conclusion": "failure", "steps": [{"name": "Deploy to GitHub Pages", "conclusion": "failure"}]},
        ]}
        with patch.object(notify, "request_bytes", side_effect=[json.dumps(jobs).encode(), b"TimeoutError: timed out"]) as request:
            reports = notify.failure_reports(REPOSITORY, EVENT["workflow_run"], "FAKE_GITHUB_TOKEN")
        self.assertIn("/attempts/2/jobs?per_page=100", request.call_args_list[0].args[0])
        self.assertIn("/jobs/2/logs", request.call_args_list[1].args[0])
        self.assertEqual(reports[0]["step"], "GitHub Pages 배포")
        self.assertIn("시간이 초과", reports[0]["problems"][0]["reason"])

    def test_api_failure_still_produces_an_alert_with_run_link(self):
        with patch.object(notify, "request_bytes", side_effect=notify.NotificationError("HTTP 403")):
            reports = notify.failure_reports(REPOSITORY, EVENT["workflow_run"], "FAKE_TOKEN")
        payload = notify.build_payload(REPOSITORY, EVENT["workflow_run"], reports)
        self.assertIn("조회하지 못", payload["content"])
        self.assertIn("actions/runs/123456789", payload["content"])

    def test_storage_redirect_does_not_receive_github_token(self):
        request = Request("https://api.github.com/repos/org/repo/actions/jobs/1/logs", headers={"Authorization": "Bearer FAKE_TOKEN"})
        redirected = notify.SafeRedirect().redirect_request(request, None, 302, "Found", {}, "https://storage.example/signed")
        self.assertIsNone(redirected.get_header("Authorization"))
        with self.assertRaises(notify.NotificationError):
            notify.SafeRedirect().redirect_request(request, None, 302, "Found", {}, "http://storage.example/insecure")

    def test_rate_limit_retries_but_auth_failure_does_not(self):
        error = HTTPError("https://discord.com/api/v10/channels/1/messages", 429, "limited", {"Retry-After": "2"}, io.BytesIO())
        opener = Mock()
        opener.open.side_effect = [error, io.BytesIO(b"{}")]
        with patch.object(notify, "build_opener", return_value=opener), patch.object(notify.time, "sleep") as sleep:
            self.assertEqual(notify.request_bytes("https://discord.com/api/v10/channels/1/messages", {}, {"nonce": "stable"}), b"{}")
            sleep.assert_called_once_with(2)
        opener.open.side_effect = HTTPError("https://discord.com", 403, "FAKE_SECRET", {}, io.BytesIO(b"PRIVATE_BODY"))
        with patch.object(notify, "build_opener", return_value=opener), patch.object(notify.time, "sleep") as sleep:
            with self.assertRaisesRegex(notify.NotificationError, "^HTTP 403$"):
                notify.request_bytes("https://discord.com", {})
            sleep.assert_not_called()

    def test_main_sends_only_to_configured_channel_without_real_network(self):
        with tempfile.TemporaryDirectory() as directory:
            event_path = Path(directory) / "event.json"
            event_path.write_text(json.dumps(EVENT), encoding="utf-8")
            env = {"GITHUB_REPOSITORY": REPOSITORY, "GITHUB_EVENT_PATH": str(event_path),
                   "DISCORD_SYNC_ALERT_CHANNEL_ID": "661972168586035211",
                   "DISCORD_BOT_TOKEN": "FAKE_BOT_TOKEN", "GITHUB_TOKEN": "FAKE_GITHUB_TOKEN"}
            with patch.dict(os.environ, env, clear=True), patch.object(notify, "failure_reports", return_value=[]), patch.object(notify, "request_bytes") as request:
                notify.main()
            self.assertEqual(request.call_args.args[0], "https://discord.com/api/v10/channels/661972168586035211/messages")
            self.assertEqual(request.call_args.args[1], {"Authorization": "Bot FAKE_BOT_TOKEN"})


if __name__ == "__main__":
    unittest.main()
