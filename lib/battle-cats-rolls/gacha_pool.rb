# frozen_string_literal: true

require 'forwardable'

module BattleCatsRolls
  class GachaPool < Struct.new(:cats, :gacha, :event)
    Base = 10000

    extend Forwardable

    def_delegator :cats, :dig, :dig_cat
    def_delegator :slots, :dig, :dig_slot

    %w[rare supa uber].each do |name|
      define_method(name) do
        event[name]
      end
    end

    def legend
      @legend ||= Base - rare - supa - uber
    end

    def initialize ball, event_data: nil, event_name: nil
      event_data ||= ball.events[event_name] || ball.events.first.last
      # If there's no such event, pick the first active one

      super(ball.cats, ball.gacha.dig(event_data['id'], 'cats'), event_data)
    end

    def exist?
      !!gacha && slots.any?
    end

    def version
      num = event['version'].to_i
      sprintf('%g', num / 10000 + (num % 1000 / 1000.0))
    end

    def slots
      @slots ||= gacha&.inject(default_slots) do |result, cat_id|
        if rarity = dig_cat(cat_id, 'rarity')
          result[rarity] << cat_id
          result
        else # Ignore when a cat can't be found
          return @slots = default_slots
        end
      end || default_slots
    end

    def guaranteed_rolls
      @guaranteed_rolls ||=
        case
        when event['guaranteed']
          11
        when event['step_up']
          15
        else
          0
        end
    end

    def add_future_ubers amount
      range = -1.downto(-amount)

      if range.any?
        # Avoid modifying existing uber pool
        self.cats = cats.dup

        range.each do |n|
          slots[Cat::Uber].unshift(n)
          cats[n] = Cat.future_uber(n)
        end
      end
    end

    private

    def default_slots
      Hash.new{ |h, k| h[k] = [] }
    end
  end
end
