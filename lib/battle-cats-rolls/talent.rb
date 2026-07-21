# frozen_string_literal: true

require_relative 'ability'

module BattleCatsRolls
  module TalentUtility
    include AbilityUtility

    def values_range values, suffix: '', show: :itself.to_proc
      result = values.uniq
      first_value = "#{show.call(result.first)}#{suffix}"

      if result.size > 1
        last_value = "#{show.call(result.last)}#{suffix}"
        "#{first_value} ~ #{strong(last_value)}"
      else
        strong(first_value)
      end
    end
  end

  class Talent < Struct.new(:key, :data, :ability)
    class IncreaseHealth < Talent
      include TalentUtility

      def name
        'Increase'
      end

      def display
        "#{strong('Health')} by #{min}% ~ #{percent(max)} by #{level} levels"
      end

      def augment_module
        talent = self
        Module.new do
          define_method(:health_raw) do
            super() * (1 + (talent.max / 100.0))
          end
        end
      end

      def augment_attributes
        [:health]
      end
    end

    class IncreaseDamage < Talent
      include TalentUtility

      def name
        'Increase'
      end

      def display
        "#{strong('Damage')} by #{min}% ~ #{percent(max)} by #{level} levels"
      end

      def augment_module
        talent = self
        Module.new do
          define_method(:damage_raw) do |n=0|
            result = super(n)
            result * (1 + (talent.max / 100.0)) if result
          end
        end
      end

      def augment_attributes
        [:damage, :dps] # rubocop:disable Style/SymbolArray
      end
    end

    class IncreaseSpeed < Talent
      include TalentUtility

      def name
        'Increase'
      end

      def display
        show = yield.method(:stat_speed)

        "#{strong('Speed')} by" \
          " #{show[min]} ~ #{strong(show[max])} by #{level} levels"
      end

      def augment_module
        talent = self
        Module.new do
          define_method(:speed) do
            super() + talent.max
          end
        end
      end

      def augment_attributes
        [:speed]
      end
    end

    class ReduceCost < Talent
      include TalentUtility

      def name
        'Reduce'
      end

      def display
        "#{strong('Cost')} by #{min} ~ #{strong(max)} by #{level} levels"
      end

      def augment_module
        talent = self
        Module.new do
          define_method(:production_cost) do
            super() - talent.max
          end
        end
      end

      def augment_attributes
        [:production_cost]
      end

      def min
        (super * chapter2_cost_multiplier).round
      end

      def max
        (super * chapter2_cost_multiplier).round
      end

      private

      def chapter2_cost_multiplier
        1.5
      end
    end

    class ReduceProductionCooldown < Talent
      include TalentUtility

      def name
        'Reduce'
      end

      def display
        values = values_range(data.dig('minmax', 0),
          show: yield.method(:stat_time))

        "#{strong('Production cooldown')} by #{values} by #{level} levels"
      end

      def augment_module
        talent = self
        Module.new do
          define_method(:production_cooldown) do
            super() - talent.max
          end
        end
      end

      def augment_attributes
        [:production_cooldown]
      end
    end

    class ReduceAttackCooldown < Talent
      include TalentUtility

      def name
        'Reduce'
      end

      def display
        values = values_range(data.dig('minmax', 0), suffix: '%')

        "#{strong('Attack cooldown')} by #{values} by #{level} levels"
      end

      def augment_module
        talent = self
        Module.new do
          define_method(:attack_cooldown) do
            (super() * (100 - talent.max)) / 100
          end
        end
      end

      def augment_attributes
        [:attack_cooldown, :dps] # rubocop:disable Style/SymbolArray
      end
    end

    class Specialization < Talent
      def initialize(...)
        super
        self.ability ||= Ability::Specialization.new(
          [key.delete_prefix('against_').capitalize])
      end

      def augment stat
        super

        if target = stat.abilities.find{ _1.kind_of?(Ability::Specialization) }
          target.enemies.concat(ability.enemies)
          capitalized_list = Ability::Specialization::List.map(&:capitalize)
          target.enemies.sort_by!(&capitalized_list.method(:index))
        else
          stat.abilities << ability
        end
      end

      def augment_attributes
        ability.enemies
      end
    end

    Ability::Specialization::List.each do |type|
      const_set("Against#{type.capitalize}", Specialization)
    end

    class Standalone < Talent
      def augment stat
        super

        stat.abilities << ability
      end

      def augment_attributes
        [name]
      end
    end

    class Strong < Standalone
      def initialize(...)
        super
        self.ability = Ability::Strong.new
      end
    end

    class Resistant < Standalone
      def initialize(...)
        super
        self.ability = Ability::Resistant.new
      end
    end

    class MassiveDamage < Standalone
      def initialize(...)
        super
        self.ability = Ability::MassiveDamage.new
      end
    end

    class EffectRate < Talent
      include TalentUtility

      def display
        values = values_range(data.dig('minmax', 0), suffix: '%')

        "Improve rate by #{values} by #{level} levels"
      end

      def augment_ability_module stat
        Module.new do
          define_method(:highlight) do |view, text|
            view.stat_augmented(stat, name.downcase, super(view, text))
          end
        end
      end

      def augment stat
        super

        if target = stat.abilities.find{ _1.kind_of?(ability.class) }
          target.chance += ability.chance
          target.singleton_class.prepend(augment_ability_module(stat))
          stat.augment_attribute(self, name.downcase)
        else
          stat.abilities << ability
          stat.augment_attribute(self, name)
        end
      end
    end

    class Knockback < EffectRate
      def initialize(...)
        super
        self.ability = Ability::Knockback.new(data.dig('minmax', 0, 1))
      end
    end

    class EffectDuration < Talent
      include TalentUtility

      def display(...)
        if data['minmax'].size > 1
          display_full(...)
        else
          display_improve(...)
        end
      end

      private

      def display_full
        chance = data.dig('minmax', 0)
        duration = data.dig('minmax', 1)
        stat_time = yield.method(:stat_time)

        display_text = ability.display(
          chance: values_range(chance, suffix: '%'),
          duration: values_range(duration, show: stat_time))

        "#{display_text} by #{level} levels"
      end

      def display_improve
        values = values_range(data.dig('minmax', 0),
          show: yield.method(:stat_time))

        "Improve duration by #{values} by #{level} levels"
      end
    end

    class Freeze < EffectDuration
      def initialize(...)
        super
        self.ability = Ability::Freeze.new
      end
    end

    class Slow < EffectDuration
      def initialize(...)
        super
        self.ability = Ability::Slow.new
      end
    end

    class Weaken < EffectDuration
      include TalentUtility

      def initialize(...)
        super
        self.ability = Ability::Weaken.new
      end

      private

      def display_full
        chance = data.dig('minmax', 0)
        duration = data.dig('minmax', 1)
        multiplier = data.dig('minmax', 2)
        stat_time = yield.method(:stat_time)

        display_text = ability.display(
          chance: values_range(chance, suffix: '%'),
          duration: values_range(duration, show: stat_time),
          multiplier: values_range(multiplier, suffix: '%'))

        "#{display_text} by #{level} levels"
      end
    end

    class Curse < EffectDuration
      def initialize(...)
        super
        self.ability = Ability::Curse.new
      end
    end

    class Dodge < EffectDuration
      def initialize(...)
        super
        self.ability = Ability::Dodge.new
      end

      private

      def display_improve
        values = values_range(data.dig('minmax', 0), suffix: '%')

        if level
          "Improve rate by #{values} by #{level} levels"
        else
          "Improve rate by #{values}"
        end
      end
    end

    class Survive < EffectRate
      def initialize(...)
        super
        self.ability = Ability::Survive.new(data.dig('minmax', 0, 1))
      end
    end

    class Strengthen < Talent
      include TalentUtility

      def initialize(...)
        super
        self.ability = Ability::Strengthen.new
      end

      def display
        if data['minmax'].size > 1
          display_full
        else
          display_improve
        end
      end

      private

      def display_full
        threshold = data.dig('minmax', 0).map{ |p| 100 - p }
        multiplier = data.dig('minmax', 1).map{ |p| p + 100 }

        display_text = ability.display(
          threshold: values_range(threshold, suffix: '%'),
          multiplier: values_range(multiplier, suffix: '%'))

        "#{display_text} by #{level} levels"
      end

      def display_improve
        values = values_range(data.dig('minmax', 0), suffix: '%')

        "Improve damage by #{values} by #{level} levels"
      end
    end

    class SavageBlow < EffectRate
      def initialize(...)
        super
        self.ability = Ability::SavageBlow.new(*data['minmax'].transpose.last)
      end
    end

    class CriticalStrike < EffectRate
      def initialize(...)
        super
        self.ability = Ability::CriticalStrike.new(data.dig('minmax', 0, 1))
      end

      def display(...)
        if level
          super
        else
          ability.display(...)
        end
      end
    end

    class BreakBarrier < EffectRate
      def initialize(...)
        super
        self.ability = Ability::BreakBarrier.new(data.dig('minmax', 0, 1))
      end
    end

    class BreakShield < EffectRate
      def initialize(...)
        super
        self.ability = Ability::BreakShield.new(data.dig('minmax', 0, 1))
      end
    end

    class ZombieKiller < Talent
      def initialize(...)
        super
        self.ability = Ability::ZombieKiller.new
      end
    end

    class SoulStrike < Talent
      def initialize(...)
        super
        self.ability = Ability::SoulStrike.new
      end
    end

    class BaseDestroyer < Talent
      def initialize(...)
        super
        self.ability = Ability::BaseDestroyer.new
      end
    end

    class ColossusSlayer < Talent
      def initialize(...)
        super
        self.ability = Ability::ColossusSlayer.new
      end
    end

    class SageSlayer < Talent
      def initialize(...)
        super
        self.ability = Ability::SageSlayer.new
      end
    end

    class BehemothSlayer < Talent
      include TalentUtility

      def initialize(...)
        super
        self.ability = Ability::BehemothSlayer.new
      end

      def display
        chance = data.dig('minmax', 0)
        duration = data.dig('minmax', 1)
        stat_time = yield.method(:stat_time)

        ability.display(
          chance: values_range(chance, suffix: '%'),
          duration: values_range(duration, show: stat_time))
      end
    end

    class Wave < Talent
      include TalentUtility

      def initialize(...)
        super
        self.ability = Ability::Wave.new
      end

      def display
        chance = data.dig('minmax', 0)
        wave_level = data.dig('minmax', 1)

        display_text = ability.display(
          chance: values_range(chance, suffix: '%'),
          level: values_range(wave_level))

        "#{display_text} by #{level} levels"
      end
    end

    class WaveMini < Wave
      def initialize(...)
        super
        ability.mini = true
      end
    end

    class Surge < Talent
      include TalentUtility

      def initialize(...)
        super
        self.ability = Ability::Surge.new
      end

      def display
        chance = data.dig('minmax', 0)
        surge_level = data.dig('minmax', 1)
        start = data.dig('minmax', 2).
          map{ |r| (r * range_multiplier).floor }
        reach = data.dig('minmax', 3).
          map.with_index{ |r, i| (r * range_multiplier).floor + start[i] }
        area = "#{values_range(start)} ~ #{values_range(reach)}"

        display_text = ability.display(
          chance: values_range(chance, suffix: '%'),
          level: values_range(surge_level),
          area: yield.method(:stat_range)[area])

        "#{display_text} by #{level} levels"
      end
    end

    class SurgeMini < Surge
      def initialize(...)
        super
        ability.mini = true
      end
    end

    class CounterSurge < Talent
      def initialize(...)
        super
        self.ability = Ability::CounterSurge.new
      end
    end

    class Explosion < Talent
      include TalentUtility

      def initialize(...)
        super
        self.ability = Ability::Explosion.new
      end

      def name
        'Explosion'
      end

      def display
        chance = data.dig('minmax', 0)
        range = data.dig('minmax', 1).
          map{ |r| (r * range_multiplier).floor }

        display_text = ability.display(
          chance: values_range(chance, suffix: '%'),
          range: yield.method(:stat_range)[values_range(range)])

        "#{display_text} by #{level} levels"
      end
    end

    class ExtraMoney < Talent
      def initialize(...)
        super
        self.ability = Ability::ExtraMoney.new
      end
    end

    class Immunity < Talent
      def initialize(...)
        super
        self.ability = Ability::Immunity.new(
          [key.delete_prefix('immune_').capitalize])
      end
    end

    Ability::Immunity::List.each do |type|
      const_set("Immune#{type.capitalize}", Immunity)
    end

    class Resistance < Talent
      include TalentUtility

      def self.set_constants types
        types.each do |type|
          Talent.const_set("Resistant#{type.capitalize}", self)
        end
      end

      def name
        'Resistance'
      end

      def display
        values = values_range(data.dig('minmax', 0), suffix: '%')

        "Reduce #{strong(type)} #{kind} by #{values} by #{level} levels"
      end

      private

      def type
        key[/([a-z]+)\z/, 1]
      end

      def kind
        self.class.name[/([A-Z][a-z]+)\z/, 1].downcase
      end
    end

    class ResistanceDistance < Resistance
      set_constants(%w[knockback])
    end

    class ResistanceDuration < Resistance
      set_constants(%w[freeze slow weaken curse])
    end

    class ResistanceDamage < Resistance
      set_constants(%w[wave surge toxic])
    end

    def self.build info
      return [] unless info['talent']

      info['talent'].map do |key, data|
        const_get(constant_name(key), false).new(key, data)
      end
    end

    def self.constant_name key
      key.gsub(/(?:^|_)(\w)/) do |letter|
        letter[-1].upcase
      end
    end

    def augment stat
      stat.singleton_class.prepend(augment_module) if augment_module

      augment_attributes.each do |attribute|
        stat.augment_attribute(self, attribute)
      end
    end

    def augment_module
    end

    def augment_attributes
      []
    end

    def name
      ability.name
    end

    def display
      ability.display
    end

    def level
      data.dig('max_level') # rubocop:disable Style/SingleArgumentDig
    end

    def ultra?
      !!data.dig('ultra') # rubocop:disable Style/SingleArgumentDig
    end

    def min n=0
      data.dig('minmax', n, 0)
    end

    def max n=0
      data.dig('minmax', n, 1)
    end
  end
end
