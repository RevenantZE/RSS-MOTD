"""Send classified sync errors and source-message links, never raw job logs."""

from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


WORKFLOWS = {"Sync Discord news": "공지 동기화", "Sync Discord skins": "스킨 동기화"}
FAILURES = {"failure", "timed_out"}
STEP_LABELS = {
    "Check out target branch": "저장소 다운로드",
    "Check out main source": "저장소 다운로드",
    "Set up Python": "Python 준비",
    "Install image dependency": "이미지 라이브러리 설치",
    "Test skin converters": "스킨 변환 테스트",
    "Download announcements": "공지 다운로드",
    "Download human skins": "인간 스킨 다운로드",
    "Download zombie skins": "좀비 스킨 다운로드",
    "Download weapon skins": "무기 스킨 다운로드",
    "Download sprays": "스프레이 다운로드",
    "Validate generated catalog": "스킨 카탈로그 검증",
    "Validate JSON and referenced assets": "사이트 콘텐츠 검증",
    "Commit changed news": "공지 Git 반영",
    "Commit changed skins": "스킨 Git 반영",
    "Configure Pages": "Pages 설정",
    "Upload site artifact": "사이트 파일 업로드",
    "Deploy to GitHub Pages": "GitHub Pages 배포",
}
MESSAGE_URL = r"https://discord\.com/channels/[0-9]{17,20}/[0-9]{17,20}/[0-9]{17,20}"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class NotificationError(Exception):
    """A diagnostic that contains no response bodies or credentials."""


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        if request.get_method() != "GET" or urlsplit(new_url).scheme != "https":
            raise NotificationError("Unexpected API redirect")
        redirected = super().redirect_request(request, response, code, message, headers, new_url)
        if redirected is not None:
            # GitHub log downloads redirect to signed storage URLs.
            redirected.remove_header("Authorization")
        return redirected


def request_bytes(url: str, headers: dict, payload: dict | None = None) -> bytes:
    request = Request(url, data=json.dumps(payload).encode() if payload is not None else None, headers={
        "User-Agent": "RSS-MOTD-Sync-Alerts/1.0", "Content-Type": "application/json", **headers,
    })
    for attempt in range(3):
        delay = 2 ** attempt
        try:
            with build_opener(SafeRedirect()).open(request, timeout=15) as response:
                result = response.read(MAX_RESPONSE_BYTES + 1)
                if len(result) > MAX_RESPONSE_BYTES:
                    raise NotificationError("Response exceeds size limit")
                return result
        except HTTPError as error:
            status = error.code
            retry_after = error.headers.get("Retry-After", "")
            error.close()
            if (status != 429 and status < 500) or attempt == 2:
                raise NotificationError(f"HTTP {status}") from None
            try:
                delay = min(30, max(delay, float(retry_after)))
            except ValueError:
                pass
        except (URLError, TimeoutError, OSError):
            if attempt == 2:
                raise NotificationError("Network request failed or timed out") from None
        time.sleep(delay)
    raise NotificationError("Request retries exhausted")


def should_notify(event: dict, repository: str) -> bool:
    run = event.get("workflow_run", {})
    return (
        event.get("action") == "completed"
        and run.get("name") in WORKFLOWS
        and run.get("conclusion") in FAILURES
        and run.get("head_branch") == "main"
        and run.get("head_repository", {}).get("full_name", "").casefold() == repository.casefold()
    )


def clean_lines(log: str, step: dict) -> list[str]:
    start, end = step.get("started_at"), step.get("completed_at")
    start = datetime.fromisoformat(start.replace("Z", "+00:00")) if start else None
    end = datetime.fromisoformat(end.replace("Z", "+00:00")) + timedelta(seconds=1) if end else None
    lines = []
    for line in log.splitlines():
        line = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", line)
        timestamp = re.match(r"^(\d{4}-\d\d-\d\dT\S+)\s+(.*)$", line)
        if timestamp:
            when = datetime.fromisoformat(timestamp[1].replace("Z", "+00:00"))
            if (start and when < start) or (end and when >= end):
                continue
            line = timestamp[2]
        line = line.strip()
        if not line.startswith(("##[command]", "##[group]", "[command]")):
            lines.append(line.replace("##[error]", ""))
    return lines


