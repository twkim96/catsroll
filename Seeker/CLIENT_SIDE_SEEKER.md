# Client-Side Computation (내 기기 연산)

> 서버가 바쁠 때 브라우저에서 직접 계산하기 위한 "내 기기 연산" 기능들의 배경,
> 단계별 계획, 설계 원칙을 기록한다. 다음 단계로 넘어갈 때 맥락을 다시 설명하지
> 않아도 되도록 하는 것이 목적이다.

## 0. 두 가지 독립 기능 (방향이 반대)

| 기능 | 방향 | 위치 | 연산 성격 | 상태 |
|---|---|---|---|---|
| **A. 시드 찾기 (Seeker)** | 롤(뽑은 캐트들) → 시드 | `/seek` | 2^32 브루트포스 → **WASM** | ✅ 완료 |
| **B. 트랙 렌더 (Tracker)** | 시드 → 배열(트랙) | `/?seed=...&event=...&lang=...` | 정방향 시뮬레이션 → **순수 JS** | ⏳ 계획 (본 목표) |

- A는 "내가 뽑은 캐트들로 내 시드를 알아내기". 브루트포스라 WASM이 필요했다.
- B는 "시드를 넣으면 그 시드로 뽑히는 캐트 순서(트랙)를 예측하기". 메인 페이지가 하는 일.
  직접 시뮬레이션이라 매우 빠르고 **WASM이 필요 없다(순수 JS로 충분)**.
- **현재 주 목표는 B (트랙 렌더)이며, 서버와 동일한 풀 렌더(full render)를 목표로 한다.**
  A는 이미 배포되어 동작하는 유효 기능이므로 그대로 유지한다.

## 1. 공통 설계 원칙

1. **기존 서버 로직을 건드리지 않는다.** 클라이언트 연산은 옵션이 켜졌을 때만 도는
   추가 경로이며, 꺼져 있으면 서버 동작과 100% 동일해야 한다.
2. **알고리즘은 가능하면 재사용/이식하되 정확성을 검증한다.** 서버 출력과 1:1 대조.
3. **점진 적용.** 각 단계가 단독으로 가치를 가지도록 쪼갠다.
4. **충돌 최소화 (upstream gitlab 병합 대비).** 로직은 최대한 **새 파일**에 담는다.
   - 공유/추적 파일(`route.rb`, `web.rb`, `server.rb`, 뷰들, `TODO.md` 등)은 가능한 한
     수정하지 않는다. 불가피하면 **작고 국소적인 추가**(새 route 블록, 한 줄 include)만.
   - 트랙 표는 **독립 렌더러**로 클라이언트가 자체 생성한다. `table.erb`/`view.rb`를
     수정하는 하이드레이션 방식은 피한다(접촉면·충돌 증가).
   - `TODO.md`는 upstream 추적 파일이므로 손대지 않는다. 계획·메모는 이 문서에만 둔다.

## 2. 병목에 대한 이해 (왜 의미 있나)

"서버가 바쁘다"는 두 가지 별개의 CPU 병목을 포함한다.

- **시드 찾기 큐** (`seek_seed.rb`의 `Pool = ThreadPool.new(1)`): 한 번에 하나씩 처리 →
  A가 해소.
- **트랙 렌더링** (`route.prepare_tracks` → `gacha.rb` 시뮬 + ERB 렌더): 시드/포지션을
  바꿀 때마다 서버가 매번 계산·렌더. 무료 티어처럼 바쁜 인스턴스에서 느리거나 404.
  → **B가 해소.** 시드/포지션 탐색을 서버 왕복 없이 로컬에서 즉시 갱신.

페이지 셸/데이터 서빙은 캐시 대상이라(varnish 10분 TTL) 병목이 아니다. 병목은 위 두
CPU 연산이다.

---

# Feature A — 시드 찾기 (Seeker), WASM ✅ 완료

롤 → 시드. `/seek` 페이지. 기존 C 시커(`Seeker-VampireFlower.c`)를 Emscripten으로
WASM 컴파일해 브라우저 Web Worker에서 단일 스레드로 실행한다.

