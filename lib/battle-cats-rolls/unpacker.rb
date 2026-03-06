# frozen_string_literal: true

require 'openssl'
require 'digest/md5'

module BattleCatsRolls
  class Unpacker < Struct.new(
    :ecb_key,
    :cbc_key, :cbc_iv,
    :cipher_mode, :bad_data, keyword_init: true)
    def self.for_list
      new(
        cipher_mode: :ecb, # list files are always encrypted in ecb
        ecb_key: Digest::MD5.hexdigest('pack')[0, 16])
    end

    def self.for_pack lang
      new(
        # pack files are encrypted in ecb earlier then changed to cbc
        cbc_key: [ENV["#{lang.upcase}_KEY"]].pack('H*'),
        cbc_iv: [ENV["#{lang.upcase}_IV"]].pack('H*'),
        ecb_key: Digest::MD5.hexdigest('battlecats')[0, 16])
    end

    def self.for_text
      TextUnpacker.new
    end

    def decrypt data, png: false, mode: cipher_mode
      if mode
        safe_decrypt(data, png: png, mode: mode)
      else
        # we try cbc first because newer pack files are in cbc
        %i[cbc ecb text].lazy.filter_map do |mode|
          safe_decrypt(data, png: png, mode: mode)
        end.first
      end
    end

    private

    def safe_decrypt data, png:, mode:
      self.bad_data = nil
      result = __send__("decrypt_aes_128_#{mode}", data)
      if (png && verify_png(result)) || verify_text(result)
        self.cipher_mode = mode
        result
      end
    rescue OpenSSL::Cipher::CipherError, ArgumentError => e
      self.bad_data = e
      nil
    end

    def verify_png result
      if result.start_with?("\x89PNG".b)
        result
      else
        raise ArgumentError.new('Decrypted data not PNG')
      end
    end

    def verify_text result
      result.force_encoding('UTF-8')
      if result.valid_encoding?
        result
      else
        raise ArgumentError.new('Decrypted text not valid UTF-8')
      end
    end

    def decrypt_aes_128_cbc data
      cipher = OpenSSL::Cipher.new('aes-128-cbc')
      cipher.decrypt
      cipher.key = cbc_key
      cipher.iv = cbc_iv
      cipher.update(data) + cipher.final
    end

    def decrypt_aes_128_ecb data
      cipher = OpenSSL::Cipher.new('aes-128-ecb')
      cipher.decrypt
      cipher.key = ecb_key
      cipher.update(data) + cipher.final
    end

    def decrypt_aes_128_text data
      data.force_encoding('UTF-8')
    end
  end
end
