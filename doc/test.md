
# Test the following edge cases:

## Seeker

* time ./Seeker 8.6 6970 2500 500 30 25 29 11 1 2 22 2 9 2 18 2 19 2 2 2 4 2 1 3 12 2 21 2 8
  * 4161166321 and 3390737708
* time ./Seeker 8.6 6970 2500 500 30 25 29 11 1 2 9 2 12 2 22 2 14 2 18 2 14 2 3 2 2 2 20 2 4
  * 3890432974 and 3404232429
* time ./Seeker 8.6 6970 2500 500 30 25 29 11 1 2 18 2 14 2 3 2 2 2 20 2 4 2 6 2 1 3 14 3 0
  * The first cat is a re-rolled cat!
  * It should be 2539156964 and 562408774
* Picking an invalid event
* Check 2160402177
* 3112486085 is a very nice testing seed

## Tracking

* Existing dupes can cause more dupes, see this for bouncing around:
  https://bc.godfat.org/?seed=2263031574&event=2019-11-27_377&pick=5AR#N5A
* A lot of dupes in a row:
  * 2: https://bc.godfat.org/?seed=2458231674&event=2019-07-18_391&pick=4AX
  * 2: https://bc.godfat.org/?seed=2116007321&event=2019-07-21_391&pick=1AG
  * 3: https://bc.godfat.org/?seed=1773704064&event=2020-12-11_563&lang=jp&pick=3AR
  * 3: https://bc.godfat.org/?seed=1773704064&event=2020-12-11_563&lang=jp&pick=6BR
  * 4: https://bc.godfat.org/?seed=4229260466&last=496&event=2020-12-11_563&lang=jp&pick=5BR
  * 4: https://bc.godfat.org/?seed=1204266455&last=562&event=2020-12-11_563&lang=jp&pick=4AR
  * 5: https://bc.godfat.org/?seed=4275004160&event=2020-12-11_563&lang=jp&pick=5AR
  * 5: https://bc.godfat.org/?seed=2810505815&event=2020-12-11_563&lang=jp&pick=4BR
  * 2 into R: https://bc.godfat.org/?seed=3322538705&event=2020-12-11_563&lang=jp&pick=8AR
* Tracks from both sides can attempt to reroll the same cat:
  https://bc.godfat.org/?seed=3785770978&event=2020-03-20_414&pick=10AX#N10A
* Picking cannot reach from the beginning:
  * https://bc.godfat.org/?seed=3419147157&event=2019-07-21_391&pick=44AX#N44A
  * https://bc.godfat.org/?seed=3419147157&event=2019-07-21_391&pick=44AGX#N44A
* This can see picking A and B are passing each other:
  https://bc.godfat.org/?seed=2390649859&event=2019-06-06_318
* Highlight partial cell for the part which will be rolled:
  * https://bc.godfat.org/?seed=650315141&last=50&event=2020-09-11_433&pick=2BGX#N2B
  * https://bc.godfat.org/?seed=3626964723&last=49&event=2020-09-11_433&pick=2BGX#N2B

## Customize gacha

* Non-existing BCEN gacha
  https://bc.godfat.org/?seed=1&event=custom&custom=2&details=true
* 70% ケリ姫スイーツ
  https://bc.godfat.org/?seed=1&event=custom&custom=2&lang=jp&details=true
* 50% Merc Storia with only Wyvern
  https://bc.godfat.org/?seed=1&event=custom&custom=13&details=true
* No event data for BCJP
  https://bc.godfat.org/?seed=1&event=custom&custom=13&lang=jp&details=true
* 85% Crash Fever, but it's 蛋黃人軍團
  https://bc.godfat.org/?seed=1&event=custom&custom=196&lang=tw&details=true
* No event data, non-existing BCTW gacha, but shows some cats
  https://bc.godfat.org/?seed=1&event=custom&custom=390&lang=tw&details=true
* Try to change rates around and see if selection can be preserved
  https://bc.godfat.org/?seed=1&event=custom&custom=2&rate=predicted
* This shouldn't have legend rate:
  https://bc.godfat.org/?seed=1&event=custom&custom=328&rate=predicted&details=true
  Neither should this:
  https://bc.godfat.org/?seed=1&event=custom&custom=355&rate=predicted&details=true

## Stats

* Heavy Assault C.A.T.: Talent massive damage
  https://bc.godfat.org/cats/15
* Awakened Bahamut Cat: Multi area attacks. Talents showing explosion and
  highlighting on Speed, DPS sum, Damage sum, but not individual Damage.
  https://bc.godfat.org/cats/26
* Ultra Delinquent Cat: Strengthen at 67% Health
  https://bc.godfat.org/cats/32
* Apple Cat: Single single attack and single area attack:
  https://bc.godfat.org/cats/40
* Luxury Bath Cat: Talent highlight Knockback ability but not the value,
  because this is unlocking the ability not improving the value.
  https://bc.godfat.org/cats/41
* Ice Crystal Cat: Ultra talent to augment specialization and highlight
  the Strengthen ability without highlighting its value.
  https://bc.godfat.org/cats/43
