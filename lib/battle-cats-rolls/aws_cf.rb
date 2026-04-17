# frozen_string_literal: true

require 'uri'
require 'json'
require 'base64'
require 'openssl'

module BattleCatsRolls
  # https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-creating-signed-url-canned-policy.html
  class AwsCf < Struct.new(:url)
    def generate expires=Time.now + 300
      "#{url}?#{URI.encode_www_form(query(expires))}"
    end

    def uri
      @uri ||= URI.parse(url)
    end

    private

    def query expires
      {
        'Key-Pair-Id' => ENV['CloudFrontKeyPairId'],
        'Expires' => expires.to_i,
        'Signature' => signature(expires)
      }
    end

    # https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-creating-signed-url-canned-policy.html#private-content-canned-policy-creating-signature
    def signature expires
      base64_encode(private_key.sign('sha1', canned_policy(expires)))
    end

    # https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-creating-signed-url-canned-policy.html#private-content-canned-policy-creating-policy-statement
    def canned_policy expires
      JSON.dump(
        'Statement' => [{
          'Resource' => url,
          'Condition' => {
            'DateLessThan' => {'AWS:EpochTime' => expires.to_i}
          }
        }])
    end

    # https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-creating-signed-url-canned-policy.html#private-content-canned-policy-creating-signature-download-procedure
    def base64_encode str
      Base64.strict_encode64(str).tr('+=/', '-_~')
    end

    def self.pem
      @pem ||= File.read(File.expand_path('../../.pem', __dir__))
    end

    def private_key
      @private_key ||= OpenSSL::PKey::RSA.new(self.class.pem)
    end
  end
end
