# frozen_string_literal: true

require 'pork/auto'
require 'battle-cats-rolls/web'
require 'battle-cats-rolls/route'

module BattleCatsRolls
  module Test
    singleton_class.module_eval do
      def web
        @web ||= begin
          Route.reload_balls
          web = Web.new
          web.call('PATH_INFO' => '/warmup')
          web
        end
      end
    end

    singleton_methods.each do |name|
      define_method(name) do
        Test.public_send(__method__)
      end
    end

    def expect_request path_or_uri, query='', status: 200, &block
      if path_or_uri.kind_of?(URI)
        query = path_or_uri.query
        path = path_or_uri.path
      else
        path = path_or_uri
      end

      response_status, headers, body = web.call(
        'PATH_INFO' => path, 'QUERY_STRING' => query)

      expect(response_status).eq status

      block&.call(body.first, headers)
    end

    def cleanup_text text
      text.tr("\n", ' ').squeeze(' ').strip
    end
  end
end
