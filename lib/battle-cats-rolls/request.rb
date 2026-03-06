# frozen_string_literal: true

require 'rack'

module BattleCatsRolls
  class Request < Rack::Request
    # So that t=1&t=2 can be parsed as {"t" => [1, 2]}
    def parse_query(qs, d='&')
      query_parser.parse_query(qs, d)
    end

    # So that t=1&t=2 can be parsed as {"t" => [1, 2]}
    # This removes the normalization and reuse parse_query code
    def expand_param_pairs(pairs, query_parser = query_parser())
      params = query_parser.make_params

      pairs.each do |(k, v)|
        if cur = params[k]
          if cur.class == Array
            params[k] << v
          else
            params[k] = [cur, v]
          end
        else
          params[k] = v
        end
      end

      return params.to_h
    end

    # Rack doesn't memoize this
    def params
      @params ||= super
    end

    def params_coercion key, coercion
      params_coercion_with_nil(key, coercion).public_send(coercion)
    end

    def params_coercion_with_nil key, coercion
      case value = params[key]
      when Array
        value.last
      else
        value
      end&.public_send(coercion)
    end

    # Returning nil rather than false so Hash#compact can remove it
    # See Route#cleanup_query
    def params_coercion_true_or_nil key
      /\S+/.match?(params_coercion_with_nil(key, :to_s)) || nil
    end
  end
end
