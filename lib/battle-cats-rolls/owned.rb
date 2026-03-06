# frozen_string_literal: true

require 'zlib'
require 'base64'

module BattleCatsRolls
  module Owned
    DIGITS =
      ('0'..'9').to_a.
        concat(('a'..'z').to_a).
        concat(('A'..'Z').to_a).
        freeze

    module_function

    def encode cat_ids
      if cat_ids.empty?
        ''
      else
        int = cat_ids.uniq.inject(0) do |result, id|
          result + 2 ** id
        end

        to_radix(int)
      end
    end

    def decode code
      int = from_radix(code)

      return [] if int.zero?

      (0..Math.log2(int).floor).inject([]) do |result, id|
        result << id if int[id] == 1
        result
      end
    end

    def encode_old cat_ids
      Base64.urlsafe_encode64(deflate(cat_ids.join(',')))
    end

    def decode_old base64
      return [] if base64.empty?

      inflate(Base64.urlsafe_decode64(base64)).split(',').map(&:to_i)
    rescue Zlib::Error
      []
    end

    # private

    def deflate bytes
      Zlib::Deflate.deflate(bytes, Zlib::BEST_COMPRESSION)
    end

    def inflate bytes
      Zlib::Inflate.inflate(bytes)
    end

    def to_radix int, digits=DIGITS
      to_digits(int, digits).map(&digits.method(:[])).join
    end

    def from_radix str, digits=DIGITS
      str.each_char.reverse_each.with_index.inject(0) do |result, (digit, index)|
        result + digits.index(digit) * digits.size ** index
      end
    end

    def to_digits int, digits
      quotient, remainder = int.divmod(digits.size)

      if quotient < digits.size
        [quotient, remainder]
      else
        to_digits(quotient, digits) << remainder
      end
    end
  end
end
