# frozen_string_literal: true

require_relative 'ability'
require_relative 'attack'

module BattleCatsRolls
  class Stat < Struct.new(
    :id, :info, :index, :level, :conjure_info, :cat,
    :exclude_talents, :sum_no_wave, :dps_no_critical,
    keyword_init: true)

    DefaultLevel = 30
    FPS = 30

    def inspect
      "#<#{self.class} id=#{id.inspect} name=#{name.inspect}>"
    end

    def name
      info.dig('name', index) || cat&.pick_name(index)
    end

    def desc
      info.dig('desc', index) || cat&.pick_description(index)
    end

    def stat
      @stat ||= if conjure_info
        info.dig('stat', index).merge('conjure_info' => conjure_info)
      else
        info.dig('stat', index)
      end
    end

    def level
      super || DefaultLevel
    end

    def effective_level
      @effective_level ||= [level, info['max_level']].min
    end

    def health
      @health ||=
        (stat['health'] * treasure_multiplier * level_multiplier).round
    end

    def knockbacks
      stat['knockbacks']
    end

    def speed
      stat['speed']
    end

    def production_cost
      @production_cost ||= if stat['cost']
        (stat['cost'] * chapter2_cost_multiplier).floor
      else
        '-'
      end
    end

    def production_cooldown
      @production_cooldown ||= if stat['production_cooldown']
        [
          minimal_cooldown,
          (stat['production_cooldown'] * time_multiplier) -
            reduction_from_blue_orbs_and_treasures
        ].max
      else
        '-'
      end
    end

    def push_duration
      @push_duration ||= attack_duration &&
        attack_cycle - attack_duration
    end

    def attack_cycle
      @attack_cycle ||= attack_duration &&
        [
          attack_duration + 1,
          attacks_raw.sum(&:duration) + attack_cooldown - 1
        ].max
    end

    def attack_duration
      stat['attack_duration']
    end

    def attack_cooldown
      @attack_cooldown ||= stat['attack_cooldown'].to_i * time_multiplier
    end

    def damage_sum
      @damage_sum ||= if max_dps_area == 'None'
        '-'
      else
        if sum_no_wave
          attacks_raw
        else
          attacks_major
        end.sum(&:damage)
      end
    end

    def range
      stat['range']
    end

    def base_range
      stat['long_range_0'] || range
    end

    def blind_spot
      min = attacks.min_by{ |atk| atk.area_range.begin }.area_range.begin

      if -width < min
        min - 1
      else
        '-'
      end
    end

    def width
      stat['width']
    end

    def area_type
      if stat['area_effect']
        'Area'
      else
        'Single range'
      end
    end

    def long_range?
      @long_range ||= !!stat['long_range_0']
    end

    def kamikaze?
      @kamikaze ||= generic_abilities.any? do |ability|
        ability.kind_of?(Ability::Kamikaze)
      end
    end

    def effects
      @effects ||= abilities.flat_map do |(_, abis)|
        abis.select(&:effects)
      end
    end

    def wave_effect
      @wave_effect ||= effects.find{ |eff| eff.kind_of?(Ability::Wave) }
    end

    def surge_effect
      @surge_effect ||= effects.find{ |eff| eff.kind_of?(Ability::Surge) }
    end

    def explosion_effect
      @explosion_effect ||= effects.find{ |eff| eff.kind_of?(Ability::Explosion) }
    end

    def dps_sum
      @dps_sum ||= if kamikaze? || max_dps_area == 'None'
        '-'
      elsif attack_cycle
        if sum_no_wave
          attacks_raw
        else
          attacks_major
        end.sum(&:dps)
      end
    end

    def max_dps_area
      @max_dps_area ||= if long_range?
        intersected = attacks_major.map(&:area_range).inject do |result, range|
          [result.begin, range.begin].max..[result.end, range.end].min
        end

        if intersected.any?
          "#{intersected.begin} ~ #{intersected.end}"
        else
          'None'
        end
      elsif stat['area_effect']
        range.to_s
      else
        'Single'
      end
    end

    def attacks
      @attacks ||= if wave_effect || surge_effect || explosion_effect
        attacks_raw.flat_map do |atk|
          if atk.effects.any?
            attack_args = {stat: self, damage: atk.damage,
              trigger_effects: atk.trigger_effects}

            # Wrap wave in an array to avoid calling `to_a` on WaveAttack
            wave = [WaveAttack.new(**attack_args)] if wave_effect
            surges = [SurgeAttack.new(**attack_args)] * surge_effect.level if
              surge_effect
            explosion = ExplosionAttack.new(**attack_args) if explosion_effect

            [atk, *wave, *surges, *explosion]
          else
            atk
          end
        end
      else
        attacks_raw
      end
    end

    def attacks_major
      @attacks_major ||= attacks.reject(&:cascade)
    end

    def attacks_raw
      @attacks_raw ||= 3.times.filter_map do |n|
        next unless value = damage(n)

        Attack.new(stat: self, damage: value,
          long_range: long_range(n), long_range_offset: long_range_offset(n),
          trigger_effects: trigger_effects(n), duration: duration(n))
      end
    end

    def single_damage?
      stat['damage_1'].nil?
    end

    def specialized_abilities
      @specialized_abilities ||= abilities[true] || []
    end

    def generic_abilities
      @generic_abilities ||= abilities[false] || []
    end

    private

    def abilities
      @abilities ||= Ability.build(stat).group_by(&:specialized)
    end

    def damage n=0
      value = stat["damage_#{n}"]

      (value * treasure_multiplier * level_multiplier).round if value
    end

    def long_range n=0
      attack_stat(__method__, n)
    end

    def long_range_offset n=0
      attack_stat(__method__, n)
    end

    def trigger_effects n=0
      stat["trigger_effects_#{n}"]
    end

    def duration n=0
      prefix = 'attack_time_'

      if n == 0
        stat["#{prefix}#{n}"]
      else
        stat["#{prefix}#{n}"] - stat["#{prefix}#{n - 1}"]
      end
    end

    def attack_stat name, n=0
      key = "#{name}_#{n}"

      if n <= 0
        stat[key]
      else
        stat[key] || attack_stat(name, n - 1)
      end
    end

    def treasure_multiplier
      2.5
    end

    def chapter2_cost_multiplier
      1.5
    end

    def time_multiplier
      2
    end

    def minimal_cooldown
      60
    end

    def reduction_from_blue_orbs_and_treasures
      264
    end

    def level_multiplier
      @level_multiplier ||= begin
        growth = info['growth'].map{ |percent| percent / 100.0 }
        reminder = effective_level % 10
        steps = effective_level / 10
        1 + # base multiplier
          (growth[0...steps].sum * 10) + # sum of every 10 levels
          ((growth[steps] || 0) * reminder) -
          growth.first # subtract the first level because level starts at 1
      end
    end
  end
end
