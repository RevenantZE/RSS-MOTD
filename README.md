# RSS 좀비탈출서버 가이드

RSS 좀비탈출서버에서 사용하는 정적 안내 사이트입니다. GitHub Pages에서 별도 서버 없이 동작하며 FAQ, 서버 규칙, 명령어 목록, 좀비탈출 용어 사전, 공지, 스킨 프리뷰, 후원 안내를 제공합니다.

- 사이트: https://sj58320.github.io/test/
- 지원 UI 언어: 한국어, English, 日本語
- 용어 사전 데이터: 한국어, 日本語 제공 (English 준비 중)

## 주요 기능

- FAQ·서버 규칙·명령어·용어·공지·스킨을 한 번에 찾는 통합 검색
- 한국어 초성 검색 (`ㄱㅈ` → `고좀`)
- 명령어 카테고리 필터와 브라우저별 즐겨찾기
- 명령어, 코드, 항목 링크 복사와 다국어 완료 알림
- URL 해시를 이용한 FAQ·규칙·명령어·용어 바로가기
- 키보드 좌우 방향키 탭 이동
- Discord 공지 채널을 `data/news.json`으로 동기화하는 GitHub Actions 예시
- 인간·좀비·무기(주무기·보조무기·근접무기·투척무기)를 나눠 보여주는 이미지·영상 스킨 갤러리
- 주무기를 기관단총·소총·산탄총·기관총·저격총으로 자동 분류하고 전체 보기에서도 분류별로 묶어서 표시
- 스킨 이미지를 페이지 안의 모달로 확대
- 한국 후원자를 위한 카카오페이 직접 송금 안내와 해외 후원자를 위한 Ko-fi 구독 링크
- VIP 무료 이용 기능과 VIP 전용 기능을 구분한 혜택 안내

즐겨찾기는 브라우저의 `localStorage`에 저장됩니다. 다른 기기나 브라우저와 동기화되지 않으며 사이트 데이터를 삭제하면 함께 사라집니다.

## 파일 구조

```text
/
├─ index.html
├─ data/                  # FAQ, 규칙, 명령어, 용어, 공지, 후원 데이터
│  └─ skins/              # 인간·좀비·무기 스킨 카탈로그
├─ assets/
│  ├─ css/                # 사이트 스타일
│  ├─ js/                 # 화면 동작과 다국어 UI
│  ├─ images/guide/       # FAQ 안내 이미지
│  └─ skins/              # 스킨 이미지와 영상
├─ scripts/               # 데이터 생성·동기화·검증 도구
├─ vendor/                # 외부 라이브러리 로컬 사본
└─ .github/workflows/     # 자동 검증과 Discord 공지 동기화
```

| 파일 | 역할 |
| --- | --- |
| `index.html` | 페이지 구조와 검색·탭·푸터 UI |
| `assets/css/style.css` | 전체 화면 스타일과 반응형 UI |
| `assets/js/script.js` | 검색, 탭, JSON 렌더링, 즐겨찾기, 복사 기능 |
| `assets/js/lang.js` | 고정 UI와 FAQ 문구의 한국어·영어·일본어 번역 |
| `data/faq.json` | FAQ 항목과 답변 블록 |
| `data/rules.json` | 언어별 서버 규칙과 안내 문구 |
| `data/commands.json` | 명령어 카테고리, 명령어, 설명 |
| `data/terms.json` | 언어별 용어 사전 |
| `data/news.json` | Discord에서 가져온 최근 공지와 로컬 샘플 |
| `data/support.json` | 지역별 후원 링크와 다국어 VIP 혜택 안내 |
| `data/skins/human.json` | 인간 스킨 이름, 미디어 경로, Discord 원문 링크 |
| `data/skins/zombie.json` | 좀비 스킨 이름, 미디어 경로, Discord 원문 링크 |
| `data/skins/weapon.json` | 무기 스킨 분류, 이름, 미디어 경로, Discord 원문 링크 |
| `assets/skins/` | GitHub Pages용 WebP·GIF·MP4 스킨 미리보기 |
| `scripts/build_skin_previews.py` | 여섯 로컬 Discord 추출 폴더를 카테고리별 스킨 카탈로그로 변환 |
| `scripts/sync-discord-news.mjs` | Discord 메시지를 `data/news.json`으로 변환 |
| `scripts/validate-content.mjs` | JSON 구조, 연결된 항목, 이미지 경로, 번역 키 검증 |
| `.github/workflows/sync-discord-news.yml` | 15분마다 `main`의 공지 동기화 후 변경 시 Pages 배포 |
| `.github/workflows/deploy-pages.yml` | `main`을 검증하고 GitHub Pages에 배포 |
| `.github/workflows/validate-content.yml` | `main`·`dev` 푸시와 PR의 콘텐츠 자동 검증 |
| `vendor/` | `es-hangul`, `markdown-it` 로컬 파일 |
| `assets/images/guide/` | FAQ에 사용하는 안내 이미지 |

