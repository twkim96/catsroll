
require 'pork/auto'
require 'battle-cats-rolls/seed_view_counter'

describe BattleCatsRolls::SeedViewCounter do
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
end
