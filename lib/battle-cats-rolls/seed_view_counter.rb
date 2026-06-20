# frozen_string_literal: true

require 'date'
require 'json'
require 'time'

module BattleCatsRolls
  module SeedViewCounter
    PREFIX = 'seed_views'.freeze
    STATS_PATH = '/data/seed_views.json'
    FLUSH_INTERVAL = 15 * 60
    QUARTER_RETENTION = 26 * 60 * 60
    HOUR_RETENTION = 8 * 24 * 60 * 60
    @mutex = Mutex.new
    @stats = {
      'days' => {},
      'hours' => {},
      'quarters' => {},
      'langs_by_day' => {},
      'events_by_day' => {}
    }
    @loaded = false

    module_function

    def increment cache, now=Time.now, lang: nil, event: nil
      load!
      date = date_key(now)
      key = key(date)
      expires_in = seconds_until_tomorrow(date)

      total = @mutex.synchronize do
        @stats['days'][date] = @stats['days'][date].to_i + 1
        @stats['hours'][hour_key(now)] = @stats['hours'][hour_key(now)].to_i + 1
        quarter = quarter_key(now)
        @stats['quarters'][quarter] = @stats['quarters'][quarter].to_i + 1
        day_langs = nested_hash(@stats['langs_by_day'], date)
        day_events = nested_hash(@stats['events_by_day'], date)
        day_langs[lang] = day_langs[lang].to_i + 1 if lang
        if lang && event
          event_key = [lang, event].join('|')
          day_events[event_key] = day_events[event_key].to_i + 1
        end
        @stats['days'][date]
      end

      if cache.respond_to?(:incr)
        begin
          value = cache.incr(key, 1, expires_in, 0)
          if value
            value = [value.to_i, total].max
            cache.store(key, value, expires_in: expires_in)
            return value
          end
        rescue ArgumentError
          value = cache.incr(key, 1)
          if value
            value = [value.to_i, total].max
            cache.store(key, value, expires_in: expires_in)
            return value
          end
        end
      end

      @mutex.synchronize do
        value = [cache[key].to_i + 1, total].max
        cache.store(key, value, expires_in: expires_in)
      end
    end

    def count cache, date=Date.today
      load!
      date = date_key(date)
      [cache[key(date)].to_i, @stats.dig('days', date).to_i].max
    end

    def key date
      "#{PREFIX}:#{date_key(date)}"
    end

    def seconds_until_tomorrow date
      date = parse_date(date)
      tomorrow = Time.local(date.year, date.month, date.day) + 86_400
      [(tomorrow - Time.now).ceil, 60].max
    end

    def load! path=stats_path
      return if @loaded

      @mutex.synchronize do
        return if @loaded

        if File.exist?(path)
          data = JSON.parse(File.read(path))
          @stats = {
            'days' => integer_hash(data['days']),
            'hours' => integer_hash(data['hours']),
            'quarters' => integer_hash(data['quarters']),
            'langs_by_day' =>
              nested_integer_hash(data['langs_by_day'] || migrate_day(data['langs'])),
            'events_by_day' =>
              nested_integer_hash(data['events_by_day'] || migrate_day(data['events']))
          }
        end

        @loaded = true
      rescue JSON::ParserError, SystemCallError
        @loaded = true
      end
    end

    def flush path=stats_path
      load!(path)
      return false unless persistable?(path)

      now = Time.now
      data = @mutex.synchronize do
        prune!(now)

        {
          'updated_at' => now.utc.iso8601,
          'days' => @stats['days'].sort.to_h,
          'hours' => @stats['hours'].sort.to_h,
          'quarters' => @stats['quarters'].sort.to_h,
          'langs_by_day' => sort_nested_hash(@stats['langs_by_day']),
          'events_by_day' => sort_nested_hash(@stats['events_by_day'])
        }
      end
      tmp = "#{path}.#{$$}.tmp"

      File.write(tmp, "#{JSON.pretty_generate(data)}\n")
      File.rename(tmp, path)
      true
    rescue SystemCallError
      false
    ensure
      File.delete(tmp) if tmp && File.exist?(tmp)
    end

    def stats_path
      ENV.fetch('SEED_VIEW_STATS_PATH', STATS_PATH)
    end

    def flush_interval
      Integer(ENV.fetch('SEED_VIEW_STATS_FLUSH_INTERVAL', FLUSH_INTERVAL))
    end

    def date_key value
      parse_date(value).strftime('%Y-%m-%d')
    end

    def hour_key value
      time = parse_time(value)
      time.strftime('%Y-%m-%dT%H')
    end

    def quarter_key value
      time = parse_time(value)
      minute = time.min - (time.min % 15)
      Time.local(time.year, time.month, time.day, time.hour, minute).
        strftime('%Y-%m-%dT%H:%M')
    end

    def snapshot now=Time.now
      load!
      now = parse_time(now)

      @mutex.synchronize do
        today = date_key(now)

        {
          recent_quarters: recent_quarters(now, @stats['quarters']),
          recent_hours: recent_hours(now, @stats['hours']),
          langs: ranked_hash(@stats['langs_by_day'][today] || {}),
          events: ranked_events(@stats['events_by_day'][today] || {}),
          days: @stats['days'].sort.reverse.map do |date, count|
            {label: date, count: count}
          end
        }
      end
    end

    def parse_date value
      case value
      when Date
        value
      when Time
        value.to_date
      else
        Date.parse(value.to_s)
      end
    end

    def parse_time value
      case value
      when Time
        value
      when Date
        Time.local(value.year, value.month, value.day)
      else
        Time.parse(value.to_s)
      end
    end

    def integer_hash hash
      (hash || {}).transform_values(&:to_i)
    end

    def nested_integer_hash hash
      (hash || {}).transform_values{ |value| integer_hash(value) }
    end

    def nested_hash hash, key
      hash[key] ||= {}
    end

    def migrate_day hash
      return {} unless hash

      {Date.today.strftime('%Y-%m-%d') => hash}
    end

    def sort_nested_hash hash
      hash.sort.to_h.transform_values{ |value| value.sort.to_h }
    end

    def ranked_hash hash
      hash.sort_by{ |key, count| [-count, key] }.map do |key, count|
        {key: key, count: count}
      end
    end

    def ranked_events hash
      hash.sort_by{ |key, count| [-count, key] }.first(10).map do |key, count|
        lang, event = key.split('|', 2)
        {lang: lang, event: event, count: count}
      end
    end

    def recent_quarters now, quarters
      start = Time.parse(quarter_key(now)) - (95 * 15 * 60)

      96.times.map do |index|
        time = start + (index * 15 * 60)
        key = time.strftime('%Y-%m-%dT%H:%M')
        {
          label: time.strftime('%m-%d %H:%M'),
          count: quarters[key].to_i
        }
      end
    end

    def recent_hours now, hours
      start = Time.local(now.year, now.month, now.day, now.hour) -
        (167 * 60 * 60)

      168.times.map do |index|
        time = start + (index * 60 * 60)
        key = time.strftime('%Y-%m-%dT%H')
        {
          label: time.strftime('%m-%d %H:00'),
          count: hours[key].to_i
        }
      end
    end

    def prune! now
      prune_time_hash!(@stats['quarters'], quarter_key(now - QUARTER_RETENTION))
      prune_time_hash!(@stats['hours'], hour_key(now - HOUR_RETENTION))
      today = date_key(now)
      @stats['langs_by_day'].select!{ |date, _| date == today }
      @stats['events_by_day'].select!{ |date, _| date == today }
    end

    def prune_time_hash! hash, cutoff
      hash.delete_if{ |key, _| key < cutoff }
    end

    def persistable? path
      dir = File.dirname(path)
      File.directory?(dir) && File.writable?(dir)
    end
  end
end
