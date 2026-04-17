
require 'pork/auto'
require 'battle-cats-rolls/view'

describe BattleCatsRolls::View do
  def view
    @view ||= BattleCatsRolls::View.new
  end

  describe '#growth_rate' do
    would 'return the concise description' do
      # Gacha Cat
      expect(view.__send__(:growth_rate, [20, 20, 60, 120, 180])).eq \
        'lv2~20: 20%, lv21~30: 60%, lv31~40: 120%, lv41~50: 180%'

      # Pogo Cat
      expect(view.__send__(:growth_rate,
        [20, 20, 20, 20, 20, 20, 20, 10, 10, 5, 5, 5, 5])).eq \
        'lv2~70: 20%, lv71~90: 10%, lv91~130: 5%'

      # Crazed Titan Cat
      expect(view.__send__(:growth_rate, [20, 20, 10, 10, 10])).eq \
        'lv2~20: 20%, lv21~50: 10%'

      # Bahamut Cat
      expect(view.__send__(:growth_rate, [20, 20, 20, 10, 10])).eq \
        'lv2~30: 20%, lv31~50: 10%'
    end
  end
end
