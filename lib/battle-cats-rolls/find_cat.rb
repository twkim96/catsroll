# frozen_string_literal: true

require_relative 'gacha'
require_relative 'cat'

module BattleCatsRolls
  class FindCat < Struct.new(:gacha, :ids)
    Max = 999
    Found = Struct.new(:cat, :numbers, keyword_init: true) do
      def number
        numbers.join(', ')
      end

      def respond_to_missing? name, include_private=false
        cat.respond_to?(name, include_private) || super
      end

      def method_missing name, *args, &block
        if cat.respond_to?(name)
          cat.public_send(name, *args, &block)
        else
          super
        end
      end
    end

    def self.exclusives
      @exclusives ||= [
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
      ].freeze
    end

    def self.search gacha, find, **args
      new(gacha, exclusives + [find]).search(**args)
    end

    def initialize new_gacha, target_ids
      ids_in_gacha = %i[rare_cats supa_cats uber_cats legend_cats].
        flat_map(&new_gacha.method(:public_send)).select do |cat|
          target_ids.member?(cat.id)
        end.map(&:id)

      ids_in_gacha.concat(new_gacha.legend_cats.map(&:id))

      super(new_gacha, ids_in_gacha)
    end

    def search cats: [], guaranteed: true, max: Max
      if ids.empty?
        []
      else
        occurrences = search_all_from_cats(cats, guaranteed, ids.uniq)
        found = search_deep(cats, guaranteed, max)

        results = found.values.map do |cat|
          found_result(cat, occurrences[cat.id] || [cat])
        end

        if found.size < ids.uniq.size
          results + (ids.uniq - found.keys).map do |missing_id|
            info = gacha.pool.dig_cat(missing_id)
            cat = Cat.new(id: missing_id, info: info, sequence: max)
            found_result(cat, [cat])
          end
        else
          results
        end
      end
    end

    private

    def search_deep cats, guaranteed, max
      found = search_from_cats(cats, guaranteed, ids)

      if found.size < ids.size
        search_from_rolling(found, cats, guaranteed, max)
      else
        found
      end
    end

    def search_from_cats cats, guaranteed, remaining_ids
      cats.each.inject({}) do |result, ab|
        (remaining_ids - result.keys).each do |id|
          ab.each do |cat|
            case id
            when cat.id
              result[id] = cat
            when cat.guaranteed&.id
              result[id] = cat.guaranteed if guaranteed
            end
          end
        end

        if result.size == remaining_ids.size
          break result
        else
          next result
        end
      end
    end

    def search_all_from_cats cats, guaranteed, remaining_ids
      cats.each_with_object({}) do |ab, result|
        remaining_ids.each do |id|
          ab.each do |cat|
            case id
            when cat.id
              (result[id] ||= []) << cat
            when cat.guaranteed&.id
              (result[id] ||= []) << cat.guaranteed if guaranteed
            end
          end
        end
      end
    end

    def search_from_rolling found, cats, guaranteed, max
      cats.size.succ.upto(max).inject(found) do |result, sequence|
        if result.size == ids.size
          break result
        else
          new_ab = gacha.roll_both!(sequence)
          # TODO: gacha.fill_guaranteed([new_ab])
          # will not work here because it's trying to fill guaranteed cats
          # with existing information, yet we're rolling one by one here,
          # thus guaranteed information doesn't exist.
          # We could fix this by rolling 11 times for each attempt

          next result.merge(
            search_from_cats([new_ab], guaranteed, ids - result.keys))
        end
      end
    end

    def found_result cat, cats
      Found.new(cat: cat, numbers: cats.map(&:number))
    end
  end
end
