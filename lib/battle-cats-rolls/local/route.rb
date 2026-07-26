# frozen_string_literal: true

module BattleCatsRolls
  module LocalRouteClassMethods
    def reload_balls(...)
      super
      self.ball_jp =
        ball_jp.with_cat_names_from(ball_kr).with_event_names_from(ball_kr)
    end
  end

  module LocalRoute
    def show_tracks?
      super && !compute_client?
    end

    def multi_uri
      uri(path: "//#{web_host}/multi")
    end

    def compute
      @compute ||= request.params_coercion_with_nil('compute', :to_s)
    end

    def compute_client?
      compute == 'client'
    end

    def expanded_result
      return unless event == 'custom' || ball.events.key?(event)

      pool.add_future_ubers(ubers) if ubers > 0
      return unless pool.exist?

      kind = request.params_coercion('kind', :to_s)
      slot_seed = request.params_coercion('slot_seed', :to_i).abs % MaxSeed

      cat =
        case kind
        when 'guaranteed'
          return {available: false} if pool.guaranteed_rolls.zero?

          expanded_cat(Cat::Uber, slot_seed)
        else
          rarity_seed =
            request.params_coercion('rarity_seed', :to_i).abs % MaxSeed
          score = rarity_seed % GachaPool::Base
          expanded_cat(
            expanded_rarity(score), slot_seed,
            rarity_seed: rarity_seed, score: score)
        end

      return unless cat

      {
        available: true,
        id: cat.id,
        name: cat.pick_name(name),
        rarity: cat.rarity_label.to_s
      }
    end

    def expanded_events
      since = Date.today - 240
      [
        *upcoming_events.map{ |event_name, info|
          expanded_event(event_name, info, 'upcoming')
        },
        *past_events.reverse_each.
          select{ |_event_name, info| since <= info['end_on'] }.
          map{ |event_name, info| expanded_event(event_name, info, 'past') }
      ]
    end

    private

    def expanded_event event_name, info, group
      {
        event: event_name,
        group: group,
        label: "#{info['start_on']} ~ #{info['end_on']}: #{info['name']}"
      }
    end

    def expanded_cat rarity, slot_seed, **args
      slots = pool.dig_slot(rarity)
      return if slots.empty?

      slot = slot_seed % slots.size
      id = slots[slot]

      Cat.new(
        id: id, info: pool.dig_cat(id),
        rarity: rarity, slot_seed: slot_seed, slot: slot,
        **args)
    end

    def expanded_rarity score
      rare_supa = pool.rare + pool.supa

      case score
      when 0...pool.rare
        Cat::Rare
      when pool.rare...rare_supa
        Cat::Supa
      when rare_supa...(rare_supa + pool.uber)
        Cat::Uber
      else
        Cat::Legend
      end
    end

    def default_query query={}, include_filters: false
      super.tap do |result|
        result[:compute] = query[:compute] || compute
      end
    end
  end

  Route.singleton_class.prepend(LocalRouteClassMethods)
  Route.prepend(LocalRoute)
end
