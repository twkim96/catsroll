# frozen_string_literal: true

require_relative 'stat'

module BattleCatsRolls
  module Filter
    class Chain < Struct.new(:cats, :level,
      :exclude_talents, :sum_no_wave, :dps_no_critical,
      keyword_init: true)
      def filter! selected, all_or_any, filter_table
        return if selected.empty?

        cats.select! do |id, cat|
          indicies = cat['stat'].map.with_index do |raw_stat, index|
            if matched = matched_stats[id]
              next unless matched[index]
            end

            abilities = expand_stat(cat, raw_stat, index)
            index if selected.public_send("#{all_or_any}?") do |item|
              case filter = filter_table[item]
              when String, NilClass
                abilities[filter] || abilities[item]
              else
                filter.match?(abilities,
                  Stat.new(id: id, info: cat, index: index,
                    level: level,
                    exclude_talents: exclude_talents,
                    sum_no_wave: sum_no_wave,
                    dps_no_critical: dps_no_critical))
              end
            end
          end

          matched_stats[id] = indicies
          indicies.any?
        end
      end

      private

      def matched_stats
        @matched_stats ||= {}
      end

      def expand_stat cat, raw_stat, index
        if exclude_talents || index < 2 # 2 is true form, 3 is ultra form
          raw_stat
        else
          raw_stat.merge(cat['talent'] || {}).merge(
            (cat['talent_against'] || []).inject({}) do |result, against|
              result["against_#{against}"] = true
              result
            end
          )
        end
      end
    end

    module LongRange
      def self.match? abilities, stat=nil
        abilities['long_range_0'] && !OmniStrike.match?(abilities, stat)
      end
    end

    module OmniStrike
      def self.match? abilities, stat=nil
        abilities['long_range_offset_0'].to_i < 0
      end
    end

    module FrontStrike
      def self.match? abilities, stat=nil
        !abilities['long_range_0']
      end
    end

    module Single
      def self.match? abilities, stat=nil
        !abilities['area_effect']
      end
    end

    module HighDPS
      Modifier = :itself.to_proc

      def self.match? abilities, stat, threshold: 7500, modifier: Modifier
        modifier[stat.dps_sum.to_i] >= threshold ||
          stat.attacks_raw.any?{ |attack|
            modifier[attack.dps.to_i] >= threshold }
      end
    end

    module VeryHighDPS
      def self.match? abilities, stat, modifier: HighDPS::Modifier
        HighDPS.match?(abilities, stat, threshold: 15000, modifier: modifier)
      end
    end

    module ExtremelyHighDPS
      def self.match? abilities, stat, modifier: HighDPS::Modifier
        HighDPS.match?(abilities, stat, threshold: 25000, modifier: modifier)
      end
    end

    module HighEffectiveDPS
      def self.match? abilities, stat, filter: HighDPS
        modifiers =
          case
          when abilities['strong']
            [1.8, 1.5]
          when abilities['massive_damage']
            [4, 3]
          when abilities['insane_damage']
            [6, 5]
          end

        filter_match?(abilities, stat, modifiers, filter: filter)
      end

      def self.filter_match? abilities, stat, modifiers, filter:
        if modifiers
          filter.match?(abilities, stat,
            modifier: detect_modifier(abilities, *modifiers))
        else
          filter.match?(abilities, stat)
        end
      end

      def self.detect_modifier abilities, with_treasures, without_treasures
        lookup = abilities.method(:[])

        case
        when SpecializationWithTreasures.values.any?(&lookup)
          with_treasures
        when SpecializationWithoutTreasures.values.any?(&lookup)
          without_treasures
        end.method(:*)
      end
    end

    module VeryHighEffectiveDPS
      def self.match? abilities, stat
        HighEffectiveDPS.match?(abilities, stat, filter: VeryHighDPS)
      end
    end

    module ExtremelyHighEffectiveDPS
      def self.match? abilities, stat
        HighEffectiveDPS.match?(abilities, stat, filter: ExtremelyHighDPS)
      end
    end

    module HighSingleBlow
      def self.match? abilities, stat, threshold: 50000, modifier: HighDPS::Modifier
        stat.attacks_raw.any?{ |attack|
          modifier[attack.damage.to_i] >= threshold }
      end
    end

    module VeryHighSingleBlow
      def self.match? abilities, stat, threshold: 100000, modifier: HighDPS::Modifier
        HighSingleBlow.match?(abilities, stat,
          threshold: threshold, modifier: modifier)
      end
    end

    module ExtremelyHighSingleBlow
      def self.match? abilities, stat, threshold: 200000, modifier: HighDPS::Modifier
        HighSingleBlow.match?(abilities, stat,
          threshold: threshold, modifier: modifier)
      end
    end

    module HighEffectiveSingleBlow
      def self.match? abilities, stat
        HighEffectiveDPS.match?(abilities, stat, filter: HighSingleBlow)
      end
    end

    module VeryHighEffectiveSingleBlow
      def self.match? abilities, stat
        HighEffectiveDPS.match?(abilities, stat, filter: VeryHighSingleBlow)
      end
    end

    module ExtremelyHighEffectiveSingleBlow
      def self.match? abilities, stat
        HighEffectiveDPS.match?(abilities, stat, filter: ExtremelyHighSingleBlow)
      end
    end

    module HighHealth
      def self.match? abilities, stat, threshold: 100000, modifier: HighDPS::Modifier
        modifier[stat.health] >= threshold
      end
    end

    module VeryHighHealth
      def self.match? abilities, stat, modifier: HighDPS::Modifier
        HighHealth.match?(
          abilities, stat, threshold: 200000, modifier: modifier)
      end
    end

    module ExtremelyHighHealth
      def self.match? abilities, stat, modifier: HighDPS::Modifier
        HighHealth.match?(
          abilities, stat, threshold: 400000, modifier: modifier)
      end
    end

    module HighEffectiveHealth
      def self.match? abilities, stat, filter: HighHealth
        modifiers =
          case
          when abilities['strong']
            [2.5, 2]
          when abilities['resistant']
            [5, 4]
          when abilities['insane_resistant']
            [7, 6]
          end

        HighEffectiveDPS.filter_match?(
          abilities, stat, modifiers, filter: filter)
      end
    end

    module VeryHighEffectiveHealth
      def self.match? abilities, stat
        HighEffectiveHealth.match?(abilities, stat, filter: VeryHighHealth)
      end
    end

    module ExtremelyHighEffectiveHealth
      def self.match? abilities, stat
        HighEffectiveHealth.match?(abilities, stat, filter: ExtremelyHighHealth)
      end
    end

    module KnockbacksOne
      def self.display
        '=1'
      end

      def self.match? abilities, stat
        abilities['knockbacks'] <= 1
      end
    end

    module KnockbacksTwo
      def self.display
        '<=2'
      end

      def self.match? abilities, stat
        abilities['knockbacks'] <= 2
      end
    end

    module KnockbacksFive
      def self.display
        '3~5'
      end

      def self.match? abilities, stat
        abilities['knockbacks'] >= 3 && abilities['knockbacks'] <= 5
      end
    end

    module KnockbacksSix
      def self.display
        '>=6'
      end

      def self.match? abilities, stat
        abilities['knockbacks'] >= 6
      end
    end

    module Melee
      def self.display
        '<250'
      end

      def self.match? abilities, stat=nil
        abilities['range'].to_i < 250
      end
    end

    module Midrange
      def self.display
        '250~449'
      end

      def self.match? abilities, stat=nil
        range = abilities['range'].to_i
        range >= 250 && range < 450
      end
    end

    module Backline
      def self.display
        '>=450'
      end

      def self.match? abilities, stat=nil
        abilities['range'].to_i >= 450
      end
    end

    module Rearline
      def self.display
        '>=550'
      end

      def self.match? abilities, stat=nil
        abilities['range'].to_i >= 550
      end
    end

    class ReachFilter < Struct.new(:criteria)
      def display
        ">=#{criteria}"
      end

      def match? abilities, stat
        stat.attacks.any?{ |attack| attack.area_range.end >= criteria }
      end
    end

    class SpeedFilter < Struct.new(:criteria, :op)
      def display
        "#{op}#{criteria}"
      end

      def match? abilities, stat=nil
        abilities['speed'].to_i.public_send(op, criteria)
      end
    end

    class CostFilter < Struct.new(:criteria)
      def display
        "<=#{criteria}"
      end

      def match? abilities, stat
        case value = stat.production_cost
        when Numeric
          value <= criteria
        end
      end
    end

    class ProductionFilter < Struct.new(:criteria)
      def display
        "<=#{(criteria.to_f / Stat::FPS).round(2)}s"
      end

      def match? abilities, stat
        case value = stat.production_cooldown
        when Numeric
          value <= criteria
        end
      end
    end

    module Backswing
      def self.match? abilities, stat
        stat.push_duration.to_i <= 1
      end
    end

    SpecializationWithTreasures = {
      'red' => 'against_red',
      'float' => 'against_float',
      'black' => 'against_black',
      'angel' => 'against_angel',
      'alien' => 'against_alien',
      'zombie' => 'against_zombie',
    }.freeze

    SpecializationWithoutTreasures = {
      'aku' => 'against_aku',
      'relic' => 'against_relic',
      'white' => 'against_white',
      'metal' => 'against_metal',
    }.freeze

    Specialization = SpecializationWithTreasures.
      merge(SpecializationWithoutTreasures).freeze

    Buff = {
      'massive_damage' => nil,
      'insane_damage' => nil,
      'strong' => nil,
    }.freeze

    Resistant = {
      'resistant' => nil,
      'insane_resistant' => nil,
    }.freeze

    Range = {
      'long-range' => LongRange,
      'omni-strike' => OmniStrike,
      'front-strike' => FrontStrike,
    }.freeze

    Area = {
      'area' => 'area_effect',
      'single' => Single,
    }.freeze

    Control = {
      'freeze' => 'freeze_chance',
      'slow' => 'slow_chance',
      'knockback' => 'knockback_chance',
      'weaken' => 'weaken_chance',
      'curse' => 'curse_chance',
    }.freeze

    Immunity = {
      'freeze' => 'immune_freeze',
      'slow' => 'immune_slow',
      'knockback' => 'immune_knockback',
      'warp' => 'immune_warp',
      'weaken' => 'immune_weaken',
      'curse' => 'immune_curse',
      'wave' => 'immune_wave',
      'block_wave' => nil,
      'surge' => 'immune_surge',
      'explosion' => 'immune_explosion',
      'toxic' => 'immune_toxic',
      'bosswave' => 'immune_bosswave',
    }.freeze

    Counter = {
      'critical_strike' => 'critical_chance',
      'metal_killer' => nil,
      'break_barrier' => 'break_barrier_chance',
      'break_shield' => 'break_shield_chance',
      'zombie_killer' => nil,
      'soul_strike' => nil,
      'colossus_slayer' => nil,
      'behemoth_slayer' => nil,
      'sage_slayer' => nil,
      'witch_slayer' => nil,
      'eva_angel_slayer' => nil,
      'base_destroyer' => nil,
    }.freeze

    Combat = {
      'savage_blow' => 'savage_blow_chance',
      'strengthen' => 'strengthen_threshold',
      'wave' => 'wave_chance',
      'mini-wave' => 'wave_mini',
      'surge' => 'surge_chance',
      'mini-surge' => 'surge_mini',
      'counter-surge' => 'counter_surge',
      'explosion' => 'explosion_chance',
      'conjure' => nil,
    }.freeze

    Other = {
      'extra_money' => nil,
      'dodge' => 'dodge_chance',
      'survive' => 'survive_chance',
      'attack_only' => 'against_only',
      'metallic' => nil,
      'kamikaze' => nil,
    }.freeze

    DPS = {
      'high' => HighDPS,
      'high_effectively' => HighEffectiveDPS,
      'very_high' => VeryHighDPS,
      'very_high_effectively' => VeryHighEffectiveDPS,
      'extremely_high_effectively' => ExtremelyHighEffectiveDPS,
    }

    Damage = {
      'high' => HighSingleBlow,
      'high_effectively' => HighEffectiveSingleBlow,
      'very_high' => VeryHighSingleBlow,
      'very_high_effectively' => VeryHighEffectiveSingleBlow,
      'extremely_high_effectively' => ExtremelyHighEffectiveSingleBlow,
    }.freeze

    Health = {
      'high' => HighHealth,
      'high_effectively' => HighEffectiveHealth,
      'very_high' => VeryHighHealth,
      'very_high_effectively' => VeryHighEffectiveHealth,
      'extremely_high_effectively' => ExtremelyHighEffectiveHealth,
    }.freeze

    Knockbacks = {
      '1' => KnockbacksOne,
      '2' => KnockbacksTwo,
      '5' => KnockbacksFive,
      '6' => KnockbacksSix,
    }.freeze

    Stand = {
      'melee' => Melee,
      'midrange' => Midrange,
      'backline' => Backline,
      'rearline' => Rearline,
    }.freeze

    Reach = {
      '600' => ReachFilter.new(600),
      '800' => ReachFilter.new(800),
      '1000' => ReachFilter.new(1000),
      '1200' => ReachFilter.new(1200),
    }.freeze

    Speed = {
      '3' => SpeedFilter.new(3, '<='),
      '5' => SpeedFilter.new(5, '<='),
      '20' => SpeedFilter.new(20, '>='),
      '30' => SpeedFilter.new(30, '>='),
      '40' => SpeedFilter.new(40, '>='),
    }.freeze

    Cost = {
      '4500' => CostFilter.new(4500),
      '3500' => CostFilter.new(3500),
      '2500' => CostFilter.new(2500),
      '1500' => CostFilter.new(1500),
      '1000' => CostFilter.new(1000),
      '500' => CostFilter.new(500),
      '150' => CostFilter.new(150),
      '75' => CostFilter.new(75),
    }.freeze

    Production = {
      '350' => ProductionFilter.new(350),
      '175' => ProductionFilter.new(175),
      '60' => ProductionFilter.new(60),
    }.freeze

    Aspect = {
      'backswing' => Backswing,
    }.freeze
  end
end
