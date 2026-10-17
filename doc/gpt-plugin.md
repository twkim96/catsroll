# ChatGPT용 Catsroll 플러그인

## 목적과 현재 범위

시드 찾기와 Multi의 배열·교차 배너 R/G·Find 경로 탐색을 대화 안의 앱에서 실행한다.
기존 JS/WASM 엔진 파일을 그대로 번들하고, 계산은 사용자의 브라우저 Worker에서 한다.
서버는 공개 배너·캐릭터·풀 데이터와 앱을 제공하며 계산 서버로 자동 전환하지 않는다.

현재는 시험 버전이다. HF 공개 서버와 비공개 ChatGPT 웹 앱을 연결하고 실제 격리
iframe에서 Multi·Find·WASM 실행을 확인했다. 무료 웹 계정, 결과 공유 후 모델 설명,
공개 심사·배포 수용은 남아 있다. 플러그인 ZIP 생성, 비공개 연결, 공개 출시는
서로 다른 단계다. 공개 전에는 아래 수용 조건을 마친다.

## 파일과 유지보수

- `lib/battle-cats-rolls/local/gpt_mcp.rb`: opt-in `/mcp`, `/gpt`와 입력 검증·데이터 준비.
- `asset/gpt-runtime.js`, `asset/gpt-worker.js`: 기존 엔진의 기기 실행과 취소·직렬화.
- `asset/gpt-app.js`, `asset/gpt-app.css`, `view/gpt_app.html`: 독립 미리보기와 MCP Apps UI.
- `plugins/catsroll/{plugin,mcp}.json`: 원격 MCP 플러그인 패키지 원본.
- `bin/package-gpt-plugin.rb`: 설정된 공개 origin으로 ZIP 생성. 생성물은 `temp/`.
- 계산 원본: `asset/track-engine.js`, `multi-find-engine.js`,
  `seeker-vampireflower.js`와 `seeker-vampireflower.wasm`.

엔진·WASM은 복제하여 관리하지 않는다. UI 리소스 URI에는 현재 엔진·화면 파일의
SHA-256 지문이 들어간다. 준비한 풀의 버전은 별도 `dataVersion`으로 전달한다.
GitLab 업데이트 후에는 해당 변경에 영향을 받는 기존 테스트와 이 어댑터 테스트를 확인한다.
연결은 기존 `local_features.rb`와 `local/server_middleware.rb` 안에 한정한다.
컨트롤서버의 기존 merge/push 경로는 변경하지 않는다.

## 도구 계약

| 도구 | 입력·반환 |
| --- | --- |
| `catsroll_events` | KR/JP 배너 이름·날짜/ID 검색, 페이지 최대 50개 |
| `catsroll_cats` | 모든 형태 이름 또는 ID로 캐릭터 검색, 페이지 최대 50개 |
| `catsroll_prepare` | `multi`, `find`, `seek` 조건을 검증하고 앱에서 실행할 데이터를 준비 |

`catsroll_prepare`의 `structuredContent.status`는 **prepared**이며 결과가 아니다.
풀과 WASM 입력은 `_meta['catsroll/data']`에만 담아 모델 문맥을 불필요하게 채우지 않는다.
사용자가 계산 버튼을 누르고, 완료 후 별도 공유 버튼을 눌러야 요약이 대화로 전달된다.
요약에 없는 행이나 생략한 경로를 GPT가 추정해서는 안 된다.

Multi의 초기 횟수는 100이며, 명시적으로 전달한 횟수는 그대로 사용한다.
8개 배너, 최대 `min(TRACK_MAX_COUNT, 999)`행을 지원한다. Find는 기존 여섯
검색 기준과 확뽑·플래티넘·레전드 한도를 사용하며 한 지역의 배너끼리만 검색한다.
상태 한도 결과는 최적 경로라고 단정하지 않는다. `forceGuaranteed`는 기존 Multi와
같이 `0`(배너 기본값)·`2`·`7`·`11`·`15`회를 받는다. 시드 찾기는 이 강제 설정을
사용하지 않으며 일반 관측 제한을 유지한다. 배열은 Track A/B별 표에서 배너 열을
비교하고, 각 셀에 원본 엔진의 일반·R·G·RG 및 다음 위치를 표시한다.

시드 찾기는 한 배너에서 **일반 단뽑으로 관측한 순서 최대 10개**를 받는다.
확정 결과·스텝업·특수 티켓을 섞은 관측 해석은 이 시험 버전의 범위가 아니다.
배너 풀이 확정 배너여도 입력은 일반 뽑기 결과여야 한다. 추가 관측 없이 모호한
후보를 확정 시드로 취급하지 않는다. starting seed와 관측 후 current seed를 분리한다.
시드 찾기에는 최소 한 개 관측이 필요하고 빈 목록 준비는 선택 목록을 가져오기 위한 동작이다.

## 로컬 실행과 검증