* Catasaurus: Talent highlight critical value because it's improving it.
  Effect not highlighted because it's not unlocking it.
  https://bc.godfat.org/cats/47
* Sanzo Cat: Talent highlight the slow duration, improving 1.2s rather than
  1.0s because treasure multiplier is applied on that.
  https://bc.godfat.org/cats/51
* Immortal Keiji: Wave triggered effect highlighted in ultra talent.
  DPS/Damage sum highlighted the same as well, but DPS/Damage are highlighted
  with regular talents because that's improved by regular talents. If
  `sum_no_wave` option is used, don't highlight in ultra because then it's
  not accounted after all.
  https://bc.godfat.org/cats/73
  https://bc.godfat.org/cats/73?sum_no_wave=true
* God-Emperor Kamukura: Talent resistant
  https://bc.godfat.org/cats/87
* Crazed Titan Cat: Health should be 52200
  https://bc.godfat.org/cats/100
* Ultra Kasa Jizo: Both true form and ultra form are augmented with talents
  https://bc.godfat.org/cats/138
* Immortal Kenshin: Talent specialization for both true and ultra form
  https://bc.godfat.org/cats/159
* Master of the Pacific: Talent with built-in specialization
  https://bc.godfat.org/cats/175
* Metal Cat: Metal and max level is 20:
  https://bc.godfat.org/cats/201
* Li'l Mohawk Cat: Talent highlight Critical strike, not the value, because
  this is unlocking the ability, not improving it. The effect is also
  highlighted because it's added with the talent.
  https://bc.godfat.org/cats/210
* Li'l Macho Legs Cat: Talent highlight Knockback value, not Knockback itself,
  because this is improving the value, not unlocking the ability.
  https://bc.godfat.org/cats/246
* Almighty Anubis: Ultra highlighted: Production cost, Attack cooldown/cycle,
  Push duration, DPS sum, DPS, Break shield effect and ability. Damage sum
  and Damage should be highlighted by regular talents with increased damage.
  https://bc.godfat.org/cats/259
* Almighty Aphrodite: A lot of Resistance, each with its row because values
  can be different for them.
  https://bc.godfat.org/cats/260
* Akuma Hayabusa: Talent strong
  https://bc.godfat.org/cats/262
* Almighty Ganesha: Talent highlighting Strengthen value
  https://bc.godfat.org/cats/273
* Sea Maiden Ruri: Multi single attacks:
  https://bc.godfat.org/cats/336
* Iron wall: Immune to bosswave:
  https://bc.godfat.org/cats/340?lang=jp
* Hermit Cat: Multi 100% wave:
  https://bc.godfat.org/cats/353
* Volley Cat: Long range single attack:
  https://bc.godfat.org/cats/380
* Glass Cat: Kamikaze does not have DPS:
  https://bc.godfat.org/cats/383
* Neo Backhoe Cat: 50% surge and 15% critical
  https://bc.godfat.org/cats/447
* Wonder MOMOCO: First strike wave and stop effect:
  https://bc.godfat.org/cats/456
* Nameless Eyewaltz CC: No increased damage talent yet DPS (sum) should be
  highlighted by Savage Blow because it does increase the DPS. Do not
  highlight if `dps_no_critical` is used though, because then it should not
  account Savage Blow.
  https://bc.godfat.org/cats/507
  https://bc.godfat.org/cats/507?dps_no_critical=true
* Ken: Third strike effect with all range:
  https://bc.godfat.org/cats/518
* Almighty Hades: Talent with built-in specialization
  https://bc.godfat.org/cats/535
* Kyosaka Nanaho: Second strike critical effect:
  https://bc.godfat.org/cats/545
* Fabulous Pasalan: Level 8 surge
  https://bc.godfat.org/cats/565
* Gacha Cat: Should be capped at level=50 and health is 153000
  https://bc.godfat.org/cats/559?level=100
* Mighty Aegis Garu: Short omni strike and mini-wave:
  https://bc.godfat.org/cats/586
* Emperor Cat: A lot of control effects:
  https://bc.godfat.org/cats/587
* Shampoo (Cat): Multi 50% mini wave:
  https://bc.godfat.org/cats/600
* Fabled Adventure Girl Kanna: First strike surge effect and various ranges:
  https://bc.godfat.org/cats/608
* Awakened Doron: Kamikaze with surge
  https://bc.godfat.org/cats/614
* Iz the Dancer of Grief: A lot of abilities:
  https://bc.godfat.org/cats/658
* Chronos the Bride: Long range and mini-wave:
  https://bc.godfat.org/cats/662
* Goddess of Light Sirius: Complex attack timing:
  https://bc.godfat.org/cats/687
* Child of Destiny Phono: Very narrow max DPS area:
  https://bc.godfat.org/cats/691
* Trash Cat: BCEN exclusive should have animation and DPS data:
  https://bc.godfat.org/cats/741
* Celestial Child Luna: Explosion
  https://bc.godfat.org/cats/780
* こねこ: Wave + Surge + Explosion
  https://bc.godfat.org/cats/784?lang=jp
* 覚醒のネコムート: Talent explosion
  https://bc.godfat.org/cats/26?lang=jp