구현 요약:
- `Seeker-VampireFlower.c`: `SEEKER_WASM` 가드로 pthread 드라이버와 `main()`만 제외.
  알고리즘/전역은 그대로 공유 → 네이티브 빌드는 코드상 동일.
- `Seeker-VampireFlower-wasm.c`: 단일 스레드 `seek_seed()` 드라이버.
- `Seeker/bin/build-VampireFlower-wasm.sh` → `asset/seeker-vampireflower.js`(+`.wasm`).
- `asset/seeker-worker.js`: 워커. `asset/seek-client.js`: `compute=client`일 때만
  submit을 가로채 워커 실행. `seek_form.erb`: 라디오(서버/내 기기) + 결과 영역.
- 서버 라우트/로직 변경 없음.

빌드 (이 개발 머신, Homebrew emscripten):

    EMSDK_PYTHON=/opt/homebrew/opt/python@3.14/bin/python3.14 \
    EM_LLVM_ROOT=/opt/homebrew/opt/emscripten/libexec/llvm/bin \
    EM_BINARYEN_ROOT=/opt/homebrew/opt/emscripten/libexec/binaryen \
    ./Seeker/bin/build-VampireFlower-wasm.sh

검증: 유일 시드(롤 8~10개)는 네이티브와 begin/end 완전 일치. 모호한 경우(롤 적음)는
양쪽 모두 count>1 보고(네이티브는 멀티스레드라 비결정적, 버그 아님).

후속(선택): 11/15-roll 세 번째 링크, 진행률/취소 UI, 멀티스레드(SharedArrayBuffer+COOP/COEP).

산출물(`.js`/`.wasm`)은 커밋한다. HF Docker 이미지엔 emscripten이 없어 빌드 산출물을
그대로 서빙해야 하기 때문이다. C 알고리즘 변경 시 로컬 재빌드 후 산출물 재커밋 필요.

---

# Feature B — 트랙 렌더 (Tracker), 순수 JS ⏳ 목표: 풀 렌더

시드 → 배열. 메인 페이지 `/?seed=...&event=...&lang=...`. 옵션을 켜면 트랙 계산과
표 렌더를 **브라우저에서** 수행하여, 서버가 바빠도 시드로 내 배열을 확인/탐색할 수 있게 한다.

**목표는 MVP가 아니라 서버와 동일한 풀 렌더**(같은 표 구조·라벨·링크·이미지)다.
순수 JS로 구현하며 WASM은 쓰지 않는다.

## B.1 서버 파이프라인 매핑 (이식 대상)

트랙 1건을 만드는 서버 흐름과 대응하는 이식 작업:

1. **풀 구성** — `gacha_pool.rb` (`GachaPool`), `crystal_ball.rb`
   - 이벤트+언어의 ball에서: 등급별 슬롯(`slots`: rare/supa/uber/legend의 cat id 배열),
     확률(`rare/supa/uber/legend`, Base=10000), `guaranteed_rolls`(0/11/15),
     `add_future_ubers`(미래 우버 추가), `version`.
   - → 클라이언트엔 **이미 구성된 풀을 JSON으로 전달**(아래 B.3). 풀 구성 로직 자체는
     이식하지 않아도 됨.

2. **롤링 시뮬레이션** — `gacha.rb` (핵심 이식 대상)
   - `advance_seed` / `retreat_seed` (xorshift32 정/역방향), `backtrack_seed`.
   - `roll_both!`(A/B 두 트랙), `roll_cat`/`roll_cat!`, `dig_rarity`, `new_cat`.
   - `reroll_cat`(중복 rare 리롤), `fill_cat_links`(중복 시 다음 셀 연결),
     `finish_rerolled_links`, `finish_last_roll`.
   - `finish_guaranteed`/`fill_guaranteed`(보장 우버), `follow_cat`.
   - `finish_picking` 계열(pick 라벨), `mark_next_position`.
   - `next_index`/`next_track` 등 위치 계산.

