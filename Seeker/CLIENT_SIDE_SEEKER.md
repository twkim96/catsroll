# Client-Side Seed Seeker (클라이언트 시드 검색)

> 이 문서는 "내 기기 연산" 시드 검색 기능의 배경, 단계별 계획, 설계 원칙을 기록한다.
> 다음 단계로 넘어갈 때 맥락을 다시 설명하지 않아도 되도록 하는 것이 목적이다.

## 1. 배경 / 동기

기존 시드 검색은 전부 서버에서 수행된다.

- `lib/battle-cats-rolls/seek_seed.rb` 의 `Pool = PromisePool::ThreadPool.new(1)`
  - **스레드 1개짜리 풀**에서 한 번에 하나의 검색만 처리한다.
  - 동시 요청은 큐에 쌓이고(화면에 `position` 표시), IP throttle도 걸린다.
- 실제 연산은 `Seeker/Seeker-VampireFlower.c` 바이너리를 `IO.popen`으로 호출.

즉 "서버가 바쁘다"의 본질은 **CPU 바운드 검색 큐 병목**이지 웹/데이터 서빙 병목이 아니다.

- 페이지/이벤트 데이터 서빙은 별개이고 이미 캐시됨 (`config/varnish.vcl`, 10분 TTL).
- 검색은 `SeekHost`/`SeekBind`로 호스트 자체가 분리되어 있음 (`server.rb`).

### 이 기능이 해결하는 것

| 증상 | 원인 | 클라이언트 검색으로 해결되나 |
|---|---|---|
| 검색 중 404 / 타임아웃 | `/seek/result/:key` 폴링이 바쁜 seek 서버를 침 | ✅ 폴링 자체가 사라짐 |
| 같은 이벤트 재검색 느림 | 매번 서버 큐 대기 | ✅ 로컬 연산이라 큐 무관 |
| 최초 데이터 로딩이 느림 | 캐시 미스가 바쁜 백엔드를 침 (부트스트랩) | ⚠️ 1회 fetch는 성공해야 함 (Stage 2에서 완화) |

## 2. 핵심 설계 원칙

1. **기존 서버 검색 로직을 절대 건드리지 않는다.**
   - `seek_seed.rb`, `Seeker-VampireFlower.c`, `/seek/enqueue`, `/seek/result/:key`
     경로는 그대로 둔다.
   - 클라이언트 검색은 **추가 경로**로만 동작하며, 옵션이 꺼져 있으면 기존 흐름과
     100% 동일하게 동작해야 한다.
2. **알고리즘은 재구현하지 않고 기존 C를 WASM으로 컴파일해 재사용한다.**
   - unsigned/오버플로우 미세 버그 위험 제거, 정확성 보정 로직(`verify_seed`)까지 그대로.
   - C가 업데이트되면 한 소스로 네이티브 + WASM 양쪽 커버.
3. **점진적 적용.** Stage 1만으로도 검색 병목/404 문제는 해결된다. 오프라인은 별도 단계.

## 3. 옵션 설계: "내 기기 연산"

검색 위치를 고르는 **라디오 버튼** 옵션을 추가한다. ("오프라인"보다 직관적인 표현)

```
시드 검색 위치:
  ( ) 서버 연산        ← 기본값, 기존 동작 그대로
  ( ) 내 기기 연산      ← 브라우저(WASM)에서 직접 계산
```

- 위치: `lib/battle-cats-rolls/view/seek_form.erb` 의 seeker `<select>` 근처.
- 파라미터 이름(잠정): `compute` = `server` | `client`.
  - 기본값은 `server` → 미설정/구버전 링크는 기존 동작 유지.
- 라벨 다국어는 `data/<lang>/l10n.yaml` 에 추가 (UI language 옵션과 동일한 방식).
- 상태 유지: 다른 옵션들(`lang`, `name` 등)과 같은 패턴으로 쿼리/hidden input 처리.

