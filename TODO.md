## ChatGPT 플러그인

* `9cf4b6e` 외부 리뷰의 iframe ping·초기화/목록 재시도·정규화된 보유 ID 비교는 로컬 회귀를 통과했다.
  `7e8b3883` 배포 뒤 GPT Instant에서 최소 UI와 갱신한 전체 UI 모두 첫 실패·호스트 재시도 후 표시를 확인했다.
  전체 UI는 HTML 시작 후 5.58초에 장착됐고 일반 `1+1`은 정상 답변했다. 재시도 후 한 번의 측정이다.
  [초기 표시 진단](doc/gpt-plugin.md#초기-표시-진단)의 한계를 따라 최초 실패의 HTML 실행/리소스 전달을 조사한다.
  새 빌드의 늦은 응답 차단·`needs_input`·Seek 공유·호스트 종료도 실사용에서 재확인한다.
* 구조 개편 뒤 실제 GPT/Claude에서 새 입력/취소/플랜 편집과 공유 실패 복구를 확인한다.
  GPT Instant 100/300회 계산·공유·마지막 페이지 조회와 양쪽 올컬 목표 4종 자동 선택은 확인했다.
  [실제 호스트 재검사](doc/gpt-plugin.md#구조-개편-후-실제-호스트-재검사)의 범위와 남은 정확성 문제를 따른다.
* 결과 저장·전송 복구 패치 뒤 실제 GPT/Claude에서 공유 재시도, 문맥 업데이트 실패,
  메시지 실패 후 복사/전체 JSON 내보내기, 모든 입력을 보존한 대체 링크를 확인한다.
  로컬 페이지 회귀는 실제 호스트·무료 계정 수용을 대신하지 않는다.
* 공개 운영 전 익명 세션을 새로 발급해 저장 예산을 우회하는 한계를 고려해 용량/부하를 평가한다.
  현재 메모리 상한은 저장 JSON만 포함한다. 계정별 제한이나 공유 철회는 아직 지원하지 않는다.

* [Claude 연결](doc/gpt-plugin.md#claude-연결)의 Free 계정 시드 찾기 전체 왕복을 확인한다.
  전용 주소의 Multi/Find 100·300회 기기 계산·공유 설명은 재시도 후 확인했다.

* 초심자 안내 `catsroll_guide`와 추천 `catsroll_recommend`를 실제 ChatGPT의 모호한 질문과 무료 계정에서 확인한다.
  로컬 검색과 Luna 문서 검토는 실제 무료 계정 수용을 대신하지 않는다.

* [GPT 연동](doc/gpt-plugin.md)의 첫 앱 표시 실패·간헐적인 설명 응답 오류를 해결하고,
  무료 웹 계정 수용을 확인한다. 실제 ChatGPT Multi/Find/WASM 실행은 확인했으며
  공개 배포·무료 계정 호환성은 별도다. 300행 압축 공유와 300행동 끝의 목표 획득은
  로컬 호스트에서 검증했으며, 실제 GPT/Claude가 총 뽑기 수·획득 단계·R/G를 정확히 설명하는지 확인한다.
  기본 100·최대 300과 직접 배열/희귀도 공유 후 기존 배열 후속 질문(울슈레 수확·올컬)의 실제 GPT/Claude 도구 선택과 답변 정확도를 확인한다.
  개발 연결의 결과 ID→마지막 페이지 조회는 GPT Instant에서 확인했다.
  결과 조회 도구의 공개 정의 승인 뒤 공개 플러그인에서도 같은 왕복을 확인한다.
* [공개 제출 준비](doc/gpt-publication.md)의 0.2.5 심사 결과와 공개 후 무료 계정 수용을 확인한다.
  소유자가 게시자 인증·실명 공개 승인·최종 선언과 Submit을 완료했다. 정책·시연·도메인 인증은 연결됐다.
  최초 앱 표시 실패와 추천 조건 준수 등 남은 실사용 검증을 제출 완료와 구분한다.
* 공개 목록의 발바닥 아이콘과 인증된 게시자 표시를 확인한다. 패키지의 `twkim` 표기와
  공개 디렉터리의 인증 게시자명은 다르며, 실제 공개 목록을 보기 전에는 반영 완료로 취급하지 않는다.

## Multi Track

* 기존 `test_local_web.rb`의 Find 완료 문구 소스 단언(300행)과 커스텀 뽑기의 시리즈
  필터 범위 단언(672행)을 확인한다. `d91cd89e`의 별도 깨끗한 사본과 버튼/기록 수정본 모두
  같은 2건이 실패했다. 실제 컨트롤·최근 시드·GPT 브라우저 회귀 통과와 구분한다.
* 모바일 실기기에서 멀티 초기 로딩 최적화 후 스크롤·텍스트 선택·위치 이동·PNG
  공유가 유지되는지 검증한다. 재현 링크는
  `seed=2762818371&count=300&lang=kr&event=2026-02-13_1042`이다. 현재 최적화와 로컬 검증
  범위는 [멀티 계획 문서](doc/multi-track-local-plan.md#current-initial-load-optimizations)에 있다.

## Stats

* Add an advanced filter for forms. Useful to find all cats having ultra form
* Add an advanced filter for having talents, and/or ultra talents
* Add a separate filter for banners/families based on series id
* Show surge duration
* Show knockback distance
* Show slow speed (7.5 r/s or 0.5 p/f)

## Owned cats

* Provide a way to import/export cookies from/to the URL. Preferring cookies
  over URL to avoid messing up with random visits.

## Bugs

* Changing the banner should go back to the first page because the whole set
  is changed so there's no reason to preserve the same page.
* Don't show next page if next page is empty
* If there's a non-existing cat in a gacha, for now we show nothing because
  tracking can't be done due to missing rarity data. However, it'll be useful
  to show the gacha data so we know it's not just an empty gacha but a gacha
  we can't use, and it should be clear what's the missing cat so we have a
  better idea. See:
  https://bc.godfat.org/?event=custom&custom=12&details=true
  This should not show empty gacha, but what are there and what's missing.
  Check GachaPool#slots for this.
* Preserve current queries when swapping language for a non-existing cat when
  showing stats (This is something that it's hard to fix, too. We don't know
  if the user intentionally enter an invalid level, or it's swapping to a cat
  with invalid level. The same goes to Metal Cat. It's capped at level=20,
  and if we swap language or tick some options, we'll send level=20, without
  knowing if it's intentional or not.)

## Features and utilities

* What if we add /tracks and make /help the landing page?
* Add a dark theme. How this interacts with the mkweb theme is unclear
* Localize default customized rate. superfest -> 超極ネコ祭
* Multi-select for finding cats
* Show multiple banners of tracks horizontally so we can look at
  different events at the same time.
  Reference: https://ampuri.github.io/bc-normal-seed-tracking/
  and https://ampuri.github.io/godfat-multi/
* Don't use the hard coded version. Check on the disk and see if there's
  a newer version apk and use that instead.
* Normal gacha banners and tracks. Possibly with a new menu item

## Help pages

* Add a table of contents to the help page
* Reword `lib/battle-cats-rolls/view/table_notes.erb` accordingly
* Refactor `lib/battle-cats-rolls/help.rb`. It's a mess! Need DSL.
* A workflow guide for advanced usages with the golden cat CPU icon
  * Utilizing multiple tabs with anchored positions

## Onboarding seeking seeds

* Use a checkbox to indicate if the user did 11-rolls with a guaranteed uber
  or not, so we could just show the 2nd link or 3rd link. Possibly only show
  this checkbox if the selected event is a guaranteed event.
* For the 1st link with the starting seed, we could highlight the path for
  the user input so it's visually clear that which were the cats they just
  rolled and also promote the highlighting feature. This has to follow the
  guaranteed or not checkbox.
* We can consider showing only the starting seed with highlighted guaranteed
  uber if it's fully accurate, forcing the user to try advancing their tracks.

## Architecture

* Queue in memcached rather than in-process! Otherwise can't do great
  zero down time restarting. But we might want to find a way to clear
  the queue without clearing the whole memcached.
