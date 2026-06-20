
require 'pork/auto'
require 'battle-cats-rolls/seed_view_counter'
require 'json'
require 'tmpdir'

describe BattleCatsRolls::SeedViewCounter do
  before do
    BattleCatsRolls::SeedViewCounter.instance_variable_set(:@stats,
      {'days' => {}, 'hours' => {}, 'quarters' => {}, 'langs_by_day' => {},
       'events_by_day' => {}})
    BattleCatsRolls::SeedViewCounter.instance_variable_set(:@loaded, false)
    @cache = nil
  end

  def cache
    @cache ||= {}.extend(Module.new do
      def store key, value, expires_in: nil
        self[key] = value
      end
    end)
  end

  def date
    Date.new(2026, 6, 20)
  end

  would 'count seed views per day' do
    expect(BattleCatsRolls::SeedViewCounter.count(cache, date)).eq 0

    expect(BattleCatsRolls::SeedViewCounter.increment(cache, date)).eq 1
    expect(BattleCatsRolls::SeedViewCounter.increment(cache, date)).eq 2
    expect(BattleCatsRolls::SeedViewCounter.count(cache, date)).eq 2
  end

  would 'use a different key for each day' do
    BattleCatsRolls::SeedViewCounter.increment(cache, date)

    expect(BattleCatsRolls::SeedViewCounter.count(cache, date + 1)).eq 0
  end

  would 'flush day and hour counts to json' do
    Dir.mktmpdir do |dir|
      path = "#{dir}/seed_views.json"
      BattleCatsRolls::SeedViewCounter.increment(cache,
        Time.local(2026, 6, 20, 3, 4, 5), lang: 'kr',
        event: '2026-06-22_1043')
      BattleCatsRolls::SeedViewCounter.increment(cache,
        Time.local(2026, 6, 20, 3, 10, 0), lang: 'kr',
        event: '2026-06-22_1043')
      BattleCatsRolls::SeedViewCounter.flush(path)

      data = JSON.parse(File.read(path))

      expect(data.dig('days', '2026-06-20')).eq 2
      expect(data.dig('hours', '2026-06-20T03')).eq 2
      expect(data.dig('quarters', '2026-06-20T03:00')).eq 2
      expect(data.dig('langs_by_day', '2026-06-20', 'kr')).eq 2
      expect(data.dig('events_by_day', '2026-06-20',
        'kr|2026-06-22_1043')).eq 2
    end
  end

  would 'load existing json counts' do
    Dir.mktmpdir do |dir|
      path = "#{dir}/seed_views.json"
      File.write(path, JSON.dump(
        'days' => {'2026-06-20' => 7},
        'hours' => {'2026-06-20T03' => 5}))

      BattleCatsRolls::SeedViewCounter.load!(path)

      expect(BattleCatsRolls::SeedViewCounter.count(cache, date)).eq 7
    end
  end

  would 'merge a late stats file with memory counts' do
    Dir.mktmpdir do |dir|
      path = "#{dir}/seed_views.json"

      expect(BattleCatsRolls::SeedViewCounter.load!(path)).eq false
      BattleCatsRolls::SeedViewCounter.increment(cache,
        Time.local(2026, 6, 20, 3, 4, 5), lang: 'kr',
        event: '2026-06-22_1043')
      File.write(path, JSON.dump(
        'days' => {'2026-06-20' => 7},
        'hours' => {'2026-06-20T03' => 5},
        'quarters' => {'2026-06-20T03:00' => 5},
        'langs_by_day' => {'2026-06-20' => {'kr' => 5}},
        'events_by_day' => {'2026-06-20' => {
          'kr|2026-06-22_1043' => 5
        }}))

      expect(BattleCatsRolls::SeedViewCounter.load!(path)).eq true
      data = BattleCatsRolls::SeedViewCounter.snapshot(
        Time.local(2026, 6, 20, 3, 15, 0))

      expect(BattleCatsRolls::SeedViewCounter.count(cache, date)).eq 8
      expect(data[:recent_hours][-1][:count]).eq 6
      expect(data[:recent_quarters][-2][:count]).eq 6
      expect(data[:langs].first[:count]).eq 6
      expect(data[:events].first[:count]).eq 6
    end
  end

  would 'return recent chart data' do
    BattleCatsRolls::SeedViewCounter.increment(cache,
      Time.local(2026, 6, 20, 3, 4, 5), lang: 'kr',
      event: '2026-06-22_1043')
    BattleCatsRolls::SeedViewCounter.increment(cache,
      Time.local(2026, 6, 20, 3, 16, 0), lang: 'jp',
      event: '2026-06-22_1043')

    data = BattleCatsRolls::SeedViewCounter.snapshot(
      Time.local(2026, 6, 20, 3, 30, 0))

    expect(data[:recent_quarters].size).eq 96
    expect(data[:recent_hours].size).eq 168
    expect(data[:recent_quarters][-3][:count]).eq 1
    expect(data[:recent_quarters][-2][:count]).eq 1
    expect(data[:recent_hours][-1][:count]).eq 2
    expect(data[:langs].map{ |row| row[:key] }).eq %w[jp kr]
    expect(data[:events].first[:event]).eq '2026-06-22_1043'
    expect(data[:days].first[:count]).eq 2
  end

  would 'keep lower ranked events for view filtering' do
    10.times do |index|
      BattleCatsRolls::SeedViewCounter.increment(cache,
        Time.local(2026, 6, 20, 3, 4, 5), lang: 'en',
        event: "old_#{index}")
    end
    BattleCatsRolls::SeedViewCounter.increment(cache,
      Time.local(2026, 6, 20, 3, 4, 5), lang: 'kr',
      event: '2026-06-22_1043')

    data = BattleCatsRolls::SeedViewCounter.snapshot(
      Time.local(2026, 6, 20, 3, 30, 0))

    expect(data[:events].size).eq 11
    expect(data[:events].any?{ |row| row[:lang] == 'kr' }).eq true
  end

  would 'prune rolling buckets and daily breakdowns on flush' do
    Dir.mktmpdir do |dir|
      path = "#{dir}/seed_views.json"
      File.write(path, JSON.dump(
        'days' => {'2026-06-18' => 1, '2026-06-20' => 2},
        'hours' => {'2026-06-01T00' => 1, '2026-06-20T03' => 2},
        'quarters' => {'2026-06-01T00:00' => 1, '2026-06-20T03:00' => 2},
        'langs_by_day' => {
          '2026-06-19' => {'jp' => 1},
          '2026-06-20' => {'kr' => 2}
        },
        'events_by_day' => {
          '2026-06-19' => {'jp|old' => 1},
          '2026-06-20' => {'kr|new' => 2}
        }))
      BattleCatsRolls::SeedViewCounter.load!(path)
      BattleCatsRolls::SeedViewCounter.__send__(:prune!,
        Time.local(2026, 6, 20, 3, 30, 0))
      BattleCatsRolls::SeedViewCounter.flush(path)

      data = JSON.parse(File.read(path))

      expect(data['hours'].key?('2026-06-01T00')).eq false
      expect(data['quarters'].key?('2026-06-01T00:00')).eq false
      expect(data['langs_by_day'].keys).eq ['2026-06-20']
      expect(data['events_by_day'].keys).eq ['2026-06-20']
      expect(data['days'].key?('2026-06-18')).eq true
    end
  end
end
