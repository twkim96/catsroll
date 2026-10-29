# frozen_string_literal: true

require 'rack'
require 'puma'
require 'puma/server'
require 'puma/events'

servers = []
threads = []
running = true

%w[QUIT TERM INT].each do |signal|
  trap(signal) do
    if running
      running = false
      servers.each{ _1.stop(false) }
    end
  end
end

rack, = Rack::Builder.parse_file(
  File.expand_path("#{__dir__}/../config.ru"))

run = lambda do |host, bind, workers|
  server = Puma::Server.new(rack, Puma::Events.new,
    min_threads: workers, max_threads: workers)

  address = if bind.include?(':')
    bind
  elsif host&.include?(':')
    host
  else
    "#{host || '0.0.0.0'}:#{bind}"
  end

  server.binder.parse(
    ["tcp://#{address}?reuse_port=true"], server.log_writer)

  threads << server.run
  servers << server
end

run.call(
  BattleCatsRolls::WebHost,
  BattleCatsRolls::WebBind,
  BattleCatsRolls::WebThreads)

if BattleCatsRolls::SeekHost
  run.call(
    BattleCatsRolls::SeekHost,
    BattleCatsRolls::SeekBind,
    BattleCatsRolls::SeekThreads)
end

servers.each{ _1.stop(false) } unless running
threads.each(&:join)
