# frozen_string_literal: true

require 'rack'

module BattleCatsRolls
  class LocalServerMiddleware
    DisallowedUserAgents = /meta-webindexer/i

    def initialize app
      @app = app
      @track_api = TrackApi.new
      @assets = Rack::Files.new(File.expand_path('../asset', __dir__))
      @gpt_mcp = GptMcp.new
    end

    def call env
      return [404, {}, []] if blocked_user_agent?(env)

      case env['PATH_INFO']
      when '/mcp', '/gpt'
        @gpt_mcp.call(env)
      when '/track.json', '/events.json'
        @track_api.call(env)
      when '/sw.js'
        @assets.call(env)
      else
        @app.call(env)
      end
    end

    private

    def blocked_user_agent? env
      DisallowedUserAgents.match?(env['HTTP_USER_AGENT'].to_s)
    end
  end
end
