
require 'pork/auto'
require 'battle-cats-rolls/cat'
require 'battle-cats-rolls/crystal_ball'
require 'battle-cats-rolls/route'

describe BattleCatsRolls::CrystalBall do
  BattleCatsRolls::Route.reload_balls

  def ball
    BattleCatsRolls::Route.ball_en
  end

  describe 'loading Miko Mitama' do
    def cat_id
      319
    end

    def cat_name
      'Miko Mitama'
    end

    would '#cats_by_rarity' do
      name = ball.cats_by_rarity.dig(
        BattleCatsRolls::Cat::Uber, cat_id, 'name', 0)

      expect(name).eq cat_name
    end

    would '#cats' do
      name = ball.cats.dig(cat_id, 'name', 0)

      expect(name).eq cat_name
    end
  end
end
