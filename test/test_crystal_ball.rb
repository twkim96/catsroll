
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

  describe 'loading BCJP with BCKR cat names' do
    def jp_ball
      BattleCatsRolls::Route.ball_jp
    end

    would 'use Korean cat names when the same cat exists in BCKR' do
      expect(jp_ball.cats.dig(1, 'name')).eq(
        BattleCatsRolls::Route.ball_kr.cats.dig(1, 'name'))
    end

    would 'keep Japanese cat names when BCKR has no matching cat data' do
      raw_jp = BattleCatsRolls::CrystalBall.load(
        File.expand_path('../build', __dir__), 'jp')
      missing_id = raw_jp.cats.keys.find do |id|
        !BattleCatsRolls::Route.ball_kr.cats.key?(id)
      end

      if missing_id
        expect(jp_ball.cats.dig(missing_id, 'name')).eq(
          raw_jp.cats.dig(missing_id, 'name'))
      end
    end
  end
end
