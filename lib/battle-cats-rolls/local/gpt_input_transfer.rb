# frozen_string_literal: true

require 'base64'
require 'json'

module BattleCatsRolls
  # Encodes a validated GPT prepare request into a private, fragment-only URL.
  module GptInputTransfer
    VERSION = 1
    MAX_JSON_BYTES = 64 * 1024
    PROTOTYPE_KEYS = %w[__proto__ prototype constructor].freeze

    module_function

    def url(origin, request)
      raise ArgumentError, 'GPT input must be an object.' unless request.is_a?(Hash)
      raise ArgumentError, 'GPT input contains an unsupported object key.' unless safe_keys?(request, {})

      json = JSON.generate(version: VERSION, arguments: request).encode(Encoding::UTF_8)
      raise ArgumentError, 'GPT input is too large to transfer (maximum 64 KiB).' if json.bytesize > MAX_JSON_BYTES

      token = Base64.urlsafe_encode64(json, padding: false)
      "#{origin.to_s.sub(%r{/+\z}, '')}/gpt#catsroll-input=#{token}"
    rescue JSON::GeneratorError, EncodingError, TypeError
      raise ArgumentError, 'GPT input could not be encoded as UTF-8 JSON.'
    end

    def safe_keys?(value, ancestors)
      return true unless value.is_a?(Hash) || value.is_a?(Array)
      return false if ancestors[value.object_id]

      ancestors[value.object_id] = true
      valid = if value.is_a?(Hash)
        value.all? do |key, nested|
          (key.is_a?(String) || key.is_a?(Symbol)) &&
            !PROTOTYPE_KEYS.include?(key.to_s) && safe_keys?(nested, ancestors)
        end
      else
        value.all? { |nested| safe_keys?(nested, ancestors) }
      end
      ancestors.delete(value.object_id)
      valid
    end
    private_class_method :safe_keys?
  end
end
