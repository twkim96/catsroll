## ChatGPT 플러그인

* 결과 저장·전송 복구 패치 뒤 실제 GPT/Claude에서 공유 재시도, 문맥 업데이트 실패,
  메시지 실패 후 복사/전체 JSON 내보내기, 모든 입력을 보존한 대체 링크를 확인한다.
  로컬 페이지 회귀는 실제 호스트·무료 계정 수용을 대신하지 않는다.
* 공개 운영 전 익명 세션을 새로 발급해 저장 예산을 우회하는 한계를 고려해 용량/부하를 평가한다.
  현재 메모리 상한은 저장 JSON만 포함한다. 계정별 제한이나 공유 철회는 아직 지원하지 않는다.

* [Claude 연결](doc/gpt-plugin.md#claude-연결)의 전용 MCP 주소로 실제 Free 계정 UI 표시와
  기기 계산·결과 공유를 확인한다. 기존 주소의 UI 도메인 검증 실패는 콘솔에서 확인했다.

* 초심자 안내 `catsroll_guide`와 추천 `catsroll_recommend`를 실제 ChatGPT의 모호한 질문과 무료 계정에서 확인한다.
  로컬 검색과 Luna 문서 검토는 실제 무료 계정 수용을 대신하지 않는다.

* [GPT 연동](doc/gpt-plugin.md)의 첫 앱 표시·결과 공유 후 설명 응답 오류를 해결하고,
  무료 웹 계정 수용을 확인한다. 실제 ChatGPT Multi/Find/WASM 실행은 확인했으며
  공개 배포·무료 계정 호환성은 별도다. 300행 압축 공유와 300행동 끝의 목표 획득은
  로컬 호스트에서 검증했으며, 실제 GPT/Claude가 총 뽑기 수·획득 단계·R/G를 정확히 설명하는지 확인한다.
  기본 100·최대 300과 직접 배열/희귀도 공유 후 기존 배열 후속 질문(울슈레 수확·올컬)의 실제 GPT/Claude 도구 선택과 답변 정확도를 확인한다.
  결과 조회 도구의 공개 정의 승인 후 공유→결과 ID→추가 페이지 조회가 실제 대화에서 동작하는지 확인한다.
* [공개 제출 준비](doc/gpt-publication.md)의 개인 인증·공개명, 정책 URL·시연과 공개 CSP 수용을 마친다.
  국가 KR·무료 제공·GitHub Issues·기존 HF 주소는 확정했다. 인증은 기본 결제수단 요구에서 중단됐으며
  카드 등록/충전·자동 충전은 소유자가 결정한다. ChatGPT/API 결제는 별개다.
* ChatGPT 웹 목록에서도 개발자명이 `twkim`이고 고양이 아이콘이 표시되는지 확인한다.
  패키지 메타데이터·아이콘 파일과 미니 앱 헤더 반영은 완료했다.

## Multi Track

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
