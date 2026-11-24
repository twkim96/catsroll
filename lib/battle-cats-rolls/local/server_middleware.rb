# frozen_string_literal: true

require 'rack'
require_relative 'gpt_probe'

module BattleCatsRolls
  class LocalServerMiddleware
    DisallowedUserAgents = /meta-webindexer/i
    SearchAssets = {'/robots.txt' => 'text/plain', '/sitemap.xml' => 'application/xml'}.freeze

    def initialize app
      @app = app
      @track_api = TrackApi.new
      @assets = Rack::Files.new(File.expand_path('../asset', __dir__))
      public_origin = GptMcp.public_origin
      @search_assets = SearchAssets.keys.to_h do |path|
        source = File.read(File.expand_path("../asset#{path}", __dir__))
        [path, source.gsub('https://bc.godfat.org') { public_origin }]
      end
      @gpt_mcp = GptMcp.new
      @claude_mcp = GptMcp.new(ui_host: :claude)
      @gpt_probe = GptProbe.new
      @gpt_sdk_probe = GptSdkProbe.new
      @gpt_claude_sdk_probe = GptClaudeSdkProbe.new
      @gpt_public_pages = GptPublicPages.new
    end

    def call env
      return [404, {}, []] if blocked_user_agent?(env)

      case env['PATH_INFO']
      when '/gpt/about', '/gpt/privacy', '/gpt/terms', '/.well-known/openai-apps-challenge'
        @gpt_public_pages.call(env)
      when '/mcp', '/gpt'
        @gpt_mcp.call(env)
      when '/mcp/claude'
        @claude_mcp.call(env)
      when '/mcp/probe', '/gpt/probe'
        @gpt_probe.call(env)
      when '/mcp/probe/sdk', '/gpt/probe/sdk'
        @gpt_sdk_probe.call(env)
      when '/mcp/probe/sdk/claude', '/gpt/probe/sdk/claude'
        @gpt_claude_sdk_probe.call(env)
      when '/track.json', '/events.json'
        @track_api.call(env)
      when '/sw.js'
        @assets.call(env)
      when '/robots.txt', '/sitemap.xml'
        serve_search_asset(env)
      else
        @app.call(env)
      end
    end

    private

    def serve_search_asset env
      method = env['REQUEST_METHOD']
      return @app.call(env) unless %w[GET HEAD].include?(method)

      path = env['PATH_INFO']
      body = @search_assets.fetch(path)
      [200, {'content-type' => "#{SearchAssets.fetch(path)}; charset=utf-8",
        'content-length' => body.bytesize.to_s}, method == 'HEAD' ? [] : [body]]
    end

    def blocked_user_agent? env
      DisallowedUserAgents.match?(env['HTTP_USER_AGENT'].to_s)
    end
  end
end
