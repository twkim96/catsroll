# frozen_string_literal: true

require_relative 'cat'

module BattleCatsRolls
  class CrystalBall < Struct.new(:data)
    def self.from_cats_builder_and_events cats_builder, events
      gacha_data = attach_gacha_series_id(
        cats_builder.gacha, cats_builder.provider.gacha_option)

      new(deep_freeze({
        'cats' => cats_builder.cats,
        'gacha' => guess_gacha_events(gacha_data, events.gacha.values),
        'events' => events.gacha
      }))
    end

    def self.load dir, lang
      require 'yaml'

      new(deep_freeze(
        YAML.safe_load_file("#{dir}/bc-#{lang}.yaml",
          permitted_classes: [Date])))
    end

    def self.deep_freeze data
      case data.freeze
      when Hash
        data.each do |key, value|
          deep_freeze(key)
          deep_freeze(value)
        end
      when Array
        data.each(&method(__method__))
      end
    end

    def self.deep_dup data
      case data
      when Hash
        data.transform_values{ |value| deep_dup(value) }
      when Array
        data.map{ |value| deep_dup(value) }
      else
        data
      end
    end

    def self.attach_gacha_series_id gacha, gacha_option
      require_relative 'tsv_reader'
      option = TsvReader.new(gacha_option).gacha_option
      gacha.merge(option){ |_, a, b| a.merge(b) }
    end

    def self.guess_gacha_events gacha, events
      # Can we have transform_values and also know key at the same time?
      gacha.map do |key_value|
        gacha_id, gacha_data = key_value
        event = find_or_most_similar(events, gacha_id, gacha_data, gacha)
        if event['similarity'] != 0 # nil goes here, too, meaning exact match
          gacha_event_data = {
            'name' => event['name'],
            'rate' => find_gacha_rate(event),
            'similarity' => event['similarity']
          }.compact

          [gacha_id, gacha_data.merge(gacha_event_data)]
        else # Nothing we know about the gacha, ignore
          key_value
        end
      end.to_h
    end

    def self.find_or_most_similar events, gacha_id, gacha_data, gacha
      events.find do |event|
        event['id'] == gacha_id
      end || begin
        events_series = events.select do |event|
          gacha_data['series_id'] == gacha.dig(event['id'], 'series_id')
        end

        # Look for the same series first
        find_most_similar(events_series, gacha_data, gacha) ||
          find_most_similar(events, gacha_data, gacha)
      end
    end

    def self.find_most_similar events, gacha_data, gacha
      events.map.with_index do |event, index|
        gacha_cats = gacha_data['cats']
        event_cats = gacha.dig(event['id'], 'cats')

        if event_cats.nil? # New event no app data yet
          next {'similarity' => 0, 'index' => index}
        end

        intersection = gacha_cats & event_cats
        union = gacha_cats | event_cats
        similarity = intersection.size.to_f / union.size

        # We deliberately make rounding error here by rounding it first,
        # sort later, so we lose accuracy. This is done because if we are
        # more accurate here, it'll usually pick a more up-to-date gacha,
        # which is fine by itself but it usually also shows a cat that
        # does not exist in the gacha we're looking at here, which is
        # misleading even when it's more accurate in terms of contents.
        # By slightly losing accuracy, it'll pick a gacha which is older
        # and can avoid showing a cat doesn't exist for this gacha.
        similarity_in_percentage = (similarity * 100).round

        # Consider this the first perfect match
        return event if similarity_in_percentage == 100

        event.merge('similarity' => similarity_in_percentage, 'index' => index)
      end.min do |a, b|
        # Stable reverse sort
        case result = b['similarity'] <=> a['similarity']
        when 0
          # Reverse it because we want the highest similarity and the first
          a['index'] <=> b['index']
        else
          result
        end
      end
    end

    def self.find_gacha_rate event
      predefined_rates.find do |_, name_rate|
        name_rate[:rate] == event.values_at('rare', 'supa', 'uber')
      end&.first
    end

    def self.predefined_rates
      @predefined_rates ||= {
        'predicted' => {name: 'Predicted'},
        'regular' => {name: 'Regular', rate: [6970, 2500, 500]},
        'no_legend' => {name: 'Regular without legend',
          rate: [7000, 2500, 500]},
        'uberfest_legend' => {name: 'Uberfest / Epicfest with legend',
          rate: [6470, 2600, 900]},
        'uberfest' => {name: 'Uberfest / Epicfest without legend',
          rate: [6500, 2600, 900]},
        'dynastyfest' => {name: 'Dynasty Fest', rate: [6770, 2500, 700]},
        'royalfest' => {name: 'Royal Fest', rate: [6940, 2500, 500]},
        'superfest' => {name: 'Superfest', rate: [6500, 2500, 1000]},
        'platinum' => {name: 'Platinum', rate: [0, 0, 10000]},
        'legend' => {name: 'Legend', rate: [0, 0, 9500]},
        '' => {name: 'Customize...'}
      }
    end

    def self.group_by_rarity cats
      cats.group_by do |id, data|
        data['rarity']
      end.sort.to_h.transform_values(&:to_h)
    end

    def inspect
      "#<#{self.class} cat=#{cats.dig(1, 'name', 0).inspect}>"
    end

    def cats_by_rarity
      @cats_by_rarity ||= self.class.group_by_rarity(cats)
    end

    def gacha
      data['gacha']
    end

    def events
      data['events']
    end

    def cats
      data['cats']
    end

    def with_cat_names_from source
      data = self.class.deep_dup(self.data)

      data['cats'].each do |id, info|
        names = source.cats.dig(id, 'name')
        info['name'] = names if names && !names.empty?
      end

      self.class.new(self.class.deep_freeze(data))
    end

    def each_custom_gacha name_index
      ubers = cats_by_rarity[Cat::Uber].keys
      legends = cats_by_rarity[Cat::Legend].keys

      gacha.reverse_each do |gacha_id, gacha_data|
        title =
          if similarity = gacha_data['similarity']
            "(#{similarity}%) #{gacha_data['name']}"
          else
            gacha_data['name'] ||
              hint_gacha_name(name_index, gacha_data['cats'], ubers, legends)
          end

        yield(gacha_id, "#{gacha_id}: #{title}")
      end
    end

    def hint_gacha_name name_index, cat_ids, ubers, legends
      prefix_id =
        cat_ids.find(&legends.method(:member?)) ||
        cat_ids.find(&ubers.method(:member?))

      suffix_id =
        cat_ids.reverse_each.find(&ubers.method(:member?))

      prefix_cat = cats[prefix_id]
      suffix_cat = cats[suffix_id] if prefix_id != suffix_id

      prefix = Cat.new(info: prefix_cat).pick_name(name_index) if prefix_cat
      suffix = Cat.new(info: suffix_cat).pick_name(name_index) if suffix_cat

      hint = [*prefix, *suffix].join(', ')

      "(?) #{hint}"
    end

    def dump dir, lang
      require 'fileutils'
      require 'yaml'

      FileUtils.mkdir_p(dir)
      File.write("#{dir}/bc-#{lang}.yaml", dump_yaml)
    end

    def dump_yaml
      visitor = Psych::Visitors::YAMLTree.create
      visitor << data
      visitor.tree.grep(Psych::Nodes::Sequence).each do |seq|
        seq.style = Psych::Nodes::Sequence::FLOW
      end

      visitor.tree.yaml(nil, line_width: -1)
    end
  end
end
