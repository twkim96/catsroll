# frozen_string_literal: true

require 'cgi'

module BattleCatsRolls
  class LocalSearchAssets
    def initialize origin
      @origin = origin
    end

    def call env
      if env['PATH_INFO'] == '/sitemap.xml'
        body = sitemap
        type = 'application/xml'
      else
        body = robots
        type = 'text/plain'
      end
      [200, {'content-type' => "#{type}; charset=utf-8",
        'content-length' => body.bytesize.to_s},
        env['REQUEST_METHOD'] == 'HEAD' ? [] : [body]]
    end

    private

    def robots
      <<~ROBOTS
        Sitemap: #{@origin}/sitemap.xml

        User-agent: meta-externalagent
        Disallow: /
      ROBOTS
    end

    def sitemap
      @sitemap ||= begin
        Route.reload_balls
        paths = %w[/help /logs]
        LangAll.each do |lang|
          query = lang == 'en' ? '' : "?lang=#{lang}"
          paths << "/cats#{query}"
          Route.public_send("ball_#{lang}").cats.each_key do |id|
            paths << "/cats/#{id}#{query}"
          end
        end
        locations = paths.map do |path|
          "  <url><loc>#{CGI.escape_html(@origin + path)}</loc></url>\n"
        end.join
        <<~XML
          <?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          #{locations.chomp}
          </urlset>
        XML
      end
    end
  end
end
