# Local Multi Track Page Plan

## Goal

Add a local-only multi-track viewer that is reachable from the existing top-right
area. The existing top menu icons stay unchanged. The new entry point is a
small `multi` button placed below `today: N` only because there is not enough
space for another top icon.

The multi page should let a user compare multiple banners from one seed, similar
to `https://ampuri.github.io/godfat-multi/?seed=1`, while keeping all track
calculation on the user's device after the page is loaded.

## Non-Goals

- Do not change the existing server seed search flow.
- Do not change the existing track table behavior on `/`.
- Do not add server endpoints that calculate multi-track results.
- Do not require a network call from the multi page after initial HTML/asset load.
- Do not remove or repurpose the existing theme option.
- Do not support external banner URLs in the first version.

## Entry Point

Current layout:

- `lib/battle-cats-rolls/view/layout.erb` renders the top menu icons at
  lines 108-119.
- The implementation should use a small top-right utility area for `today: N`
  and `multi`; the original icon menu remains unchanged.

Planned change:

- Keep `#menu` and its icons exactly as-is.
- Add a second link/button: `multi`.
- Treat `multi` as independent from seed view stats. It is visually placed near
  `today: N`, but it is not a child feature of the stats page.
- Target URL: `/multi?seed=<current seed>`.
- If the current page has no valid seed, target `/multi` and let the page use
  the seed input default.
- On mobile, stack `today: N` and `multi` vertically in the same top-right area.
- Show the `multi` entry even if the today counter is absent or zero.

## Page Contract

Route:

- Add `GET /multi`.
- Render a new ERB view, for example
  `lib/battle-cats-rolls/view/multi.erb`.

Assets:

- Add a dedicated browser script, for example
  `lib/battle-cats-rolls/asset/multi-track.js`.
- Add it only on the multi page, or load it globally with a no-op guard.
- No external script CDN.

Initial data:

- The server may embed event/banner data into the page as JSON.
- After page load, the browser must not call the server for calculations.
- The embedded data should include only what the browser needs:
  region, event id/name/date, rates, rarity slots, translated cat names, and
  text labels.
- Because the multi page has per-banner region selectors and must not call the
  server after load, preload the supported region/event data needed by the page
  during the initial render. Keep this data scoped to selectable events rather
  than the whole raw data archive.
- Cat images are out of scope. The first version is text-only.
- Translation/text replacement can happen during initial server render by using
  the existing `View#cat_name` and `L10n.translate` style logic, then embedding
  the translated strings in the page JSON. Browser-side interactions reuse that
  embedded text and do not require server calls.

Persistent browser state:

- Use `localStorage` for recent multi-page settings:
  seed, count, selected banners, future uber values, custom names, and planning
  history if planning mode is implemented.

Limits:

- Maximum selected banner rows: 5.
- Maximum count: 500 rows.
- Maximum multi page max-width: 1200px.

## Calculation Model

Use the existing Ruby `Gacha` behavior as the source of truth:

- `Gacha#initialize` advances the seed once before displaying tracks.
- `Gacha#roll_both!` computes A/B rows from the current seed.
- `Gacha#dig_rarity` maps `seed % 10000` into rare/super/uber/legend.
- `Gacha#new_cat` maps slot seed into the banner's rarity slot list.
- Duplicate rare handling must match `Gacha#fill_cat_links` and
  `Gacha#reroll_cat`.
- Guaranteed/future uber support should match existing table semantics where
  possible.

The JavaScript implementation should be a direct port of the small deterministic
parts of `Gacha`, not a new interpretation of the rules.

## UI Scope

Minimum useful version:

- Seed input.
- Count selector/input.
- Add/remove banner rows.
- Region selector per row.
- Banner/event selector per row.
- No URL input mode.
- Future ubers selector per row.
- Optional custom name per row.
- Submit/update button.
- Multi-track output table showing each selected banner side by side.
- Output layout must group by track, not by banner:
  render one A-track table containing all selected banners, then one B-track
  table containing all selected banners.
- Do not render columns as banner1 A/B, banner2 A/B, banner3 A/B. That layout is
  harder to read on mobile and makes same-track comparison worse.
- Links/cell markers that make duplicate-rare track switches readable.

Mobile constraints:

- Banner controls must wrap cleanly.
- Track tables may scroll horizontally.
- The page should remain usable at narrow widths; exact parity with the external
  tool is not required for the first version.
- Prevent adding a sixth banner row.
- Clamp or reject counts above 500.

## Planning Mode

Planning Mode is useful but should not block the first implementation.

Implement in phase 3 only if the interaction model is simple after the base
viewer works. Otherwise leave it as TODO.

Expected Planning Mode behavior:

- Toggle planning mode on/off.
- Clicking a track cell records a chosen chain.
- Clicking striped/linked cells continues the chain.
- Undo removes the last chosen step.
- Reset clears the planning state.
- Output exports the chosen chain as text.

Implementation note:

