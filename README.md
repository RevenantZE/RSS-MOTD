# RSS 좀비탈출서버 가이드

RSS 좀비탈출서버에서 사용하는 정적 안내 사이트입니다. GitHub Pages에서 별도 서버 없이 동작하며 FAQ, 명령어 목록, 좀비탈출 용어 사전, 공지를 제공합니다.

- 사이트: https://sj58320.github.io/test/
- 지원 UI 언어: 한국어, English, 日本語
- 용어 사전 데이터: 현재 한국어만 제공

## 주요 기능

- FAQ·명령어·용어를 한 번에 찾는 통합 검색
- 한국어 초성 검색 (`ㄱㅈ` → `고좀`)
- 명령어 카테고리 필터와 브라우저별 즐겨찾기
- 명령어, 코드, 항목 링크 복사와 다국어 완료 알림
- URL 해시를 이용한 FAQ·명령어·용어 바로가기
- 키보드 좌우 방향키 탭 이동
- Discord 공지 채널을 `news.json`으로 동기화하는 GitHub Actions 예시

즐겨찾기는 브라우저의 `localStorage`에 저장됩니다. 다른 기기나 브라우저와 동기화되지 않으며 사이트 데이터를 삭제하면 함께 사라집니다.

## 파일 구조

| 파일 | 역할 |
| --- | --- |
| `index.html` | 페이지 구조와 검색·탭·푸터 UI |
| `style.css` | 전체 화면 스타일과 반응형 UI |
| `script.js` | 검색, 탭, JSON 렌더링, 즐겨찾기, 복사 기능 |
| `lang.js` | 고정 UI와 FAQ 문구의 한국어·영어·일본어 번역 |
| `faq.json` | FAQ 항목과 답변 블록 |
| `commands.json` | 명령어 카테고리, 명령어, 설명 |
| `terms.json` | 언어별 용어 사전 |
| `news.json` | Discord에서 가져온 최근 공지와 로컬 샘플 |
| `scripts/sync-discord-news.mjs` | Discord 메시지를 `news.json`으로 변환 |
| `.github/workflows/sync-discord-news.yml` | 15분마다 `dev`의 공지 동기화 |
| `vendor/` | PicoCSS, `es-hangul`, `markdown-it` 로컬 파일 |
| `guide_image/` | FAQ에 사용하는 안내 이미지 |

## 콘텐츠 수정 방법

콘텐츠를 수정한 뒤 해당 JSON 파일의 `updatedAt`을 `YYYY-MM-DD` 형식으로 함께 변경합니다.

### FAQ

FAQ 구조는 `faq.json`에서 관리하고 번역 문구는 `lang.js`에서 관리합니다.

```json
{
  "id": "example",
  "question": { "langKey": "faq_example" },
  "body": [
    { "type": "text", "text": { "langKey": "answer_example" } },
    { "type": "inlineCode", "value": "!example" }
  ]
}
```

사용 가능한 답변 블록은 `text`, `inlineCode`, `code`, `link`, `image`, `break`, `spacer`입니다. `langKey`를 사용했다면 `lang.js`의 `ko`, `en`, `jp`에 같은 키를 추가합니다.

### 명령어

명령어는 `commands.json`의 `pages → sections → commands` 구조로 관리합니다. 제목과 설명은 항목 안에서 언어별로 작성합니다.

```json
{
  "command": "/ztele",
  "description": {
    "ko": "스폰지역으로 이동",
    "en": "Teleport to spawn",
    "jp": "スポーン地点へ移動"
  }
}
```

### 용어 사전

용어는 `terms.json`의 `locales → 언어 → sections → terms` 구조로 관리합니다.

```json
{
  "term": "난트",
  "aliases": ["난간트롤", "edge"],
  "description": "용어 설명"
}
```

현재는 `locales.ko`만 있습니다. 영어와 일본어 내용은 한국어와 다를 수 있으므로 자동 번역하지 않고, 준비된 언어만 `locales.en` 또는 `locales.jp`로 별도 추가합니다.

### Discord 공지 연동

기본 `news.json`에는 화면 확인용 샘플이 들어 있습니다. 실제 연동은 Discord 봇과 GitHub 저장소 설정을 마친 뒤 활성화합니다.

1. Discord Developer Portal에서 봇을 만들고 **Message Content Intent**를 활성화한 뒤 서버에 추가합니다.
2. 봇에 공지 채널의 `View Channel`, `Read Message History` 권한을 줍니다.
3. GitHub 저장소의 **Settings → Secrets and variables → Actions**에서 다음 값을 추가합니다.

| 종류 | 이름 | 값 |
| --- | --- | --- |
| Secret | `DISCORD_BOT_TOKEN` | Discord 봇 토큰 |
| Variable | `DISCORD_NEWS_CHANNEL_IDS` | 공지 채널 ID들, 쉼표로 구분 |
| Variable | `DISCORD_GUILD_ID` | Discord 서버 ID |
| Variable | `DISCORD_NEWS_LIMIT` | 채널별로 가져올 공지 개수, 생략 시 20 |
| Variable | `DISCORD_NEWS_ENABLED` | 준비가 끝난 뒤 `true` |

토큰은 `news.json`, JavaScript, 워크플로 파일에 직접 적지 않습니다. 여러 채널을 지정하면 공지를 시간순으로 합치고 각 카드에 Discord 채널명을 표시합니다. 워크플로는 15분마다 실행하며, 공지 내용이 바뀐 경우에만 `news.json`을 `dev`에 커밋합니다. `news.json.updatedAt`에는 가장 최근 공지의 작성·수정 시각이 자동으로 기록되고 뉴스 탭 하단에 현지 날짜와 시간으로 표시됩니다. 수동 확인은 GitHub의 **Actions → Sync Discord news → Run workflow**에서 할 수 있습니다.

공지의 첫 번째 비어 있지 않은 줄은 제목, 그 아래 줄은 본문으로 사용합니다. 본문은 Discord에서 사용한 제목, 굵게, 목록, 인용문, 링크, 인라인 코드와 코드 블록 Markdown을 웹에서도 렌더링합니다. Discord 사용자·역할 멘션은 웹에 표시하기 전에 `@서버닉네임`·`@역할명`으로 변환합니다. 이름을 확인할 수 없는 경우에도 숫자 ID는 노출하지 않습니다. 제목을 확실히 구분하려면 다음 형식을 권장합니다.

```text
@RSSPlayer
# 서버 점검 안내
7월 20일 03:00부터 서버 점검을 진행합니다.
```

## 로컬에서 확인하기

JSON을 불러오므로 `index.html`을 파일로 직접 열기보다 로컬 웹 서버를 사용해야 합니다.

- VS Code: 프로젝트 폴더에서 **Open with Live Server**
- Python: `python -m http.server 8000`

그다음 `http://localhost:8000`에서 확인합니다.

## 배포

GitHub Pages는 `dev` 브랜치의 루트(`/`)를 기준으로 배포합니다. `dev`에 푸시된 변경 사항은 공개 사이트에 반영됩니다.
