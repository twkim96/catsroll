# frozen_string_literal: true

require_relative 'cat'
require_relative 'fruit'

require 'forwardable'

module BattleCatsRolls
  class Gacha < Struct.new(:pool, :seed, :version,
    :last_both, :last_roll, :position)
    extend Forwardable

    def_delegators :pool, *%w[rare supa uber legend]

    def initialize gacha_pool, seed, version
      super(gacha_pool, seed, version, [])

      advance_seed!
    end

    %w[Rare Supa Uber Legend].each do |rarity|
      define_method("#{rarity.downcase}_cats") do
        name = "@#{__method__}"

        instance_variable_get(name) ||
          instance_variable_set(name,
            pick_cats(Cat.const_get(rarity)))
      end
    end

    def roll_both! sequence=nil
      a_fruit = roll_fruit!
      b_fruit = roll_fruit
      a_cat = roll_cat!(a_fruit)
      b_cat = roll_cat(b_fruit)
      a_cat.track = 0
      b_cat.track = 1
      a_cat.sequence = b_cat.sequence = sequence

      fill_cat_links(a_cat, last_both.first)
      fill_cat_links(b_cat, last_both.last)

      self.last_both = [a_cat, b_cat]
    end

    def roll!
      roll_cat!(roll_fruit!)
    end

    # Existing dupes can cause more dupes, see this for bouncing around:
    # https://bc.godfat.org/?seed=2263031574&event=2019-11-27_377
    def finish_rerolled_links cats
      each_cat(cats) do |rolled_cat, index, track|
        next unless rerolled = rolled_cat.rerolled

        next_index = index + self.class.next_index(track, rerolled.steps)
        next_track = self.class.next_track(track, rerolled.steps)
        next_cat = cats.dig(next_index, next_track)

        fill_cat_links(next_cat, rerolled) if next_cat
      end
    end

    def self.next_index track, steps
      ((track + steps) / 2) + 1
    end

    def self.next_track track, steps
      ((track + steps - 1) ^ 1) & 1
    end

    def finish_last_roll first_cat
      fill_cat_links(first_cat, last_roll)
    end

    def finish_guaranteed cats, guaranteed_rolls=pool.guaranteed_rolls
      each_cat(cats) do |rolled_cat|
        fill_guaranteed(cats, guaranteed_rolls, rolled_cat)

        if rolled_cat.rerolled
          fill_guaranteed(cats, guaranteed_rolls, rolled_cat.rerolled)
        end
      end
    end

    # This can see A and B are passing each other:
    # https://bc.godfat.org/?seed=2390649859&event=2019-06-06_318
    def finish_picking cats, pick, guaranteed_rolls=pool.guaranteed_rolls
      picked = dig_cats_from(cats, pick)

      return unless picked # Users can give arbitrary input
      return unless picked.guaranteed if pick.include?('G')

      if pick.include?('X')
        if pick.include?('G')
          fill_picking_guaranteed(cats, picked, /\A#{picked.number}/,
            guaranteed_rolls)
        else
          fill_picking_single(cats, picked, /\A#{picked.number}/)
        end
      elsif pick.include?('G')
        fill_picking_guaranteed(cats, picked, "#{picked.number}G",
          guaranteed_rolls)
      else
        fill_picking_single(cats, picked, picked.number)
      end
    end

    def mark_next_position cats
      if next_position = dig_cats_from(cats, position)
        if last_roll && last_roll.id == next_position.id &&
          next_position.rerolled # Only rare would have a rerolled cat
          next_position.rerolled.picked_label = :next_position
        else
          next_position.picked_label = :next_position
        end
      elsif next_position = dig_cats_from(cats, position.delete_suffix('R'))
        # We might be switching to an event which doesn't have a rerolled cat
        # In that case we fall back to the regular position
        next_position.picked_label = :next_position
      end
    end

    def backtrack_seed base_seed, steps
      steps.times.inject(base_seed){ |seed| retreat_seed(seed) }
    end

    private

    def pick_cats rarity
      pool.dig_slot(rarity).map do |id|
        Cat.new(id: id, info: pool.dig_cat(id), rarity: rarity)
      end
    end

    def roll_fruit base_seed=seed
      Fruit.new(base_seed, version)
    end

    def roll_fruit!
      roll_fruit.tap{ advance_seed! }
    end

    def roll_cat rarity_fruit
      score = rarity_fruit.value % GachaPool::Base
      rarity = dig_rarity(score)
      slot_fruit = if block_given? then yield else roll_fruit end
      cat = new_cat(rarity, slot_fruit)

      cat.rarity_fruit = rarity_fruit
      cat.score = score

      cat
    end

    def roll_cat! rarity_fruit
      roll_cat(rarity_fruit){ roll_fruit! }
    end

    def dig_rarity score
      rare_supa = rare + supa

      case score
      when 0...rare
        Cat::Rare
      when rare...rare_supa
        Cat::Supa
      when rare_supa...(rare_supa + uber)
        Cat::Uber
      else
        Cat::Legend
      end
    end

    def new_cat rarity, slot_fruit, **args
      slots = pool.dig_slot(rarity)

      if slots.empty? # Cats for this rarity cannot be found
        slot = nil
        id = -1
        info = Cat.none
      else
        slot = slot_fruit.value % slots.size
        id = slots[slot]
        info = pool.dig_cat(id)
      end

      Cat.new(
        id: id, info: info,
        rarity: rarity,
        slot_fruit: slot_fruit, slot: slot,
        **args)
    end

    def reroll_cat cat
      rarity = cat.rarity
      rerolling_slots = pool.dig_slot(rarity).dup
      next_seed = cat.slot_fruit.value
      slot = cat.slot
      id = nil

      # This can run up to the number of duplicated cats
      # 2: https://bc.godfat.org/?seed=2458231674&event=2019-07-18_391&pick=4AX
      # 2: https://bc.godfat.org/?seed=2116007321&event=2019-07-21_391&pick=1AG
      # 3: https://bc.godfat.org/?seed=1773704064&event=2020-12-11_563&lang=jp&pick=3AR
      # 3: https://bc.godfat.org/?seed=1773704064&event=2020-12-11_563&lang=jp&pick=6BR
      # 4: https://bc.godfat.org/?seed=4229260466&last=496&event=2020-12-11_563&lang=jp&pick=5BR
      # 4: https://bc.godfat.org/?seed=1204266455&last=562&event=2020-12-11_563&lang=jp&pick=4AR
      # 5: https://bc.godfat.org/?seed=4275004160&event=2020-12-11_563&lang=jp&pick=5AR
      # 5: https://bc.godfat.org/?seed=2810505815&event=2020-12-11_563&lang=jp&pick=4BR
      # 2 into R: https://bc.godfat.org/?seed=3322538705&event=2020-12-11_563&lang=jp&pick=8AR
      steps = (1..rerolling_slots.count(cat.id)).find do
        next_seed = advance_seed(next_seed)
        rerolling_slots.delete_at(slot)

        slot = next_seed % rerolling_slots.size
        id = rerolling_slots[slot]

        id != cat.id
      end

      Cat.new(
        id: id, info: pool.dig_cat(id),
        rarity: rarity, score: cat.score,
        slot_fruit: roll_fruit(next_seed), slot: slot,
        sequence: cat.sequence, track: cat.track, steps: steps,
        extra_label: "#{cat.extra_label}R")
    end

    def fill_cat_links cat, last_cat
      if version == '8.6' && cat.duped?(last_cat)
        # We need ||= to avoid rerolling the same cat, because it can
        # dupe from both A and B, thus it can be called twice.
        # Given the same cat in the same position, result is the same.
        # https://bc.godfat.org/?seed=3785770978&event=2020-03-20_414
        last_cat.next = cat.rerolled ||= reroll_cat(cat)
      elsif last_cat
        last_cat.next = cat
      end
    end

    def each_cat cats
      cats.each.with_index do |row, index|
        row.each.with_index do |rolled_cat, track|
          yield(rolled_cat, index, track)
        end
      end
    end

    def fill_guaranteed cats, guaranteed_rolls, rolled_cat
      return unless last = follow_cat(rolled_cat, guaranteed_rolls - 1)

      next_index = last.sequence - (last.track ^ 1)
      next_track = last.track ^ 1
      next_cat = cats.dig(next_index, next_track)

      if next_cat
        guaranteed_slot_fruit =
          cats.dig(last.sequence - 1, last.track, :rarity_fruit)

        rolled_cat.guaranteed =
          new_cat(
            Cat::Uber, guaranteed_slot_fruit,
            sequence: rolled_cat.sequence,
            track: rolled_cat.track,
            next: next_cat,
            extra_label: "#{rolled_cat.extra_label}G")
      end
    end

    # We should find a way to optimize this so that
    # we don't have to follow tightly in a loop!
    # How do we reuse the calculation?
    def follow_cat cat, steps
      steps.times.inject(cat) do |result|
        result.next || break
      end
    end

    def dig_cats_from cats, marker
      located = cats.dig(*index_and_track(marker))

      if marker.include?('R')
        located&.rerolled # Users can give arbitrary input
      else
        located
      end
    end

    def index_and_track marker
      index = marker.to_i - 1
      track = (marker[/\A\d+(\w)/, 1] || 'A').ord - 'A'.ord

      [index, track]
    end

    def fill_picking_single cats, picked, number
      detected = fill_picking_backtrack(cats, number)

      # Might not find the way back
      # https://bc.godfat.org/?seed=3419147157&event=2019-07-21_391&pick=44AX#N44A
      the_cat = detected || picked
      the_cat.picked_label = :picked
      the_cat.next&.picked_label = :next_position
    end

    def fill_picking_guaranteed cats, picked, number, guaranteed_rolls
      detected = fill_picking_backtrack(cats, number, :guaranteed)

      # Might not find the way back
      # https://bc.godfat.org/?seed=3419147157&event=2019-07-21_391&pick=44AGX#N44A
      the_cat = detected || picked
      guaranteed = the_cat.guaranteed
      guaranteed.picked_label = :picked_consecutively
      guaranteed.next&.picked_label = :next_position

      fill_picked_consecutively_label(guaranteed_rolls, the_cat)
    end

    # Examples highlighting from last roll:
    # https://bc.godfat.org/?seed=650315141&last=50&event=2020-09-11_433&pick=2BGX#N2B
    # https://bc.godfat.org/?seed=3626964723&last=49&event=2020-09-11_433&pick=2BGX#N2B
    def fill_picking_backtrack cats, number, which_cat=:itself
      cat = last_roll || dig_cats_from(cats, position) || cats.dig(0, 0)

      fill_picking_backtrack_from(cat, number, which_cat)
    end

    def fill_picking_backtrack_from cat, number, which_cat=:itself
      path = []

      begin
        checking_cat = cat.public_send(which_cat)

        # checking_cat might not be there for out of range guaranteed
        # do not break the loop because last_roll doesn't have one either
        if number === checking_cat&.number # String or Regexp matching
          path.each do |passed_cat|
            passed_cat.picked_label = :picked
          end

          break cat
        else
          path << cat
        end
      end while cat = cat.next
    end

    def fill_picked_consecutively_label guaranteed_rolls, cat
      step_up = guaranteed_rolls == 15

      (guaranteed_rolls - 1).times.inject(cat) do |rolled, index|
        rolled.picked_label =
          if step_up && (3 <= index && index < 8)
            :picked # Try to highlight 3, 5, 7 differently
          else
            :picked_consecutively
          end

        rolled.next || break
      end
    end

    def advance_seed!
      self.seed = advance_seed
    end

    def advance_seed base_seed=seed
      base_seed = shift(:<<, 13, base_seed)
      base_seed = shift(:>>, 17, base_seed)
      base_seed = shift(:<<, 15, base_seed)
    end

    def retreat_seed base_seed=seed
      base_seed = shift(:<<, 15, base_seed)
      base_seed = shift(:<<, 30, base_seed)
      base_seed = shift(:>>, 17, base_seed)
      base_seed = shift(:<<, 13, base_seed)
      base_seed = shift(:<<, 26, base_seed)
    end

    def shift direction, bits, base_seed=seed
      base_seed ^= base_seed.public_send(direction, bits) % 0x100000000
    end
  end
end