def general_reason(lines: list[str], step: dict) -> str:
    text = "\n".join(lines)
    rules = [
        (r"Discord API request failed[^\n]*: 401\b", "Discord 봇 인증에 실패했습니다. 토큰을 확인하세요."),
        (r"Discord API request failed[^\n]*: 403\b", "Discord 채널 접근 권한이 없습니다. 봇 권한을 확인하세요."),
        (r"Discord API request failed[^\n]*: 404\b", "Discord 채널이나 리소스를 찾지 못했습니다. ID를 확인하세요."),
        (r"Discord API request failed[^\n]*: 429\b", "Discord 요청 제한으로 재시도 후에도 동기화하지 못했습니다."),
        (r"Discord API request failed[^\n]*: 5\d\d\b", "Discord API 서버 오류로 동기화하지 못했습니다."),
        (r"DISCORD_BOT_TOKEN[^\n]*required", "Discord 봇 토큰 설정이 누락되었습니다."),
        (r"(?:THREAD_ID|CHANNEL_IDS|GUILD_ID)[^\n]*required", "Discord 서버·채널 ID 설정이 누락되었습니다."),
        (r"UnidentifiedImageError|cannot identify image|image file is truncated", "첨부파일을 정상적인 이미지로 읽지 못했습니다."),
        (r"DecompressionBombError|decompression bomb", "첨부 이미지의 픽셀 수가 안전한 처리 범위를 초과했습니다."),
        (r"HTTP Error 403", "외부 파일 요청이 거부되었습니다 (HTTP 403). 첨부파일 접근 여부를 확인하세요."),
        (r"HTTP Error 404", "다운로드할 첨부파일을 찾지 못했습니다 (HTTP 404)."),
        (r"timed? out|TimeoutError|ETIMEDOUT", "요청 시간이 초과되었습니다."),
        (r"ConnectionError|ConnectionResetError|ENOTFOUND|ECONNRESET|fetch failed|urlopen error", "외부 서비스와 통신하지 못했습니다."),
        (r"\[rejected\].*(?:fetch first|non-fast-forward)", "원격 저장소에 새 변경이 있어 Git push가 거부되었습니다."),
        (r"CONFLICT \(|could not apply", "원격 변경을 합치는 과정에서 Git 충돌이 발생했습니다."),
        (r"Permission.*denied|Write access.*not granted|Authentication failed", "Git 인증 또는 쓰기 권한 문제로 반영하지 못했습니다."),
        (r"failed to push some refs", "Git push에 실패했습니다. 실행 로그에서 서버 응답을 확인하세요."),
        (r"refusing \d+ new records", "한 번에 추가할 수 있는 신규 스킨 수를 초과했습니다."),
        (r"No complete .*records|no complete .*records", "채널에서 완성된 스킨 게시물을 찾지 못했습니다."),
    ]
    for pattern, reason in rules:
        if re.search(pattern, text, re.I):
            return reason
    if step.get("conclusion") == "timed_out":
        return "작업 제한 시간을 초과했습니다."
    if step.get("name", "").startswith("Validate "):
        return "콘텐츠 형식 또는 파일 참조 검증에 실패했습니다. 실행 로그에서 세부 항목을 확인하세요."
    return "원인을 자동 분류하지 못했습니다. 실행 로그에서 오류를 확인하세요."


def extract_problems(log: str, step: dict) -> list[dict]:
    lines = clean_lines(log, step)
    problems = []
    media_urls = []
    for line in lines:
        marker = re.fullmatch(r"RSS_MOTD_MEDIA_FAILURE (" + MESSAGE_URL + r")", line)
        if marker:
            media_urls.append(marker[1])
            continue
        url = re.search(r"\((" + MESSAGE_URL + r")\)$", line)
        if not url:
            continue
        reason = None
        if line.startswith("warning: "):
            if "has fewer than two following images" in line:
                reason = "이름 글에 연결된 이미지가 2개 미만입니다. 1인칭·3인칭 이미지를 확인하세요."
            elif "has no following media" in line:
                reason = "이름 글 뒤에 연결할 이미지·영상이 없습니다."
            elif "expected exactly one" in line:
                reason = "한 게시물에 첨부파일이 여러 개입니다. 이미지·영상은 1개만 허용됩니다."
        elif line.startswith("primary: ") and "needs a recognized weapon name in final parentheses" in line:
            reason = "신규 주무기 이름의 마지막 괄호에 등록된 무기명이 없습니다. 예: 스킨이름(m4a1)."
        if reason:
            problems.append({"reason": reason, "urls": [url[1]]})
    if media_urls:
        reason = general_reason(lines, step)
        if reason.startswith("원인을 자동 분류"):
            reason = "첨부파일 다운로드 또는 이미지·영상 처리에 실패했습니다."
        problems.append({"reason": reason, "urls": list(dict.fromkeys(media_urls))})
    return problems or [{"reason": general_reason(lines, step), "urls": []}]