## 4. 검색에 필요한 입력 (self-contained)

`lib/battle-cats-rolls/route.rb` 의 `seek_source` 가 곧 검색 입력 전부다:

- `seek_rates`  : 등급별 확률 4개 (`gacha.rare/supa/uber/legend`)
- `seek_slots`  : 등급별 슬롯 개수 4개 (`*_cats.size`)
- `seek_rolls`  : 사용자가 고른 (rarity, slot) 쌍의 나열

이 입력은 이벤트 데이터에서 파생되며 네트워크 없이 계산 가능하다.
출력은 begin/end 시드 두 개뿐.

> 주의: 검색 자체는 위 입력만 필요하지만, **결과를 화면에 표시**(어떤 캐트가 뽑히는지
> 트랙 렌더링)하려면 gacha pool + cat 데이터가 필요하다. 이는 이미 로딩된 페이지
> 데이터로 충족된다.

## 5. 단계별 계획

### Stage 1 — 클라이언트 WASM 검색 (영향 최소, 지금 진행)

목표: 옵션을 켜면 검색을 브라우저에서 수행. 데이터는 평소대로 캐시된 엔드포인트에서.

작업 항목:
- [x] `Seeker-VampireFlower.c` 를 Emscripten으로 WASM 빌드 (네이티브 빌드 보존)
  - 알고리즘/전역은 그대로 재사용. `SEEKER_WASM` 가드로 pthread 드라이버와
    `main()` 만 제외 → 네이티브 빌드는 코드상 동일.
  - WASM 드라이버 `Seeker-VampireFlower-wasm.c` 가 단일 스레드로 `seek_seed()` 노출.
  - 빌드 스크립트: `Seeker/bin/build-VampireFlower-wasm.sh`
    → `lib/battle-cats-rolls/asset/seeker-vampireflower.js` (+ `.wasm`) 생성.
- [x] Web Worker 글루 `asset/seeker-worker.js` (단일 워커, 메인 스레드 비차단)
- [x] 옵션 라디오 버튼 (`seek_form.erb`): `compute=server|client`, 기본 `server`
  - 순수 클라이언트 동작이라 **서버 라우트/로직 변경 없음**.
    `compute=client` 일 때만 `asset/seek-client.js` 가 submit을 가로채 워커 실행.
- [x] 결과 표시: `#client-seek-result` 에 시작/마지막 시드 링크 렌더
  (`route.uri` 가 내려준 track base에 `&seed=` 만 덧붙여 트랙 페이지로 연결).
  count>1 이면 "1개 이상 발견" 경고.
- [x] 정확성 검증: 네이티브 바이너리와 1:1 대조 (아래 "검증" 참고)

후속(여유 시):
- [ ] 11/15-roll 오프셋(세 번째 링크) 클라이언트 계산 — 현재는 시작/마지막 시드만 표시
- [ ] 진행률 표시/취소 버튼 (현재는 "검색 중..." 메시지)
- [ ] 멀티스레드(pthread + SharedArrayBuffer + COOP/COEP) 병렬화

건드리지 않는 것: `seek_seed.rb`, 서버 `/seek/enqueue`·`/seek/result` 흐름, C 네이티브 빌드.

#### 빌드 방법

표준 emscripten(emsdk) 환경이면:

    ./Seeker/bin/build-VampireFlower-wasm.sh

이 개발 머신(Homebrew emscripten)에서는 emcc가 시스템 python/llvm을 잘못 잡을 수
있어 환경변수로 지정해 빌드했다:

    EMSDK_PYTHON=/opt/homebrew/opt/python@3.14/bin/python3.14 \
    EM_LLVM_ROOT=/opt/homebrew/opt/emscripten/libexec/llvm/bin \
    EM_BINARYEN_ROOT=/opt/homebrew/opt/emscripten/libexec/binaryen \
    ./Seeker/bin/build-VampireFlower-wasm.sh

