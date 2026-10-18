# ChatGPT용 Catsroll 플러그인

## 목적과 현재 범위

시드 찾기와 Multi의 배열·교차 배너 R/G·Find 경로 탐색을 대화 안의 앱에서 실행한다.
기존 Multi의 배열·Find·플랜 컨트롤러와 JS/WASM 엔진을 공유한다.
배열은 기존 Multi의 기기 JS, Find·시드 찾기는 기기 Worker에서 실행한다.
상단 시드·횟수·배너 입력은 기존 GPT 디자인을 유지하며, 아래에 Multi의 선택·표·플랜 기능을 배치한다.
서버는 공개 배너·캐릭터·풀 데이터와 앱을 제공하며 계산 서버로 자동 전환하지 않는다.

현재는 시험 버전이며 실제 호스트·계정별 수용 상태와 남은 검증은 [다음 수용 조건](#다음-수용-조건)에 요약한다.
과거 실행의 날짜·커밋·계정 조건·결과와 한계는 [연동 검증 기록](gpt-validation.md)에 보존한다.

## 파일과 유지보수

- `lib/battle-cats-rolls/local/gpt_mcp.rb`: opt-in HTTP/JSON-RPC와 기존 도구 핸들러·입력 준비.
- `local/gpt_tool_registry.rb`: 도구 이름·스키마·노출·annotations·접근 정책·핸들러의 정적 정의. 목록과 실행이 같은 정의를 사용한다. `local/gpt_validation.rb`는 공통 검증이다.
- `local/gpt_widget.rb`: 기존 UI/Worker 자산 조립과 콘텐츠 지문 생성. 현재 런타임 조립 방식을 보존하고 배포 전 빌드는 후속 검토한다.
- `local/gpt_target_selection.rb`: 실제 배너 풀에서 올컬 목표·명시적 보유 제외·제한 상태를 구성한다. 계산 엔진을 실행하지 않는다.
- `local/gpt_results.rb`: 스냅샷 검증·한시적 보관·만료·할당량·멱등성·접근 경계. `local/gpt_result_query.rb`는 저장소와 독립된 불변 스냅샷 투영·페이지 생성이다.
- `local/gpt_banner_preview.rb`: 기존 KR/JP 시리즈 연결과 최신 참고 풀 조회. 서버 계산은 하지 않는다.
- `asset/gpt-runtime.js`, `asset/gpt-worker.js`: 기존 엔진의 기기 실행과 취소·직렬화.
- `asset/gpt-host-bridge.js`: 수동 MCP/브라우저 전송, 출처 고정·capability·pending·연결 종료. SDK 교체는 이 경계 안에서 검토한다.
- `asset/gpt-application-state.js`: 입력/플랜 revision, 계산 실행 세대·취소·완료 상태. 이전 세대 응답은 현재 결과를 변경하지 못한다.
- `asset/gpt-share.js`: 고정 스냅샷별 저장·전달·재시도와 복구 상태. GPT/Claude 차이는 전송 정책에만 있다.
- `asset/gpt-app.js`, `asset/gpt-inputs.js`, `asset/gpt-input-transfer.js`, `asset/gpt-app.css`, `view/gpt_app.html`: UI·공통 Multi 컨트롤러 연결·독립 미리보기.
- `asset/gpt-snapshot.js`: 텍스트를 거치지 않는 구조화 캡처. `gpt-result-summary.js`는 고정 스냅샷의 제한된 모델 문맥만 생성한다.
- `view/multi.erb`, `asset/multi-{track,find,plan}.js`: 표·목표 선택·경로 도장·플랜의 공통 UI. `CatsrollMultiHost`가 있을 때만 MCP 데이터·Worker·임시 저장소를 사용한다.
- `plugins/catsroll/{plugin,mcp}.json`: 원격 MCP 플러그인 패키지 원본.
- `bin/package-gpt-plugin.rb`: 설정된 공개 origin으로 ZIP 생성. 생성물은 `temp/`.
- 계산 원본: `asset/track-engine.js`, `multi-find-engine.js`,
  `seeker-vampireflower.js`와 `seeker-vampireflower.wasm`.

엔진·WASM은 복제하여 관리하지 않는다. UI 리소스 URI에는 현재 엔진·화면 파일의
SHA-256 지문이 들어간다. 준비한 풀의 버전은 별도 `dataVersion`으로 전달한다.
배포 전 도구 설명을 호스트가 기억하는 경우에도 기존 `ui://catsroll/multi-<16자리 지문>.html`
요청은 현재 호환 앱으로 응답한다. Claude의 `-claude-1.html` 주소는 해당 연결에서만
허용한다. 과거 버전의 보관·재현 주소는 아니며, 새 목록은 계속 최신 지문을 광고한다.
GitLab 업데이트 후에는 해당 변경에 영향을 받는 기존 테스트와 이 어댑터 테스트를 확인한다.
연결은 기존 `local_features.rb`와 `local/server_middleware.rb` 안에 한정한다.
컨트롤서버의 기존 merge/push 경로는 변경하지 않는다.

## 상태 소유권과 계약 회귀

연결의 초기화·출처·RPC pending은 HostBridge가 소유한다. 계산 실행은 ApplicationState의
세대 번호로 늦은 응답을 차단하며 기존 엔진/컨트롤러가 결과를 소유한다. ShareJob은 고정 캡처,
멱등성 키·결과 ID, publishing/published/delivering/delivered/recoverable_error를 소유한다.
입력 변경은 현재 계산을 무효화하지만 이미 고정한 ShareJob은 유지한다. 플랜 편집은 별도 revision으로
새 공유를 만들 수 있고 배열 재계산을 요구하지 않는다. 전송 실패는 계산 실패로 표시하지 않는다.
호스트 준비 알림은 시작 시점의 입력/플랜 revision과 명시된 요청 필드를 함께 대조한다.
보유 제외 ID만 집합으로 비교해 서버의 중복 제거를 허용한다. 배너·관측·목표 배열은 순서를 유지한다.
표준 알림에는 호출 ID가 없으므로 다른 입력의 결과나 수정 뒤 결과를 자동 적용하지 않고 보류한다.
상관관계를 알 수 없는 오류도 새 pending 준비를 소비하지 않는다. 동일 인수의 겹친 호출은
프로토콜만으로 구분할 수 없으므로 호출별 버전의 우선 도착 순서를 보장한다고 주장하지 않는다.
`prepared`/`needs_input`/오류/알 수 없는 응답은 호스트·앱 RPC·fragment 복원에서 같은 해석을 사용한다.
남은 목표 0/30종 초과는 상태를 표시하고 기존 결과의 계산/공유를 막으며, 입력을 수정해 다시 준비한다.
복구 패널은 고정 recoveryJob을 소유하므로 다른 결과 공유가 성공해도 표시·복사·다운로드는 같은 JSON이다.
`ui/resource-teardown`은 호스트 요청으로 분리해 계산 취소·pending 정리·응답·종료하며 자동 업로드하지 않는다.
같은 출처의 부모가 보낸 iframe `ping` 요청에는 빈 성공 결과를 반환한다.
초기화 실패/10초 초과 뒤에는 ‘연결 다시 시도’로 이전 pending·타이머·출처·capability를 지우고
새 ID로 초기화한다. 이전 시도의 응답은 무시하며 ready/connecting 중 재연결은 중복 실행하지 않는다.
종료된 연결은 복구하지 않는다. 목록 요청 실패는 ‘목록 다시 불러오기’로 별도 복구하고 입력을 유지한다.
목록 재시도는 DOM 이동·컨트롤러/이벤트 장착을 반복하지 않는다. 장착 중 코드 오류는 재로딩을 안내하며
부분 장착 상태에서 다시 실행하지 않는다. 복구만으로 계산하거나 결과를 공유하지 않는다.
목표 검색처럼 목록만 좁히는 입력은 계산을 취소하지 않는다. 실제 목표 추가·제거·티켓 허용·예산 변경은
공통 컨트롤러의 `multi-find:settings-changed`로 계산/공유 revision을 무효화한다.

`test/fixtures/gpt_mcp/870cc54d.json`은 구조 변경 전 initialize·tools/list·resources/list와
대표 성공/실패 응답의 기준본이다. UI 지문과 데이터 버전처럼 의도적으로 변하는 값만 정규화한다.
올컬 선택의 추가 입력·설명 변경은 `selection_delta_v1.json`, 명시적 티켓 허용은
`selection_delta_v2.json`에 명시한다. 기준본 자동 갱신은 하지 않는다.
도구의 app visibility는 호스트 표시 메타데이터이며 서버 사용자 인증이 아니다. 현재 익명 공개 조회와
명시적 공유·비밀 결과 ID의 권한 경계는 그대로 유지한다.
호스트가 이전 도구 스키마를 캐시해 `targetSelection`을 받지 못하면 기존 `catsroll_cats`의
동일 이벤트·rarity=4 전체 페이지로 목표를 구성한다. 공유된 배열에 등장한 캐릭터만으로
올컬 명단을 만들지 않는다. 새 자동 선택 입력을 쓰려면 호스트의 도구 정의 갱신이 필요하다.

## 도구 계약

| 도구 | 입력·반환 |
| --- | --- |
| `catsroll_guide` | 질문으로 관련 안내 최대 2개(명시적 limit 최대 3개)의 필요한 절을 검색. `topic`만 지정하면 전체 문서. 본문 합계 최대 16,000자 |
| `catsroll_site_link` | 준비와 같은 입력 검증 후 iframe 없이 일반 배열·Multi·독립 앱 링크 반환. 계산·결과 저장 없음 |
| `catsroll_recommend` | 속성/육성/보유/배너 풀로 상위 티어 후보 조회. 이름·형태·능력은 기존 게임 데이터에서 읽음 |
| `catsroll_banner_preview` | 일정 미정 콜라보/이벤트의 시리즈를 KR·JP 이름/별명/캐릭터 ID로 연결하고 지역별 최신 참고 풀과 `prepare_rows` 반환. 예측·미래 일정 아님 |
| `catsroll_events` | KR/JP 배너 이름·날짜/ID 검색, `cat_id`로 실제 풀에 포함된 배너 역검색, 페이지 최대 50개. `catalog=true`는 앱용 전체 선택 목록을 `_meta`에만 전달하며 `cat_id`와 함께 쓰지 않음 |
| `catsroll_cats` | 모든 형태 이름·검토한 별명 또는 ID로 캐릭터 검색, 페이지 최대 50개. `event`·`rarity`로 실제 배너 풀의 희귀도별 명단 조회. `details=true`는 최대 5종의 현재 형태별 기본 정보와 조건/출처가 붙은 의견 추가 |
| `catsroll_prepare` | `multi`, `seek`와 Find 옵션·플랜 초기 설정을 검증. 기존 `find`는 같은 Multi 화면의 호환 입력 |
| `catsroll_share_result` | 앱 전용 쓰기. 사용자가 공유한 기기 계산 스냅샷을 서버 메모리에 임시 저장하고 최대 1시간 조회를 허용하며 비밀 결과 ID·만료·요약 반환 |
| `catsroll_result` | 모델/앱 읽기. 결과 ID와 summary/array/character/route/plan, 배너·구간·페이지로 조회. 재계산하지 않음 |
| `catsroll_multi_data` | 앱 전용(`_meta.ui.visibility=[app]`) bootstrap/series/pool 전송. 기존 `TrackApi`의 공개 데이터만 `_meta`로 반환하며 계산하지 않음 |

`catsroll_prepare`의 `structuredContent.status`는 **prepared**이며 결과가 아니다.
문단·라길·아이캣 같은 한국어 축약과 백/흑 캐릭터 별명은
`gpt-knowledge/character-aliases.json`에서 ID·출처로 관리한다. 정식 형태명은 게임
데이터에서 읽고, 같은 별명 사전은 웹/MCP Multi의 선택 검색에도 전달한다.
하고축 같은 배너 별명은 정확히 일치하는 시리즈를 부분 문자열보다 우선한다.
집단 표현·중의적인 이름을 한 캐릭터로 합치지 않는다. [검토 기록](gpt-alias-review.md)을 참고한다.
준비 응답의 `guide`는 모드별 설명 주제만 제안하며 계산 결과를 담지 않는다.
풀과 WASM 입력은 `_meta['catsroll/data']`에만 담아 모델 문맥을 불필요하게 채우지 않는다.
사용자가 계산 버튼을 누르고, 완료 후 별도 공유 버튼을 눌러야 요약이 대화로 전달된다.
공유 원본은 `asset/gpt-snapshot.js`가 계산된 출력·입력·플랜에서 직접 정규화한다.
시드 찾기도 `captureSeek`로 `kind=seek`·계산에 사용한 request·status/begin/end/count·해당 payload의
data_version을 고정한다. 설명과 JSON은 이 원본을 사용하며, 시드 결과의 서버 임시 저장은 하지 않는다.
`capture`는 모든 배열·조건부 R/G/RG·Find·플랜을 보존하며 표시 텍스트를 만들거나 역파싱하지 않고 엔진도 다시 실행하지 않는다.
`gpt-result-summary.js`의 기존 `capture/build/buildCaptured` API는 호환을 유지한다. 원본 캡처·모델 문맥·전체 JSON·저장/조회는 동일한 스냅샷을 사용한다.
공유 버튼은 `catsroll_share_result`로 서버 메모리에 저장한 뒤 결과 ID·만료와 함께
압축 A/B 배열·R/G·이름/희귀도 사전·Find 경로·플랜을 모델에 직접 전달한다.
GPT의 기존 짧은 후속 메시지와 Claude의 본문 전달 방식은 유지한다.
전체 전송은 60,000자 이내이며 기본 배열을 조건부 분기보다 우선한다. 여러 배너나 긴
경로로 한도를 넘으면 범주별 생략 수를 밝히고 `catsroll_result`로 필요한 상세만 보충한다.
희귀도 사전이 없는 이전 스냅샷도 읽지만 이름만 보고 희귀도를 추측하지 않는다.
배열의 `nextConditionalQuery`는 결과 ID와 `start`·`rowEnd`를 포함해 행 범위를 고정하고 조건부 분기만 이어 읽는다.
조건부 페이지에서는 배열 행을 반복하지 않으며 `nextStart`는 같은 행 범위 끝을 유지한다.
경로의 `nextOffset`은 액션 페이지 커서로 마지막/범위 밖 페이지에서 null이다. 엔진 진행 위치는
경로 응답에서 `nextTrackOffset`으로 분리한다. 저장 원본의 `find.nextOffset`은 호환을 유지하지만,
모델 문맥·summary 조회 투영에서는 `find.engine_position.next_track_offset`으로 제공한다.
배너의 선택적 `guarantee`는 requested_override/effective_rolls/source로 실제 계산 풀의 확정 조건을
보존한다. 0 override는 배너 기본값이며 effective_rolls와 구분한다. 이 필드가 없는 이전 결과도 조회한다.
모델은 클라이언트가 명시적으로 공유한 결과를 읽으며 서버 검증된 결과로 표현하지 않는다.
공유 전에는 서버 보관하지 않는다. 결과 ID는 256비트 난수인 읽기 권한으로 해당 호스트
(GPT/Claude) 네임스페이스에서 사용한다. 같은 호스트의 계정·대화를 인증하거나 격리하지 않으므로
ID 유출에 주의한다. 파일/DB 없이 단일 프로세스 메모리에 보관하고 조회 가능 시간은 최대 1시간이다.
조회/동일 공유 재시도는 TTL을 연장하지 않으며 만료 후 메모리 정리는 다음 요청 때 수행한다.
Yahns의 GPT 활성 웹 리스너에는 명시적 공유 요청을 위한 8MiB+봉투 용량과 메모리 버퍼를
설정한다. 일반 MCP 요청은 기존 65,536바이트 제한을 유지한다. 재시작 시 즉시 사라질 수 있다.
저장 JSON은 전체 최대 256개·총 64MiB·개별 8MiB이며 기존 유효 결과를 밀어내지 않는다.
앱은 메모리의 무작위 `session_id`와 공유별 `idempotency_key`를 보내며 같은 세션·키·내용 재시도는
기존 ID/만료를 반환한다. 다른 내용에 키를 재사용하면 거부하며 다른 세션/호스트는 중복 제거하지 않는다.
세션별 4개·16MiB·분당 6회, 프로세스 전체 분당 60회를 적용한다. 이전 앱의 키 없는 호출은
공용 legacy 세션 예산으로 호환한다. 세션은 클라이언트가 발급하는 익명 식별자로 새로 발급해 우회할 수 있다.
사용자 인증·강한 공정성·공격 방어를 보장하지 않으며 글로벌 용량 상한은 유지한다.
저장소의 스냅샷 정규화·조회용 JSON 파싱·응답 생성은 동시에 최대 두 작업으로 제한한다. HTTP 본문 버퍼·MCP 봉투 파싱과 저장 외 Ruby 객체는
64MiB 저장 상한 밖이므로 전체 프로세스 메모리 상한이 아니다. 새 쓰기 속도 제한은 정규화 전 적용한다.
`session_full`, `storage_full`, `rate_limited`, `busy`, `idempotency_conflict`를 구조화된 오류로 구분한다.
재배포/재시작은 기존 결과 ID를 무효화하므로 다시 공유해야 한다. 여러 서버 프로세스 간 공유는
지원하지 않는다. 현재 단일 프로세스 HF 운영을 전제로 하며 다중 인스턴스로 늘리기 전 공유 저장소가 필요하다.
호스트의 message/updateModelContext/serverTools 지원 여부에 맞춰 공유하고,
GPT의 정상 경로는 문맥 업데이트 뒤 짧은 후속 메시지로 유지한다. 문맥 전송 실패 시 결과가 든
메시지로 대체하고, 전송까지 실패하면 선택 가능한 텍스트·복사·전체 JSON 내려받기를 제공한다.
파일 내려받기는 호스트의 다운로드 허용 여부에 따르며, 차단 시 선택 가능한 JSON을 직접 복사한다.
상세 조회 도구가 승인되지 않았거나 저장이 실패하면 직접 요약으로 폴백한다. 전송 요약은
60,000자 절대 상한 안에서 생략 범위를 표시하고 전체 캡처는 JSON 내보내기로 보존한다.
`cost`는 비교 가중치이며
게임 재화가 아니고 `uberDraws`는 획득 울슈레 수로서 입력의 미래 울슈레 수와 다르다.
이는 공유 시점의 스냅샷이며 모델이 앱 DOM이나 이후 조작을 자동으로 읽는 것은 아니다.

화면을 열 수 없을 때 `siteUrl`은 `/gpt#catsroll-input=…`로 준비 입력을 넘긴다.
`local/gpt_input_transfer.rb`와 `asset/gpt-input-transfer.js`의 버전 1 JSON 봉투가 모든 배너,
last·목표·티켓/확뽑 예산·일정·미래 울슈레·참고 풀·플랜·시드 찾기 관측을 보존한다.
입력은 URL fragment에 있어 HTTP 요청 쿼리로 보내지지 않지만 링크를 받은 사람과 브라우저 기록에는
노출될 수 있다. 복원은 같은 서버 검증을 거쳐 기기 계산 화면을 준비하며 자동 계산하지 않는다.

앱 카드 오류나 일반 웹 사용 요청은 `catsroll_site_link`를 사용한다. `catsroll_prepare`와 동일한 입력·
카탈로그 검증을 재사용하지만 UI 메타데이터와 원본 풀을 반환하지 않는다. `links_ready`는 계산 결과가 아니다.
두 도구의 `websiteLinks`는 `app`(전체 입력), `multi`(배열/활성 Find), `tracks`(배너별 일반 배열),
`unavailable`(전달 불가능 조건)을 제공한다. `siteUrl`의 기존 의미는 유지한다.
Multi는 기존 `multi-share.js` v1의 비압축 base64url 봉투를 사용해 저장 설정과 분리되는 편집 세션을 연다.
일반 배열은 `compute=client`와 지역/event/seed/last/count/ubers/force_guaranteed를 전달한다.
둘은 열면 기기에서 계산하므로 앱의 수동 계산과 구별하고 자동 서버 계산 폴백은 추가하지 않는다.
참고 풀 또는 Multi 미래 울슈레 20 초과·일반 배열 9 초과·웹 Find 선택기에 없는 목표는 해당 링크를 생략하고 독립 앱으로 안내한다.
Multi에 플랜 상태/이름은 전달하지 않으며 일반 배열은 Find·예산·다른 배너도 전달하지 않는다.
상세 생략은 응답에 명시한다. 일반 웹의 결과는 채팅에 자동 공유하지 않는다.
`catsroll_guide(topic="website", query=구체적인 질문)`가 일반/Multi 조작과 스크린샷 열 이동 상담의 조회 경로다.
UI 실패와 MCP 연결 실패를 구별하며, 후자는 고정 사이트/수동 설정으로 안내한다.

공유 버튼은 Multi 배열 표 바로 위에, 시드 찾기에서는 결과 바로 위에 배치한다.
요약에 없는 행이나 생략한 경로를 GPT가 추정해서는 안 된다.

MCP 앱의 초기 횟수는 100이며 최대 300이다. 명시적 범위는 이 한도 안에서 사용한다.
일반 웹 `/multi`의 기존 범위와 이전 공유 결과(최대 999행)의 조회 호환성은 유지한다.
후속 비교 질문은 공유된 기존 배열·배너·시드·예산을 먼저 사용하며 새 배너 요청 없이
배너를 다시 검색하거나 예산을 늘리지 않는다. AI는 알려진 R/G/RG 조건·다음 위치를 따라
후보 경로의 획득 개수·종류·뽑기 수를 비교해 제안할 수 있지만 엔진 계산이나 전역 최적성
확인으로 표현하지 않는다. 새 최적 경로 계산은 기존 기기 Find로 확인한다.
“다마군 울슈레 다/올컬”은 기존 입력을 유지한 `catsroll_prepare`의 `targetSelection`을 사용한다.
`{type:"banner_collection",lang:"kr",event:"확인된 배너 ID",rarity:4,excludeOwnedIds:[명시한 보유 ID]}`가 계약이다.
`allowTicket`은 선택적 boolean이며 기본 false다. 사용자가 특수티켓 획득을 명시한 경우에만 true로
설정한다. 양수 티켓 예산만으로 허용하지 않으며, 선택 응답의 ticket_policy가 허용 여부·이유를 제공한다.
선택 지역·배너는 rows에 있어야 하며 seek나 명시적 targets와 동시에 쓰지 않는다. 서버가 실제 풀의
울슈레 ID를 중복 제거하고 보유 제외한 전체 목표를 구성한다. 포함·제외 ID/이름/이유·개수를
`targetSelection`에 반환하며 정규화된 request.targets는 기존 기기 Find 입력과 같다.
레레는 포함하지 않는다. 30개 초과 또는 남은 목표 0개면 prepared 대신 구조화된
`needs_input`과 `reason`·`matched_count`·`maximum`·`next_action`을 반환하고 조용히 자르지 않는다.
이미 받은 직접 targets와 기존 catsroll_cats(event,rarity) 페이지 조회도 계속 지원한다.
호스트 준비 결과가 bootstrap보다 먼저 도착해도 시드 찾기 payload와 관측 순서를 유지한다.
초기 목록 로딩 뒤 입력을 다시 적용하면서 payload를 지우지 않으며 사용자 계산 버튼으로 실행한다.
목표 캐릭터는 먼저 `catsroll_cats`로 식별한 다음 `catsroll_events(cat_id=...)`로 포함 배너를 찾는다.
Find 준비는 선택한 일반 풀 또는 해당 목표에 허용하고 예산을 부여한 특수 티켓 풀 중 적어도
하나에 목표가 있어야 한다. 캐릭터 도감에 존재한다는 이유만으로 잘못된 배너를 수락하지 않는다.
별도 Find 탭 없이 `findEnabled`로 켠다. `targets`가 있으면 기본으로 켜지며, 목표 이름은
공유 Multi 카탈로그에서 표시한다. AI는 `cat_id`와 `cat_name`을 같이 전달하며 이름/ID가
맞지 않으면 준비 도구가 오류를 반환한다. `planMode`, `planName`으로 플랜 UI를 준비할 수 있다.
준비 입력을 받았다고 계산하지 않는다. 사용자의 계산하기 클릭이 실행 경계다.
Found cats는 기존 Multi의 캐릭터·좌표 목록을 유지한다. 목표 선택은 Find 설정의 필터 창에서 한다.
Find 성공 후 경로 도장을 자동 표시한다. 플랜 그리기·직접 선택·조회·저장은 공통 Multi 규칙을 쓴다.
공유 전 GPT의 플랜·입력 상태는 메모리에서 격리되며 해당 앱 세션 동안만 유지한다. 공유된 복사본의 서버 보관은 위 결과 조회 계약을 따른다. 사이트의 저장 플랜이나 주소를 변경하지 않는다.
샌드박스가 native form 제출을 허용하지 않아도 계산 버튼은 명시적인 기기 API로 실행한다.
Find 옵션은 계산 방식 옆에 두며, Find·플랜 도구는 각 패널 왼쪽 위에 모은다.
플랜 그리기·불러오기·초기화·저장은 접근성 이름과 툴팁이 있는 아이콘이다.
스위치는 텍스트 표제 대신 패널의 블러 막으로 꺼진 상태를 나타낸다.
꺼진 상태에서는 스위치만 막 위에 또렷하게 강조하며, 실제 활성화되면 막과 강조 링이 사라진다.
배열 미계산/변경 대기 중 활성화가 거부되면 스위치와 흐림을 실제 상태로 유지하고
흐린 영역 중앙에 계산하기 안내를 표시한다.
입력칸은 도구 막대 다음 행에 두며 중간 폭에서도 도구를 분산하지 않는다. 목표 선택창은 좁은 폭에서도
이름·획득처·삭제 버튼을 안쪽에 유지한다.
MCP 앱은 8개 배너, 최대 `min(TRACK_MAX_COUNT, 300)`행을 지원한다. Find는 기존 여섯
검색 기준과 확뽑·플래티넘·레전드 한도를 사용하며 한 지역의 배너끼리만 검색한다.
상태 한도 결과는 최적 경로라고 단정하지 않는다. `forceGuaranteed`는 기존 Multi와
같이 `0`(배너 기본값)·`2`·`7`·`11`·`15`회를 받는다. 시드 찾기는 이 강제 설정을
사용하지 않으며 일반 관측 제한을 유지한다. 배열은 Track A/B별 표에서 배너 열을
비교하고, 각 셀에 원본 엔진의 일반·R·G·RG 및 다음 위치를 표시한다.

시드 찾기는 한 배너에서 **일반 단뽑으로 관측한 순서 최대 10개**를 받는다.
시드 찾기 화면에는 Multi의 상단 계산하기·미래 울슈레·강제 확정 입력을 표시하지 않는다.
배너 선택이나 모드 전환 시 관측 캐릭터 목록만 자동 준비하며, 실제 탐색은 시드 계산 버튼으로 실행한다.
Multi에서 전환하면 첫 배너만 사용하고 미래 울슈레·강제 확정은 0으로 준비한다.
Multi로 돌아올 때의 배너·시뮬레이션 설정은 보존한다. 관측 추가·삭제·시드 계산·중단은 기존 버튼 스타일을 사용한다.
확정 결과·스텝업·특수 티켓을 섞은 관측 해석은 이 시험 버전의 범위가 아니다.
배너 풀이 확정 배너여도 입력은 일반 뽑기 결과여야 한다. 추가 관측 없이 모호한
후보를 확정 시드로 취급하지 않는다. starting seed와 관측 후 current seed를 분리한다.
시드 찾기에는 최소 한 개 관측이 필요하고 빈 목록 준비는 선택 목록을 가져오기 위한 동작이다.

## 로컬 실행과 검증

### 초심자 설명 검색

[지식 목차](gpt-knowledge/index.md)와 짧은 주제별 문서를 `catsroll_guide`로 조회한다.
한국어/영어 키워드·동의어는 `gpt-knowledge/manifest.json`, 검색은 `local/gpt_guide.rb`가 관리한다.
실행 중 외부 게시글 수집, 임베딩, 벡터 DB, 추가 모델/API 호출은 없다. 로컬 문서만 읽는다.
개념·초심자·모호한 요청에는 먼저 사용자의 말로 검색하고 핵심 누락 정보 1~2개만 묻도록
초기화 지침과 도구 설명에 명시했다. 빈 검색/불일치는 목차와 전체 주제 목록을 반환한다.
목차는 `catsroll://guide/index` MCP resource로도 제공한다. 문서는 예측값을 생성하지 않는다.
질문별 근거 우선순위는 [지식 목차](gpt-knowledge/index.md#판단-우선순위)를 따른다. [출처 선별·검증](gpt-knowledge-sources.md)을 참고한다.
검색 가중치의 일반 질문 검사와 실제 ChatGPT 도구 선택/무료 계정 수용은 다른 검증이다.

검색은 manifest의 절 제목·검색어와 용어집 표의 첫 열을 상위 문서 선택에 함께 반영한다.
일반 문장의 단어 경계는 유지하므로 `원범`이 “지원 범위”에 일치하지 않는다. 등록된 한국어
붙임말과 조사·공백 변형은 허용하지만, `large` 속 `rg`, `111` 속 `11`, `R G`를 `RG`로
해석하지 않는다. 이 방식은 로컬 결정적 검색이며 범용 의미 검색이나 추가 모델 호출이 아니다.

일반 후보는 문서/절 점수로 좁히되, 질문에 명시된 등록 용어와 제약에 해당하는 절은 상대 점수와
일반 두 절 상한보다 우선한다. 겹친 용어는 가장 긴 구문을 보존하고, 같은 개념의 중복 문서는
한 설명으로 묶는다. `include`는 설명에 필수인 동반 조건이다. 문서 limit과 본문 16,000자 상한은
유지한다. 한도 때문에 전달하지 못한 요청 절은 `unansweredSections=[{topic,query}]`로 알려
다음 조회를 안내한다. 절을 못 찾으면 짧은 주제 요약만 주고 전체 문서로 자동 확대하지 않는다.

도구 이름·입력 스키마는 유지한다. `contentMode`는 `full`/`sections`/`summary`, `sections`는
전달한 절, `omittedSections`는 선택으로 생략한 절이다. 분량 잘림은 `truncated`로 따로 알린다.
`guideRevision`은 manifest와 문서별 ID·원문을 경계가 보존되는 형식으로 묶은 SHA-256,
각 문서의 `contentHash`는 집중 반환 전 전체 원문의 SHA-256이다. `sourceUrl`의 main 링크는
현재 문서 위치이고 과거 원문을 고정한 주소가 아니므로 두 지문으로 받은 안내를 식별한다.
성공 응답의 `topics`는 선택 문서와 관련 주제로 좁힌다. `topic`과 `query`를 함께 쓰면 집중
조회하고, 명시적으로 전체 절차가 필요할 때만 `topic` 단독으로 전체를 읽는다. 스크린샷 상담도
구체적인 질문을 함께 넘기며, R/G 규칙이 더 필요할 때만 해당 주제를 추가 조회한다.

새 입력은 현재 카탈로그, 기존 공유 결과는 그 스냅샷의 입력·데이터 버전·기록을 기준으로 한다.
사용자가 직접 제공한 계산표·스크린샷·경로와 명시한 행동도 보이는 범위에서 설명할 수 있다.
화면에 없는 새 경로에만 기기 계산/공유를 요청하며 prepared를 계산 결과로 간주하지 않는다.
초기화 지침과 guide/site_link 설명 변경은 `guide_routing_delta_v1.json`에 명시해 양쪽 호스트의
나머지 공개 계약을 고정한다. 실제 호스트가 도구 정의를 캐시하면 해당 설명은 갱신이 필요할 수
있지만 MCP 주소·인증·플러그인 패키지는 바뀌지 않는다.
사용자 FAQ의 질문은 티켓/지역·배너·열 이동·자원·캐릭터/육성의 기존 주제에 합쳤다.
초안의 답변을 그대로 학습하지 않으며, 질문 본문 확인·게임 데이터 대조·미검증 댓글의 구분은
[FAQ 검토](gpt-knowledge-sources.md#2026-10-18-사용자-faq-초안-검토)에 유지한다.

“뭐 뽑을까”·“빨적이 부족해”는 [추천 안내](gpt-knowledge/recommendations.md)에 따라
`catsroll_recommend`로 후보를 고른다. 외부 티어 평가는 `tier-picks.json`에 ID/평가 형태/투자
조건만 저장하며, 이름·대상 속성·능력을 복제하지 않는다. 실제 `ball.cats`와 `Stat`/`Talent`에서
평가 형태 정보를 읽어 연결한다. 자세한 선별·검증은 [티어 출처](gpt-tier-sources.md)에 있다.
추가 6개 글은 `character-notes.json`의 ID별 용도/제약 의견으로 연결한다. 수집 우선순위와
전투 티어를 합치지 않고, 사진의 불확실한 캐릭터 매칭은 제외한다. 원문 의견에는 날짜와
형태/투자 조건을 붙이며, 현재 게임 데이터와 구분한다.
복수 속성은 기본 all(모두 충족), 보유 ID 제외, 실제 이벤트 풀 포함 여부를 지원한다.
기본 투자 예산은 일반 본능이며 4단 진화/초본능은 ultra를 명시해야 한다. 특정
배너의 풀에 들어 있어도 현재 판매/시드 도달을 보증하지 않는다. 실제 경로는 Find에서 계산한다.

Ruby/Bundler 환경은 기존 README의 개발 환경을 사용한다. 별도 npm 런타임은 필요 없다.

```sh
CATSROLL_GPT_ENABLED=1 WEB_BIND=127.0.0.1:17867 bundle exec yahns -c config/yahns.rb
```

`http://127.0.0.1:17867/gpt`에서 독립 미리보기를 사용하고, MCP Inspector/SDK는
같은 origin의 `/mcp`에 연결한다. 이 명령은 기존 warmup/통계 로직을 사용한다.
별도 서비스나 포트를 점유하지 않도록 실행 전에 기존 작업과 조정한다.

```sh
node test/test_gpt_runtime.js
node test/test_gpt_result_summary.js
node test/test_gpt_host_bridge.cjs
node test/test_gpt_lifecycle.cjs
node test/test_gpt_input_transfer.cjs
node test/test_gpt_site_links.cjs
bundle exec ruby -EUTF-8 -Ilib:test test/test_gpt_input_transfer.rb
bundle exec ruby -EUTF-8 -Ilib:test test/test_gpt_results.rb
bundle exec ruby -EUTF-8 -Ilib:test test/test_gpt_guide.rb
bundle exec ruby -EUTF-8 -Ilib:test test/test_gpt_recommendations.rb
bundle exec ruby -EUTF-8 -Ilib:test test/test_gpt_mcp.rb
bundle exec ruby -EUTF-8 -Ilib:test test/test_gpt_mcp_contract.rb
# Playwright가 제공되는 환경에서 별도 실행한 로컬 서버에 연결:
node test/test_gpt_browser.cjs
node test/test_gpt_recovery.cjs
bundle exec ruby -EUTF-8 -Ilib:test test/test_gpt_probe.rb
```

기존 Ruby·Node 검사는 엔진 결과와 어댑터 계약, 입력 복원, 공유 저장·조회 경계와 도구 교환을 확인한다.
Playwright 브라우저 검사는 로컬 서버와 모의 호스트에서 Worker·WASM·취소·공유 복구를 확인한다.
이 검사는 실제 ChatGPT/Claude의 도구 선택, iframe 첫 표시, 계정 제한, 공개 CSP 수용을 대신하지 않는다.
실제 호스트 관찰은 [연동 검증 기록](gpt-validation.md)에 날짜·빌드별로 분리해 둔다.

앱은 인증된 부모 호스트에 `ui/notifications/size-changed`로 실제 본문 높이를 알린다.
`ResizeObserver`와 animation frame 중복 제거로 입력·접기/펼치기·계산 결과의 크기 변화를
전달하며 iframe viewport 높이를 본문 높이로 재사용하지 않는다. 실제 최대 높이와 폭은
호스트 정책이 결정하므로 높이 알림만으로 전체 화면 전환이나 임의 크기를 보장하지 않는다.

## 배포 설정과 패키지

플러그인 아이콘 원본과 출처는 `plugins/catsroll/assets/`에 있다. 아이콘 교체 시
manifest의 `composerIcon`·`logo`를 함께 유지하고 패키지를 다시 생성한다.
미니 앱 헤더도 같은 아이콘을 리소스에 인라인하며, 아이콘 변경은 UI 지문에 포함한다.
화면은 기존 Multi와 참고 배열 뷰어의 밝은 중성색 배경·간결한 입력·표 구성을 따른다.
ChatGPT 테마가 어두워도 앱은 밝게 표시하며, 캐릭터 검색 목록은 희귀도 색상 표시를 쓴다.
배열 표는 기존 Multi의 점수 구간 색상과 한정 캐릭터 강조를 사용한다. 점수 구간과
설명은 원본 TrackEngine에서 전달하며, 어댑터에서 별도 계산하지 않는다.
일반 결과는 트랙 변경 시에만 이동 위치를 표시하고 G/RG는 다음 위치를 항상 표시한다.
배너는 기존 Multi와 같이 지역별 선택 메뉴에서 고른다. 진행·예정과 지난 배너를
나눠 표시하고 짧은 이름 뒤에 날짜를 둔다. 지역·선택 메뉴·삭제 아이콘은 좁은
화면에서도 한 줄을 유지한다. 선택한 배너 설명은 내부 폭을 채운다.
배너 제목과 표 머리글은 기존 Multi의 `multi_events.series_name`을 사용한다.
제목 아래에는 원래 배너 설명을 작은 글자로 표시하고, 이벤트 ID는 툴팁에 둔다.
별도 ‘선택됨’ 설명은 반복하지 않으며 준비된 배너도 동일한 선택 상자로 표시한다.
일정 미정 배너 요청은 `catsroll_banner_preview`로 기존 시리즈·캐릭터 ID를 연결하고 KR/JP 최신 풀을 비교한다.
준비 행의 `previewFor`는 가정 대상 지역이며 원본 `lang`/이벤트 ID/확률/슬롯 순서를 유지한다.
캐릭터 이름만 해당 지역 데이터에서 ID로 연결하고 없는 이름은 원문을 유지한다. 화면·GPT 입력·플랜 저장에도
참고 계산 표시를 보존한다. 이 표시를 임의로 지우고 실제 확정 일정으로 답하지 않는다.
`previewFor`와 `scheduleAware=true`를 함께 전달하면 미확정 일정으로 경로를 계산하지 않고 오류를 반환한다.
JP 배너의 한국어 표시 우선순위와 원본 날짜 유지 규칙은
[Multi 표시명](multi-track-local-plan.md#regional-display-names)을 따른다.

전체 목록은 앱 안에서 지역별로 한 번 불러온다. 모델의 이름 검색은 기존 페이지
검색을 사용하고, 준비 도구가 넘긴 정확한 이벤트 ID는 선택 메뉴에 그대로 반영한다.
공개 디렉터리 개발자명은 선택한 인증 게시자 정보에서 정해지며, `developerName`이나
계정 닉네임만 바꿔서 임의의 게시자명으로 바뀐다고 가정하지 않는다.
패키지 작성자·개발자명은 `twkim`이다. 웹 목록은 현재 계정의 표시 정보를 따로
사용하므로 실제 목록에서 확인하기 전에는 별명이나 아이콘 적용 완료로 취급하지 않는다.

## 실제 ChatGPT 웹 확인

### 초기 표시 진단

`CatsrollDiagnostics()`는 기기 메모리에 최대 40개의 단계·경과 시간·UI build ID와 페이지별 임의 diagnosticId만 보관한다.
시드·관측·본문·결과 ID·계정 정보는 기록하지 않고 서버로 전송하거나 기본 콘솔에 출력하지 않는다.
`html-start`, 앱/브리지 초기화, bootstrap, UI 장착, Worker 실행·완료·teardown 단계를 구분한다.
스크립트 실행 전 리소스 표시가 실패하면 앱 단계가 남지 않으므로 리소스 응답과 호스트 sandbox 표시를 함께 확인한다.
진단 단계 추가만으로 첫 표시 문제가 해결됐다고 판단하지 않는다.

`/mcp/probe`와 `/gpt/probe`는 정상 앱과 같은 HostBridge를 쓰는 연결·UI 비용 대조용이며 계산·카탈로그·저장 도구는 없다.
`/mcp/probe/sdk`와 `/gpt/probe/sdk`는 고정 버전 번들에 든 MCP Apps SDK `App.connect()` 독립 대조다.
두 경로의 생성 기록은 resourceId·probeVariant·build·UTC time만 담는다. 생성 기록은 호스트 수신이나 브라우저 전달 증명이 아니며,
SDK 대조도 정상 앱의 브리지·계산·공유를 대체하지 않는다. 번들 출처·라이선스·재생성은
[SDK 진단 번들](../lib/battle-cats-rolls/vendor/probe-sdk/README.md)에 있다.

초기화 전 유효한 부모 HTTP(S) origin의 ping에도 빈 응답을 보내지만, 이를 origin 고정이나 초기화 완료로 취급하지 않는다.
정상 초기화 응답 뒤에는 기존 출처 검사를 유지한다. 어떤 진단 신호도 첫 카드 문제의 원인을 단독으로 확정하지 않는다.

### 구조 개편 후 실제 호스트 재검사

이전 GPT/Claude 계정·빌드별 관찰은 [실제 호스트 재검사 기록](gpt-validation.md#구조-개편-후-실제-호스트-재검사)에 보존한다.
현재의 성공 범위와 미완료 수용은 아래 [수용 표](#다음-수용-조건)를 기준으로 한다.

## 배포 환경과 운영

- `CATSROLL_GPT_ENABLED=1`: `/mcp`와 `/gpt` 활성화. 앱 기본은 비활성(404)이며
  HF 배포용 루트 Dockerfile에서는 활성화한다. HF 설정에서 `0`으로 덮어쓰면 비활성화된다.
- `CATSROLL_PUBLIC_ORIGIN`: 공개 서비스 HTTPS origin. 기본은 현재 HF Space 주소.
- `CATSROLL_GPT_UI_ORIGIN`: 공개 UI 심사용 전용 origin이 정해진 경우 지정한다.
  미지정 시 공개 MCP origin을 사용한다. 도메인 소유권과 ChatGPT 호스트의 실제 origin/CSP를 확인해야 한다.
  Claude 전용 연결에는 적용하지 않는다.
- `CATSROLL_GPT_PUBLIC_PAGES=1`: 소개·개인정보처리방침·이용약관 활성화. HF 루트 Dockerfile은 0.2.3부터 활성화한다.
- `CATSROLL_OPENAI_DOMAIN_CHALLENGE`: 포털이 발급한 정확한 단일 도메인 인증 토큰.
  페이지·인증 준비와 남은 소유자 확인은 [공개 제출 준비](gpt-publication.md#페이지와-도메인-인증-준비)에 유지한다.

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
ChatGPT 공유는 계산 스냅샷을 `ui/update-model-context`로 전달한 뒤 기존의 짧은
`ui/message`를 보낸다. 문맥 갱신 실패 시 같은 고정 스냅샷을 보이는 메시지에 담아 전달하고
복사/전체 JSON 내보내기를 제공한다. 실패 때문에 계산을 다시 실행하지 않는다.
Claude 전용 리소스의 `data-catsroll-ui-host="claude"` 표식이 있을 때만 `ui/message`
본문에도 같은 계산 스냅샷을 넣는다. Claude가 숨은 문맥을 반영하지 않아도 사용자가
확인·전송하는 메시지에서 결과를 읽으며, 숨은 문맥 갱신 실패 시에도 메시지를 시도한다.
두 리소스의 구분, GPT의 짧은 메시지 유지, Claude의 결과 포함·문맥 실패 후 공유는
MCP 테스트와 로컬 브라우저 회귀에서 확인했다. 실제 GPT의 모델 답변 수용과는 구분한다.
Claude가 앱 발신 메시지에 붙이는 프롬프트 주의 경고는 호스트 기능이며 앱에서 숨기거나 우회하지 않는다.
메시지에는 이전 prepared와 구분되는 계산 후 스냅샷, Find 상태, 배열/경로 생략 범위를 명시한다.
공개 전에는 요청 로그 정책, 트래픽 제한, 동시 요청, HF 절전·cold start와 캐시를 검토한다.
현재 HF Docker는 Ruby 서비스이며 별도 Node 프로세스를 추가하지 않는다.
정상 MCP 요청 본문을 기록하는 미들웨어/요청 이력 DB는 없고, 서버 진단은 stdout/stderr로 전달된다.
인프라 기록은 제공자 정책을 따르며 방침의 유지 위치는 `view/gpt_public/privacy.html`이다.

공개 등록에는 게시자 인증, 고정 HTTPS MCP 주소·도메인 검증, 개인정보처리방침·약관·문의처,
아이콘과 시연·심사 자료가 필요하다. 소유자가 0.2.5의 최종 선언과 제출을 완료했으며
심사 수용·공개 출시는 별도다. 비공개 플러그인은 배포된 `/mcp`에 연결해 시험한다.
공개 설정·심사 자료와 제출 경과는 [공개 제출 준비](gpt-publication.md)에 유지한다.
사용자용 소개와 문의는 [Catsroll 소개](gpt-overview.md)에 있다.

### 안내 문서와 패키지의 업데이트 경계

`doc/gpt-knowledge/*.md`와 `manifest.json`은 서버가 `catsroll_guide` 호출 때 읽는다.
HF 서버에 수정본을 배포하면 다음 안내 도구 응답에 반영되며, 이를 위해 플러그인 ZIP을
다시 올릴 필요는 없다. 기존 대화의 지난 응답이 바뀌거나 모델이 호출 없이 모든 문서를
자동으로 읽는다는 뜻은 아니다. 최초 도구 선택은 서버의 instructions·도구 설명도 중요하다.

서버의 도구 설명·UI 수정도 서버 배포로 제공하지만, 공개된 ChatGPT 플러그인의 도구 변경은
OpenAI 자동 검사·승인된 정의 반영을 거친다. 설치한 클라이언트의 도구 목록/리소스 캐시도
구분한다. 패키지에 포함한 스킬 MD·이름·아이콘·연결 설정은 패키지 변경이므로 새 ZIP이 필요하다.
현재 `plugins/catsroll`에는 서버 안내 문서를 복제해 넣지 않는다.
공식 절차는 [공개 제출 준비의 업데이트 범위](gpt-publication.md#업데이트와-이전)와
[OpenAI 제출 안내](https://developers.openai.com/plugins/deploy/submission#update-your-published-plugin)를 따른다.

## Claude 연결

### 현재 빌드의 Claude Free 실사용 확인

이 제목은 기존 TODO 링크 호환용이다. 날짜·모델·계정 조건과 실제 결과는
[Claude Free 검증 기록](gpt-validation.md#현재-빌드의-claude-free-실사용-확인)에 정리했다.

Claude의 사용자 지정 원격 커넥터에는
`https://twkim96-my-cats-rolls.hf.space/mcp/claude`를 등록한다. 인증은 없다.
기존 `/mcp`는 ChatGPT용이며 공개 심사 중인 연결과 패키지 설정을 유지한다.
두 경로는 도구·입력 검증·데이터·계산 UI·JS/WASM을 공유하고, UI 리소스 URI와
호스트별 `ui.domain` 메타데이터만 분리한다. `/mcp/claude`도 `CATSROLL_GPT_ENABLED`를 따른다.

Claude 경로는 전체 공개 연결 URL(`/mcp/claude` 포함)의 SHA-256 앞 32자리와
`.claudemcpcontent.com`을 조합한다. 공식 [MCP Apps CSP/CORS 안내](https://apps.extensions.modelcontextprotocol.io/api/documents/csp-and-cors.html)의 규칙을 따른다.
요청 User-Agent로 호스트를 추측하거나 세션의 initialize 정보를 전역 상태로 저장하지 않는다.
연결/메타데이터 검사는 실제 UI 표시·기기 계산·결과 공유 수용을 대신하지 않는다.
모델이 시드를 모르는 사용자를 `multi`로 준비하면 입력 검사가 실패한다. 이 경우 `seek`로
화면을 열어야 하며, UI 호환 문제와 구분한다.

호스트별 과거 표시 진단은 [검증 기록](gpt-validation.md#claude-도메인-수정-후-후속-확인)에 보존한다.

Claude 전용 initialize 안내와 배너/캐릭터/계산 도구 설명에는 일반 배열 조회와 목표 Find를
구분하는 한국어 규칙을 제공한다. 일반 조회에 목표를 요구하지 않고 배너는 `catsroll_events`로
찾으며, 시드가 없으면 `seek` 화면을 준비한다. 기존 ChatGPT 도구 설명은 유지한다.
배너 검색은 기존 `EventSeriesNames.shortcuts`와 공백 제거 비교를 사용한다.
다마군·다군은 같은 시리즈로 연결하며, 별도의 GPT 전용 이름 사전을 만들지 않는다.

## 다음 수용 조건

현재 상태는 아래와 같다. 상세한 과거 측정과 한계는 [검증 기록](gpt-validation.md)을 참고한다.

| 범위 | 현재 근거 | 남은 수용 |
| --- | --- | --- |
| 로컬 서버·Node/Ruby·Playwright 모의 호스트 | 엔진/어댑터, 공유·복구, 입력 복원, 브라우저 Worker/WASM 회귀 기록이 있다. 실제 계정 동작은 보장하지 않는다. | 변경 계약에 맞는 기존 회귀를 유지하고, 실제 호스트 항목과 별도로 판정한다. |
| 실제 ChatGPT GPT Instant/Business | 100/300행 기기 계산·일부 공유/조회와 올컬 준비를 완료한 사례가 있다. 새 카드 첫 표시는 여러 번 실패 후 재시도됐고, 결과 설명 응답 오류도 발생했다. | 첫 진입과 공유 뒤 설명 오류의 재현·원인·수정 후 전체 왕복을 확인한다. **첫 표시 문제는 해결된 것으로 보지 않는다.** |
| ChatGPT Free | 무료 웹 계정 설치·연결 및 사용량 제한을 확인한 근거가 없다. | 무료 계정의 설치/연결, UI 제공, 실제 제한을 확인한다. |
| 실제 Claude Free | `4fee8e26`의 100행 Multi·300행 Find 계산/공유·마지막 두 행 조회와 수동 Seek 공유, `da3e23b9`~`109a61cb`의 화면 상담 재시험을 확인했다. `bfdd9be6`의 집중 안내도 4진·NP·S/G 세 질문에서 설명했다([범위](gpt-validation.md#2026-10-18-집중-안내-검색-수용)). | 최초 카드 안정성, 시드 미상 질문의 자동 Seek 선택, 안내 요청 없이 도구를 고르는 경우와 불필요한 캐릭터 검색을 확인한다. SDK 실제 호스트 대조는 미실행이다. |
| 공식 SDK·최초 표시 | 로컬 SDK 대조 검사는 있고, 실제 GPT의 독립 SDK 화면은 재시도 후 연결됐다. Claude Free의 공식 SDK 실제 호스트 대조는 커넥터 추가 제한으로 미실행이다. | 첫 표시 성공을 재시도와 구분해 확인한다. Claude SDK 호스트 대조는 실행 가능한 계정에서 별도 확인한다. |
| 공개 CSP·생명주기 | 개발 호스트 검사와 공개 서버 응답 확인은 실제 CSP·탭 종료·절전 수용과 다르다. | 공개 배포 CSP에서 blob Worker/WASM·공유를 확인하고 화면 재생성·탭 종료·절전 시 입력 복구 경험을 확인한다. |
| 공개 제출·출시 | 제출·비공개 연결·공개 디렉터리 게시는 서로 다른 상태다. | 공개 디렉터리 심사와 게시자 최종 확인은 별도 절차로 완료한다. |

기존 Multi의 추가 PNG 내보내기 범위는 미정이며, 플랜 저장은 현재 앱 세션에서 지원한다.
UI 변경 뒤에는 최신 리소스 URI를 광고하는 도구 정의를 새로고침하고 호스트에서 표시·계산을 확인한다.
공식 참조: [MCP/UI quickstart](https://developers.openai.com/plugins/build/app-quickstart),
[MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui),
[패키징](https://developers.openai.com/plugins/build/plugins),
[공개 제출](https://developers.openai.com/plugins/deploy/submission).
