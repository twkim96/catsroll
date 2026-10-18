# frozen_string_literal: true

module BattleCatsRolls
  module GptValidation
    def self.object!(value, message)
      raise GptMcp::InvalidInput, message unless value.is_a?(Hash)
    end

    def integer(value, label, min, max)
      raise GptMcp::InvalidInput, "#{label}: expected integer #{min}..#{max}" unless value.is_a?(Integer) && (min..max).cover?(value)

      value
    end

    def boolean(value, label)
      raise GptMcp::InvalidInput, "#{label}: expected boolean" unless value == true || value == false

      value
    end
  end
end
