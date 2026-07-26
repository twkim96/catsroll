# frozen_string_literal: true

module BattleCatsRolls
  Root = File.expand_path("#{__dir__}/../..").freeze
  WebHost = ENV['WEB_HOST'].freeze
  WebBind = ENV['WEB_BIND'].freeze || 8080
  WebThreads = Integer(ENV['WEB_THREADS'] || 5)
  SeekHost = ENV['SEEK_HOST'].freeze
  SeekBind = ENV['SEEK_BIND'].freeze || 9090
  SeekThreads = Integer(ENV['SEEK_THREADS'] || 25)
  TrackMaxCount = Integer(ENV['TRACK_MAX_COUNT'] || 999)
end
