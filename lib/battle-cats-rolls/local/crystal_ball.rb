# frozen_string_literal: true

module BattleCatsRolls
  module LocalCrystalBallClassMethods
    def deep_dup data
      case data
      when Hash
        data.transform_values{ |value| deep_dup(value) }
      when Array
        data.map{ |value| deep_dup(value) }
      else
        data
      end
    end
  end

  module LocalCrystalBall
    def with_cat_names_from source
      copied_data = self.class.deep_dup(data)

      copied_data['cats'].each do |id, info|
        names = source.cats.dig(id, 'name')
        info['name'] = names if names && !names.empty?
      end

      self.class.new(self.class.deep_freeze(copied_data))
    end

    def with_event_names_from source, window_days: 240
      source_events = source.events.values.group_by{ |event| event['id'] }
      copied_data = self.class.deep_dup(data)

      copied_data['events'].each_value do |event|
        if name = matching_event_name(event, source_events, window_days)
          event['name'] = name
        end
      end

      self.class.new(self.class.deep_freeze(copied_data))
    end

    private

    def matching_event_name event, source_events, window_days
      candidates = Array(source_events[event['id']]).select do |source_event|
        event_name_match?(event, source_event, window_days)
      end

      candidates.min_by do |source_event|
        [
          (source_event['start_on'] - event['start_on']).abs.to_i,
          -source_event['start_on'].jd
        ]
      end&.fetch('name')
    end

    def event_name_match? event, source_event, window_days
      source_event['name'] &&
        !source_event['name'].empty? &&
        event['platinum'] == source_event['platinum'] &&
        event['start_on'] &&
        source_event['start_on'] &&
        (source_event['start_on'] - event['start_on']).abs <= window_days
    end
  end

  CrystalBall.singleton_class.prepend(LocalCrystalBallClassMethods)
  CrystalBall.prepend(LocalCrystalBall)
end
