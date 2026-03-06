# frozen_string_literal: true

require 'stringio'

module BattleCatsRolls
  class CatsBuilder < Struct.new(:provider, :preserved_gacha)
    def cats
      @cats ||= Hash[build_cats.sort]
    end

    def gacha
      @gacha ||= store_gacha(provider.gacha)
    end

    def cat_data
      @cat_data ||= store_cat_data(provider.res)
    end

    def cat_stats
      @cat_stats ||= store_cat_stats(provider.units)
    end

    def attack_animation
      @attack_animation ||= store_attack_animation(provider.attack_maanims)
    end

    def unitbuy
      @unitbuy ||= store_unitbuy(provider.unitbuy)
    end

    def unitlevel
      @unitlevel ||= store_unitlevel(provider.unitlevel)
    end

    def unitforms
      @unitforms ||= store_unitforms(provider.picture_book_data)
    end

    def skills
      @skills ||= store_skills(provider.skill_acquisition)
    end

    def == rhs
      cats == rhs.cats && gacha == rhs.gacha
    end

    private

    def build_cats
      ids = cat_data.keys
      cat_data.merge(unitbuy.slice(*ids)) do |id, data, buy|
        data.merge(buy)
      end.merge(unitlevel.slice(*ids)) do |id, data, level|
        growth = level.take((data['max_level'] / 10.0).ceil).map(&:to_i)
        data['growth'] = growth
        data
      end.merge(skills.slice(*ids)) do |id, data, skill|
        data.merge(skill)
      end
    end

    def store_gacha data
      data.each_line.with_index.inject({}) do |result, (line, index)|
        if line =~ /\A\d+/
          slots = line.split(',')
          id = slots.pop until slots.empty? || id&.start_with?('-1')
          result[index] = {'cats' => slots.map { |s| Integer(s) + 1 }}
        elsif preserved = preserved_gacha[index]
          result[index] = preserved
        end

        result
      end
    end

    def store_unitbuy data
      data.each_line.with_index.inject({}) do |result, (line, index)|
        id = index + 1
        row = line.split(',')
        result[id] = {
          'rarity' => Integer(row[13]),
          'max_level' => Integer(row[50]) + Integer(row[51])
        }
        result
      end
    end

    def store_unitforms data
      data.each_line.with_index.inject({}) do |result, (line, index)|
        id = index + 1
        row = line.split(',')
        result[id] = Integer(row[2])
        result
      end
    end

    def store_unitlevel data
      data.each_line.with_index.inject({}) do |result, (line, index)|
        id = index + 1
        result[id] = line.split(',')
        result
      end
    end

    def store_skills data
      rows = data.each_line.map{ |line| line.rstrip.split(',') }
      names = rows.first
      rows.drop(1).inject({}) do |result, values|
        named_data = Hash[names.zip(values)].transform_values(&:to_i)
        result[named_data['ID'].succ] = {
          'talent_against' => transform_against(named_data['typeID']),
          'talent' => transform_skills(named_data)
        }.compact
        result
      end
    end

    def transform_against type_bits
      result = talent_against.select.with_index do |_, index|
        type_bits & (2 ** index) > 0
      end

      result if result.any?
    end

    def transform_skills named_data
      group_skills(named_data).inject({}) do |result, skill|
        result[talent_types.fetch(skill['abilityID'])] = {
          'max_level' => skill['MAXLv'],
          'minmax' => skill['minmax'],
          'ultra' => skill['limit']
        }.compact

        result
      end
    end

    def group_skills named_data
      ('A'..'H').inject([]) do |result, letter|
        skill = group_skills_letter(letter, named_data)

        compact_skill(skill)

        result << skill if skill['abilityID']
        result
      end
    end

    def group_skills_letter letter, named_data
      named_data.inject({}) do |result, (key, value)|
        suffix = "_#{letter}"

        if key.end_with?(suffix) # regular fields
          result[key.delete_suffix(suffix)] = value
        elsif match = key.match(/#{suffix}(\d)\z/) # min and max fields
          index = match[1].to_i - 1
          (result[key.delete_suffix(match[0])] ||= [])[index] = value
        end

        result
      end
    end

    def compact_skill skill
      minmax = skill.delete('min').zip(skill.delete('max'))
      skill['minmax'] = minmax - [[0, 0]]
      skill.delete_if do |key, value|
        case value
        when Array
          value.empty?
        else
          case key
          when 'MAXLv'
            value <= 1
          else
            value <= 0
          end
        end
      end
    end

    def store_cat_data res
      res.inject({}) do |result, (filename, data)|
        separator_char =
          if filename.end_with?('_ja.csv')
            ','
          else
            '|'
          end
        separator = Regexp.escape(separator_char)
        # String#strip doesn't remove \u00a0
        strip = lambda do |str|
          str.sub(/\A\p{whitespace}+/, '').sub(/\p{whitespace}+\z/, '')
        end

        names = data.scan(/^(?:[^#{separator}]+)/).map(&strip).
          delete_if(&:empty?)
        descs = data.scan(/(?=#{separator}).+$/).
          map{ |s| strip[s.tr(separator_char, "\n").squeeze(' ')] }.
          delete_if(&:empty?)
        id = Integer(filename[/\d+/])

        # Cat 765 in non-JP doesn't have a name. We give a fake one for it
        names = ["(#{id}?)"] if names.empty? && descs.any?

        if names.any? && descs.any?
          # Cat 78 in TW has 3rd form but not indicated by unitforms
          # Here we try to use the number of animations to capture that
          size = [unitforms[id], attack_animation[id]&.size || 0].max

          result[id] = {
            'name' => names.first(size),
            'desc' => descs.first(size),
            'stat' => cat_stats[id].first(size)
          }
        end

        result
      end
    end

    def store_cat_stats units
      result = units.transform_values do |csv|
        csv.each_line.filter_map do |line|
          fields = stat_fields
          values = line.split(',').values_at(*fields.values)

          if values.any?
            stat = Hash[fields.each_key.map(&:to_s).zip(values)].
              delete_if do |name, value|
                !/\A\-?\d+/.match?(value) || value.start_with?('0')
              end.transform_values(&:to_i)

            if stat['conjure']
              stat['conjure'] += 1
              stat.delete('conjure') if stat['conjure'] == 0
            end

            %w[wave surge].each do |type|
              mini = "#{type}_mini"
              stat[mini] = stat.delete("#{type}_chance") if stat[mini]
            end

            stat
          end
        end
      end

      attach_attack_duration(result)
    end

    def attach_attack_duration result
      result.each do |id, cat_stats|
        cat_stats.each.with_index do |stat, index|
          if attack_duration = attack_animation.dig(id, index)
            stat.merge!('attack_duration' => attack_duration)
          end
        end
      end
    end

    def stat_fields
      @stat_fields ||= {
        health: 0, knockbacks: 1, speed: 2, cost: 6, production_cooldown: 7,
        attack_cooldown: 4, range: 5, width: 9, area_effect: 12,
        damage_0: 3, long_range_0: 44, long_range_offset_0: 45,
        attack_time_0: 13, trigger_effects_0: 63,
        damage_1: 59, long_range_1: 100, long_range_offset_1: 101,
        attack_time_1: 61, trigger_effects_1: 64,
        damage_2: 60, long_range_2: 103, long_range_offset_2: 104,
        attack_time_2: 62, trigger_effects_2: 65,
        against_red: 10, against_float: 16, against_black: 17,
        against_angel: 20, against_alien: 21, against_zombie: 22,
        against_aku: 96, against_relic: 78,
        against_white: 19, against_metal: 18,
        against_only: 32,
        strong: 23, massive_damage: 30, insane_damage: 81,
        resistant: 29, insane_resistant: 80,
        knockback_chance: 24,
        freeze_chance: 25, freeze_duration: 26,
        slow_chance: 27, slow_duration: 28,
        weaken_chance: 37, weaken_duration: 38, weaken_multiplier: 39,
        curse_chance: 92, curse_duration: 93,
        dodge_chance: 84, dodge_duration: 85,
        survive_chance: 42, strengthen_threshold: 40, strengthen_modifier: 41,
        savage_blow_chance: 82, savage_blow_modifier: 83,
        critical_chance: 31, metal_killer: 112,
        break_barrier_chance: 70, break_shield_chance: 95,
        zombie_killer: 52, soul_strike: 98, base_destroyer: 34,
        colossus_slayer: 97, sage_slayer: 111,
        witch_slayer: 53, eva_angel_slayer: 77,
        behemoth_slayer: 105,
        behemoth_dodge_chance: 106, behemoth_dodge_duration: 107,
        conjure: 110,
        wave_chance: 35, wave_level: 36, wave_mini: 94,
        surge_chance: 86, surge_level: 89, surge_mini: 108,
        surge_range: 87, surge_range_offset: 88, counter_surge: 109,
        explosion_chance: 113, explosion_range: 114,
        extra_money: 33, metallic: 43, kamikaze: 58,
        immune_bosswave: 56,
        immune_knockback: 48, immune_warp: 75,
        immune_freeze: 49, immune_slow: 50,
        immune_weaken: 51, immune_curse: 79,
        immune_wave: 46, block_wave: 47,
        immune_surge: 91, immune_explosion: 116,
        immune_toxic: 90,
        # unused
        warp_chance: 71, warp_duration: 72,
        warp_range: 73, warp_range_offset: 74,
      }
    end

    def talent_against
      @talent_against ||= %w[
        red float black metal angel alien zombie relic white eva witch aku
      ]
    end

    def talent_types
      @talent_types ||= {
        32 => 'increase_health', 31 => 'increase_damage',
        27 => 'increase_speed',
        25 => 'reduce_cost', 26 => 'reduce_production_cooldown',
        61 => 'reduce_attack_cooldown',
        33 => 'against_red', 34 => 'against_float', 35 => 'against_black',
        37 => 'against_angel', 38 => 'against_alien', 39 => 'against_zombie',
        57 => 'against_aku', 40 => 'against_relic',
        41 => 'against_white', 36 => 'against_metal',
        4 => 'against_only',
        5 => 'strong', 7 => 'massive_damage', 6 => 'resistant',
        8 => 'knockback', 2 => 'freeze', 3 => 'slow',
        1 => 'weaken', 60 => 'curse', 51 => 'dodge',
        11 => 'survive', 10 => 'strengthen',
        50 => 'savage_blow', 13 => 'critical_strike',
        15 => 'break_barrier', 58 => 'break_shield',
        14 => 'zombie_killer', 59 => 'soul_strike', 12 => 'base_destroyer',
        63 => 'colossus_slayer', 66 => 'sage_slayer', 64 => 'behemoth_slayer',
        17 => 'wave', 62 => 'wave_mini', 56 => 'surge', 65 => 'surge_mini',
        67 => 'explosion',
        16 => 'extra_money',
        47 => 'immune_knockback', 49 => 'immune_warp',
        45 => 'immune_freeze', 46 => 'immune_slow',
        44 => 'immune_weaken', 29 => 'immune_curse',
        48 => 'immune_wave', 55 => 'immune_surge', 53 => 'immune_toxic',
        21 => 'resistant_knockback',
        19 => 'resistant_freeze', 20 => 'resistant_slow',
        18 => 'resistant_weaken', 30 => 'resistant_curse',
        22 => 'resistant_wave', 54 => 'resistant_surge',
        52 => 'resistant_toxic',
        # unused
        28 => 'increase_knockbacks', 9 => 'warp', 24 => 'resistant_warp',
        42 => 'witch_slayer', 43 => 'eva_angel_slayer',
      }
    end

    def store_attack_animation attack_maanims
      attack_maanims.transform_values do |maanims|
        maanims.map(&method(:calculate_duration))
      end
    end

    def calculate_duration maanim
      return unless maanim

      stream = StringIO.new(maanim)
      stream.readline
      stream.readline
      stream.readline.to_i.times.filter_map do
        times = read_int(stream, 2).abs
        size = stream.readline.to_i

        next if size <= 0

        first_frame = read_int(stream)
        (size - 2).times{ stream.readline }
        last_frame = read_int(stream) if size > 1

        min, max = [first_frame, last_frame || first_frame].sort

        [max - min, times, min]
      end.inject(0) do |result, (delta, times, offset)|
        value = delta * times

        if offset < 0
          [result, value]
        else
          [result, value + offset]
        end.max
      end
    end

    def read_int stream, index=0
      stream.readline.split(',')[index].to_i
    end
  end
end
