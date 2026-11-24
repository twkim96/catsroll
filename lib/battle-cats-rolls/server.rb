# frozen_string_literal: true

require_relative 'root'
require_relative 'web'
require_relative 'local_features'
require_relative 'server_status'

require 'jellyfish'
require 'rack'

module BattleCatsRolls
  def self.env_to_bool name, default
    case value = ENV[name]
    when nil
      default
    when 'true'
      true
    when 'false'
      false
    else
      raise "Unknown value: #{value}"
    end
  end

  server_status = ServerStatus.middleware
  Server = Jellyfish::Builder.app do
    use Rack::Deflater if BattleCatsRolls.env_to_bool('RACK_DEFLATER', true)
    use *server_status if server_status

    use Rack::ContentLength if BattleCatsRolls.
      env_to_bool('RACK_CONTENT_LENGTH', true)
    use Rack::ContentType, 'text/html; charset=utf-8'
    use LocalServerMiddleware

    # This part can be completely replaced by Nginx
    rewrite \
      '/asset' => '',
      '/robots.txt' => '/robots.txt',
      '/sitemap.xml' => '/sitemap.xml' do
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

    auto_update_event_data if env_to_bool('AUTO_UPDATE_EVENT_DATA', false)

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

      LangAll.each do |lang|
        break if Task.shutting_down

        Runner.build(lang)
      rescue *Runner::EventsBuildingErrors => e
        puts "WARN: Ignoring for #{lang}: <#{e.class}> #{e.message}"
      rescue *Runner::EventsNetworkErrors => e
        puts "WARN: Retrying for #{lang}: <#{e.class}> #{e.message}"
        begin
          Runner.build(lang)
        rescue *Runner::EventsNetworkErrors, *Runner::EventsBuildingErrors => e
          puts "WARN: Retried. Ignoring for #{lang}: <#{e.class}> #{e.message}"
        end
      end

      next if Task.shutting_down

      unless `git -C #{Root} status --porcelain -- build`.empty?
        puts 'Reloading balls...'
        Route.reload_balls(true)
      end
    end
  end
end
