
require 'pork/auto'
require 'battle-cats-rolls/stat'
require 'battle-cats-rolls/route'

describe BattleCatsRolls::Stat do
  BattleCatsRolls::Route.reload_balls

  def lang; 'en'; end
  def level; 30; end
  def index; 0; end
  def sum_no_wave; nil; end
  def dps_no_critical; nil; end
  def stat
    @stat ||= BattleCatsRolls::Stat.new(
      id: id, index: index, level: level,
      sum_no_wave: sum_no_wave,
      dps_no_critical: dps_no_critical,
      info: BattleCatsRolls::Route.public_send("ball_#{lang}").cats[id])
  end

  describe 'cats without triggering effects can trigger effects' do
    def id; 40; end

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
    copy :check_health do
      would 'be correct' do
        expect(stat.health).eq health
      end
    end

    describe 'Gacha Cat' do
      def id; 559; end
      def level; 50; end
      def health; 153000; end
      paste :check_health
    end

    describe 'Pogo Cat' do
      def id; 38; end
      def level; 130; end
      def health; 14100; end
      paste :check_health
    end

    describe 'Crazed Titan Cat' do
      def id; 100; end
      def level; 30; end
      def health; 52200; end
      paste :check_health
    end

    describe 'Bahamut Cat' do
      def id; 26; end
      def level; 50; end
      def health; 33000; end
      paste :check_health
    end

    describe 'Bahamut Cat capped at level 50' do
      def id; 26; end
      def level; 999; end
      def health; 33000; end
      paste :check_health
    end
  end

  describe 'DPS accounts critical strike and savage blow' do
    describe 'Kyosaka Nanaho' do
      def id; 545; end
      def level; 45; end # This level can test rounding error

      would 'return correct DPS' do
        attacks = stat.attacks

        expect(attacks.size).eq 2
        expect(attacks.first.dps.round(3)).eq 4118.534
        expect(attacks.last.dps.round(3)).eq 3326.509 # 50% critical strike
        expect(stat.dps_sum.round(3)).eq 7445.043 # Not 7444 nor 7446
      end

      describe 'but can be disabled' do
        def dps_no_critical; true; end

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
      def id; 520; end
      def index; 2; end

      def expected_dps
        14688
      end

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
        def dps_no_critical; true; end

        def expected_dps
          9180
        end

        paste
      end
    end
  end

  describe 'account wave attacks' do
    describe 'Shampoo' do
      def id; 600; end

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
          def sum_no_wave; true; end

          def sum_with_wave sum, wave
            sum - wave * number_of_attacks
          end

          paste :test
        end
      end

      describe 'cat form' do
        def number_of_attacks; 2; end
        def damage; 4675; end
        def wave_chance; 0.5; end

        paste :account_wave
        paste :discount_wave
      end

      describe 'human form' do
        def index; 1; end

        def number_of_attacks; 3; end
        def damage; 9180; end
        def wave_chance; 1; end

        paste :account_wave
        paste :discount_wave
      end
    end
  end

  describe 'account surge attacks' do
    describe 'Fabulous Pasalan' do
      def id; 565; end
      def index; 2; end

      would 'have correct DPS' do
        attacks = stat.attacks
        expect(attacks.size).eq 9

        all_dps = [898] * 9

        expect(stat.attacks.map(&:dps).map(&:round)).eq \
          all_dps.map(&:round)
      end
    end
  end

  describe '#max_dps_area' do
    def index; 1; end

    copy do
      would 'return correct max DPS area along with mini-wave' do
        expect(stat.max_dps_area).eq area
      end
    end

    describe 'Masked Grandmaster Cat' do
      def id; 353; end
      def index; 2; end
      def area; '255'; end

      paste
    end

    describe 'Mighty Aegis Garu' do
      def id; 586; end
      def area; '-67 ~ 400'; end

      paste
    end

    describe 'Wedding Chronos' do
      def id; 662; end
      def area; '300 ~ 700'; end

      paste
    end

    describe 'King of Destiny Phonoa' do
      def id; 691; end
      def area; '590 ~ 600'; end

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
      def id; 60; end
      def index; 3; end
      def blind_spot; -101; end

      paste
    end

    describe 'Supernova Cosmo' do
      def id; 136; end
      def index; 3; end
      def blind_spot; -301; end

      paste
    end

    describe 'CAT-10 Gigapult' do
      def id; 305; end
      def index; 3; end
      def blind_spot; 99; end # Would be -68 with wave talent

      paste
    end

    describe 'Mighty Kristul Muu' do
      def id; 464; end
      def blind_spot; '-'; end

      paste
    end

    describe 'Gaia the Creator' do
      def id; 494; end
      def blind_spot; 349; end

      paste
    end

    describe 'Chronos the Bride' do
      def id; 662; end
      def blind_spot; -68; end

      paste
    end

    describe 'Daybreaker Izanagi' do
      def id; 732; end
      def blind_spot; 0; end

      paste
    end

    describe 'Master of Life Dr. Nova' do
      def id; 772; end
      def blind_spot; 74; end

      paste
    end
  end
end
