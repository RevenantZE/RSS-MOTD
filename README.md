# RSS 좀비탈출서버 가이드

RSS 좀비탈출서버에서 사용하는 정적 안내 사이트입니다. GitHub Pages에서 별도 서버 없이 동작하며 FAQ, 명령어 목록, 좀비탈출 용어 사전을 제공합니다.

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
- 오프라인 캐시와 홈 화면 설치 지원

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
| `manifest.webmanifest` | 설치형 웹 앱 정보 |
| `sw.js` | 오프라인 캐시 |
| `icon.svg` | 파비콘과 설치 아이콘 |
| `vendor/` | PicoCSS와 `es-hangul` 로컬 파일 |
| `guide_image/` | FAQ 이미지와 공유 미리보기 이미지 |

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

## 로컬에서 확인하기

JSON을 불러오므로 `index.html`을 파일로 직접 열기보다 로컬 웹 서버를 사용해야 합니다.

- VS Code: 프로젝트 폴더에서 **Open with Live Server**
- Python: `python -m http.server 8000`

그다음 `http://localhost:8000`에서 확인합니다. 서비스 워커 캐시 때문에 변경 내용이 바로 보이지 않으면 페이지를 새로고침하거나 사이트 데이터를 지운 뒤 다시 확인합니다.

## 배포

GitHub Pages는 `main` 브랜치를 기준으로 배포합니다. 기능 브랜치의 변경 사항을 검토한 뒤 `main`에 병합하면 사이트에 반영됩니다.
