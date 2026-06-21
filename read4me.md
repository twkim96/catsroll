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
  - Lightweight seed-view analytics with a `today:` link and stats page.
  - Optional expanded event comparison in the track table.

Major files added or changed from upstream:

- `bin/update-live-events.rb`
  - Downloads live event TSV data for one or more languages.
  - Used by the external control server button flow.
- `Dockerfile`
  - Hugging Face oriented runtime setup.
  - Sets `TRACK_MAX_COUNT=500`.
  - Sets `EXPAND_COMPARE=0` so expanded comparison stays disabled by default.
- `lib/battle-cats-rolls/asset/recent-seeds.js`
  - Client-side recent seed panel.
- `lib/battle-cats-rolls/asset/track-compare.js`
  - Client-side expanded event comparison UI and auto-loading.
- `lib/battle-cats-rolls/crystal_ball.rb`
  - JP names/events can be localized from KR when matchable.
- `lib/battle-cats-rolls/route.rb`
  - Extra expand-result logic and JP/KR localization setup.
- `lib/battle-cats-rolls/seed_view_counter.rb`
  - In-memory seed view counters, compact JSON persistence, and pruning.
- `lib/battle-cats-rolls/web.rb`
  - Adds JSON endpoints for expanded comparison.
  - Counts seed result page renders and serves `/seed-views`.
- `lib/battle-cats-rolls/view.rb`
  - Adds asset digests, compare-row data attributes, and seed stats helpers.
- `lib/battle-cats-rolls/view/layout.erb`
  - Loads `recent-seeds.js` and `track-compare.js`.
  - Shows the top-right `today:` seed view stats link.
- `lib/battle-cats-rolls/view/seed_views.erb`
  - Renders the seed view stats page.
- Tests touched:
  - `test/test_crystal_ball.rb`
  - `test/test_seed_view_counter.rb`
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

- Default `TRACK_MAX_COUNT` is lowered to `500` for Hugging Face free tier safety.
- Upstream default in `lib/battle-cats-rolls/root.rb` is still `999`; local Docker/service config sets `500`.
- `server.rb` blocks `meta-webindexer` by User-Agent before app routing.
  - EN probe logs showed 167 seed-result requests in about 15 minutes, all from
    `meta-webindexer/1.1`, all with implicit default `count=100`.
  - Blocking here avoids seed calculation work, unlike merely hiding stats logs.

Future load option:

- If non-Meta bots later hit implicit EN seed URLs, consider lowering default
  count only when both `lang` and `count` params are absent.
- Avoid lowering the global default count unless necessary; it affects ordinary
  users more directly.

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

### 5. Seed view stats

Relevant commits:

- `bf451f0 feat: show daily seed view count`
- `4fbb4f4 feat: persist seed view stats`
- `6d85491 feat: add seed view stats page`
- `4d9c18d feat: refine seed view stats`
- `9ed7531 feat: prune seed view stats`
- `911504f fix: retry seed stats loading`
- `041cc95 tweak: expand seed event stats`
- `9b40579 tweak: widen seed region stats`
- `b225246 tweak: label seed event stats`
- `0624664 tweak: refine seed event stats`

Core files:

- `lib/battle-cats-rolls/seed_view_counter.rb`
- `lib/battle-cats-rolls/web.rb`
- `lib/battle-cats-rolls/server.rb`
- `lib/battle-cats-rolls/view.rb`
- `lib/battle-cats-rolls/view/layout.erb`
- `lib/battle-cats-rolls/view/seed_views.erb`
- `test/test_seed_view_counter.rb`

Behavior:

- A valid seed track page render increments the counter once.
- Refreshing a seed result page increments once again.
- Bots are not filtered. All counted seed result renders are included.
- The top-right corner shows `today: N` when today's count is positive.
- Clicking `today: N` opens `/seed-views`.

Storage:

- Counts are updated in memory during requests.
- The server flushes stats every 15 minutes.
- Default path is `/data/seed_views.json`, for the Hugging Face Storage Bucket mounted at `/data`.
- Override path with `SEED_VIEW_STATS_PATH`.
- Override flush interval with `SEED_VIEW_STATS_FLUSH_INTERVAL`.
- `server.rb` loads stats during warmup, starts the periodic flush thread, and flushes again at process exit.
- If `/data/seed_views.json` is not visible at boot, `load!` returns false and retries later.
- If the file appears after in-memory counts already exist, persisted values are merged with current memory values.

JSON shape:

```json
{
  "updated_at": "...",
  "days": {"YYYY-MM-DD": 123},
  "hours": {"YYYY-MM-DDTHH": 45},
  "quarters": {"YYYY-MM-DDTHH:MM": 12},
  "langs_by_day": {"YYYY-MM-DD": {"kr": 10, "jp": 2, "en": 5}},
  "events_by_day": {"YYYY-MM-DD": {"kr|2026-06-22_1043": 8}}
}
```

Pruning:

- `days` is kept indefinitely for daily history.
- `quarters` is kept for about 26 hours, enough for the last-24h chart plus margin.
- `hours` is kept for about 8 days, enough for the last-7d chart plus margin.
- `langs_by_day` and `events_by_day` keep only today's date on flush.
- Older pre-day schema keys `langs` and `events` are migrated into today's bucket when loaded.

Stats page:

- Region table is shown first as a wide horizontal table.
- Event title is `이벤트 Top 10 (KR/JP)`.
- Event Top 10 excludes EN at render time, so EN does not consume top slots.
- Region counts still include EN.
- Event JSON stores compact `lang|event_id` keys. Long event names are resolved at render time from loaded event data.
- Recent 24h chart uses 96 fifteen-minute buckets.
- Recent 7d chart uses 168 one-hour buckets.
- Charts are SVG line graphs with small numeric labels on positive points.
- Chart x-axes show sparse time labels: hourly labels for 24h, daily labels for 7d.
- Daily table lists all retained day totals.

Operational notes:

- This is not SQLite. It is in-memory counters plus periodic JSON writes.
- Do not switch to per-request file writes unless load and locking are reconsidered.
- Hugging Face should have the storage bucket mounted read/write at `/data`; without it, stats still work in memory but persistence fails.
- Day/hour/quarter buckets use fixed Korean time, `+09:00`, regardless of the server's local timezone.

Conflict risk:

- Medium in `web.rb`, `server.rb`, `view.rb`, and `layout.erb`.
- Low/medium in `seed_view_counter.rb`, because it is local-only but important for persistence.

### 6. Expanded event comparison

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
- Seed view stats avoid request-time file writes.
  - Requests update memory only.
  - JSON persistence is batched by the periodic flush thread.
- Seed event stats store compact event ids, not long event labels.
  - Labels are resolved at render time from current event data.
- Seed stats keep EN visible in region counts but hide EN from the event Top 10.
  - This keeps bot-heavy EN traffic visible without letting it fill the KR/JP event table.

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
env LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 ruby -Ilib test/test_seed_view_counter.rb
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
   - `lib/battle-cats-rolls/server.rb`
   - `lib/battle-cats-rolls/route.rb`
   - `lib/battle-cats-rolls/seed_view_counter.rb`
   - `lib/battle-cats-rolls/crystal_ball.rb`
   - `lib/battle-cats-rolls/view/layout.erb`
   - `lib/battle-cats-rolls/view/seed_views.erb`
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
