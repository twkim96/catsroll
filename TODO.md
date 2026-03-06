## Stats

* Toggle talents
* Show surge duration
* Show knockback distance
* Show slow percentage
* Use consistent unit for speed (range per second)
* Figure out how where to find the hard coded values in the game data

## Talents

* When unlocked at lv1, it starts at min. when it's at max level, it's at max. so growth is `(max - min) / (maxLevel - 1)`

## Bugs

* If there's a non-existing cat in a gacha, for now we show nothing because
  tracking can't be done due to missing rarity data. However, it'll be useful
  to show the gacha data so we know it's not just an empty gacha but a gacha
  we can't use, and it should be clear what's the missing cat so we have a
  better idea. See:
  https://bc.godfat.org/?seed=1&event=custom&custom=12&details=true
  This should not show empty gacha, but what are there and what's missing.
  Check GachaPool#slots for this.
* Fix guessing 10 rolls link when seeking seed (Can't recall this. Was this for dupe rare?)
* Preserve current queries when swapping language for a non-existing cat when
  showing stats (This is something that it's hard to fix, too. We don't know
  if the user intentionally enter an invalid level, or it's swapping to a cat
  with invalid level. The same goes to Metal Cat. It's capped at level=20,
  and if we swap language or tick some options, we'll send level=20, without
  knowing if it's intentional or not.)
* Can't untick the last owned cat (This is because we can't tell if this is
  visiting the page itself or it's unticking the last cat, because `t` is
  absent in both cases, the URL is the same!)

## Features and utilities

* Localize default customized rate. superfest -> 超極ネコ祭
* Finishing the help page
* Collapse past events. The dropdown can look like:
  * Upcoming:
    * Yesterday
    * Today
    * Tomorrow
  * Custom:
    * Customize...
  * Past:
    * Within last year...
    * Within 2 years ago...
    * Within 3 years ago...
  So it expands like "Customize..." when selecting those past ones.
  To avoid timezone offset, possibly keep 1 day more worth of banners.
* Retreat seed
* Multi-select for finding cats
* Show multiple banners of tracks horizontally so we can look at
  different events at the same time.
  Reference: https://ampuri.github.io/bc-normal-seed-tracking/
* Don't use the hard coded version. Check on the disk and see if there's
  a newer version apk and use that instead.
* Tracking history (by recording rolls we click)
* Use browser timezone offset to calculate local time
* Normal gacha banners and tracks
* Client-side seed seeker

## Architecture

* Queue in memcached rather than in-process! Otherwise can't do great
  zero down time restarting. But we might want to find a way to clear
  the queue without clearing the whole memcached.

## Build script, language and APK

* Only show the languages which are built, no need to force all of them

## Seed seeker

* Fix the bug where it cannot find the seed if the first rare cat happens to
  be a re-rolled rare cat.
