# read4me: catsroll local fork notes for AI agents

이 파일은 새 채팅방에서 AI agent가 이 repo를 빠르게 파악하기 위한 인수인계 문서다.
원본은 GitLab `godfat/battle-cats-rolls`이고, 이 작업공간은 개인용 fork/배포본이다.

## Repository map

- Workspace: `/Users/twkim/Documents/catsroll`
- Local branch: `main`
- User fork remote: `origin` -> `https://github.com/twkim96/catsroll.git`
- Hugging Face Space remote: `hf` -> `https://huggingface.co/spaces/twkim96/my-cats-rolls`
- Original upstream remote: `upstream` -> `https://gitlab.com/godfat/battle-cats-rolls.git`
- As of this note, upstream reference in local repo is `upstream/master` at `61150b3 Always add those headers`.

Do not assume this repo is a clean copy of upstream. It has local features layered on top.

## High-level local changes vs upstream

Main local goals:

- Keep BCKR/BCJP event data closer to live web data even when upstream GitLab lags.
- Deploy to Hugging Face with lower default load.
- Improve KR user experience:
  - Korean names for JP character pools where KR data can be matched.
  - Recently used seed panel.
  - Optional expanded event comparison in the track table.

Major files added or changed from upstream:

- `bin/update-live-events.rb`
  - Downloads live event TSV data for one or more languages.
  - Used by the external control server button flow.
- `Dockerfile`
  - Hugging Face oriented runtime setup.
  - Sets `TRACK_MAX_COUNT=300`.
  - Sets `EXPAND_COMPARE=0` so expanded comparison stays disabled by default.
- `lib/battle-cats-rolls/asset/recent-seeds.js`
  - Client-side recent seed panel.
- `lib/battle-cats-rolls/asset/track-compare.js`
  - Client-side expanded event comparison UI and auto-loading.
- `lib/battle-cats-rolls/crystal_ball.rb`
  - JP names/events can be localized from KR when matchable.
- `lib/battle-cats-rolls/route.rb`
  - Extra expand-result logic and JP/KR localization setup.
- `lib/battle-cats-rolls/web.rb`
  - Adds JSON endpoints for expanded comparison.
- `lib/battle-cats-rolls/view.rb`
  - Adds asset digests and data attributes on `score` cells for compare rows.
- `lib/battle-cats-rolls/view/layout.erb`
  - Loads `recent-seeds.js` and `track-compare.js`.
- Tests touched:
  - `test/test_crystal_ball.rb`
  - `test/test_view.rb`
  - `test/test_web.rb`

## Current custom features

### 1. Live event TSV updater

Relevant commit history:

- `b6f315e tools: add live event updater`
- `2067ada tools: update live events for multiple langs`

Purpose:

- Pull live event TSV data directly instead of waiting for upstream GitLab event commits.
- Supports multiple languages, currently important for `kr` and `jp`.

Operational note:

- The external control server under `../terminal` has buttons for update/deploy flows.
- If event TSV files are unchanged, normal git commit/push should have nothing meaningful to upload.
- Official upstream later adding the same TSV usually should not conflict if contents match. If not identical, conflict is possible in the TSV file only.

### 2. Hugging Face load cap

Relevant commit:

- `5c113d7 config: cap track count on hf`

Purpose:

- Default `TRACK_MAX_COUNT` is lowered to `300` for Hugging Face free tier safety.
- Upstream default in `lib/battle-cats-rolls/root.rb` is still `999`; local Docker/service config sets `300`.

### 3. JP page Korean character names and event-name matching

Relevant commits:

- `e1269e1 feat: show Korean names for JP cats`
- `5fca101 feat: localize JP event names from KR`

Behavior:

- JP character names are mapped to KR names when the same unit exists in KR data.
- Missing KR data falls back to original JP naming.
- JP event names can be localized from KR only when there is a conservative match.
- Event-name matching is intentionally limited to a recent window, not broad fuzzy translation.

Conflict risk:

- Medium in `lib/battle-cats-rolls/crystal_ball.rb` and `lib/battle-cats-rolls/route.rb` if upstream changes data-loading/localization structure.

### 4. Recent seed panel

Relevant commits:

- `a010d90 feat: remember recent seeds`
- `7ad2bfc tweak: limit recent seeds panel`
- `9b1a4c4 feat: pin recent seed`

File:

- `lib/battle-cats-rolls/asset/recent-seeds.js`

Behavior:

- Browser localStorage stores recent seeds.
- Panel shows up to 4 recent seeds.
- Panel label is `최근 seed`.
- Long-press can pin one seed.
- Pinned seed stays at top, is light gray, and is not dropped from the list.
- Long-press pinned again or pin another seed to unpin/switch.

Conflict risk:

- Low unless upstream adds its own recent-seed JS or changes layout script loading.

### 5. Expanded event comparison

Relevant main commits:

- `f0d6344 feat: compare expanded track events`
- `e18c8a2 tweak: improve expand event picker`
- `97cbad2 tweak: refine expand compare ui`
- Later UI cleanup commits through `56a773d fix: align compare label title column`

Core files:

- `lib/battle-cats-rolls/asset/track-compare.js`
- `lib/battle-cats-rolls/web.rb`
- `lib/battle-cats-rolls/route.rb`
- `lib/battle-cats-rolls/view.rb`
- `lib/battle-cats-rolls/view/layout.erb`
- `lib/battle-cats-rolls/root.rb`

Server support toggle:

- `BattleCatsRolls::ExpandCompareSupported` is controlled by `EXPAND_COMPARE`.
- Default is disabled. Enable only with `EXPAND_COMPARE=1`, `true`, `yes`, or `on`.
- Docker and systemd config currently set `EXPAND_COMPARE=0`.
- When disabled:
  - `layout.erb` does not load `track-compare.js`.
  - `/expand/events` returns `supported:false` and an empty event list.
  - `/expand/result` returns `supported:false, available:false`.
  - No expanded comparison calculation runs, which protects the server under load.

Endpoints:

- `GET /expand/events?lang=kr|jp`
  - Returns selectable recent event list only when `EXPAND_COMPARE` is enabled.
- `GET /expand/result?...`
  - Returns one expanded comparison result for a cell only when `EXPAND_COMPARE` is enabled.

Current UI behavior:

- Button text: `확장 비교`.
- Button is placed next to the `Event:` label.
- Modal title: `확장 이벤트`.
- Up to 2 expansion events.
- Supports `KR` and `JP`.
- Each expansion has an `ubers` numeric option.
- Save button applies changes. Clicking outside modal closes without saving.
- `선택 해제` clears modal selections.
- `확장 1`, `확장 2` title rows show the selected event label.
  - Event label starts aligned with the event select column.
  - It spans through the ubers column.
  - It shows up to 2 lines and clips overflow.

Current table-rendering structure:

- Important: compare boxes are rendered into `td.score`, not `td.cat`.
- `view.rb` adds `data-expand-*` only to `score` cells.
- `cat` cells no longer carry compare data.
- The failed earlier approach of wrapping/repositioning inside `cat` cells was removed.
- Removed/should not reintroduce unless intentionally redesigning:
  - `track-compare-stack`
  - `track-compare-main`
  - `alignBoxes`
  - `track-compare-offset`

Current compare-row rendering behavior:

- Compare boxes are `position: absolute` inside `td.score.track-compare-cell`.
- This keeps compare UI out of table flow, so enabling compare should not inflate row height.
- Divider color is `#b3b3b3` to avoid looking like the main black table border.
- Desktop width `>= 761px`:
  - If two expansion events are selected, compare boxes render as two columns in one row.
  - Text is one line and clipped if too long.
- Mobile width `<= 760px`:
  - Compare boxes stack vertically.
  - Each box may show up to 2 lines, so two expansions can show up to 4 lines.
- Scrollbars are hidden for compare boxes.

Auto-load behavior:

- Manual click/touch still calculates a cell.
- Additionally, visible high-value `score` cells auto-load sequentially.
- Target classes:
  - `uber_fest`
  - `uber`
  - `legend`
  - `exclusive`
- Uses `IntersectionObserver` with `rootMargin: "240px 0px"`.
- Queue runs one cell at a time.
- After a cell finishes, waits about `120ms` before processing next.
- Before processing, it checks the cell is still near viewport.
- If the user scrolls very fast, stale cells are re-observed instead of requested immediately.
- Cached localStorage results are reused.
- Cache clears when expansion selection changes.

Conflict risk:

- High in `track-compare.js` because it is a large local-only file.
- Medium in `view.rb`, `web.rb`, and `route.rb` if upstream changes table rendering, routing, or JSON endpoints.

## Important design decisions

- Keep conflict-prone behavior thin where possible:
  - Most UI logic lives in JS assets.
  - Ruby view changes are intentionally small.
- Expanded compare should use `score` cells, not `cat` cells.
  - `score` cells already occupy the upper/blank half of the track table in normal display mode.
  - This avoids fighting the vertical layout of cat names.
- Do not auto-load all rows.
  - Only high-value visible/near-visible rows are auto-loaded.
  - Manual click remains available for all rows.
- Do not translate unmatched event names.
  - Conservative match only; otherwise keep original.

## Common commands

Pull upstream GitLab:

```sh
git pull https://gitlab.com/godfat/battle-cats-rolls.git master
```

For normal local event update commits, avoid `git add .` if `.DS_Store` or personal notes are untracked. Prefer targeted adds:

```sh
git status --short
git add data build
git commit -m "Update gacha events"
git push origin main
git push hf main
```

If intentionally committing this local note:

```sh
git add read4me.md
git commit -m "docs: update local fork notes"
git push origin main
git push hf main
```

Useful checks:

```sh
node --check lib/battle-cats-rolls/asset/track-compare.js
env LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 ruby -Ilib -S rake test
```

Known macOS caveat:

- `./bin/server` uses `readlink -e`, which can fail on macOS.
- For local testing, direct `yahns -c config/yahns.rb` with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` has been used.

Example:

```sh
env LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 WEB_BIND=127.0.0.1:18080 SEEK_BIND=127.0.0.1:18090 yahns -c config/yahns.rb
```

## Merge/conflict guidance for future AI

If `git pull upstream/master` conflicts:

1. Preserve local features unless user explicitly asks to drop them.
2. Highest-risk local files:
   - `lib/battle-cats-rolls/asset/track-compare.js`
   - `lib/battle-cats-rolls/view.rb`
   - `lib/battle-cats-rolls/web.rb`
   - `lib/battle-cats-rolls/route.rb`
   - `lib/battle-cats-rolls/crystal_ball.rb`
   - `lib/battle-cats-rolls/view/layout.erb`
3. Event TSV/data conflicts are usually safe to resolve by comparing actual data freshness.
4. Do not revert user/local features just because upstream lacks them.
5. If UI compare breaks, first verify current intended structure:
   - `score` cells have `data-expand-*`.
   - JS selects `td.score[data-expand-slot-seed]`.
   - Compare boxes are absolute within `score` cells.
   - `cat` cells should not have compare wrappers.

## Current untracked files commonly seen

These have appeared during work and should not be blindly committed unless user asks:

- `.DS_Store`
- `mymy.md`
