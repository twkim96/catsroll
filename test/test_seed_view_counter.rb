
require 'pork/auto'
require 'battle-cats-rolls/seed_view_counter'
require 'json'
require 'tmpdir'

describe BattleCatsRolls::SeedViewCounter do
  before do
    BattleCatsRolls::SeedViewCounter.instance_variable_set(:@stats,
      {'days' => {}, 'hours' => {}, 'quarters' => {}})
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
        Time.local(2026, 6, 20, 3, 4, 5))
      BattleCatsRolls::SeedViewCounter.increment(cache,
        Time.local(2026, 6, 20, 3, 10, 0))
      BattleCatsRolls::SeedViewCounter.flush(path)

      data = JSON.parse(File.read(path))

      expect(data.dig('days', '2026-06-20')).eq 2
      expect(data.dig('hours', '2026-06-20T03')).eq 2
      expect(data.dig('quarters', '2026-06-20T03:00')).eq 2
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

  would 'return recent chart data' do
    BattleCatsRolls::SeedViewCounter.increment(cache,
      Time.local(2026, 6, 20, 3, 4, 5))
    BattleCatsRolls::SeedViewCounter.increment(cache,
      Time.local(2026, 6, 20, 3, 16, 0))

    data = BattleCatsRolls::SeedViewCounter.snapshot(
      Time.local(2026, 6, 20, 3, 30, 0))

    expect(data[:recent_quarters].size).eq 96
    expect(data[:recent_hours].size).eq 168
    expect(data[:recent_quarters][-3][:count]).eq 1
    expect(data[:recent_quarters][-2][:count]).eq 1
    expect(data[:recent_hours][-1][:count]).eq 2
    expect(data[:days].first[:count]).eq 2
  end
end