Ruby/Bundler 환경은 기존 README의 개발 환경을 사용한다. 별도 npm 런타임은 필요 없다.

```sh
CATSROLL_GPT_ENABLED=1 WEB_BIND=127.0.0.1:17867 bundle exec yahns -c config/yahns.rb
```

`http://127.0.0.1:17867/gpt`에서 독립 미리보기를 사용하고, MCP Inspector/SDK는
같은 origin의 `/mcp`에 연결한다. 이 명령은 기존 warmup/통계 로직을 사용한다.
별도 서비스나 포트를 점유하지 않도록 실행 전에 기존 작업과 조정한다.

```sh
node test/test_gpt_runtime.js
bundle exec ruby -EUTF-8 -Ilib:test test/test_gpt_mcp.rb
# Playwright가 제공되는 환경에서 별도 실행한 로컬 서버에 연결:
node test/test_gpt_browser.cjs
```

첫 검사는 원본 배열·교차 배너 RG·Find 결과와 어댑터를 비교하고, 실제 WASM으로
관측 열 개에서 시드를 복원한다. 두 번째는 opt-in, origin, 크기/타입 제한,
MCP 교환·카탈로그·준비/결과 구분·풀 불변성·독립 리소스를 확인한다.
실제 브라우저에서 Worker·WASM·취소와 호스트 브리지 왕복은 별도 확인한다.
브라우저 검사는 Playwright가 설치된 환경의 `NODE_PATH` 또는 `PLAYWRIGHT_MODULE`을
사용하고 Chrome을 실행한다. `CATSROLL_GPT_TEST_URL`로 별도 시험 서버를 지정할 수 있다.
호스트 브리지는 로컬 모의 호스트이며 실제 ChatGPT 격리 정책의 검증을 대체하지 않는다.

## 배포 설정과 패키지

HF의 `/mcp`, `/gpt`, 기존 `/multi`, `/track.json` 공개 응답과 공식 MCP SDK의
도구 목록·준비·UI 리소스 조회를 확인했다. ChatGPT 웹의 사용자 지정 MCP 추가에서
도구 검색·연결도 완료했다. 계정에서 생성한 비공개 앱과 공개 제출용 원격 MCP ZIP은
서로 다른 등록 경로이므로, ZIP 생성만으로 웹 앱 연결이 완료됐다고 간주하지 않는다.

등록된 비공개 앱은 `plugin_asdk_app_6ad2f06dc56881918ef6aae2965d1b08`이다.
원래 시험 패키지 `Plugin_8990fc30b9a48191b7b54ec1b199eaad`는 이 앱에 연결한다.
이 ID는 현재 소유자의 비공개 등록 참조이며 다른 사용자의 계정에 그대로 복제하지 않는다.
공개 제출 ZIP은 `mcp.json`을 사용한다. 비공개 웹 시험 패키지에는 원격 서버를 중복
등록하지 않고 `.app.json`과 `extensions.com.openai.apps`로 등록된 앱만 연결한다.

플러그인 아이콘 원본과 출처는 `plugins/catsroll/assets/`에 있다. 아이콘 교체 시
manifest의 `composerIcon`·`logo`를 함께 유지하고 패키지를 다시 생성한다.
미니 앱 헤더도 같은 아이콘을 리소스에 인라인하며, 아이콘 변경은 UI 지문에 포함한다.
화면은 기존 Multi와 참고 배열 뷰어의 밝은 중성색 배경·간결한 입력·표 구성을 따른다.
ChatGPT 테마가 어두워도 앱은 밝게 표시하며, 캐릭터 검색 목록은 희귀도 색상 표시를 쓴다.
배열 표는 희귀도별 셀 배경색을 쓰며, 작은 화면에서는 A/B 표를 위아래로 배치한다.
배너 검색 결과는 내부 폭을 채운다. 지역·검색어·검색/삭제 아이콘은 좁은 화면에서도
한 줄을 유지하며, 아이콘에는 접근성 이름과 툴팁을 제공한다.
배너 제목과 표 머리글은 기존 Multi의 `multi_events.series_name`을 사용한다.
제목 아래에는 원래 배너 설명을 작은 글자로 표시하고, 이벤트 ID는 툴팁에 둔다.
별도 ‘선택됨’ 설명은 반복하지 않으며 준비된 배너도 동일한 선택 상자로 표시한다.
공개 디렉터리 개발자명은 선택한 인증 게시자 정보에서 정해지며, `developerName`이나
계정 닉네임만 바꿔서 임의의 게시자명으로 바뀐다고 가정하지 않는다.
패키지 작성자·개발자명은 `twkim`이다. 웹 목록은 현재 계정의 표시 정보를 따로
사용하므로 실제 목록에서 확인하기 전에는 별명이나 아이콘 적용 완료로 취급하지 않는다.

## 실제 ChatGPT 웹 확인

