# frozen_string_literal: true

require_relative 'seed_view_counter'
require_relative 'live_events_admin'
require_relative 'track_api'
require_relative 'local/crystal_ball'
require_relative 'local/find_cat'
require_relative 'local/route'
require_relative 'local/view'
require_relative 'local/web'
require_relative 'local/server_middleware'

module BattleCatsRolls
  ExpandCompareSupported = /\A(?:1|true|yes|on)\z/i.match?(
    ENV['EXPAND_COMPARE'].to_s)

  module LocalFeatures
    module_function

    def start
      return if @started

      @started = true
      SeedViewCounter.load!

      Task.create(:persist_seed_view_stats) do
        sleep(SeedViewCounter.flush_interval)
        next if Task.shutting_down

        SeedViewCounter.flush
      end

      Kernel.at_exit(&SeedViewCounter.method(:flush))
    end
  end

  def self.warmup_with_local_features app
    LocalFeatures.start
    warmup(app)
  end
end