## 콘텐츠 수정 방법

콘텐츠를 수정한 뒤 해당 JSON 파일의 `updatedAt`을 `YYYY-MM-DD` 형식으로 함께 변경합니다.

커밋 전에 아래 명령으로 JSON 문법, 중복 ID, FAQ 관련 항목, 번역 키, 스킨 이미지 경로를 한 번에 확인할 수 있습니다.

```powershell
node scripts/validate-content.mjs
```

### FAQ

FAQ 구조는 `data/faq.json`에서 관리하고 번역 문구는 `assets/js/lang.js`에서 관리합니다.

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

사용 가능한 답변 블록은 `text`, `inlineCode`, `code`, `link`, `image`, `break`, `spacer`입니다. `langKey`를 사용했다면 `assets/js/lang.js`의 `ko`, `en`, `jp`에 같은 키를 추가합니다.

### 서버 규칙

서버 규칙은 `data/rules.json`의 `locales → 언어 → sections → items` 구조로 관리합니다. 한국어(`ko`), 영어(`en`), 일본어(`jp`)는 서로 독립된 데이터이며, 딥링크가 언어를 바꿔도 유지되도록 섹션과 규칙 ID는 세 언어에서 동일하게 사용합니다. 현재 일본어 규칙 내용은 번역 준비 전까지 영어와 동일하게 저장되어 있습니다.

### 명령어

명령어는 `data/commands.json`의 `pages → sections → commands` 구조로 관리합니다. 제목과 설명은 항목 안에서 언어별로 작성합니다.

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

용어는 `data/terms.json`의 `locales → 언어 → sections → terms` 구조로 관리합니다.

```json
{
  "term": "난트",
  "aliases": ["난간트롤", "edge"],
  "description": "용어 설명"
}
```

현재 `locales.ko`와 `locales.jp`를 사용하며 영어 용어집은 준비 중입니다. 언어별 내용은 서로 다를 수 있으므로 자동 번역하지 않고 각 언어 데이터를 별도로 관리합니다.

### Discord 공지 연동

기본 `data/news.json`에는 화면 확인용 샘플이 들어 있습니다. 실제 연동은 Discord 봇과 GitHub 저장소 설정을 마친 뒤 활성화합니다.

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

토큰은 `data/news.json`, JavaScript, 워크플로 파일에 직접 적지 않습니다. 여러 채널을 지정하면 공지를 시간순으로 합치고 각 카드에 Discord 채널명을 표시합니다. 워크플로는 15분마다 실행하며, 공지 내용이 바뀐 경우에만 `data/news.json`을 `main`에 커밋한 뒤 Pages를 명시적으로 다시 배포합니다. `news.json.updatedAt`에는 가장 최근 공지의 작성·수정 시각이 자동으로 기록되고 뉴스 탭 하단에 현지 날짜와 시간으로 표시됩니다. 수동 확인은 GitHub의 **Actions → Sync Discord news → Run workflow**에서 할 수 있습니다.

공지의 첫 번째 비어 있지 않은 줄은 제목, 그 아래 줄은 본문으로 사용합니다. 본문은 Discord에서 사용한 제목, 굵게, 목록, 인용문, 링크, 인라인 코드와 코드 블록 Markdown을 웹에서도 렌더링합니다. Discord 사용자·역할 멘션은 웹에 표시하기 전에 `@서버닉네임`·`@역할명`으로 변환합니다. 이름을 확인할 수 없는 경우에도 숫자 ID는 노출하지 않습니다. 제목을 확실히 구분하려면 다음 형식을 권장합니다.

```text
@RSSPlayer
# 서버 점검 안내
7월 20일 03:00부터 서버 점검을 진행합니다.
```

