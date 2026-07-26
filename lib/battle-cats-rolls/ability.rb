# frozen_string_literal: true

module BattleCatsRolls
  module AbilityUtility
    class EffectDuration < Struct.new(:chance, :duration)
      include AbilityUtility

      def display(values=nil, **)
        sprintf('%{chance} for %{duration}', values || display_values(**))
      end

      def specialized = true
      def effects = true

      private

      def display_values(**)
        {chance: percent(chance),
         duration: seconds_with_treasure(**)}
      end
    end

    def qualified_name
      "ability.#{name}"
    end

    def qualified_value_name
      qualified_name.downcase
    end

    private

    def seconds_with_treasure(view: view, **)
      max_time = (duration * treasure_multiplier).floor
      without = view.stat_time(duration)
      with = view.stat_time(max_time)

      "#{without} or #{highlight(with, view: view, **)}"
    end

    def seconds(view: view, **)
      strong(view.stat_time(duration))
    end

    def percent_highlight(integer, **)
      highlight(percent(integer), **)
    end

    def percent integer
      strong("#{integer}%")
    end

    def highlight text, view:, stat: nil
      result = strong(text)

      if stat
        view.stat_augmented(stat, qualified_value_name, result)
      else
        result
      end
    end

    def strong text
      "<strong>#{text}</strong>"
    end

    def treasure_multiplier
      1.2
    end

    def range_multiplier
      0.25
    end
  end

  class Ability
    class Specialization < Struct.new(:enemies)
      include AbilityUtility

      List = %w[
        red float black angel alien zombie aku relic white metal
      ].freeze

      def self.display list
        (List & list).map(&:capitalize)
      end

      def self.build_if_available stat
        enemies = List.filter_map do |type|
          stat["against_#{type}"] && type.capitalize
        end

        new(enemies) if enemies.any?
      end

      def name
        'Specialized to'
      end

      def display(**)
        enemies
      end

      def specialized = true
      def effects = false
      def index = __LINE__
    end

    class AgainstOnly
      include AbilityUtility

      def self.build_if_available stat
        new if stat['against_only']
      end

      def name
        'Attack only'
      end

      def display(**)
        "Only attack specialized enemies or enemy base.<br>\nWhen cursed, only attack the base." # rubocop:disable Layout/LineLength
      end

      def specialized = true
      def effects = false
      def index = __LINE__
    end

    class Strong
      include AbilityUtility

      def self.build_if_available stat
        new if stat['strong']
      end

      def name
        'Strong'
      end

      def display(**)
        'Deal 150% or 180% damage and take 50% or 40% damage'
      end

      def specialized = true
      def effects = false
      def index = __LINE__
    end

    class MassiveDamage
      include AbilityUtility

      def self.build_if_available stat
        new if stat['massive_damage']
      end

      def name
        'Massive damage'
      end

      def display(**)
        'Deal 300% or 400% damage'
      end

      def specialized = true
      def effects = false
      def index = __LINE__
    end

    class InsaneDamage
      include AbilityUtility

      def self.build_if_available stat
        new if stat['insane_damage']
      end

      def name
        'Insane damage'
      end

      def display(**)
        'Deal 500% or 600% damage'
      end

      def specialized = true
      def effects = false
      def index = __LINE__
    end

    class Resistant
      include AbilityUtility

      def self.build_if_available stat
        new if stat['resistant']
      end

      def name
        'Resistant'
      end

      def display(**)
        'Take 25% or 20% damage'
      end

      def specialized = true
      def effects = false
      def index = __LINE__
    end

    class InsaneResistant
      include AbilityUtility

      def self.build_if_available stat
        new if stat['insane_resistant']
      end

      def name
        'Insane resistant'
      end

      def display(**)
        'Take 16% or 14% damage'
      end

      def specialized = true
      def effects = false
      def index = __LINE__
    end

    class Knockback < Struct.new(:chance)
      include AbilityUtility

      def self.build_if_available stat
        new(stat['knockback_chance']) if stat['knockback_chance']
      end

      def name
        'Knockback'
      end

      def display(**)
        percent_highlight(chance, **)
      end

      def specialized = true
      def effects = true
      def index = __LINE__
    end

    class Freeze < AbilityUtility::EffectDuration
      include AbilityUtility

      def self.build_if_available stat
        if stat['freeze_chance']
          new(*stat.values_at('freeze_chance', 'freeze_duration'))
        end
      end

      def name
        'Freeze'
      end

      def index = __LINE__
    end

    class Slow < AbilityUtility::EffectDuration
      def self.build_if_available stat
        if stat['slow_chance']
          new(*stat.values_at('slow_chance', 'slow_duration'))
        end
      end

      def name
        'Slow'
      end

      def index = __LINE__
    end

    class Weaken < Struct.new(:chance, :duration, :multiplier)
      include AbilityUtility

      def self.build_if_available stat
        if stat['weaken_chance']
          new(*stat.values_at(
            'weaken_chance', 'weaken_duration', 'weaken_multiplier'))
        end
      end

      def name
        'Weaken'
      end

      def display(values=nil, **)
        sprintf(
          '%{chance} to reduce enemies damage to %{multiplier} for %{duration}',
          values || display_values(**))
      end

      def specialized = true
      def effects = true
      def index = __LINE__

      private

      def display_values(**)
        {chance: percent(chance), multiplier: percent(multiplier),
         duration: seconds_with_treasure(**)}
      end
    end

    class Curse < AbilityUtility::EffectDuration
      def self.build_if_available stat
        if stat['curse_chance']
          new(*stat.values_at('curse_chance', 'curse_duration'))
        end
      end

      def name
        'Curse'
      end

      def display(values=nil, **)
        sprintf(
          '%{chance} to invalidate specialization for %{duration}',
          values || display_values(**))
      end

      def index = __LINE__
    end

    class Dodge < Struct.new(:chance, :duration)
      include AbilityUtility

      def self.build_if_available stat
        if stat['dodge_chance']
          new(*stat.values_at('dodge_chance', 'dodge_duration'))
        end
      end

      def name
        'Dodge'
      end

      def display(values=nil, **)
        sprintf(
          '%{chance} to become invulnerable when hit for %{duration}',
          values || display_values(**))
      end

      def specialized = true
      def effects = false
      def index = __LINE__

      private

      def display_values(**)
        {chance: percent(chance),
         duration: seconds_with_treasure(**)}
      end
    end

    class Survive < Struct.new(:chance)
      include AbilityUtility

      def self.build_if_available stat
        new(stat['survive_chance']) if stat['survive_chance']
      end

      def name
        'Survive'
      end

      def display(**)
        sprintf(
          '%{chance} to survive a lethal strike to be knocked back with 1 health', # rubocop:disable Layout/LineLength
          display_values(**))
      end

      def specialized = false
      def effects = false
      def index = __LINE__

      private

      def display_values(**)
        {chance: percent_highlight(chance, **)}
      end
    end

    class Strengthen < Struct.new(:threshold, :modifier)
      include AbilityUtility

      def self.build_if_available stat
        if stat['strengthen_threshold']
          new(*stat.values_at('strengthen_threshold', 'strengthen_modifier'))
        end
      end

      def name
        'Strengthen'
      end

      def display(values=nil, **)
        sprintf(
          'Deal %{multiplier} damage when health reached %{threshold}',
          values || display_values(**))
      end

      def specialized = false
      def effects = false
      def index = __LINE__

      private

      def display_values(**)
        {multiplier: percent_highlight(modifier + 100, **),
         threshold: percent(threshold)}
      end
    end

    class SavageBlow < Struct.new(:chance, :modifier)
      include AbilityUtility

      def self.build_if_available stat
        if stat['savage_blow_chance']
          new(*stat.values_at('savage_blow_chance', 'savage_blow_modifier'))
        end
      end

      def name
        'Savage blow'
      end

      def display(values=nil, **)
        sprintf(
          '%{chance} to deal %{multiplier} damage',
          values || display_values(**)
        )
      end

      def specialized = false
      def effects = true
      def index = __LINE__

      private

      def display_values(**)
        {chance: percent_highlight(chance, **),
         multiplier: percent(modifier + 100)}
      end
    end

    class CriticalStrike < Struct.new(:chance)
      include AbilityUtility

      def self.build_if_available stat
        new(stat['critical_chance']) if stat['critical_chance']
      end

      def name
        'Critical strike'
      end

      def display(**)
        percentage = percent_highlight(chance, **)

        "#{percentage} to deal 200% damage and ignore metal effect"
      end

      def modifier
        100
      end

      def specialized = false
      def effects = true
      def index = __LINE__
    end

    class MetalKiller < Struct.new(:percentage)
      include AbilityUtility

      def self.build_if_available stat
        new(stat['metal_killer']) if stat['metal_killer']
      end

      def name
        'Metal killer'
      end

      def display(**)
        "Deal #{percent(percentage)} health to metal enemies"
      end

      def specialized = false
      def effects = true
      def index = __LINE__
    end

    class BreakBarrier < Struct.new(:chance)
      include AbilityUtility

      def self.build_if_available stat
        new(stat['break_barrier_chance']) if stat['break_barrier_chance']
      end

      def name
        'Break barrier'
      end

      def display(**)
        percentage = percent_highlight(chance, **)

        "#{percentage} to break star alien barrier"
      end

      def specialized = false
      def effects = true
      def index = __LINE__
    end

    class BreakShield < Struct.new(:chance)
      include AbilityUtility

      def self.build_if_available stat
        new(stat['break_shield_chance']) if stat['break_shield_chance']
      end

      def name
        'Break shield'
      end

      def display(**)
        percentage = percent_highlight(chance, **)

        "#{percentage} to break aku shield"
      end

      def specialized = false
      def effects = true
      def index = __LINE__
    end

    class ZombieKiller
      include AbilityUtility

      def self.build_if_available stat
        new if stat['zombie_killer']
      end

      def name
        'Zombie killer'
      end

      def display(**)
        'Final blow prevents zombies from reviving'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class SoulStrike
      include AbilityUtility

      def self.build_if_available stat
        new if stat['soul_strike']
      end

      def name
        'Soul strike'
      end

      def display(**)
        'It can attack zombie corpses'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class BaseDestroyer
      include AbilityUtility

      def self.build_if_available stat
        new if stat['base_destroyer']
      end

      def name
        'Base destroyer'
      end

      def display(**)
        'Deal 400% damage to enemy base'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class ColossusSlayer
      include AbilityUtility

      def self.build_if_available stat
        new if stat['colossus_slayer']
      end

      def name
        'Colossus slayer'
      end

      def display(**)
        'Deal 160% damage to and take 70% damage from colossus'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class SageSlayer
      include AbilityUtility

      def self.build_if_available stat
        new if stat['sage_slayer']
      end

      def name
        'Sage slayer'
      end

      def display(**)
        'Deal 120% damage, take 50% damage, trigger 100% effects for sages'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class WitchSlayer
      include AbilityUtility

      def self.build_if_available stat
        new if stat['witch_slayer']
      end

      def name
        'Witch slayer'
      end

      def display(**)
        'Deal 500% damage to and take 10% damage from witches'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class EvaAngelSlayer
      include AbilityUtility

      def self.build_if_available stat
        new if stat['eva_angel_slayer']
      end

      def name
        'Eva angel slayer'
      end

      def display(**)
        'Deal 500% damage to and take 20% damage from eva angels'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class BehemothSlayer < Struct.new(:chance, :duration)
      include AbilityUtility

      def self.build_if_available stat
        if stat['behemoth_slayer']
          new(*stat.values_at(
            'behemoth_dodge_chance', 'behemoth_dodge_duration'))
        end
      end

      def name
        'Behemoth slayer'
      end

      def display(values=nil, **)
        sprintf(
          'Deal 250%% and take 60%% damage, and %{chance} to be immune for %{duration}', # rubocop:disable Layout/LineLength
          values || display_values(**))
      end

      def specialized = false
      def effects = false
      def index = __LINE__

      private

      def display_values(**)
        {chance: percent(chance), duration: seconds(**)}
      end
    end

    class Conjure < Struct.new(:cat_id, :cat_info)
      include AbilityUtility

      def self.build_if_available stat
        new(stat['conjure'], stat['conjure_info']) if stat['conjure']
      end

      def name
        'Conjure'
      end

      def display(view:, **)
        if cat_info
          href = view.route.uri_to_cat(Cat.new(id: cat_id))
          %Q{<a href="#{href}">#{cat_info.dig('desc', 0)}</a>}
        else
          'Unknown spirit'
        end
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class Wave < Struct.new(:chance, :level, :mini)
      include AbilityUtility

      def self.build_if_available stat
        if stat['wave_level']
          new(
            stat['wave_chance'] || stat['wave_mini'],
            stat['wave_level'],
            !!stat['wave_mini'])
        end
      end

      def name
        if mini
          'Mini-wave'
        else
          'Wave'
        end
      end

      def display(values=nil, **)
        sprintf(
          "%{chance} to produce level %{level} #{name.downcase} attack",
          values || display_values(**))
      end

      def display_short(**)
        "#{percent(chance)} #{name.downcase}"
      end

      def specialized = false
      def effects = true
      def index = __LINE__

      private

      def display_values(**)
        {chance: percent(chance), level: strong(level)}
      end
    end

    class Surge < Struct.new(
      :chance, :level, :range, :range_offset, :mini)
      include AbilityUtility

      def self.build_if_available stat
        if stat['surge_level']
          new(
            stat['surge_chance'] || stat['surge_mini'],
            stat['surge_level'],
            stat['surge_range'],
            stat['surge_range_offset'],
            !!stat['surge_mini'])
        end
      end

      def name
        if mini
          'Mini-surge'
        else
          'Surge'
        end
      end

      def display(values=nil, **)
        # rubocop:disable Style/StringLiterals
        sprintf(
          "%{chance} to produce level %{level}" \
            " #{name.downcase} attack within %{area}",
          values || display_values(**))
        # rubocop:enable Style/StringLiterals
      end

      def display_short(**)
        "#{percent(chance)} #{name.downcase}"
      end

      def area_range
        @area_range ||= start..reach
      end

      def specialized = false
      def effects = true
      def index = __LINE__

      private

      def display_values(view:, **)
        area = "#{area_range.begin} ~ #{area_range.end}"

        {chance: percent(chance), level: highlight(level, view: view),
         area: highlight(view.stat_range(area), view: view)}
      end

      def start
        (range * range_multiplier).floor
      end

      def reach
        start + (range_offset * range_multiplier).floor
      end
    end

    class CounterSurge
      include AbilityUtility

      def self.build_if_available stat
        new if stat['counter_surge']
      end

      def name
        'Counter-surge'
      end

      def display(**)
        'Spawn the same surge with self damage and effects when hit by a surge'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class Explosion < Struct.new(:chance, :range, :mini)
      include AbilityUtility

      def self.build_if_available stat
        if stat['explosion_chance']
          new(*stat.values_at('explosion_chance', 'explosion_range'))
        end
      end

      def name
        'Explosion'
      end

      def display(values=nil, **)
        sprintf(
          "%{chance} to trigger #{name.downcase} attack at %{range}",
          values || display_values(**))
      end

      def display_short(**)
        "#{percent(chance)} #{name.downcase}"
      end

      def start
        (range * range_multiplier).floor
      end

      def specialized = false
      def effects = true
      def index = __LINE__

      private

      def display_values(view:, **)
        {chance: percent(chance),
         range: strong(view.stat_range(start))}
      end
    end

    class ExtraMoney
      include AbilityUtility

      def self.build_if_available stat
        new if stat['extra_money']
      end

      def name
        'Extra money'
      end

      def display(**)
        'Get double money from defeating enemies'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class Metallic
      include AbilityUtility

      def self.build_if_available stat
        new if stat['metallic']
      end

      def name
        'Metallic'
      end

      def display(**)
        'Take only 1 damage except from critical strikes'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class Kamikaze
      include AbilityUtility

      def self.build_if_available stat
        new if stat['kamikaze']
      end

      def name
        'Kamikaze'
      end

      def display(**)
        'It dies from its own attack'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class Immunity < Struct.new(:immunity)
      include AbilityUtility

      List = %w[
        bosswave knockback warp freeze slow weaken curse
        wave surge explosion toxic
      ].freeze

      def self.build_if_available stat
        immunity = List.filter_map do |effect|
          stat["immune_#{effect}"] && effect.capitalize
        end

        new(immunity) if immunity.any?
      end

      def name
        'Immune to'
      end

      def display(**)
        immunity
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    class BlockWave
      include AbilityUtility

      def self.build_if_available stat
        new if stat['block_wave']
      end

      def name
        'Block wave'
      end

      def display(**)
        'Immune to and block wave from reaching further'
      end

      def specialized = false
      def effects = false
      def index = __LINE__
    end

    def self.build stat
      constants.filter_map do |ability|
        const_get(ability, false).build_if_available(stat)
      end
    end

    def self.build_if_available stat; end
    def specialized = false
    def effects = false
    def index = __LINE__
  end
end
