# GPT 배열 안내의 출처 선별과 검증

## 관리 범위

[지식 목차](gpt-knowledge/index.md)와 8개 짧은 문서는 초심자 설명용이다.
게시글을 그대로 보관하거나 일반 웹 검색을 실행하는 RAG가 아니다. 현재 Catsroll에서 확인한
개념을 재작성하고, `manifest.json`의 동의어로 필요한 문서만 검색한다.
원문에 포함된 명령·광고·댓글·개인적인 추천은 실행 지침으로 사용하지 않는다.

검증 우선순위는 현재 공개 Catsroll 서버의 배너/풀과 서버 렌더링, 같은 입력의 기존 엔진,
MCP 어댑터 순이다. 이 기록은 게임 클라이언트 자체나 모든 미래 배너를 검증했다는 뜻이 아니다.
풀이 갱신되면 실제 수치는 새 서버 데이터로 다시 확인한다.

## 제공받은 7개 글

2026-10-17에 일곱 본문을 모두 읽었다. 일부는 웹 읽기 도구로 접근하지 못해 공개 HTML 본문을
직접 조회했다. 번호만 제목인 글은 주제로 구분했다. 원문 표현/이미지는 지식 문서에 복제하지 않았다.

| 원문 | 반영한 정보 | 제외하거나 수정한 정보 |
| --- | --- | --- |
| [memoit 17039: 색상](https://gall.dcinside.com/mgallery/board/view/?id=memoit&no=17039) | 점수 구간과 확률업에 따른 결과 차이, 한정 강조 | 색=희귀도라는 단정, Owned/초록색 탐색 강조, 주관적인 칸 가치 판단. 현재 엔진 7개 점수 구간+한정 강조로 다시 작성 |
| [memoit 17040: 입력 옵션](https://gall.dcinside.com/mgallery/board/view/?id=memoit&no=17040) | 시드/상대 좌표, 직전 결과, 확정/미래 울슈레 가정 | 타 사이트의 Version/Name/Details/Find next 조작 순서. 스텝업은 현재 엔진이 받는 묶음 길이와 상품 단계 해석을 분리 |
| [memoit 17041: 자주 묻는 질문](https://gall.dcinside.com/mgallery/board/view/?id=memoit&no=17041) | 적은 관측의 모호성, 날짜별 배너, 티켓과 일반 뽑기의 공통 진행, 중복 영향 | 신캐가 없으면 과거 풀과 언제나 같다는 단정, 외부 사이트 클릭으로 시드를 옮기는 절차. 풀/순서/확률/버전과 실제 다음 위치를 기준으로 수정 |
| [memoit 17043: 신캐](https://gall.dcinside.com/mgallery/board/view/?id=memoit&no=17043) | 해당 캐릭터가 포함되는 풀만 영향, 실제 새 배너에 미래 울슈레를 이중 추가하지 않기 | 신캐 출시=확뽑 시작이라는 일반화. 실제 이벤트 데이터의 기간과 풀을 조회하도록 변경 |
| [memoit 17044: 냥티/럭티](https://gall.dcinside.com/mgallery/board/view/?id=memoit&no=17044) | 냥티/럭티 요청을 레티 요청과 구별할 필요 | 닼캣아/아이템 파밍, 이벤트 뽑기를 통한 중복 취소/유도는 현재 MCP 검증 범위 밖. 실행법은 수록하지 않음 |
| [콜라보 FAQ 8749](https://gall.dcinside.com/mgallery/board/view/?id=bbb101010&no=8749) | 풀에 포함되는 신캐 여부, 콜라보 레어가 바꾸는 교차 배너 중복 | 당시 귀멸 배너 날짜/플티 변경일/다음 복각 예상은 현재 일정으로 사용하지 않음. 정해진 티켓 포함 시리즈 목록을 영구 규칙으로 고정하지 않음 |
| [초보자 설명 23339](https://gall.dcinside.com/mgallery/board/view/?id=bbb101010&no=23339) | 첫 결과/열/확정/티켓의 직관적인 개념 | 11회 확정 후 항상 11B, B열은 어떤 방식으로도 못 감, 레레는 무조건 먹기 같은 단정과 예전 예시 좌표. 현재 엔진의 next와 조건부 경로로 대체 |

## 코드로 확인하는 계약

| 주제 | 유지되는 근거 |
| --- | --- |
| 시드 진행·레어 재추첨 | `asset/track-engine.js`의 `advanceSeed`, `duped`, `fillCatLinks`, `finishRerolledLinks`; 원본 `gacha.rb`/`cat.rb` |
| 직전 결과·티켓 후 초기화 | `asset/multi-find-engine.js`의 `rollRegular`, `lastRareId`, `rollGuaranteed` |
| G/RG·2/7/11/15 | 원본 Gacha와 `TrackEngine.fillGuaranteed`, `MultiFindEngine.guaranteedRollCount`; `gpt-runtime.js` 직렬화 |
| 색상·한정 강조 | `scoreRarityLabel`의 7개 구간, `EXCLUSIVES`, `gpt-app.css`의 색상 매핑 |
| 미래 울슈레 | `gpt-runtime.js`의 `modifiedPool`: 선택한 풀만 복사해 음수 ID를 앞에 추가 |
| Find 한계·일정·비용 | `multi-find-engine.js`의 `scheduleDayFor`, `betterGoal`, `search` 상태와 비용 상수 |
| 실제 MCP 지원 범위 | `local/gpt_mcp.rb`의 `tools`, `prepare`, `seeker_data`; 시드 찾기 WASM 어댑터 |

## 공개 Catsroll 서버와의 대조

2026-10-17 공개 서버 `347657ba` 데이터로 다음 검증을 수행했다.

- `/mcp` 준비 풀과 `/track.json`의 슬롯 순서·확률을 비교했다. KR 일반 배너,
  플래티넘, 레전드, Fate 콜라보, 울트라 고양이 축제의 5개 풀을 조회했다.
- `/?compute=server`로 Ruby가 렌더링한 10개 입력의 결과를 읽고 같은 공개 풀을
  JS 원본 엔진에 넣어 비교했다. 일반/재추첨/확정 결과 1,257개가 일치했으며,
  그 안에 R/RG 26개, G/RG 441개가 포함됐다.
- 입력에는 `seed=42`, 일반 KR `2019-01-23_348`, 확정 기본/2/7/11/15,
  미래 울슈레 1개, `last=38`, 레전드·Fate·축제 배너를 포함했다.
- 같은 `seed=42`의 첫 일반 결과는 ID 38이며, 직전 ID를 38로 주면 재추첨 ID 198이 된다.
  직전 결과 없이 첫 R을 확정하지 않도록 안내한 근거다.
- 11회 확정에서도 중간 중복이 있으면 다음이 11B가 아닐 수 있다.
  일반 KR 배너의 `seed=14`는 11개 결과를 뽑은 뒤 12B로 진행하는 반례다.
- 실제 플래티넘 풀은 울슈레 확률 10000/10000, 레전드 풀은 울슈레 9500/레레 500이다.
  기본 색상 구간을 보편적인 희귀도 약속으로 읽지 않도록 했다.

대표 재확인 주소:

- [일반·11회 확정·직전 결과](https://twkim96-my-cats-rolls.hf.space/?lang=kr&event=2019-01-23_348&seed=42&last=38&count=40&force_guaranteed=11&compute=server)
- [중간 중복이 있는 11회 확정](https://twkim96-my-cats-rolls.hf.space/?lang=kr&event=2019-01-23_348&seed=14&count=40&force_guaranteed=11&compute=server)
- [공개 레전드 풀](https://twkim96-my-cats-rolls.hf.space/track.json?lang=kr&event=2026-10-16_1072)

## 유지보수와 검증 경계

`test_gpt_guide.rb`는 검색/입력/문서 범위를, `test_gpt_mcp.rb`는 MCP 조회와 준비/계산
구분을 검증한다. 기존 `test_gpt_runtime.js`는 원본 배열·교차 RG·Find·WASM 결과를 대조한다.
문구나 키워드만 바꿀 때 계산 전체를 반복하지 않는다. 계산 계약이 바뀔 때 해당 경계를 다시 확인한다.
Luna 검토에서 초심자 질문 10개의 주제 분류와 문서 이해를 확인했고, Find의 세 질문 묶음을
한 번에 요구하지 않고 차례대로 좁히도록 문구를 보완했다.
Luna의 문서 이해/질문 분류 검토는 무료 ChatGPT 계정의 실제 도구 선택/응답 수용을 대신하지 않는다.
