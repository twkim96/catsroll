
require 'pork/auto'
require 'battle-cats-rolls/filter'
require 'battle-cats-rolls/crystal_ball'
require 'battle-cats-rolls/route'

describe BattleCatsRolls::Filter do
  BattleCatsRolls::Route.reload_balls

  def ball; BattleCatsRolls::Route.ball_en; end
  def exclude_talents; false; end

  def chain
    @chain ||= BattleCatsRolls::Filter::Chain.new(
      cats: ball.cats.dup, exclude_talents: exclude_talents)
  end

  would 'not give Metal Cat when filtering against metal specialization' do
    ids = chain.filter!(['metal'], 'all',
      BattleCatsRolls::Filter::Specialization).keys

    expect(ids).include?(89) # Rope Jump Cat
    expect(ids).not.include?(201) # Metal Cat
  end

  would 'filter against hybrid talents with specialization' do
    ids = chain.filter!(['metal'], 'all',
      BattleCatsRolls::Filter::Specialization).keys

    expect(ids).include?(85) # Megidora, talent, against_metal
    expect(ids).include?(170) # Kubiluga, talent, talent_against: [metal]
    expect(ids).include?(574) # Vega, native, against_metal
  end

  would 'filter both native strengthen and talent strengthen' do
    ids = chain.filter!(['strengthen'], 'all',
      BattleCatsRolls::Filter::Combat).keys

    expect(ids).include?(45) # Lesser Demon Cat, talent, strengthen
    expect(ids).include?(73) # Maeda Keiji, native, strengthen_threshold
  end

  would 'filter both native mini-surge and talent mini-surge' do
    ids = chain.filter!(['mini-surge'], 'all',
      BattleCatsRolls::Filter::Combat).keys

    expect(ids).include?(144) # Nurse Cat, talent, surge_mini
    expect(ids).include?(706) # King of Doom Phono, native, surge_mini
  end

  would 'filter both native mini-wave and talent mini-wave' do
    ids = chain.filter!(['mini-wave'], 'all',
      BattleCatsRolls::Filter::Combat).keys

    expect(ids).include?(137) # Momotaro, talent, wave_mini
    expect(ids).include?(586) # Baby Garu, native, wave_mini
  end

  would 'filter long-range without omni-strike' do
    ids = chain.filter!(['long-range'], 'all',
      BattleCatsRolls::Filter::Range).keys

    expect(ids).not.include?(270) # Baby Gao, front-strike
    expect(ids).include?(319) # Miko Mitama, long-range
    expect(ids).not.include?(780) # Celestial Child Luna, omni-strike
  end

  would 'filter omni-strike without long-range' do
    ids = chain.filter!(['omni-strike'], 'all',
      BattleCatsRolls::Filter::Range).keys

    expect(ids).not.include?(270) # Baby Gao, front-strike
    expect(ids).not.include?(319) # Miko Mitama, long-range
    expect(ids).include?(780) # Celestial Child Luna, omni-strike
  end

  would 'filter front-strike without long-range nor omni-strike' do
    ids = chain.filter!(['front-strike'], 'all',
      BattleCatsRolls::Filter::Range).keys

    expect(ids).include?(270) # Baby Gao, front-strike
    expect(ids).not.include?(319) # Miko Mitama, long-range
    expect(ids).not.include?(780) # Celestial Child Luna, omni-strike
  end

  would 'not filter talents applied to first and second form' do
    chain.filter!(%w[black angel alien], 'all',
      BattleCatsRolls::Filter::Specialization)
    chain.filter!(%w[dodge survive], 'all',
      BattleCatsRolls::Filter::Other)
    ids = chain.cats.keys

    expect(ids).include?(35) # Nekoluga
    expect(ids).not.include?(196) # Mekako Saionji, black only for first form
  end

  would 'not filter across different forms' do
    chain.filter!(['alien'], 'all',
      BattleCatsRolls::Filter::Specialization)
    chain.filter!(['massive_damage'], 'all',
      BattleCatsRolls::Filter::Buff)
    chain.filter!(['resistant'], 'all',
      BattleCatsRolls::Filter::Resistant)
    ids = chain.cats.keys

    expect(ids).not.include?(196) # Mekako Saionji, resistant only in 1st form
    expect(ids).include?(360) # Bora
  end

  would 'not filter across different forms for lugas' do
    chain.filter!(['single'], 'all', BattleCatsRolls::Filter::Area)
    chain.filter!(%w[freeze weaken], 'all', BattleCatsRolls::Filter::Control)
    ids = chain.cats.keys

    expect(ids).not.include?(172) # Balaluga, single only in 1st form
    expect(ids).include?(649) # Lovestruck Lesser Demon
  end

  would 'filter high DPS' do
    ids = chain.filter!(['high'], 'all',
      BattleCatsRolls::Filter::DPS).keys

    expect(ids).include?(586) # Baby Garu
  end

  would 'filter very high DPS' do
    ids = chain.filter!(['very_high'], 'all',
      BattleCatsRolls::Filter::DPS).keys

    expect(ids).include?(649) # Lovestruck Lesser Demon
  end

  would 'filter high effective DPS' do
    ids = chain.filter!(['high_effectively'], 'all',
      BattleCatsRolls::Filter::DPS).keys

    expect(ids).include?(243) # Santa Kuu
    expect(ids).include?(654) # Elder Beast Naala
  end

  would 'filter very high effective DPS' do
    ids = chain.filter!(['very_high_effectively'], 'all',
      BattleCatsRolls::Filter::DPS).keys

    expect(ids).include?(442) # D'arktanyan
    expect(ids).include?(691) # Child of Destiny Phono
  end

  would 'filter extremely high effective DPS' do
    ids = chain.filter!(['extremely_high_effectively'], 'all',
      BattleCatsRolls::Filter::DPS).keys

    expect(ids).include?(693) # Issun Boshi
    expect(ids).include?(792) # Kaoru Hanayama
  end

  would 'filter high single blow' do
    ids = chain.filter!(['high'], 'all',
      BattleCatsRolls::Filter::Damage).keys

    expect(ids).include?(284) # Pai-Pai
  end

  would 'filter very high single blow' do
    ids = chain.filter!(['very_high'], 'all',
      BattleCatsRolls::Filter::Damage).keys

    expect(ids).include?(107) # Kai
  end

  would 'filter high effective single blow' do
    ids = chain.filter!(['high_effectively'], 'all',
      BattleCatsRolls::Filter::Damage).keys

    expect(ids).include?(363) # Saber
    expect(ids).include?(739) # Izanami of Dusk
  end

  would 'filter very high effective single blow' do
    ids = chain.filter!(['very_high_effectively'], 'all',
      BattleCatsRolls::Filter::Damage).keys

    expect(ids).include?(334) # Shadow Gao
    expect(ids).include?(793) # Katsumi Orochi
  end

  would 'filter extremely high effective single blow' do
    ids = chain.filter!(['extremely_high_effectively'], 'all',
      BattleCatsRolls::Filter::Damage).keys

    expect(ids).include?(284) # Pai-Pai
    expect(ids).include?(467) # Black Zeus
  end

  would 'filter high speed' do
    ids = chain.filter!(['20'], 'all',
      BattleCatsRolls::Filter::Speed).keys

    expect(ids).include?(93) # Crazed Tank Cat
  end

  would 'filter very high speed' do
    ids = chain.filter!(['40'], 'all',
      BattleCatsRolls::Filter::Speed).keys

    expect(ids).include?(716) # Mighty Sphinx Korps
  end

  would 'filter high health' do
    ids = chain.filter!(['high'], 'all',
      BattleCatsRolls::Filter::Health).keys

    expect(ids).include?(60) # Baby Cat
  end

  would 'filter very high health' do
    ids = chain.filter!(['very_high'], 'all',
      BattleCatsRolls::Filter::Health).keys

    expect(ids).include?(770) # Hanasaka Cat
  end

  would 'filter high effective health' do
    ids = chain.filter!(['high_effectively'], 'all',
      BattleCatsRolls::Filter::Health).keys

    expect(ids).include?(98) # Crazed Fish Cat
    expect(ids).include?(448) # Miter Saw Cat
  end

  would 'filter very high effective health' do
    ids = chain.filter!(['very_high_effectively'], 'all',
      BattleCatsRolls::Filter::Health).keys

    expect(ids).include?(323) # Sarukani
    expect(ids).include?(692) # Ape Lord Luza
    expect(ids).include?(592) # KAITO & Cat
  end

  would 'filter extremely high effective health' do
    ids = chain.filter!(['extremely_high_effectively'], 'all',
      BattleCatsRolls::Filter::Health).keys

    expect(ids).include?(73) # Maeda Keiji
    expect(ids).include?(535) # Hades the Punisher
  end

  would 'filter fast production' do
    ids = chain.filter!(['350'], 'all',
      BattleCatsRolls::Filter::Production).keys

    expect(ids).include?(381) # D'artanyan
  end

  would 'filter very fast production' do
    ids = chain.filter!(['175'], 'all',
      BattleCatsRolls::Filter::Production).keys

    expect(ids).include?(137) # Momotaro
  end

  would 'filter cheap' do
    ids = chain.filter!(['1000'], 'all',
      BattleCatsRolls::Filter::Cost).keys

    expect(ids).include?(523) # Nymph Cat
  end

  would 'filter very cheap' do
    ids = chain.filter!(['500'], 'all',
      BattleCatsRolls::Filter::Cost).keys

    expect(ids).include?(528) # Slime Cat
  end

  describe 'exclude_talents option' do
    def exclude_talents; true; end

    would 'filter native strengthen and exclude talent strengthen' do
      ids = chain.filter!(['strengthen'], 'all',
        BattleCatsRolls::Filter::Combat).keys

      expect(ids).not.include?(45) # Lesser Demon Cat, talent, strengthen
      expect(ids).include?(73) # Maeda Keiji, native, strengthen_threshold
    end

    would 'filter native mini-surge and exclude talent mini-surge' do
      ids = chain.filter!(['mini-surge'], 'all',
        BattleCatsRolls::Filter::Combat).keys

      expect(ids).not.include?(144) # Nurse Cat, talent, surge_mini
      expect(ids).include?(706) # King of Doom Phono, native, surge_mini
    end

    would 'filter native mini-wave and exclude talent mini-wave' do
      ids = chain.filter!(['mini-wave'], 'all',
        BattleCatsRolls::Filter::Combat).keys

      expect(ids).not.include?(137) # Momotaro, talent, wave_mini
      expect(ids).include?(586) # Baby Garu, native, wave_mini
    end

    would 'filter native specialization and exclude talent' do
      ids = chain.filter!(['metal'], 'all',
        BattleCatsRolls::Filter::Specialization).keys

      expect(ids).not.include?(85) # Megidora, talent, against_metal
      expect(ids).not.include?(170) # Kubiluga, talent, talent_against: [metal]
      expect(ids).include?(574) # Vega, native, against_metal
    end
  end
end