- If the external `godfat-multi` source is available, use it only as behavioral
  reference. Do not copy opaque code unless license and compatibility are clear.
- Current sandbox DNS failed when trying to fetch `ampuri.github.io`, so the
  first implementation should be based on local `Gacha` behavior and manual UI
  comparison.

## Performance and Cache Guardrails

- Keep localStorage to one latest multi setup, not an unbounded history.
- Keep planning history bounded to the visible count, with an absolute maximum
  of 500 steps.
- Remove or replace the previous output DOM before rendering a new result.
- Use event delegation for row controls so adding/removing rows does not
  accumulate per-row listeners.
- Keep the hard limits of 5 banner rows and 500 output rows.
- If mobile rendering is still too heavy, add a later enhancement to reveal
  rows in chunks, for example 100 rows at a time.

## Phases

### Phase 1: Navigation and Page Shell

Files:

- `lib/battle-cats-rolls/view/layout.erb`
- `lib/battle-cats-rolls/web.rb`
- `lib/battle-cats-rolls/route.rb`
- `lib/battle-cats-rolls/view/multi.erb`

Tasks:

- Add the `multi` button below `today: N`.
- Add `/multi` route.
- Preserve all existing top menu icons and links.
- Render a basic form with seed/count and one banner selector.
- Include region selection next to banner selection.
- Do not include URL input mode.

Done criteria:

- `/multi` loads.
- The mobile top-right area shows `today: N` and `multi` without covering the
  menu icons.
- The `multi` button still appears when the today counter has no value.
- Existing `/`, `/seed-views`, `/seek`, `/cats`, `/logs`, and `/help` still load.

### Phase 2: Embedded Banner Data and Local Calculator

Files:

- `lib/battle-cats-rolls/view/multi.erb`
- `lib/battle-cats-rolls/view.rb` if JSON helpers are needed
- `lib/battle-cats-rolls/asset/multi-track.js`

Tasks:

- Embed selectable multi-page region/event/banner data as JSON in the multi
  page.
- Embed translated text/cat names needed for text-only output.
- Port seed advance, rarity selection, slot selection, A/B track generation, and
  duplicate rare reroll handling to JavaScript.
- Render side-by-side track output for multiple selected banners.
- Keep all update/re-render actions local in the browser.

Done criteria:

- Changing seed/count/banner updates without a page reload.
- Changing a banner row's region updates available events without a server
  request.
- Browser devtools Network panel shows no application requests after initial
  load when interacting with the multi page.
- For a fixed seed/event, the first N rows match the existing `/` table for the
  same event.

### Phase 3: Multi Controls and Persistence

Files:

- `lib/battle-cats-rolls/asset/multi-track.js`
- `lib/battle-cats-rolls/view/multi.erb`

Tasks:

- Add multiple banner rows.
- Add remove row.
- Enforce a maximum of 5 banner rows.
- Add custom name.
- Add future ubers selector.
- Enforce a maximum count of 500.
- Persist settings in `localStorage`.
- Restore settings when revisiting `/multi`.

Done criteria:

- Up to five banners can be compared from the same seed.
- Refreshing `/multi` keeps the last selected multi setup.
- Future uber values affect only the local calculated output.
- Count values above 500 are clamped or rejected with a clear inline message.

### Phase 4: Planning Mode or TODO

Files:

- `lib/battle-cats-rolls/asset/multi-track.js`
- `lib/battle-cats-rolls/view/multi.erb`

Tasks:

- Implement Planning Mode if base table state makes it straightforward.
- Otherwise add a visible TODO note in the code and leave this phase pending.

Done criteria if implemented:

- Toggle, undo, reset, and output work locally.
- Planning selections survive ordinary table rerenders.
- No server call is made by planning interactions.

## Verification

Use these checks before considering the feature complete:

- Ruby route smoke test or local server request for `/multi`.
- Manual mobile viewport check for top-right `today` + `multi` layout.
- Manual compare against existing `/` table for at least one seed and one event.
- Manual compare against `godfat-multi` when the reference page is reachable.
- Browser Network check proving no server calls after page load.
- Region changes, event changes, future uber changes, and count changes must all
  pass the no-server-call check.
- Regression smoke checks for existing routes and server seed search page.

## Resolved Decisions

- The `multi` button is independent from `today`. It is placed below `today`
  only because the icon row has no spare space.
- The multi page owns its own event selection UI.
- `/multi?seed=<seed>` should use the current page `lang` and `event` as the
  initial first row when those values are present. The user can still change
  region/event inside the multi page.
- Each banner row uses region selection plus event selection. There is no
  external URL input mode.
- Track output is grouped as A table plus B table. It is not grouped as repeated
  A/B columns per banner.
- Output is text-only because this server does not have the image assets needed
  for a multi image view.
- Translation/text replacement should be reused at initial render time and
  embedded into the page data, so the browser can remain local-only after load.
- Limit to 5 selected banners and 500 rows.
