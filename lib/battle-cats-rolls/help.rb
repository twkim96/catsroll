# frozen_string_literal: true

require_relative 'cat'
require_relative 'gacha'

module BattleCatsRolls
  class Help
    def read_the_tracks
      @read_the_tracks ||= fake_tracks.first(5)
    end

    def advance_the_tracks
      @advance_the_tracks ||=
        read_the_tracks.drop(2).
          map{ |cs| cs.map{ |c| c.new_with(sequence: c.sequence - 2) }}
    end

    def swap_the_tracks
      @swap_the_tracks ||=
        advance_the_tracks.map do |(a, b)|
          [b.new_with(track: 0), a.new_with(track: 1)]
        end
    end

    def lookup_cat_data
      @lookup_cat_data ||= [[
        fake_cat(319, 'Miko Mitama', 1, 0, slot_fruit: Fruit.new(1)),
        fake_cat(-1, 'Cat', 1, 1)
      ]]
    end

    def guaranteed_tracks
      @guaranteed_tracks ||= begin
        tracks = fake_tracks.map(&:dup)

        fake_1AG = fake_cat(-1, '(1A guaranteed uber)', 1, 0)
        fake_1AG.next = tracks.dig(10, 1)
        tracks[0][0] = tracks.dig(0, 0).new_with(guaranteed: fake_1AG)

        fake_1BG = fake_cat(-1, '(1B guaranteed uber)', 1, 1)
        fake_1BG.next = tracks.dig(11, 0)
        tracks[0][1] = tracks.dig(0, 1).new_with(guaranteed: fake_1BG)

        tracks
      end
    end

    def dupe_rare_tracks
      @dupe_rare_tracks ||= begin
        tracks = fill_dupes(read_the_tracks.map(&:dup))

        dup_modify(tracks, 4, 1, picked_label: :next_position)

        tracks
      end
    end

    def bouncing_tracks
      @bouncing_tracks ||= begin
        tracks = bouncing_base.map(&:dup)

        dup_modify(tracks, 6, 0, picked_label: :picked)
        dup_modify(tracks, 7, 0, picked_label: :next_position)

        tracks
      end
    end

    def go_straight_tracks
      @go_straight_tracks ||= begin
        tracks = bouncing_base.map(&:dup)

        dup_modify(tracks, 4, 1, picked_label: :picked,
          rerolled: tracks.dig(4, 1).rerolled.new_with(picked_label: ''))

        tracks
      end
    end

    def mark_next_position cats
      result = cats.dup
      result[0] = result[0].dup
      dup_modify(result, 0, 0, picked_label: :next_position)
      result
    end

    def pick cats, sequence, track, guaranteed=false
      result = cats.map(&:dup)

      if guaranteed
        index = sequence - 1
        index_end = sequence + 9

        pick_sequence(result, index_end, track, :picked_consecutively)

        dup_modify(result, index, track, guaranteed:
          result.dig(index, track).guaranteed.
            new_with(picked_label: :picked_consecutively))

        dup_modify(result, index_end + track ^ 0, track ^ 1,
          picked_label: :next_position)
      else
        pick_sequence(result, sequence, track, :picked)

        # Handle rerolled case by case...
        if result.dig(sequence - 1, track).rerolled.nil?
          dup_modify(result, sequence, track, picked_label: :next_position)
        end
      end

      result
    end

    private

    def fake_tracks
      @fake_tracks ||= [
        %i[rare supa rare rare supa supa rare uber supa rare legend rare],
        %i[supa rare uber rare rare rare supa rare rare supa rare uber]
      ].map.with_index do |column, track|
        column.map.with_index do |rarity_label, index|
          sequence = index + 1
          track_label = (track + 'A'.ord).chr
          name = "(#{sequence}#{track_label} #{rarity_label} cat)"
          cat = fake_cat(-1, name, sequence, track)
          cat.rarity_label = rarity_label
          cat
        end
      end.transpose
    end

    def fake_cat id, name, sequence, track, **args
      Cat.new(
        id: id, info: {'name' => [name]},
        sequence: sequence, track: track,
        **args)
    end

    def pick_sequence result, sequence, track, label
      (0...sequence).each do |index|
        if rerolled = result.dig(index, track).rerolled
          if rerolled.picked_label.nil?
            dup_modify(result, index, track,
              rerolled: rerolled.new_with(picked_label: label))
          end
        else
          dup_modify(result, index, track, picked_label: label)
        end
      end
    end

    def dup_modify result, index, track, **args
      result[index][track] = result.dig(index, track).new_with(**args)
    end

    def bouncing_base
      @bouncing_base ||= begin
        tracks = fill_dupes(fake_tracks.first(8).map(&:dup))

        tracks[3][1] = fake_cat(149, 'Rocker Cat', 4, 1)
        tracks[4][1] = fake_cat(38, 'Pogo Cat', 5, 1,
          rerolled: fake_cat(51, 'Bishop Cat', 5, 1,
            extra_label: 'R', picked_label: :picked,
            next: tracks.dig(6, 0)))

        dup_modify(tracks, 3, 0,
          rerolled: tracks.dig(3, 0).rerolled.new_with(
            next: tracks.dig(4, 1).rerolled))

        tracks
      end
    end

    def fill_dupes tracks
      tracks[2][0] = fake_cat(148, 'Tin Cat', 3, 0)
      tracks[3][0] = fake_cat(148, 'Tin Cat', 4, 0,
        rerolled: fake_cat(38, 'Pogo Cat', 4, 0,
          next: tracks.dig(4, 1)))

      tracks
    end
  end
end
