# frozen_string_literal: true

require 'date'
require 'json'
require 'time'

module BattleCatsRolls
  module SeedViewCounter
    PREFIX = 'seed_views'.freeze
    STATS_PATH = '/data/seed_views.json'
    FLUSH_INTERVAL = 15 * 60
    @mutex = Mutex.new
    @stats = {'days' => {}, 'hours' => {}}
    @loaded = false

    module_function

    def increment cache, now=Time.now
      load!
      date = date_key(now)
      key = key(date)
      expires_in = seconds_until_tomorrow(date)

      total = @mutex.synchronize do
        @stats['days'][date] = @stats['days'][date].to_i + 1
        @stats['hours'][hour_key(now)] = @stats['hours'][hour_key(now)].to_i + 1
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
            'hours' => integer_hash(data['hours'])
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

      data = @mutex.synchronize do
        {
          'updated_at' => Time.now.utc.iso8601,
          'days' => @stats['days'].sort.to_h,
          'hours' => @stats['hours'].sort.to_h
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

    def persistable? path
      dir = File.dirname(path)
      File.directory?(dir) && File.writable?(dir)
    end
  end
end
