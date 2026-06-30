# Client-Side Computation (내 기기 연산)

서버가 바쁠 때 브라우저에서 직접 계산하는 "내 기기 연산" 기능 두 가지의 설계·구현·운영
메모. 둘 다 구현 완료 상태이며, 이 문서는 향후 유지보수/디버깅을 위한 레퍼런스다.

## 0. 두 가지 기능 (방향이 반대)

| 기능 | 방향 | 위치 | 연산 | 상태 |
|---|---|---|---|---|
| **A. 시드 찾기 (Seeker)** | 롤(뽑은 캐트) → 시드 | `/seek` | 2^32 브루트포스 → **WASM** | ✅ |
| **B. 트랙 렌더 (Tracker)** | 시드 → 배열(트랙) | `/?seed=...` | 정방향 시뮬 → **순수 JS** | ✅ |

- A: "내가 뽑은 캐트들로 시드를 알아내기". 브루트포스라 WASM.
- B: "시드를 넣으면 그 시드의 캐트 트랙을 예측"(메인 페이지). 빠른 정방향 시뮬이라 순수 JS.

## 1. 설계 원칙

1. **기존 서버 로직 불가침.** 클라 연산은 옵션이 켜졌을 때만 도는 추가 경로. 끄면 서버
   동작과 100% 동일.
2. **알고리즘은 이식하되 정확성을 서버 출력과 1:1 대조한다.**
3. **충돌 최소화 (upstream gitlab 병합 대비).** 로직은 최대한 **새 파일**에. 공유 파일
   (`route.rb`/`web.rb`/`server.rb`/뷰)은 불가피할 때만 작고 국소적으로 수정. `TODO.md`는
   손대지 않는다(계획·메모는 이 문서에만).
4. **트랙 표는 독립 렌더러**로 클라가 자체 생성한다(서버 `table.erb` 하이드레이션 안 함).

## 2. 왜 의미 있나 (서버 병목)

"서버 바쁨"은 두 CPU 병목을 포함한다. 페이지/데이터 서빙은 캐시 대상(varnish 10분)이라
병목이 아니다.

- **시드 찾기 큐**: `seek_seed.rb`의 `Pool = ThreadPool.new(1)` — 한 번에 하나만 처리. → A가 해소.
- **트랙 렌더링**: `route.prepare_tracks`(`gacha.rb` 시뮬) + ERB 렌더 — 시드/포지션 바꿀
  때마다 서버가 계산·렌더. → B가 해소(로컬 탐색 + 새로고침 시 서버 트랙 연산 스킵).

---

# Feature A — 시드 찾기 (Seeker, WASM)

롤 → 시드. `/seek` 페이지. 기존 C 시커를 Emscripten으로 WASM 컴파일해 브라우저 Web
Worker에서 단일 스레드로 실행한다.

## 파일
- `Seeker/Seeker-VampireFlower.c` — `SEEKER_WASM` 가드로 pthread 드라이버와 `main()`만
  제외(네이티브 빌드는 코드상 동일).
- `Seeker/Seeker-VampireFlower-wasm.c` — 단일 스레드 `seek_seed()` 드라이버.
- `Seeker/bin/build-VampireFlower-wasm.sh` — `asset/seeker-vampireflower.js`(+`.wasm`) 생성.
- `asset/seeker-worker.js` — Web Worker.
- `asset/seek-client.js` — `/seek`에서 "내 기기 연산" 라디오가 `client`일 때 form submit을
  가로채 워커 실행.
- `view/seek_form.erb` — 서버/내 기기 라디오 + 결과 영역.

## 빌드 (이 개발 머신: Homebrew emscripten)
```
EMSDK_PYTHON=/opt/homebrew/opt/python@3.14/bin/python3.14 \
EM_LLVM_ROOT=/opt/homebrew/opt/emscripten/libexec/llvm/bin \
EM_BINARYEN_ROOT=/opt/homebrew/opt/emscripten/libexec/binaryen \
./Seeker/bin/build-VampireFlower-wasm.sh
```
표준 emsdk 환경이면 스크립트만 실행하면 된다.

## 검증
유일 시드(롤 8~10개): 네이티브 바이너리와 begin/end 완전 일치. 모호한 경우(롤 적음):
양쪽 모두 count>1 보고(네이티브는 멀티스레드라 비결정적 — 버그 아님).

