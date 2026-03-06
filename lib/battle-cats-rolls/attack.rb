# frozen_string_literal: true

module BattleCatsRolls
  class Attack < Struct.new(
    :stat, :damage, :long_range, :long_range_offset,
    :trigger_effects, :duration, :cascade,
    keyword_init: true)

    def display_short
      triggered_effect.display_short
    end

    def area_type
      stat.area_type
    end

    def area_display
      @area_display ||= if long_range
        "#{area_range.begin} ~ #{area_range.end}"
      else
        area_range.end.to_s
      end
    end

    def area_range
      @area_range ||= if long_range
        reach = long_range + long_range_offset
        from, to = [long_range, reach].sort
        from..to
      else
        -stat.width..stat.range
      end
    end

    def effects
      @effects ||= if trigger_effects?
        stat.effects
      else
        []
      end
    end

    def display_effects
      @display_effects ||= if trigger_effects?
        effects.map(&:name)
      else
        '-'
      end
    end

    def dps
      @dps ||= if stat.kamikaze?
        '-'
      elsif stat.attack_cycle
        raw_dps = (damage.to_f / stat.attack_cycle) * Stat::FPS

        if stat.dps_no_critical
          raw_dps
        else
          account_critical(raw_dps)
        end
      end
    end

    private

    def trigger_effects?
      # Older cats with single attack might not be marked with triggering
      # effects, but they do according to the game. For example,
      # Apple Cat (id=40) has no trigger effects but it does trigger effect!
      trigger_effects == 1 || stat.single_damage?
    end

    def critical_effects
      @critical_effects ||= effects.select do |eff|
        case eff
        when Ability::CriticalStrike, Ability::SavageBlow
          true
        end
      end
    end

    def account_critical raw_dps
      critical_effects.inject(raw_dps) do |result, critical|
        result *
          (1 + (critical.modifier / 100.0) * (critical.chance / 100.0))
      end
    end
  end

  class TriggeredAttack < Attack
    def triggered_effect
      raise NotImplementedError
    end

    def area_type
      'Area' # Wave, Surge, and Explosion are all area attack
    end

    def damage
      if triggered_effect.mini
        (super * mini_damage_multiplier).round
      else
        super
      end
    end

    def dps
      @dps ||= if stat.kamikaze?
        super
      elsif stat.attack_cycle
        account_chance(super)
      end
    end

    def effects
      @effects ||= super.reject do |eff|
        case eff
        when Ability::Wave, Ability::Surge, Ability::Explosion
          true
        end
      end
    end

    private

    def account_chance raw_dps
      raw_dps * triggered_effect.chance / 100.0
    end

    def mini_damage_multiplier
      0.2
    end
  end

  class WaveAttack < TriggeredAttack
    def triggered_effect
      stat.wave_effect
    end

    def area_display
      @area_display ||= area_range.end.to_s # Display this in a simple way
    end

    def area_range
      @area_range ||= self.begin..self.begin + width +
        wave_step * (triggered_effect.level - 1)
    end

    private

    def wave_step
      (width * next_position_multiplier).round
    end

    def width
      400
    end

    def begin
      -67
    end

    def next_position_multiplier
      0.5
    end
  end

  class SurgeAttack < TriggeredAttack
    def triggered_effect
      stat.surge_effect
    end

    def area_display
      "#{area_range.begin} ~ #{area_range.end}"
    end

    def area_range
      @area_range ||= begin
        range = triggered_effect.area_range
        (range.begin - backward)..(range.end + forward)
      end
    end

    private

    def forward
      125
    end

    def backward
      250
    end
  end

  class ExplosionAttack < TriggeredAttack
    def triggered_effect
      stat.explosion_effect
    end

    def display_short
      if cascade
        "Cascade of #{triggered_effect.name.downcase}"
      else
        triggered_effect.display_short
      end
    end

    def area_display
      @area_display ||= if cascade
        "~#{area_range.end}"
      else
        "#{area_range.begin} ~ #{area_range.end}"
      end
    end

    def area_range
      @area_range ||= begin
        start = triggered_effect.start
        (start - backward)..(start + forward)
      end
    end

    def to_a
      attrs = to_h
      [
        self,
        self.class.new(attrs.merge({damage: (damage * 0.7).floor, cascade: 1})),
        self.class.new(attrs.merge({damage: (damage * 0.4).floor, cascade: 2})),
      ]
    end

    private

    def forward
      75 + cascade.to_i * 100
    end

    def backward
      75 + cascade.to_i * 100
    end
  end
end
