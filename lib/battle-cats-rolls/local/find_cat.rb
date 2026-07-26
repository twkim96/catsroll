# frozen_string_literal: true

module BattleCatsRolls
  class FindCat
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
  end

  module LocalFindCat
    def search cats: [], guaranteed: true, max: FindCat::Max
      return [] if ids.empty?

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

    private

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

    def found_result cat, cats
      FindCat::Found.new(cat: cat, numbers: cats.map(&:number))
    end
  end

  FindCat.prepend(LocalFindCat)
end
