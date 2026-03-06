# frozen_string_literal: true

module BattleCatsRolls
  class Cat < Struct.new(
    :id, :info,
    :rarity, :rarity_fruit, :score,
    :slot, :slot_fruit,
    :sequence, :track, :steps,
    :next, :parent, :rerolled, :guaranteed,
    :rarity_label, :picked_label, :extra_label,
    keyword_init: true)

    Rare   = 2
    Supa   = 3
    Uber   = 4
    Legend = 5

    def self.none
      @none ||= {'name' => ['N/A']}.freeze
    end

    def self.future_uber n
      {'name' => ["(#{n}?)"], 'desc' => ['An unknown future uber']}
    end

    def inspect
      %Q{#<BattleCatsRolls::Cat number="#{number}" name="#{name}">}
    end

    alias_method :to_s, :inspect

    def name
      info&.dig('name', 0) || id
    end

    def pick_name index
      info.dig('name', index) || pick_name(index - 1) if index >= 0
    end

    def pick_title index
      picked_name = pick_name(index)
      names = info.dig('name').join(' | ').sub(picked_name, "*#{picked_name}")

      "#{names}\n#{pick_description(index)}"
    end

    def pick_description index
      info.dig('desc', index) || pick_description(index - 1) if index >= 0
    end

    def number
      "#{sequence}#{track_label}#{extra_label}"
    end

    def track_label
      if track
        (track + 'A'.ord).chr
      else
        '+'
      end
    end

    def == rhs
      id == rhs.id
    end

    def duped? rhs
      rhs && rarity == Rare && id == rhs.id && id > 0
    end

    def max_level
      info['max_level']
    end

    def growth
      info['growth']
    end

    def talent_against
      info['talent_against']
    end

    def new_with **args
      self.class.new(to_h.merge(args))
    end

    def rarity_label
      super ||
        case score
        when nil, 0...6470
          :rare
        when 6470...6970
          :supa_fest
        when 6970...9070
          :supa
        when 9070...9470
          :uber_fest
        when 9470...9970
          :uber
        else
          :legend
        end
    end

    def wiki_entry_name
      "#{name} (#{wiki_rarity_label})".tr(' ', '_')
    end

    def wiki_rarity_label
      self.class.wiki_rarity_label(info['rarity'])
    end

    def self.wiki_rarity_label rarity
      case rarity
      when 0
        'Normal Cat'
      when 1
        'Special Cat'
      when 2
        'Rare Cat'
      when 3
        'Super Rare Cat'
      when 4
        'Uber Rare Cat'
      when 5
        'Legend Rare Cat'
      end
    end
  end
end