산출물(`asset/seeker-vampireflower.js` + `.wasm`)은 빌드 결과물이다. 네이티브
바이너리는 배포 시 빌드되어 `.gitignore` 처리되지만, 서버에 emscripten을 두지
않으려면 이 WASM 자산은 커밋해서 배포하는 편이 낫다. (정책 미확정 — 커밋 여부 결정 필요)

#### 검증 결과

동일 입력으로 네이티브 바이너리와 WASM 출력을 대조:
- 시드가 **유일한 경우**(롤 8~10개, 실사용 시나리오): begin/end **완전 일치**.
- 시드가 **모호한 경우**(롤 5개 등 정보 부족): 양쪽 모두 count>1 로 "1개 이상" 보고.
  begin/end가 서로 다를 수 있는데, 이는 네이티브가 멀티스레드라 조기 종료 시점이
  **비결정적**이기 때문이며 버그가 아니다(둘 다 유효한 매치). UI는 count>1 경고로 처리.


### Stage 2 — 오프라인 / PWA (선택, 별도 니즈가 있을 때)

목표: 첫 fetch 한 번만 성공하면 이후 완전 오프라인 동작.

작업 항목:
- [ ] Service Worker로 앱 셸 + WASM 바이너리 사전 캐시
- [ ] 이벤트 데이터(TSV/gacha)를 Cache Storage / IndexedDB에 저장
- [ ] 데이터 fetch 재시도 + 백오프 (바쁜 서버 대응)
- [ ] (선택) 정적 데이터 엔드포인트를 바쁜 seek 서버 경로에서 분리 / CDN

부트스트랩 한계(반드시 인지): 오프라인 캐시는 **과거에 1회 성공적으로 받은 데이터**만
제공할 수 있다. 생애 첫 fetch가 끝내 실패하면 부트스트랩 불가. 그래서 재시도/CDN 분리로
"그 한 번"의 성공률을 높이는 것이 Stage 2의 핵심.

## 6. 기술 메모

### xorshift32의 JS/WASM 매핑

C:
```c
x ^= x << 13; x ^= x >> 17; x ^= x << 15;
```
JS(참고용, 실제로는 WASM 사용): 비트 연산이 32비트라 거의 그대로. unsigned 비교/나머지는
`>>> 0` 필요.
```js
x ^= x << 13; x ^= x >>> 17; x ^= x << 15; return x >>> 0;
```

### COOP/COEP (멀티스레드 WASM용)

`SharedArrayBuffer` 기반 pthread 병렬화를 쓰려면 응답 헤더 필요:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
- nginx(`config/nginx.conf`) 또는 varnish 앞단에서 설정.
- 1차(단일 워커)에서는 불필요. 병렬화 단계에서 도입.

### 성능

- 탐색 공간은 최대 2^32(약 43억) 시드 브루트포스.
- C는 멀티스레드 + `mod_10000` 매직넘버 + rarity/slot 중 작은 탐색공간 선택
  (`determine_fastest_approach`) 으로 최적화됨 → WASM에 그대로 이식됨.
- 단일 워커여도 동작은 하나, 병렬화 시 네이티브에 근접.

## 7. 변경 대상 / 비대상 요약

변경(추가):
- `Seeker/bin/build-VampireFlower.sh` (emcc 타겟 추가)
- `lib/battle-cats-rolls/asset/seeker-worker.js` (신규)
- WASM 산출물(`Seeker/` 또는 `asset/`)
- `lib/battle-cats-rolls/view/seek_form.erb` (라디오 옵션)
- `data/<lang>/l10n.yaml` (라벨)
- (Stage 2) Service Worker, 캐시, 헤더 설정

비변경(보존):
- `lib/battle-cats-rolls/seek_seed.rb`
- 서버 `/seek/enqueue`, `/seek/result/:key` 흐름
- `Seeker-VampireFlower.c` 의 네이티브 빌드 및 알고리즘