### 스킨 프리뷰 갱신

Discord에서 추출한 아래 원본 폴더들은 용량이 커서 Git에 올리지 않습니다. 폴더를 프로젝트 루트에 둔 뒤 스크립트를 실행하면 `data/skins/human.json`, `data/skins/zombie.json`, `data/skins/weapon.json`과 `assets/skins/`가 한 번에 갱신됩니다.

- `Human_Skin_List_Extract/`
- `Zombie_Skin_List_Extract/`
- `Primary_Weapon_Skin_List_Extract/`
- `Secondary_Weapon_Skin_List_Extract/`
- `Knife_Skin_List_Extract/`
- `Throwing_Weapon_Skin_List_Extract/`

```powershell
python scripts/build_skin_previews.py
```

기본 실행은 Pages CMS에 이미 있는 항목과 미디어를 그대로 보존하고, 추출 원본에만 있는 새 ID를 추가합니다. 생성기가 만든 파일과 이미 확인한 원본 ID는 `assets/skins/.generated-manifest.json`에 기록됩니다. 이후 정리할 때도 이 manifest에 있는 파일만 삭제 대상이 되며, CMS에서 삭제한 기존 ID는 자동으로 다시 추가하지 않습니다. 선택 필드의 `null`과 빈 문자열은 Pages CMS와 같은 방식으로 생략합니다.

추출 원본으로 기존 항목과 미디어를 의도적으로 다시 만들 때만 아래 옵션을 사용합니다. 이 옵션은 같은 ID의 CMS 수정 내용을 교체하므로 실행 전에 변경 내용을 확인하세요.

```powershell
python scripts/build_skin_previews.py --overwrite-existing
```

스크립트는 Pillow가 필요합니다. 정적 이미지는 화면용 WebP로 압축하고 GIF와 MP4는 애니메이션·영상을 유지하기 위해 그대로 복사합니다. 영상 카드는 전체 파일을 미리 내려받지 않고 메타데이터와 첫 프레임을 불러와 썸네일처럼 표시합니다. 각 항목은 `media` 배열을 사용하므로 나중에 이미지와 영상이 함께 추가되어도 같은 카드 안에 자동으로 나란히 표시됩니다. 주무기 종류는 항목 이름에 포함된 기반 무기명으로 판별하며, 새 이름을 판별하지 못하면 `기타`로 분류됩니다.

### Pages CMS에서 스킨 수정하기

루트의 `.pages.yml`은 카테고리별 스킨 JSON과 `assets/skins/`만 편집할 수 있는 스킨 관리 화면을 정의합니다. 인간·좀비·무기 카탈로그를 각각 열기 때문에 223개 항목을 한 화면에서 한꺼번에 처리하지 않습니다. 스킨 프리뷰 제목 옆의 **관리하기** 버튼은 Pages CMS의 `main` 브랜치를 직접 엽니다. GitHub로 로그인하면 다음 작업을 폼으로 처리할 수 있습니다.

- 선택한 카테고리 안에서 표시 순서 수정
- 한국어·영문 스킨 이름 수정
- 이미지 또는 MP4 업로드와 교체
- 새 스킨 추가 및 기존 스킨 삭제

저장 전 `마지막 업데이트`를 현재 시각으로 바꾸고, 고유 ID와 같은 분류의 표시 순서가 다른 항목과 겹치지 않는지 확인합니다. 카테고리별 개수는 사이트가 스킨 목록에서 자동으로 계산하므로 따로 입력하지 않습니다. 저장하면 선택한 브랜치에 커밋되며, `main`에 저장한 경우 검증을 통과한 뒤 GitHub Pages에 자동 배포됩니다.

## 로컬에서 확인하기

JSON을 불러오므로 `index.html`을 파일로 직접 열기보다 로컬 웹 서버를 사용해야 합니다.

- VS Code: 프로젝트 폴더에서 **Open with Live Server**
- Python: `python -m http.server 8000`

그다음 `http://localhost:8000`에서 확인합니다.

## 배포

GitHub Pages는 `.github/workflows/deploy-pages.yml`이 `main` 브랜치의 루트(`/`)를 검증한 뒤 배포합니다. 일반 `main` 푸시뿐 아니라 공지 동기화가 새 커밋을 만든 경우에도 같은 배포 과정을 실행합니다.
