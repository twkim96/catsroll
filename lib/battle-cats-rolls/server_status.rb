# frozen_string_literal: true

module BattleCatsRolls
  if Object.const_defined?(:Yahns)
    require 'raindrops'

    class YahnsStatus < Raindrops::Middleware
      def stats_response
        result = super
        headers = result[1]
        headers[Rack::CONTENT_LENGTH] ||= headers.delete('Content-Length')
        headers[Rack::CONTENT_TYPE] ||= headers.delete('Content-Type')
        result
      end
    end
  elsif Object.const_defined?(:Puma)
    require 'json'

    class PumaStatus < Struct.new(:app)
      singleton_class.module_eval do
        attr_accessor :servers
      end

      def call env
        if env['PATH_INFO'] == '/yahns/status'
          [200, {'content-type' => 'application/json'},
            [JSON.generate(self.class.servers.map(&:stats))]]
        else
          app.call(env)
        end
      end
    end
  end

  module ServerStatus
    def self.middleware
      @middleware ||= if Object.const_defined?(:Yahns)
        [YahnsStatus, {path: '/yahns/status', listeners: [WebBind, SeekBind]}]
      elsif Object.const_defined?(:Puma)
        [PumaStatus]
      end
    end
  end
end
