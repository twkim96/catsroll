# frozen_string_literal: true

require_relative 'gacha'
require_relative 'cat'

require 'set'

module BattleCatsRolls
  class FindCat < Struct.new(:gacha, :ids)
    Max = 999
    Count = 5

    def self.exclusives
      @exclusives ||= Set.new([
        270, # "Baby Gao",
        284, # "Pai-Pai",
        287, # "Strike Unit R.E.I.",
        319, # "Miko Mitama",
        381, # "D'artanyan",
        334, # "Shadow Gao",
        379, # "Dark Mitama",
        398, # "Sakura Sonic",
        436, # "Li'l Valkyrie",
        442, # "D'arktanyan",
        485, # "Li'l Valkyrie Dark",
        521, # "Good-Luck Ebisu",
        530, # "Kasli the Scourge",
        544, # "Kasli the Bane",
        560, # "Hell Warden Emma",
        586, # "Baby Garu",
        610, # "Shadow Garu",
        613, # "Princess Cat",
        642, # "Iz the Dancer",
        658, # "Iz the Dancer of Grief",
        687, # "Goddess of Light Sirius",
        691, # "Child of Destiny Phono",
        706, # "King of Doom Phono",
        759, # "Trixi the Merc",
        780, # "Celestial Child Luna",
        784, # "Koneko",
        788, # "Netherworld Nymph Lunacia",
        811, # "Agent Staal",
        838, # "Squire Luno",
        860, # "Lone Moon Lunos",
        874, # "Metal Maiden Koneko",
      ]).freeze
    end

    def self.search gacha, find, **args
      ids_in_gacha = filter(gacha, [find, *exclusives])
      ids_in_gacha.concat([find] * (Count - 1)) if ids_in_gacha.member?(find)

      new(gacha, ids_in_gacha).search!(**args)
    end

    def self.filter gacha, ids
      %i[rare_cats supa_cats uber_cats].
        flat_map(&gacha.method(:public_send)).filter_map do |cat|
          cat.id if ids.member?(cat.id)
        end + gacha.legend_cats.map(&:id)
    end

    def search! cats: [], guaranteed: true, max: Max
      if ids.empty?
        []
      else
        found = search_deep(cats, guaranteed, max)

        ids.uniq.each do |missing_id|
          info = gacha.pool.dig_cat(missing_id)
          found[missing_id] <<
            Cat.new(id: missing_id, info: info, sequence: max)
        end

        found
      end
    end

    private

    def search_deep cats, guaranteed, max
      found = search_from_cats(cats, guaranteed)

      if ids.empty?
        found
      else
        search_from_rolling(found, cats, guaranteed, max)
      end
    end

    def search_from_cats cats, guaranteed
      cats.each.inject(Hash.new{ |h, k| h[k] = [] }) do |result, ab|
        ab.each do |cat|
          index = ids.index do |id|
            case id
            when cat.id
              result[id] << cat
            when cat.guaranteed&.id
              result[id] << cat.guaranteed if guaranteed
            end
          end

          ids.delete_at(index) if index
        end

        if ids.empty?
          break result
        else
          next result
        end
      end
    end

    def search_from_rolling found, cats, guaranteed, max
      cats.size.succ.upto(max).inject(found) do |result, sequence|
        if ids.empty?
          break result
        else
          new_ab = gacha.roll_both!(sequence)
          # TODO: gacha.fill_guaranteed([new_ab])
          # will not work here because it's trying to fill guaranteed cats
          # with existing information, yet we're rolling one by one here,
          # thus guaranteed information doesn't exist.
          # We could fix this by rolling 11 times for each attempt

          result.merge(search_from_cats([new_ab], guaranteed)) do |id, a, b|
            a + b
          end
        end
      end
    end
  end
end
