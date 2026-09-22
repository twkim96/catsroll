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

* If there's a non-existing cat in a gacha, for now we show nothing because
  tracking can't be done due to missing rarity data. However, it'll be useful
  to show the gacha data so we know it's not just an empty gacha but a gacha
  we can't use, and it should be clear what's the missing cat so we have a
  better idea. See:
  https://bc.godfat.org/?seed=1&event=custom&custom=12&details=true
  This should not show empty gacha, but what are there and what's missing.
  Check GachaPool#slots for this.
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

* What if we add /tracks and make /help the landing page?
* Add a dark theme. How this interacts with the mkweb theme is unclear
* Localize default customized rate. superfest -> 超極ネコ祭
* Add a dropdown menu for filtering events based on series id
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
