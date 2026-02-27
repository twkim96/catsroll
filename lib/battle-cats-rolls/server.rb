# frozen_string_literal: true

require_relative 'root'
require_relative 'web'

require 'jellyfish'
require 'rack'
require 'raindrops'

module BattleCatsRolls
  class YahnsStatus < Raindrops::Middleware
    def stats_response
      result = super
      headers = result[1]
      headers[Rack::CONTENT_LENGTH] ||= headers.delete('Content-Length')
      headers[Rack::CONTENT_TYPE] ||= headers.delete('Content-Type')
      result
    end
  end

  class GuardReferrer
    include Jellyfish
    controller_include NormalizedPath

    disallowed_domains = Regexp.union(%w[
      t.co
      twitter.com
      x.com
      facebook.com
      youtube.com
    ])
    DisallowedDomains = Regexp.new("\\b#{disallowed_domains}\\b")

    get // do
      if DisallowedDomains.match?(request.referrer)
        not_found
      else
        cascade
      end
    end
  end

  Server = Jellyfish::Builder.app do
    use Rack::Deflater
    use YahnsStatus, path: '/yahns/status', listeners: [WebBind, SeekBind]

    use Rack::ContentLength
    use Rack::ContentType, 'text/html; charset=utf-8'

    use GuardReferrer

    # This part can be completely replaced by Nginx
    rewrite \
      '/asset' => '',
      '/robots.txt' => '/robots.txt' do
      run Rack::Files.new(File.expand_path('asset', __dir__))
    end
    rewrite '/extract' => '' do
      run Rack::Files.new("#{Root}/extract/asset")
    end

    map '/seek', to: '/seek', host: SeekHost do
      run Web::Seek.new
    end

    map '/', host: WebHost do
      run Web.new
    end
  end

  def self.warmup app
    base = "http://#{WebHost}" if WebHost

    print Rack::MockRequest.new(app).get("#{base}/warmup").errors

    @shutdown = false

    auto_update_event_data if ENV['AUTO_UPDATE_EVENT_DATA']
    monitor_memory if ENV['MONITOR_MEMORY']

    Kernel.at_exit(&Task.method(:shutdown))
    Kernel.at_exit(&SeekSeed::Pool.method(:shutdown))
  end

  class Task
    singleton_class.attr_accessor :shutting_down

    def self.create name, &block
      (@tasks ||= []) << new(name, &block)
    end

    def self.shutdown
      self.shutting_down = true
      @tasks&.each(&:shutdown)
    end

    def initialize name
      @thread = Thread.new do
        yield until self.class.shutting_down

        puts "Shutting down #{name}"
      end
    end

    def shutdown
      @thread.wakeup
      @thread.join
    end
  end

  def self.auto_update_event_data
    require_relative 'runner'

    Task.create(__method__) do
      sleep(61 * 60)

      next if Task.shutting_down

      %w[en tw jp kr].each do |lang|
        break if Task.shutting_down

        Runner.build(lang)
      rescue Date::Error => e
        puts "WARN: Ignoring for #{lang}: <#{e.class}> #{e.message}"
      rescue Errno::ECONNRESET, OpenSSL::SSL::SSLError => e
        puts "WARN: Retrying for #{lang}: <#{e.class}> #{e.message}"
        begin
          Runner.build(lang)
        rescue Errno::ECONNRESET, OpenSSL::SSL::SSLError => e
          puts "WARN: Retried. Ignoring for #{lang}: <#{e.class}> #{e.message}"
        end
      end

      next if Task.shutting_down

      unless `git -C #{Root} status --porcelain -- build`.empty?
        puts "Reloading balls..."
        Route.reload_balls(true)
      end
    end
  end

  def self.monitor_memory
    Task.create(__method__) do
      printf \
        "Memory total: %.2fM, current: %.2fM, CPU: %.2f%%,%s\n",
        *ps, `uptime`[/(?<=users,).+/]

      sleep(10)
    end
  end

  def self.ps
    cpid = Process.pid

    `ps -Ao pid,rss,pcpu`.scan(/(\d+)\s+(\d+)\s+(\d+\.\d+)/).
      inject([0, 0, 0]) do |result, (pid, rss, pcpu)|
        mem = rss.to_f / 1024
        cpu = pcpu.to_f
        result[0] += mem

        if pid.to_i == cpid
          result[1] = mem
          result[2] = cpu
        end

        result
      end
  end
end