- 준비 도구로 전달한 시드 `2762818371`, KR `2026-02-13_1042`, 10회 조건이 앱에
  채워지고 버튼을 누르기 전에는 계산 결과가 표시되지 않았다.
- 앱에서 Multi를 실행해 A/B 10행을 표시했다. 첫 A 결과는 비명의 왕 포노아
  `#706`, 다음 위치 `2A`였다.
- 같은 조건에서 목표 `#706`, 티켓 허용, 플래티넘 한도 1로 Find를 실행해
  티켓 1회·목표 1/1·다음 `2A` 경로를 확인했다. 티켓 불허 시에는 획득처 없음이었다.
- KR `2019-01-23_348`의 관측 `#418` 하나로 WASM을 실행해 두 번째 후보에서
  탐색을 멈추고, 확정 시드를 제시하지 않는 ‘여러 시드 후보’ 결과를 확인했다.
- 명시적 공유 버튼의 호스트 요청은 수락됐지만 설명 응답에는
  ‘이 응답을 불러오지 못했습니다’가 반복됐다. 첫 화면 열기 실패도 재시도 후에
  정상 표시됐다. 원인은 확정하지 않았으며, 모델 설명과 첫 진입 안정성은 미완료다.
- 위 확인은 최초 시험 UI와 현재 연결된 계정에서의 개발 시험이다.
  이후 표·명칭·2/7회 선택 변경은 로컬 검증이며, 새 UI의 실제 ChatGPT 재확인과
  무료 계정 수용은 별도다.

## 배포 환경과 운영

- `CATSROLL_GPT_ENABLED=1`: `/mcp`와 `/gpt` 활성화. 앱 기본은 비활성(404)이며
  HF 배포용 루트 Dockerfile에서는 활성화한다. HF 설정에서 `0`으로 덮어쓰면 비활성화된다.
- `CATSROLL_PUBLIC_ORIGIN`: 공개 서비스 HTTPS origin. 기본은 현재 HF Space 주소.
- `CATSROLL_GPT_UI_ORIGIN`: 공개 UI 심사용 전용 origin이 정해진 경우 지정한다.
  UI 검증을 마치고 도메인 소유권과 ChatGPT 호스트의 실제 origin/CSP를 확인해야 한다.

```sh
CATSROLL_PUBLIC_ORIGIN=https://twkim96-my-cats-rolls.hf.space ruby bin/package-gpt-plugin.rb
```

서버는 stateless JSON Streamable HTTP `/mcp`를 제공한다. 사용자 인증은 사용하지 않으며
공개 게임 데이터만 제공한다. 외부 Origin의 직접 POST는 거부하고 브라우저 미리보기는
같은 origin만 허용한다. ChatGPT MCP 호출의 실제 Origin이 있는 경우 실제 시험으로 확인한다.
Worker와 WASM은 리소스 안에 번들되어 외부 fetch/importScripts 없이 실행된다.
ChatGPT의 blob Worker/WASM 보안 정책이 호환되는지는 실제 시험의 필수 수용 조건이다.

앱은 시드·결과를 DB나 localStorage에 저장하지 않는다. MCP 입력은 HF 서버를 통과하고
공유 요약은 ChatGPT에 전달된다. 호스팅·ChatGPT 자체의 보관 정책까지 없다고 주장하지 않는다.
공개 전에는 요청 로그 정책, 트래픽 제한, 동시 요청, HF 절전·cold start와 캐시를 검토한다.
현재 HF Docker는 Ruby 서비스이며 별도 Node 프로세스를 추가하지 않는다.

공개 등록에는 게시자 인증, 고정 HTTPS MCP 주소·도메인 검증, 개인정보처리방침·약관·문의처,
아이콘과 시연·심사 자료가 필요하다. 패키지는 소유자 정보를 임의로 만들지 않으므로
공개 제출 준비 완료 상태가 아니다. 비공개 플러그인은 배포된 `/mcp`에 연결해 시험한다.

## 다음 수용 조건

- 실제 ChatGPT 첫 진입 실패와 결과 공유 후 설명 응답 오류를 재현·해결하고 전체 왕복을 확인.
- 무료 웹 계정에서 설치/연결·UI 제공 여부와 실제 사용량 제한 확인.
- 화면 재생성·탭 종료·절전 시 실행 중단과 입력 재구성 경험 확인. 지속 실행은 보장하지 않는다.
- 기존 Multi의 플랜 저장·진행 기록·PNG 등 부가 기능은 이후 범위를 정한다.
- UI 변경 후 새 리소스 URI로 ChatGPT 도구 설정을 새로고침하고 표시·계산을 확인한다.
- 공개 디렉터리 심사 제출·공개는 별도 준비와 소유자 확인 후 진행한다.

공식 참조: [MCP/UI quickstart](https://developers.openai.com/plugins/build/app-quickstart),
[MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui),
[패키징](https://developers.openai.com/plugins/build/plugins),
[공개 제출](https://developers.openai.com/plugins/deploy/submission).