3. **캐트 모델** — `cat.rb` (`Cat`)
   - `duped?`, `pick_name(form)`, `number`, rarity/slot/seed 필드, `rerolled`/`guaranteed`/
     `next` 링크, `picked_label`, 이미지 id 등 렌더에 필요한 속성.

4. **찾기 기능** — `find_cat.rb` (`FindCat.search`) — "find" 파라미터로 특정 캐트 강조.

5. **렌더** — `view.rb` 헬퍼 + `view/table.erb` + `view/index.erb`
   - `each_ab_cat`, `number_td`, `seed_tds`, `score_tds`, `cat_tds`(+`td_to_cat`),
     `cat_name`, `uri_for_backtrack`, `uri_to_roll`, `uri_to_cat`.
   - `show_details` 모드(Seed/Score·Slot 열 표시) 분기.
   - rowspan 계산(리롤/보장에 따른 셀 병합), A/B 트랙, Backtrack 셀, 마지막 행.
   - **풀 렌더 = 서버가 내보내는 HTML과 동일한 표/라벨/링크/이미지 산출.**

6. **롤 개수** — `count`(기본 100, `TrackMaxCount`로 상한; HF는 500).

## B.2 알고리즘 메모 (xorshift32)

정방향(advance):
```
x ^= x << 13; x ^= x >> 17; x ^= x << 15;   // 32-bit, unsigned
```
역방향(retreat, backtrack용):
```
x ^= x << 15; x ^= x << 30; x ^= x >> 17; x ^= x << 13; x ^= x << 26;
```
JS는 비트연산이 32-bit라 그대로 옮기되, 비교/나머지는 `>>> 0`로 unsigned 처리.
rarity 판정은 `score = rarity_seed % 10000` 윈도우(rare/supa/uber/legend) 기준.

## B.3 데이터 전달 (이벤트 정보만 받아오면 로컬 가능)

서버에 **작은 read-only JSON 엔드포인트** 추가를 제안 (값싸고 캐시 가능):

- 입력: `event`, `lang`(, `name`/form).
- 출력: 해당 이벤트의 풀
  - 등급별 슬롯(cat id 배열), 확률 4개, `guaranteed_rolls`, `version`.
  - 슬롯에 등장하는 캐트들의 메타: id별 이름(form별), rarity, 이미지 id, l10n 라벨.
- 클라이언트는 이 JSON을 한 번 받아(캐시) JS로 롤링·렌더. 시드/포지션/pick 변경은
  네트워크 없이 로컬 갱신.

> 이 엔드포인트는 기존 서버 트랙 라우트와 별개의 추가 경로다(서버 로직 불가침 원칙).

## B.4 UI

메인 페이지에 "내 기기 연산" 토글(라디오/체크박스) 추가:
- 기본 = 서버 렌더(기존 동작 그대로).
- 켜면 = JSON 풀을 받아 클라이언트가 트랙 표를 렌더. 시드/포지션 변경 시 즉시 재계산.
- 가능하면 서버 렌더 결과와 DOM이 동일하도록(점진적 하이드레이션 형태도 검토).

## B.5 단계 (최종 목표는 풀 패리티)

풀 렌더가 목표지만 검증을 위해 순서대로 진행한다.

- [x] B-1: 데이터 JSON 엔드포인트 + 클라이언트 fetch/캐시
  - 서버: `lib/battle-cats-rolls/track_api.rb` (신규) — `GET /track.json`이 이벤트/언어의
    풀(등급별 슬롯 cat id, 확률, base, guaranteed_rolls, version) + 캐트 메타(이름 form별,
    rarity)를 JSON으로 반환. `Route#gacha.pool` 재사용(=route.rb 무수정). `server.rb`엔
    require 1줄 + map 블록만 추가.
  - 클라: `lib/battle-cats-rolls/asset/track-data.js` (신규) — `/track.json` fetch +
    sessionStorage 캐시. `TrackData.load({event,lang,name,custom,ubers})`.
  - 검증: platinum(uber만 132) / 일반(rare25·supa18·uber13) 케이스 + 기존 트랙/seek 페이지
    회귀 없음 확인.