## 운영 메모
산출물 `.js`/`.wasm`은 **커밋**한다(HF Docker 이미지엔 emscripten이 없어 빌드 결과물을 그대로
서빙). C 알고리즘을 바꾸면 로컬 재빌드 후 산출물을 재커밋해야 HF에 반영된다.

---

# Feature B — 트랙 렌더 (Tracker, 순수 JS)

시드 → 배열. 메인 페이지에서 "내 기기 연산" 토글을 켜면 트랙 계산과 표 렌더를 브라우저에서
수행한다. 서버 트랙 HTML과 **동일한 풀 렌더**가 목표이며 달성됨.

## 동작 흐름

1. 토글 ON → URL에 `compute=client`를 박고(replaceState) 서버는 트랙을 안 그림.
   브라우저가 `/track.json`을 받아 로컬로 표를 그린다.
2. 시드/포지션/pick/캐트 클릭/시드 입력 = 전부 가로채 **로컬 재계산 + `history.pushState`**
   (서버 왕복 없음). 같은 이벤트는 `/track.json`을 다시 안 받음(캐시).
3. 토글 OFF → `compute=client` 제거 후 새로고침 → 서버 렌더로 복귀(동작 불변).

## 클라이언트 파일 (전부 신규)

- `asset/track-data.js` — `/track.json` fetch + sessionStorage/메모리 캐시.
  `TrackData.load({event,lang,name,custom,ubers})`. `ubers=0`은 "없음"과 같은 캐시 키로
  정규화(폼은 항상 ubers=0을 보내므로, 정규화 안 하면 시드마다 재fetch → 오프라인 멈춤).
- `asset/track-engine.js` — `gacha.rb` + `find_cat.rb` 포팅. `TrackEngine.buildTracks(pool,
  seed, opts)` → 서버 `prepare_tracks`와 동일한 `cats` 구조 + `foundCats`.
- `asset/track-render.js` — `table.erb` + `view.rb` td/링크 헬퍼 포팅.
  `TrackRender.renderTable/renderFoundCats`.
- `asset/track-client.js` — 메인 페이지 컨트롤러(토글, 가로채기, 렌더 주입, SW 등록).
- `asset/sw.js` — 오프라인 Service Worker.

## 서버 변경 (국소, 추가 위주)

- `lib/battle-cats-rolls/track_api.rb` (신규) — Jellyfish 앱:
  - `GET /track.json?event&lang&name&custom&ubers` → `{exist, version, rates, base,
    guaranteed_rolls, slots, cats}`. `cats`는 id별 `{name[form], desc[form], rarity, img}`.
    `Route#gacha.pool` 재사용(=route.rb 무수정).
  - `GET /events.json?lang` → `{current, upcoming:[{value,label}], past:[..]}`. 지역 전환 시
    이벤트 드롭다운만 작게 갱신하기 위함.
- `server.rb` — `require_relative 'track_api'` + `map '/track.json'` + `map '/events.json'`
  + rewrite에 `'/sw.js' => '/sw.js'`(루트 스코프 서빙). 모두 국소 추가.
- `route.rb` — `compute` / `compute_client?` 접근자 추가 + `default_query` keys에 `:compute`.
- `web.rb` — `/` 핸들러를 `show_tracks? && !compute_client?`일 때만 `prepare_tracks`.
- `view/find_cat.erb` — 블록 조건을 `(arg || route.compute_client?)`로(클라 모드에서 서버가
  트랙을 안 그려도 폼/토글이 보이게) + "Add future ubers" 오른쪽에 토글 마크업 추가.
- `view/index.erb` — track-* 스크립트 4개 include.

> `gacha.rb`/`route.prepare_tracks`/`table.erb`/`view.rb`/`layout.erb`/`TODO.md`는 **무수정**.

## UI / 토글

- "내 기기 연산" 체크박스 + `[캐시 제거]` 링크를 폼의 "Add future ubers" 오른쪽에 둠.
- 상태 표시는 활성 시 체크표시(`✓`)만. (영문 괄호·"서버 미사용" 등 긴 문구 제거 — 모바일 폭)
- 상태는 localStorage 영속. 가로채기는 항상 설치하고 런타임에 `enabled()`로 게이트
  → 토글 켜는 즉시 적용(리로드 불필요).

## compute=client (새로고침/직접링크도 서버 스킵)

토글 ON이면 URL에 `compute=client`가 유지된다. 서버는 `compute_client?`면 `prepare_tracks`를
건너뛰고 폼+토글+스크립트만 내려주며(트랙 표 없음), 브라우저가 표를 렌더. 따라서 새로고침/
공유 링크에서도 서버는 트랙 연산을 하지 않는다.

