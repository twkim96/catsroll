
require 'pork/auto'
require 'battle-cats-rolls/gacha'

describe BattleCatsRolls::Gacha do
  describe 'next index and track' do
    [
      [1, 0, 1, 1], # 1A -> 2B
      [1, 1, 2, 0], # 1B -> 3A
      [2, 0, 2, 0], # 1A -> 3A
      [2, 1, 2, 1], # 1B -> 3B
      [3, 0, 2, 1], # 1A -> 3B
      [3, 1, 3, 0], # 1B -> 4A
    ].each do |(steps, track, expected_index, expected_track)|
      would "steps: #{steps}, track: #{track}" do
        next_index = BattleCatsRolls::Gacha.next_index(track, steps)
        next_track = BattleCatsRolls::Gacha.next_track(track, steps)

        expect(next_index).eq expected_index
        expect(next_track).eq expected_track
      end
    end
  end

  describe 'advance_seed and retreat_seed' do
    def gacha
      # We don't care about the dependency here
      @gacha ||= BattleCatsRolls::Gacha.allocate
    end

    would 'advance and retreat back to the original seed' do
      expect(
        gacha.__send__(:retreat_seed, gacha.__send__(:advance_seed, 1))
      ).eq 1
    end
  end
end
