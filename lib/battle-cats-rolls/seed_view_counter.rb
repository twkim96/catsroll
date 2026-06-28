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
    DAY_RETENTION = 7
    WEEK_RETENTION = 7
    MONTH_RETENTION = 7
    TIME_ZONE = '+09:00'
    @mutex = Mutex.new
    @stats = {
      'days' => {},
      'weeks' => {},
      'months' => {},
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
        @stats['weeks'][week_key(now)] = @stats['weeks'][week_key(now)].to_i + 1
        @stats['months'][month_key(now)] = @stats['months'][month_key(now)].to_i + 1
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

    def count cache, date=nil
      load!
      date = date ? date_key(date) : date_key(Time.now)
      [cache[key(date)].to_i, @stats.dig('days', date).to_i].max
    end

    def key date
      "#{PREFIX}:#{date_key(date)}"
    end

    def seconds_until_tomorrow date
      date = parse_date(date)
      tomorrow = Time.new(date.year, date.month, date.day, 0, 0, 0, TIME_ZONE) +
        86_400
      [(tomorrow - Time.now).ceil, 60].max
    end

    def load! path=stats_path
      return true if @loaded
      return false unless File.exist?(path)

      @mutex.synchronize do
        return true if @loaded
        return false unless File.exist?(path)

        merge_stats!(normalize_stats(JSON.parse(File.read(path))))
        @loaded = true
      end
      true
    rescue JSON::ParserError, SystemCallError
      false
    end

    def flush path=stats_path, now=Time.now
      load!(path)
      return false unless persistable?(path)

      now = kst_time(now)
      data = @mutex.synchronize do
        prune!(now)

        {
          'updated_at' => now.utc.iso8601,
          'days' => @stats['days'].sort.to_h,
          'weeks' => @stats['weeks'].sort.to_h,
          'months' => @stats['months'].sort.to_h,
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
      case value
      when Time, DateTime
        kst_time(value).strftime('%Y-%m-%d')
      when Date
        value.strftime('%Y-%m-%d')
      else
        kst_time(value).strftime('%Y-%m-%d')
      end
    end

    def hour_key value
      time = kst_time(value)
      time.strftime('%Y-%m-%dT%H')
    end

    def week_key value
      date = period_date(value)
      monday = date - (date.cwday - 1)
      monday.strftime('%Y-%m-%d')
    end

    def month_key value
      period_date(value).strftime('%Y-%m')
    end

    def quarter_key value
      time = kst_time(value)
      minute = time.min - (time.min % 15)
      Time.new(time.year, time.month, time.day, time.hour, minute, 0, TIME_ZONE).
        strftime('%Y-%m-%dT%H:%M')
    end

    def snapshot now=Time.now
      load!
      now = kst_time(now)

      @mutex.synchronize do
        today = date_key(now)

        {
          recent_quarters: recent_quarters(now, @stats['quarters']),
          recent_hours: recent_hours(now, @stats['hours']),
          langs: ranked_hash(@stats['langs_by_day'][today] || {}),
          events: ranked_events(@stats['events_by_day'][today] || {}),
          days: recent_days(@stats['days']),
          weeks: recent_weeks(@stats['weeks']),
          months: recent_months(@stats['months'])
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
      when DateTime
        Time.parse(value.to_s)
      when Date
        Time.new(value.year, value.month, value.day, 0, 0, 0, TIME_ZONE)
      else
        Time.parse(value.to_s)
      end
    end

    def kst_time value
      parse_time(value).getlocal(TIME_ZONE)
    end

    def period_date value
      case value
      when Time, DateTime
        parse_date(date_key(value))
      when Date
        value
      else
        Date.parse(value.to_s[0, 10])
      end
    end

    def normalize_stats data
      days = integer_hash(data['days'])

      {
        'days' => days,
        'weeks' => integer_hash(data['weeks'] || aggregate_weeks(days)),
        'months' => integer_hash(data['months'] || aggregate_months(days)),
        'hours' => integer_hash(data['hours']),
        'quarters' => integer_hash(data['quarters']),
        'langs_by_day' =>
          nested_integer_hash(data['langs_by_day'] || migrate_day(data['langs'])),
        'events_by_day' =>
          nested_integer_hash(data['events_by_day'] || migrate_day(data['events']))
      }
    end

    def merge_stats! stats
      merge_hash!(@stats['days'], stats['days'])
      merge_hash!(@stats['weeks'], stats['weeks'])
      merge_hash!(@stats['months'], stats['months'])
      merge_hash!(@stats['hours'], stats['hours'])
      merge_hash!(@stats['quarters'], stats['quarters'])
      merge_nested_hash!(@stats['langs_by_day'], stats['langs_by_day'])
      merge_nested_hash!(@stats['events_by_day'], stats['events_by_day'])
    end

    def merge_hash! target, source
      source.each do |key, value|
        target[key] = target[key].to_i + value.to_i
      end
    end

    def merge_nested_hash! target, source
      source.each do |key, value|
        merge_hash!(nested_hash(target, key), value)
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

      {date_key(Time.now) => hash}
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
      hash.sort_by{ |key, count| [-count, key] }.map do |key, count|
        lang, event = key.split('|', 2)
        {lang: lang, event: event, count: count}
      end
    end

    def recent_days days
      days.sort.last(DAY_RETENTION).reverse.map do |date, count|
        {label: date, count: count}
      end
    end

    def recent_weeks weeks
      weeks.sort.last(WEEK_RETENTION).reverse.map do |date, count|
        {label: week_label(date), count: count}
      end
    end

    def recent_months months
      months.sort.last(MONTH_RETENTION).reverse.map do |month, count|
        {label: month_label(month), count: count}
      end
    end

    def aggregate_weeks days
      aggregate_period(days){ |date| week_key(date) }
    end

    def aggregate_months days
      aggregate_period(days){ |date| month_key(date) }
    end

    def aggregate_period days
      days.each_with_object({}) do |(date, count), result|
        key = yield(date)
        result[key] = result[key].to_i + count.to_i
      end
    end

    def week_label week
      monday = Date.parse(week)
      sunday = monday + 6
      "#{monday.month}.#{monday.day}~#{sunday.month}.#{sunday.day}"
    end

    def month_label month
      date = Date.strptime("#{month}-01", '%Y-%m-%d')
      "#{date.month}월"
    end

    def recent_quarters now, quarters
      now = kst_time(now)
      minute = now.min - (now.min % 15)
      start = Time.new(now.year, now.month, now.day, now.hour, minute, 0,
        TIME_ZONE) - (95 * 15 * 60)

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
      now = kst_time(now)
      start = Time.new(now.year, now.month, now.day, now.hour, 0, 0, TIME_ZONE) -
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
      prune_recent_hash!(@stats['days'], DAY_RETENTION)
      prune_recent_hash!(@stats['weeks'], WEEK_RETENTION)
      prune_recent_hash!(@stats['months'], MONTH_RETENTION)
      today = date_key(now)
      @stats['langs_by_day'].select!{ |date, _| date == today }
      @stats['events_by_day'].select!{ |date, _| date == today }
    end

    def prune_time_hash! hash, cutoff
      hash.delete_if{ |key, _| key < cutoff }
    end

    def prune_recent_hash! hash, retention
      keep = hash.keys.sort.last(retention)
      hash.select!{ |key, _| keep.include?(key) }
    end

    def persistable? path
      dir = File.dirname(path)
      File.directory?(dir) && File.writable?(dir)
    end
  end
end
