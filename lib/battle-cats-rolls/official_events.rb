# frozen_string_literal: true

require_relative 'runner'

module BattleCatsRolls
  # Only authenticates an existing account; never creates accounts during updates.
  class OfficialEvents
    class Error < RuntimeError; end

    class Auth < NyankoAuth
      private

      def perform_request uri, request
        response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true,
          open_timeout: 10, read_timeout: 20) { |http| http.request(request) }
        unless response.is_a?(Net::HTTPSuccess)
          raise Error, "PONOS authentication failed (HTTP #{response.code})"
        end
        JSON.parse(response.body.force_encoding('UTF-8'))
      end
    end

    def initialize repo:, env: ENV
      # Read only these two keys, without executing shell code or changing ENV.
      path = File.join(repo, '.env')
      values = File.file?(path) ? File.readlines(path).filter_map do |line|
        match = line.match(/\A\s*(?:export\s+)?(INQUIRY_CODE|PASSWORD)\s*=\s*(.*?)\s*\z/)
        next unless match
        value = match[2]
        value = value[1...-1] if value.match?(/\A(["']).*\1\z/)
        [match[1], value]
      end.to_h : {}
      @inquiry_code = env.fetch('INQUIRY_CODE') { values['INQUIRY_CODE'] }
      @password = env.fetch('PASSWORD') { values['PASSWORD'] }
    end

    def read lang
      if @inquiry_code.to_s.empty? || @password.to_s.empty?
        raise Error, 'PONOS 인증 설정이 없습니다. INQUIRY_CODE와 PASSWORD를 환경변수 또는 비공개 .env에 설정하세요.'
      end

      runner = Runner.new(*Runner.locale(lang))
      jwt = Auth.new(@inquiry_code, @password).generate_jwt(runner.version_id)
      unless jwt.is_a?(String) && !jwt.empty?
        raise Error, 'PONOS authentication returned no JWT'
      end

      uri = URI(NyankoAuth.event_url(lang, jwt: jwt))
      request = Net::HTTP::Get.new(uri)
      request.delete('Accept-Encoding')
      response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true,
        open_timeout: 10, read_timeout: 20) { |http| http.request(request) }
      unless response.is_a?(Net::HTTPSuccess)
        raise Error, "PONOS #{lang.upcase} TSV download failed (HTTP #{response.code})"
      end
      response.body.force_encoding('UTF-8')
    rescue Error
      raise
    rescue StandardError => e
      # HTTP exceptions can include the request URL and its JWT query parameter.
      raise Error, "PONOS request failed (#{e.class}); credentials and response omitted"
    end
  end
end