## 지역(lang) 전환

이벤트 목록은 지역별이라 서버 소유다. 클라 모드에서 지역을 바꾸면:
- 온라인: `/events.json?lang=새지역`만 작게 받아 드롭다운을 in-place 갱신 + 로컬 렌더
  (전체 리로드 없음, 체크 유지). 기존 이벤트가 새 지역에도 있으면 유지, 없으면 새 지역 current.
- 오프라인/실패: 지역 셀렉트를 원복하고 현재 지역 유지(체크 해제 안 함).

## 오프라인 (Service Worker, `asset/sw.js`)

- 전략: same-origin GET에 **network-first + 캐시 폴백**. 온라인 동작 불변(항상 네트워크
  우선), 오프라인일 때만 캐시 제공.
- **install 때 셸(`/`) + 핵심 자산 precache.** (첫 방문에 SW는 그 페이지를 아직 제어하지
  못하므로 런타임 캐시만으론 셸이 안 잡힘 → precache 필수. 이전에 이게 없어서 오프라인 시
  검은 503 화면이 떴음.) 자산 폴백은 `ignoreSearch`로 digest 쿼리 URL도 매칭.
- track.json은 같은 탭이면 sessionStorage, 아니면 SW 캐시에서.
- **안전장치**:
  - SW 등록을 **토글과 분리** — 클라 모드 첫 ON 시 1회만 `register('/sw.js')`, 이후 유지.
    따라서 토글을 따닥 눌러도 SW 처닝이 없다(per-click은 `compute=client` 플립 + 렌더만).
  - "[캐시 제거]" 링크로만 `unregister` + 캐시 삭제.
  - `sw.js`의 `KILL=true`를 배포하면 다음 활성화에서 자가 unregister + 전체 캐시 삭제
    (원격 킬스위치). activate에서 옛 버전 캐시 정리(현재 `bcr-client-v2`).
- **부트스트랩 한계**: 생애 첫 1회 온라인 방문이 있어야 SW가 깔린다.
- **새 이벤트 갱신**: SW가 network-first라 온라인에선 항상 최신을 받는다(서버가 막지 않음).
  단 같은 탭에서 이미 본 이벤트는 sessionStorage 재사용, 서버 HTTP 캐시(10분)로 최근 추가분이
  약간 지연될 수 있음(기존 사이트 동작). 확실히 갱신하려면 `[캐시 제거]`.

---

## 알고리즘/이식 메모

### xorshift32 (gacha.rb → track-engine.js)
```
advance:  x ^= x<<13; x ^= x>>17; x ^= x<<15;
retreat:  x ^= x<<15; x ^= x<<30; x ^= x>>17; x ^= x<<13; x ^= x<<26;
```
JS는 32-bit 비트연산이라 그대로 옮기되 비교/나머지는 `>>> 0`(unsigned). rarity는
`score = rarity_seed % 10000` 윈도우(rare/supa/uber/legend).

### FindCat 부수효과 (중요)
`prepare_tracks`는 `finish_*` 뒤에 `FindCat.search`를 돌리는데, 이게 exclusives+legend+find
타겟을 다 찾을 때까지 `count` 너머로 추가 롤을 한다. 그 부수효과로 **마지막 가시 행의 forward
`.next`**가 채워진다(다 찾으면 추가 롤 0 → null). 엔진의 `runFindCat`이 이 순서/부수효과까지
재현해야 서버와 `.next`가 일치한다. `runFindCat`은 순서 보존 Map + occurrences/missing까지
포팅되어 `found_cats` 패널 렌더에도 쓰인다.

### 검증 (모두 서버와 1:1 일치 확인 — 임시 하네스로 검증 후 제거)
- 트랙 데이터: normal/11-roll보장/15-roll스텝업/platinum × 7 시드 × count=50.
- 렌더 HTML: 4 이벤트 × 3 시드 × {text, +details, both} (URL/공백 정규화 후 구조 비교).
- 파라미터: 4 이벤트 × 2 시드 × {pos, last, pick, pick+X/+G/+GX, ubers, find, 콤보} = 72조합.
- found_cats: platinum/normal/g11/g15 + find= 케이스.

---

## Count 상한
서버는 `count`를 `TrackMaxCount`(HF 500)로 자동 클램프한다(서버 모드는 그대로 안전).
클라 모드는 서버 제한이 없어 `track-client.js`에서 `CLIENT_MAX_COUNT = 9999`로 클램프
(폰에서 거대한 표 렌더 방지). 서버 count 로직/`control.erb`는 무수정.

