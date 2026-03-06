# frozen_string_literal: true

require 'uri'
require 'net/http'
require 'openssl'
require 'json'

module BattleCatsRolls
  class NyankoAuth < Struct.new(:inquiry_code, :password)
    def self.event_url lang,
      file: 'gatya.tsv',
      jwt: '',
      base_uri: 'https://nyanko-events.ponosgames.com',
      kind: '_production'
      case lang
      when 'jp'
        "#{base_uri}/battlecats#{kind}/#{file}?jwt=#{jwt}"
      when 'en', 'tw', 'kr'
        "#{base_uri}/battlecats#{lang}#{kind}/#{file}?jwt=#{jwt}"
      else
        raise "Unknown language: #{lang}"
      end
    end

    def self.request url
      uri = URI.parse(url)
      get = Net::HTTP::Get.new(uri)

      # Workaround for weird server cache bug?
      get.delete('Accept-Encoding')

      http = Net::HTTP.new(uri.hostname, uri.port)
      http.use_ssl = true if uri.scheme == 'https'
      http.response_body_encoding = 'UTF-8'
      # http.set_debug_output($stdout)
      http.request(get).body
    end

    def generate_inquiry_code
      uri = URI.parse('https://nyanko-backups.ponosgames.com/?action=createAccount&referenceId=')
      request = Net::HTTP::Get.new(uri)

      perform_request(uri, request).dig('accountId')
    end

    def generate_password
      post('https://nyanko-auth.ponosgames.com/v1/users') do
        {'accountCreatedAt' => timestamp}
      end.dig('payload', 'password')
    end

    def generate_jwt version_id
      post('https://nyanko-auth.ponosgames.com/v1/tokens') do
        {
          'clientInfo' => {
            'client' => {'countryCode' => 'en', 'version' => version_id},
            'device' => {'model' => model},
            'os' => {'type' => 'android', 'version' => '12.0.0'}
          },
          'password' => password
        }
      end.dig('payload', 'token')
    end

    def post url
      uri = URI.parse(url)
      payload = JSON.dump(base_payload.merge(yield))
      request = Net::HTTP::Post.new(uri, generate_headers(payload))
      request.body = payload
      request.content_type = 'application/json'

      perform_request(uri, request)
    end

    def inquiry_code
      super || self.inquiry_code = ENV['INQUIRY_CODE']
    end

    def password
      super || self.password = ENV['PASSWORD']
    end

    def generate_headers payload
      {
        'Nyanko-Signature' => generate_signature(payload),
        'Nyanko-Signature-Version' => '1',
        'Nyanko-Signature-Algorithm' => 'HMACSHA256',
        'Nyanko-Timestamp' => timestamp.to_s,
        'User-Agent' => user_agent
      }
    end

    def base_payload
      @base_payload ||= {
        'accountCode' => inquiry_code,
        'nonce' => nonce
      }
    end

    private

    def perform_request uri, request
      response =
        Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|
          http.request(request)
        end

      JSON.parse(response.body.force_encoding('UTF-8'))
    end

    def generate_signature payload
      signature_prefix +
        hmac_sha256hex(inquiry_code + signature_prefix, payload)
    end

    def timestamp
      @timestamp ||= Time.now.to_i
    end

    def user_agent
      # https://user-agents.net/applications/dalvik/versions/2-1
      'Dalvik/2.1.0 (Linux; U; Android 12; moto e22 Build/SOVS32.121-40-2)'
    end

    def model
      'moto e22'
    end

    def signature_prefix
      @signature_prefix ||= random_hex(32)
    end

    def nonce
      @nonce ||= random_hex(16)
    end

    def random_hex bytes
      Random.urandom(bytes).unpack1('H*')
    end

    def hmac_sha256hex key, data
      OpenSSL::HMAC.hexdigest('sha256', key, data)
    end
  end
end