def failure_reports(repository: str, run: dict, token: str) -> list[dict]:
    api = f"https://api.github.com/repos/{repository}/actions"
    headers = {
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
    }
    try:
        response = json.loads(request_bytes(
            f"{api}/runs/{int(run['id'])}/attempts/{int(run['run_attempt'])}/jobs?per_page=100", headers,
        ))
        jobs = [job for job in response["jobs"] if job.get("conclusion") in FAILURES]
    except (NotificationError, ValueError, KeyError):
        return [{"step": "작업 정보 조회", "problems": [{"reason": "실패 작업을 조회하지 못했습니다. 실행 링크에서 확인하세요.", "urls": []}]}]
    reports = []
    for job in jobs[:3]:
        failed_steps = [step for step in job.get("steps", []) if step.get("conclusion") in FAILURES]
        failed_steps = failed_steps or [{"name": "작업 시작·실행", "conclusion": job.get("conclusion")}]
        try:
            log = request_bytes(f"{api}/jobs/{int(job['id'])}/logs", headers).decode("utf-8", "replace")
        except NotificationError:
            reports.append({"step": "실행 로그 조회", "problems": [{"reason": "상세 로그를 가져오지 못했습니다. 실행 링크에서 확인하세요.", "urls": []}]})
            continue
        for step in failed_steps:
            reports.append({"step": STEP_LABELS.get(step["name"], "기타 작업"), "problems": extract_problems(log, step)})
    return reports or [{"step": "작업 실행", "problems": [{"reason": "실패한 단계가 기록되지 않았습니다. 실행 링크에서 확인하세요.", "urls": []}]}]


def build_payload(repository: str, run: dict, reports: list[dict]) -> dict:
    run_id, attempt = int(run["id"]), int(run["run_attempt"])
    link = f"https://github.com/{repository}/actions/runs/{run_id}/attempts/{attempt}"
    content = f"RSS-MOTD {WORKFLOWS[run['name']]} 실패\n실행 #{int(run['run_number'])} · 시도 {attempt}\n"
    footer = f"\n실행 로그: <{link}>"
    blocks = []
    for report in reports:
        for problem in report["problems"]:
            block = f"\n단계: {report['step']}\n원인: {problem['reason']}\n"
            block += "\n".join(f"[문제 메시지 열기](<{url}>)" for url in problem["urls"][:3])
            blocks.append(block.rstrip())
    for index, block in enumerate(blocks):
        if index == 5 or len((content + block + footer).encode("utf-16-le")) // 2 > 1850:
            content += "\n추가 오류는 실행 로그에서 확인하세요.\n"
            break
        content += block + "\n"
    return {
        "content": content + footer,
        "allowed_mentions": {"parse": []},
        "nonce": hashlib.sha256(f"{repository}:{run_id}:{attempt}".encode()).hexdigest()[:24],
        "enforce_nonce": True,
    }


def main() -> None:
    repository = os.environ["GITHUB_REPOSITORY"]
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository):
        raise NotificationError("Invalid repository name")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    if not should_notify(event, repository):
        print("Not a failed main-branch Discord sync; no message sent.")
        return
    channel = os.environ.get("DISCORD_SYNC_ALERT_CHANNEL_ID", "").strip()
    if not re.fullmatch(r"[0-9]{17,20}", channel):
        raise NotificationError("DISCORD_SYNC_ALERT_CHANNEL_ID must be a Discord channel ID")
    bot_token, github_token = os.environ.get("DISCORD_BOT_TOKEN"), os.environ.get("GITHUB_TOKEN")
    if not bot_token or not github_token:
        raise NotificationError("DISCORD_BOT_TOKEN and GITHUB_TOKEN are required")
    run = event["workflow_run"]
    reports = failure_reports(repository, run, github_token)
    request_bytes(f"https://discord.com/api/v10/channels/{channel}/messages",
                  {"Authorization": f"Bot {bot_token}"}, build_payload(repository, run, reports))
    print("Discord sync failure notification sent.")


if __name__ == "__main__":
    try:
        main()
    except NotificationError as error:
        print(f"Discord notification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