## 해결한 버그 / 함정 (재발 방지용)

- **ubers 캐시 미스**: 폼은 항상 `ubers=0`을 보내는데 초기 URL엔 없어 캐시 키가 달라져
  시드마다 `/track.json` 재fetch(오프라인 멈춤). → `track-data.js`에서 `ubers=0`↔없음 정규화.
- **캐트 클릭 이중 발동**: 캐트 셀에 인라인 `onclick="pick(...)"`가 있어, 캐트 링크 클릭 시
  링크 핸들러와 `pick()`가 둘 다 발동 → 이중 내비/재렌더(깜빡임+요청). → 클릭 가로채기를
  **캡처 단계 + `stopPropagation`**으로 변경(링크는 roll만, 셀 배경은 pick).
- **폼 미갱신**: 로컬 렌더는 `.table`/`.found_cats`만 교체해 seed 입력칸이 과거값 →
  렌더 후 `syncForm`으로 seed/pos/last/count/event/find/ubers 갱신.
- **SW 검은 화면**: install precache 누락 → 위 "오프라인" 참고.

### 코드리뷰 반영 (추가 수정)
- **compute=client 직접 링크 빈 화면**: 새 브라우저(localStorage off)에서 `?compute=client`
  링크는 서버가 표를 스킵하는데 클라도 안 그렸음 → `enabled()`가 URL의 `compute=client`도
  활성으로 취급.
- **SW ignoreSearch 오염**: 모든 요청에 ignoreSearch 폴백을 써서 오프라인 `/track.json?event=A`가
  B를 반환할 수 있었음 → ignoreSearch는 `/asset/*` 정적 자산에만 적용.
- **SHELL 오염**: 어떤 navigation이든 SHELL로 저장 → `/cats/...` 방문 뒤 오프라인 셸이 cats
  페이지가 될 수 있었음 → SHELL 갱신은 pathname `/`일 때만.
- **guaranteed 파라미터 누락**: `force_guaranteed`/`no_guaranteed`를 엔진에 안 넘겨 서버와
  guaranteed/found_cats가 갈렸음 → `guaranteedRolls = force_guaranteed || pool`, `guaranteed
  = !no_guaranteed` 전달.
- **custom 확률 누락**: custom gacha의 `rate/c_rare/c_supa/c_uber`가 `/track.json` URL/캐시
  키에서 빠져 기본 확률로 렌더됐음 → 네 값을 `TrackData.load`/URL/cache key에 포함.
- **[캐시 제거] stale**: SW 캐시만 지우고 `TrackData` 메모리/sessionStorage는 남았음 →
  `TrackData.clear()`로 `track|` 키와 메모리도 비움.

## 남은 부가 항목 (선택)
- 메인 페이지 상단 `information.erb`(배너 정보 패널)는 클라 렌더 미포함(메인 트랙 표·found_cats는 완전 일치).
- recent-seeds 패널 링크(#content 밖)는 가로채지 않음 → 클릭 시 전체 내비게이션.
- name(form) 변경 시 `img`는 fetch 시점 form 기준이라 이미지가 약간 어긋날 수 있음(텍스트는 정확).
- Feature A 후속: 11/15-roll 세 번째 링크, 진행률/취소 UI, 멀티스레드(SharedArrayBuffer+COOP/COEP).

---

## 파일 인벤토리

신규(클라):
`asset/seeker-worker.js`, `seek-client.js`, `seeker-vampireflower.js`/`.wasm`(A),
`asset/track-data.js`, `track-engine.js`, `track-render.js`, `track-client.js`, `sw.js`(B).

신규(서버):
`Seeker/Seeker-VampireFlower-wasm.c`, `Seeker/bin/build-VampireFlower-wasm.sh`,
`lib/battle-cats-rolls/track_api.rb`.

수정(국소):
`Seeker/Seeker-VampireFlower.c`(가드), `server.rb`(require+map+rewrite),
`route.rb`(compute 접근자+키), `web.rb`(/ 핸들러 조건),
`view/find_cat.erb`(조건+토글), `view/index.erb`(스크립트), `view/seek_form.erb`(라디오, A).

무수정(보존):
`seek_seed.rb`, `/seek/enqueue`·`/seek/result` 흐름, `gacha.rb`,
`route.prepare_tracks`·렌더, `table.erb`, `view.rb`, `layout.erb`, `TODO.md`.
