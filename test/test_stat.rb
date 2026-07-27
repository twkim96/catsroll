
require 'pork/auto'
require 'battle-cats-rolls/stat'
require 'battle-cats-rolls/talent'
require 'battle-cats-rolls/route'

describe BattleCatsRolls::Stat do
  BattleCatsRolls::Route.reload_balls

  def lang = 'en'
  def level = 30
  def index = 0
  def sum_no_wave = nil
  def dps_no_critical = nil
  def exclude_talents = true

  def stat
    @stat ||= BattleCatsRolls::Stat.new(
      id: id, index: index, level: level,
      sum_no_wave: sum_no_wave,
      dps_no_critical: dps_no_critical,
      info: info
    ).augment(talents)
  end

  def talents
    return if exclude_talents

    @talents ||= BattleCatsRolls::Talent.build(info)
  end

  def info
    @info ||= BattleCatsRolls::Route.public_send("ball_#{lang}").cats[id]
  end

  describe 'cats without triggering effects can trigger effects' do
    def id = 40

    would 'trigger effects even when it does not have it' do
      attack = stat.attacks.first

      expect(stat.attacks.size).eq 1
      expect(attack.trigger_effects).eq nil
      expect(attack.display_effects).eq ['Freeze']

      expect(stat.specialized_abilities.size).eq 2

      specialized_to_red = stat.specialized_abilities.first
      expect(specialized_to_red.name).eq 'Specialized to'
      expect(specialized_to_red.display).eq ['Red']

      freeze = stat.specialized_abilities.last
      expect(freeze.name).eq 'Freeze'
    end
  end

  describe 'correct health by correct level multiplier' do
    copy do
      would 'be correct' do
        expect(stat.health).eq expected_health
      end
    end

    describe 'Gacha Cat' do
      def id = 559
      def level = 50
      def expected_health = 153000

      paste
    end

    describe 'Pogo Cat' do
      def id = 38
      def level = 130
      def expected_health = 14100

      paste

      describe 'with talents' do
        def exclude_talents = false

        paste

        describe 'Jiangshi Cat' do
          def index = 2
          def expected_health = 22560

          paste
        end
      end
    end

    describe 'Crazed Titan Cat' do
      def id = 100
      def level = 30
      def expected_health = 52200

      paste
    end

    describe 'Bahamut Cat' do
      def id = 26
      def level = 50
      def expected_health = 33000

      paste
    end

    describe 'Bahamut Cat capped at level 50' do
      def id = 26
      def level = 999
      def expected_health = 33000

      paste
    end
  end

  describe 'DPS accounts critical strike and savage blow' do
    describe 'Kyosaka Nanaho' do
      def id = 545
      def level = 45 # This level can test rounding error

      would 'return correct DPS' do
        attacks = stat.attacks

        expect(attacks.size).eq 2
        expect(attacks.first.dps.round(3)).eq 4118.534
        expect(attacks.last.dps.round(3)).eq 3326.509 # 50% critical strike
        expect(stat.dps_sum.round(3)).eq 7445.043 # Not 7444 nor 7446
      end

      describe 'but can be disabled' do
        def dps_no_critical = true

        would 'return correct DPS' do
          attacks = stat.attacks

          expect(attacks.size).eq 2
          expect(attacks.first.dps.round(3)).eq 4118.534
          expect(attacks.last.dps.round(3)).eq 2217.672
          expect(stat.dps_sum.round(3)).eq 6336.207
        end
      end
    end

    describe 'Lasvoss Reborn' do
      def id = 520
      def index = 2
      def expected_dps = 14688

      copy do
        would 'return correct DPS' do
          attacks = stat.attacks

          expect(attacks.size).eq 1
          expect(attacks.first.dps.round(3)).eq expected_dps
          expect(stat.dps_sum.round(3)).eq expected_dps
        end
      end

      paste

      describe 'but can be disabled' do
        def dps_no_critical = true
        def expected_dps = 9180

        paste

        describe 'with talents' do
          def exclude_talents = false
          def expected_dps =  11016

          paste
        end
      end

      describe 'with talents' do
        def exclude_talents = false
        def expected_dps = 17625.6

        paste
      end
    end
  end

  describe 'account wave attacks' do
    describe 'Shampoo' do
      def id = 600

      def dps
        damage / attack_cycle
      end

      def wave_dps
        (wave_damage / attack_cycle) * wave_chance
      end

      def wave_damage
        damage * 0.2 # mini-wave 20% damage
      end

      def attack_cycle
        @attack_cycle ||= stat.attack_cycle.to_f / BattleCatsRolls::Stat::FPS
      end

      copy :test do
        would 'have correct DPS' do
          attacks = stat.attacks
          expect(attacks.size).eq number_of_attacks * 2

          all_dps = [dps, wave_dps] * number_of_attacks

          expect(stat.attacks.map(&:dps).map(&:round)).eq \
            all_dps.map(&:round)

          expect(stat.dps_sum.round).eq \
            sum_with_wave(all_dps.sum, wave_dps).round
        end

        would 'have correct damage' do
          attacks = stat.attacks
          expect(attacks.size).eq number_of_attacks * 2

          all_damage = [damage, wave_damage] * number_of_attacks

          expect(stat.attacks.map(&:damage).map(&:round)).eq \
            all_damage.map(&:round)

          expect(stat.damage_sum.round).eq \
            sum_with_wave(all_damage.sum, wave_damage).round
        end
      end

      copy :account_wave do
        describe 'wave DPS' do
          def sum_with_wave sum, _
            sum
          end

          paste :test
        end
      end

      copy :discount_wave do
        describe 'no wave DPS' do
          def sum_no_wave = true

          def sum_with_wave sum, wave
            sum - wave * number_of_attacks
          end

          paste :test
        end
      end

      describe 'cat form' do
        def number_of_attacks = 2
        def damage = 4675
        def wave_chance = 0.5

        paste :account_wave
        paste :discount_wave
      end

      describe 'human form' do
        def index = 1

        def number_of_attacks = 3
        def damage = 9180
        def wave_chance = 1

        paste :account_wave
        paste :discount_wave
      end
    end
  end

  describe 'account surge attacks' do
    describe 'Fabulous Pasalan' do
      def id = 565
      def index = 2

      would 'have correct DPS' do
        attacks = stat.attacks
        expect(attacks.size).eq 9

        all_dps = [898] * 9

        expect(stat.attacks.map(&:dps).map(&:round)).eq \
          all_dps.map(&:round)
      end
    end
  end

  describe 'augmenting with talents' do
    def index = 2
    def exclude_talents = false

    describe 'Can Can Cat' do
      def id = 33

      would 'have augmented attributes' do
        expect(stat.speed).eq 21
      end

      copy do
        would 'not have augmented attributes' do
          expect(stat.speed).eq 11
        end
      end

      describe 'with base form' do
        def index = 0
        paste
      end

      describe 'with evolved form' do
        def index = 1
        paste
      end
    end

    describe 'The Grey Fox' do
      def id = 213

      would 'have augmented attributes' do
        expect(stat.health).eq 58752
        expect(stat.damage_sum).eq 40392
        expect(stat.production_cost).eq 4725

        # Ensure it's not mutating the talents
        immunities =
          talents.select{ _1.kind_of?(BattleCatsRolls::Talent::Immunity) }
        expect(immunities.size).eq 2
        immunities.each do |immunity|
          expect(immunity.ability.list.size).eq 1
        end
      end

      describe 'with ultra form' do
        def index = 3

        would 'have augmented attributes' do
          expect(stat.health).eq 81600
          expect(stat.damage_sum).eq 59160
          expect(stat.production_cost).eq 4725
        end
      end

      copy do
        would 'not have augmented attributes' do
          expect(stat.health).eq 48960
          expect(stat.damage_sum).eq 33660
          expect(stat.production_cost).eq 5325
        end
      end

      describe 'with base form' do
        def index = 0
        paste
      end

      describe 'with evolved form' do
        def index = 1
        paste
      end
    end

    describe 'Lasvoss Reborn' do
      def id = 520

      would 'have augmented attributes' do
        expect(stat.health).eq 81600
        expect(stat.dps_sum.round).eq 17626
        expect(stat.production_cooldown).eq 1936
      end

      copy do
        would 'not have augmented attributes' do
          expect(stat.health).eq 34000
          expect(stat.dps_sum.round).eq 9792
          expect(stat.production_cooldown).eq 2136
        end
      end

      describe 'with base form' do
        def index = 0
        paste
      end

      describe 'with evolved form' do
        def index = 1
        paste
      end
    end

    describe 'Almighty Anubis' do
      def id = 259

      would 'have augmented attributes' do
        expect(stat.health).eq 81600
        expect(stat.dps_sum.round).eq 17736
        expect(stat.attack_cooldown).eq 39
        expect(stat.production_cost).eq 3600
      end

      describe 'when talents are excluded' do
        def exclude_talents = true

        would 'not have augmented attributes' do
          expect(stat.health).eq 68000
          expect(stat.dps_sum.round).eq 6685
          expect(stat.attack_cooldown).eq 152
          expect(stat.production_cost).eq 4200
        end
      end
    end
  end

  describe '#max_dps_area' do
    def index = 1

    copy do
      would 'return correct max DPS area along with mini-wave' do
        expect(stat.max_dps_area).eq area
      end
    end

    describe 'Masked Grandmaster Cat' do
      def id = 353
      def index = 2
      def area = '255'

      paste
    end

    describe 'Mighty Aegis Garu' do
      def id = 586
      def area = '-67 ~ 400'

      paste
    end

    describe 'Wedding Chronos' do
      def id = 662
      def area = '300 ~ 700'

      paste
    end

    describe 'King of Destiny Phonoa' do
      def id = 691
      def area = '590 ~ 600'

      paste
    end
  end

  describe '#blind_spot' do
    copy do
      would 'return correct blind spot' do
        expect(stat.blind_spot).eq blind_spot
      end
    end

    describe 'Cats in the Stroller' do
      def id = 60
      def index = 3
      def blind_spot = -101

      paste
    end

    describe 'Supernova Cosmo' do
      def id = 136
      def index = 3
      def blind_spot = -301

      paste
    end

    describe 'CAT-10 Gigapult' do
      def id = 305
      def index = 3
      def blind_spot = 99 # Would be -68 with wave talent

      paste
    end

    describe 'Mighty Kristul Muu' do
      def id = 464
      def blind_spot = '-'

      paste
    end

    describe 'Gaia the Creator' do
      def id = 494
      def blind_spot = 349

      paste
    end

    describe 'Chronos the Bride' do
      def id = 662
      def blind_spot = -68

      paste
    end

    describe 'Daybreaker Izanagi' do
      def id = 732
      def blind_spot = 0

      paste
    end

    describe 'Master of Life Dr. Nova' do
      def id = 772
      def blind_spot = 74

      paste
    end
  end
end
