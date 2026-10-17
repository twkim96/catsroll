# frozen_string_literal: true

require_relative '../track_api'
require 'digest'
require 'json'
require 'set'

module BattleCatsRolls
  # Finds the latest observed KR/JP pools for a named event series. This is a
  # reference-pool lookup only; it does not establish a future regional schedule.
  class GptBannerPreview
    NOTICE = 'Reference simulation using an observed regional pool; this is NOT a confirmed schedule or pool in the requested game.'.freeze
    INPUT_KEYS = %w[query lang series_id].freeze
    AmbiguousCandidateLimit = 10

    class InvalidInput < ArgumentError; end

    def lookup(args)
      options = normalize_args(args)
      balls = source_balls
      catalogs = catalogs_for(balls)
      event_indexes = multi_event_indexes(balls)
      ids = if options.key?('series_id')
        catalogs.key?(options.fetch('series_id')) ? [options.fetch('series_id')] : []
      else
        matching_series(catalogs, options.fetch('query'))
      end

      ambiguous = ids.size > 1
      candidate_ids = ambiguous ? ids.first(AmbiguousCandidateLimit) : ids
      candidates = candidate_ids.map do |series_id|
        build_candidate(series_id, catalogs.fetch(series_id), balls, event_indexes, options.fetch('lang')) ||
          unavailable_candidate(series_id, catalogs.fetch(series_id), options.fetch('lang'))
      end

      if ambiguous
        return {
          'status' => 'ambiguous',
          'query' => options.fetch('query'),
          'requested_lang' => options.fetch('lang'),
          'notice' => NOTICE,
          'candidates' => candidates,
          'prepare_rows' => [],
          'totalCandidates' => ids.size,
          'truncated' => ids.size > candidate_ids.size,
          'message' => 'Several series match; select a candidate or provide series_id.'
        }
      end

      if candidates.empty? || candidates.first['availability'] == 'no_usable_pool'
        return {
          'status' => 'unmatched',
          'query' => options.fetch('query'),
          'requested_lang' => options.fetch('lang'),
          'notice' => NOTICE,
          'candidates' => [],
          'prepare_rows' => [],
          'message' => 'No matching series with a usable observed pool was found.'
        }
      end

      candidate = candidates.first
      rows = candidate.fetch('recommended_events').map do |event|
        {
          'lang' => candidate.fetch('source_lang'),
          'event' => event.fetch('event'),
          'previewFor' => options.fetch('lang')
        }
      end
      {
        'status' => 'ok',
        'query' => options.fetch('query'),
        'requested_lang' => options.fetch('lang'),
        'notice' => NOTICE,
        'candidates' => candidates,
        'recommended' => candidate,
        'prepare_rows' => rows
      }
    end

    private

    def normalize_args(args)
      unless args.is_a?(Hash) && args.keys.all? { |key| key.is_a?(String) }
        raise InvalidInput, 'arguments must be a string-keyed object'
      end
      unknown = args.keys - INPUT_KEYS
      raise InvalidInput, "unknown argument: #{unknown.first}" if unknown.any?

      query = args['query']
      unless query.is_a?(String) && !query.strip.empty? && query.length <= 100
        raise InvalidInput, 'query must be a non-empty string of at most 100 characters'
      end
      lang = args.fetch('lang', 'kr')
      raise InvalidInput, 'lang must be kr or jp' unless %w[kr jp].include?(lang)
      if args.key?('series_id') && (!args['series_id'].is_a?(Integer) || args['series_id'].negative?)
        raise InvalidInput, 'series_id must be a non-negative integer'
      end

      {'query' => query, 'lang' => lang}.tap do |result|
        result['series_id'] = args['series_id'] if args.key?('series_id')
      end
    end

    def source_balls
      kr = Route.ball_kr || Route.load_ball('kr')
      jp_display = Route.ball_jp || Route.load_ball('jp')
      jp_raw = TrackApi.raw_ball_jp
      {'kr' => kr, 'jp' => jp_raw, 'jp_display' => jp_display}
    end

    def catalogs_for(balls)
      catalogs = {}
      %w[kr jp].each do |lang|
        ball = balls.fetch(lang)
        catalog = TrackApi.event_series_data(Struct.new(:ball).new(ball))
        catalog.fetch(:series).each do |series|
          item = catalogs[series.fetch(:id)] ||= {labels: [], names: []}
          item[:labels].concat([series[:label], *Array(series[:aliases])].compact)
        end
        catalog.fetch(:characters).each do |character|
          character.fetch(:series_ids).each do |series_id|
            item = catalogs[series_id] ||= {labels: [], names: []}
            item[:names].concat(Array(character[:names]))
          end
        end
        ball.gacha.each_value do |gacha|
          series_id = gacha['series_id']
          next if series_id.nil?

          item = catalogs[series_id] ||= {labels: [], names: []}
          item[:labels] << gacha['name'] if gacha['name']
          Array(gacha['cats']).each do |cat_id|
            item[:names].concat(Array(ball.cats.dig(cat_id, 'name')))
          end
        end
        ball.events.each_value do |event|
          series_id = ball.gacha.dig(event['id'], 'series_id')
          next if series_id.nil?

          item = catalogs[series_id] ||= {labels: [], names: []}
          item[:labels] << event['name'] if event['name']
        end
      end

      catalogs.each do |series_id, item|
        canonical = EventSeriesNames.korean(series_id)
        item[:labels] << canonical if canonical
        item[:labels].uniq!
        item[:names].uniq!
      end
      catalogs
    end

    def multi_event_indexes(balls)
      %w[kr jp].to_h do |lang|
        events = TrackApi.multi_events(balls.fetch(lang))
        [lang, events.to_h { |event| [event.fetch(:event), event] }]
      end
    end

    def matching_series(catalogs, query)
      term = normalize_name(query)
      return [] if term.empty?

      catalogs.filter_map do |series_id, item|
        terms = item[:labels] + item[:names]
        series_id if terms.any? do |name|
          normalized = normalize_name(name)
          !normalized.empty? && (normalized.include?(term) || term.include?(normalized))
        end
      end.sort
    end

    def normalize_name(value)
      value.to_s.unicode_normalize(:nfkc).downcase.gsub(/[^\p{Alnum}]/, '')
    end

    def build_candidate(series_id, catalog, balls, event_indexes, requested_lang)
      requested_ball = requested_lang == 'kr' ? balls.fetch('kr') : balls.fetch('jp_display')
      regional = %w[kr jp].to_h do |lang|
        events = latest_events(balls.fetch(lang), series_id, lang, requested_ball,
          event_indexes.fetch(lang))
        [lang, events]
      end
      return if regional.values.all?(&:empty?)

      dates = regional.transform_values do |events|
        events.first&.fetch('start_on')
      end
      source_lang = if dates['kr'].nil?
        'jp'
      elsif dates['jp'].nil?
        'kr'
      elsif dates['jp'] > dates['kr']
        'jp'
      elsif dates['kr'] > dates['jp']
        'kr'
      else
        requested_lang
      end
      {
        'series_id' => series_id,
        'label' => EventSeriesNames.korean(series_id) || catalog[:labels].find { |name| !name.to_s.empty? },
        'source_lang' => source_lang,
        'requested_lang' => requested_lang,
        'source_period' => regional.fetch(source_lang).map do |event|
          {'event' => event.fetch('event'), 'start_on' => event.fetch('start_on'), 'end_on' => event.fetch('end_on')}
        end,
        'regional_latest_dates' => dates,
        'regions' => regional,
        'recommended_events' => regional.fetch(source_lang)
      }
    end

    def unavailable_candidate(series_id, catalog, requested_lang)
      {
        'series_id' => series_id,
        'label' => EventSeriesNames.korean(series_id) || catalog[:labels].find { |name| !name.to_s.empty? },
        'availability' => 'no_usable_pool',
        'source_lang' => nil,
        'requested_lang' => requested_lang,
        'source_period' => [],
        'regional_latest_dates' => {'kr' => nil, 'jp' => nil},
        'regions' => {'kr' => [], 'jp' => []},
        'recommended_events' => []
      }
    end

    def latest_events(ball, series_id, source_lang, requested_ball, event_index)
      requested_ids = requested_ball.cats.keys.to_set
      event_groups = ball.events.filter_map do |event_name, info|
        next unless ball.gacha.dig(info['id'], 'series_id') == series_id

        [info.fetch('start_on').to_s, event_name, info]
      end.group_by(&:first)

      event_groups.keys.sort.reverse_each do |start_on|
        latest = event_groups.fetch(start_on).filter_map do |_, event_name, info|
          pool = TrackApi.pool_data_for(ball, event_name)
          next unless pool[:exist]

          slots = pool.fetch(:slots).transform_keys(&:to_s)
          ids = slots.values.flatten.uniq
          missing_ids = (ids - requested_ids.to_a).sort
          missing_metadata = missing_ids.map do |id|
            names = Array(pool.dig(:cats, id, :name)).select do |name|
              name.is_a?(String) && !name.empty?
            end
            {'id' => id, 'source_names' => names,
             'missing_from_requested_region' => !requested_ids.include?(id)}
          end
          signature_data = {
            'rates' => pool.fetch(:rates).transform_keys(&:to_s),
            'guaranteed_rolls' => pool.fetch(:guaranteed_rolls),
            'slots' => slots
          }
          {
            'event' => event_name,
            'label' => event_index.dig(event_name, :label) || TrackApi.multi_event_label(info),
            'start_on' => start_on,
            'end_on' => info.fetch('end_on').to_s,
            'source_lang' => source_lang,
            'source_period' => {'start_on' => start_on, 'end_on' => info.fetch('end_on').to_s},
            'pool_signature' => {
              'sha256' => Digest::SHA256.hexdigest(JSON.generate(signature_data)),
              'rates' => signature_data.fetch('rates'),
              'guaranteed_rolls' => signature_data.fetch('guaranteed_rolls'),
              'slot_counts' => slots.transform_values(&:size),
              'character_count' => ids.size,
              'missing_character_ids' => missing_ids,
              'missing_character_metadata' => missing_metadata,
              'version' => pool.fetch(:version)
            }
          }
        end
        return latest.sort_by { |event| event.fetch('event') } unless latest.empty?
      end
      []
    end
  end
end