- [x] B-2: `gacha.rb` 롤링 로직 JS 포팅 → `asset/track-engine.js` (신규)
  - advance/retreat/shift, roll_both/roll_cat, dig_rarity, new_cat,
    reroll_cat(중복 rare), fill_cat_links, finish_rerolled_links,
    finish_last_roll, finish_guaranteed/follow_cat, finish_picking 계열,
    mark_next_position, backtrack_seed, next_index/next_track.
  - `find_cat.rb`도 포팅(`runFindCat`): exclusives+legend+find 타겟을 찾을 때까지
    count 너머로 롤 → 마지막 가시 행의 forward `.next`가 서버와 동일해짐.
    (prepare_tracks가 finish_* 뒤에 FindCat.search를 돌리는 순서/부수효과까지 재현)
  - 32-bit unsigned는 `>>> 0`로 처리. extra_label는 Ruby와 동일하게 미설정 시 null.
- [x] B-3: 서버 `prepare_tracks`와 1:1 대조 검증 완료
  - normal / 11-roll보장 / 15-roll스텝업 / platinum 4개 이벤트 × 7개 시드 × count=50:
    id·score·slot·slot_seed·rarity_seed·next·rerolled·guaranteed·picked_label 전부 일치.
  - 검증 하네스는 임시(`tmp_verify2`)로 작성 후 제거. 회귀 시 재작성 가능.
  - (pick/pos/last는 엔진에 포팅됨. 전용 비교는 B-5에서.)
- [x] B-4: `table.erb` + view.rb td/link 헬퍼 풀 렌더 → `asset/track-render.js` (신규)
  - number_td/seed_tds/score_tds/cat_tds/td_to_cat/link_to_roll/link_to_next/
    link_to_cat/avatar_tag, color_rarity/color_label(exclusive/found/owned/picked),
    expand_data_attrs, onclick_pick, uri_to_roll/uri_to_cat/backtrack/number_td URL.
  - 엔드포인트에 렌더용 데이터 보강: cat별 `desc`(title용), `img`(요청 form 기준 해석).
  - 검증: 서버가 그린 `<table>`과 클라 렌더를 URL/공백 정규화 후 구조 비교.
    4 이벤트(normal/g11/g15/platinum) × 3 시드 × {text, text+details, both} = 36조합 일치.
- [ ] B-5: find/pick/last/pos/ubers 등 부가 파라미터까지 패리티
- [ ] B-6: 메인 페이지 "내 기기 연산" 토글 + 로컬 탐색(시드/포지션 즉시 갱신)

건드리지 않는 것: 서버 트랙 라우트/렌더, `gacha.rb`/`route.rb` 등 서버 로직,
Feature A의 모든 것.

---

## 변경 / 비변경 요약

추가(완료, Feature A):
- `Seeker/Seeker-VampireFlower-wasm.c`, `Seeker/bin/build-VampireFlower-wasm.sh`
- `lib/battle-cats-rolls/asset/seeker-worker.js`, `seek-client.js`,
  `seeker-vampireflower.js`/`.wasm`
- `lib/battle-cats-rolls/view/seek_form.erb` (라디오)
- `Seeker/Seeker-VampireFlower.c` 에 `SEEKER_WASM` 가드만

추가 예정(Feature B):
- 풀 JSON 엔드포인트 (서버, read-only 추가 경로)
- 클라이언트 트랙 엔진 + 렌더 JS (신규 asset)
- 메인 페이지 "내 기기 연산" 토글 (`view/options.erb` 또는 메인 폼)

비변경(보존):
- `seek_seed.rb`, 서버 `/seek/enqueue`·`/seek/result` 흐름
- `Seeker-VampireFlower.c` 의 네이티브 빌드/알고리즘
- 서버 트랙 라우트(`route.prepare_tracks`)·렌더·`gacha.rb` 로직
