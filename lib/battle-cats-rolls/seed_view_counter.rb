# frozen_string_literal: true

require 'date'

module BattleCatsRolls
  module SeedViewCounter
    PREFIX = 'seed_views'.freeze
    @mutex = Mutex.new

    module_function

    def increment cache, date=Date.today
      key = key(date)
      expires_in = seconds_until_tomorrow(date)

      if cache.respond_to?(:incr)
        begin
          value = cache.incr(key, 1, expires_in, 0)
          return value.to_i if value
        rescue ArgumentError
          value = cache.incr(key, 1)
          return value.to_i if value
        end
      end

      @mutex.synchronize do
        value = count(cache, date) + 1
        cache.store(key, value, expires_in: expires_in)
      end
    end

    def count cache, date=Date.today
      cache[key(date)].to_i
    end

    def key date
      "#{PREFIX}:#{date.strftime('%Y-%m-%d')}"
    end

    def seconds_until_tomorrow date
      tomorrow = Time.local(date.year, date.month, date.day) + 86_400
      [(tomorrow - Time.now).ceil, 60].max
    end
  end
end
