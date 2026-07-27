# frozen_string_literal: true

require_relative 'root'

require 'digest'
require 'json'
require 'net/http'
require 'open3'
require 'rack/utils'
require 'rbconfig'
require 'uri'

module BattleCatsRolls
  class LiveEventsAdmin
    class Busy < RuntimeError; end
    class ConfigurationError < RuntimeError; end

    LANGS = %w[kr jp].freeze
    DEFAULT_REPOSITORY = 'twkim96/catsroll'
    DEFAULT_WORKFLOW = 'update-live-events.yml'
    API_VERSION = '2022-11-28'
    Lock = Mutex.new

    class << self
      def configured?
        !password.empty? && !github_token.empty?
      end

      def authorized? candidate
        return false if password.empty?

        Rack::Utils.secure_compare(
          secure_digest(candidate.to_s), secure_digest(password))
      end

      def check
        synchronize do
          output, status = Open3.capture2e(
            {'LANG' => 'en_US.UTF-8', 'LC_ALL' => 'en_US.UTF-8'},
            RbConfig.ruby, File.join(Root, 'bin', 'update-live-events.rb'),
            *LANGS, '--check', chdir: Root)
          results = output.scan(/^\[result\] (KR|JP): (.+)$/).to_h
          valid_results = results.values.all? do |result|
            result == '최신 버전' || /\A업데이트 \d+건\z/.match?(result)
          end

          unless status.success? && results.keys.sort == %w[JP KR] && valid_results
            raise RuntimeError, check_error(output, status.exitstatus)
          end
          update_count = results.values.sum do |result|
            result[/\A업데이트 (\d+)건\z/, 1].to_i
          end

          {
            ok: true,
            action: 'check',
            update_available: update_count.positive?,
            update_count: update_count,
            message: LANGS.map{ |lang| "#{lang.upcase}: #{results.fetch(lang.upcase)}" }.
              join(' / ')
          }
        end
      end

      def dispatch
        synchronize do
          validate_dispatch_configuration!
          uri = dispatch_uri
          req = Net::HTTP::Post.new(uri)
          req['Accept'] = 'application/vnd.github+json'
          req['Authorization'] = "Bearer #{github_token}"
          req['X-GitHub-Api-Version'] = API_VERSION
          req['User-Agent'] = 'catsroll-live-events-admin/1.0'
          req['Content-Type'] = 'application/json'
          req.body = JSON.dump(ref: 'main')

          response = Net::HTTP.start(uri.hostname, uri.port,
            use_ssl: true, open_timeout: 10, read_timeout: 20) do |http|
            http.request(req)
          end

          unless response.code == '204'
            message = JSON.parse(response.body).fetch('message', response.message)
            raise RuntimeError, "GitHub workflow request failed: #{message}"
          end

          {
            ok: true,
            action: 'deploy',
            message: 'KR/JP 업데이트와 HF 배포를 요청했습니다.',
            workflow_url: workflow_url
          }
        end
      end

      private

      def synchronize
        raise Busy, '다른 TSV 작업이 진행 중입니다.' unless Lock.try_lock

        begin
          yield
        ensure
          Lock.unlock
        end
      end

      def secure_digest value
        Digest::SHA256.hexdigest(value)
      end

      def password
        ENV['TSV_ADMIN_PASSWORD'].to_s
      end

      def github_token
        ENV['TSV_ADMIN_GITHUB_TOKEN'].to_s
      end

      def repository
        ENV.fetch('TSV_ADMIN_GITHUB_REPOSITORY', DEFAULT_REPOSITORY)
      end

      def workflow
        ENV.fetch('TSV_ADMIN_GITHUB_WORKFLOW', DEFAULT_WORKFLOW)
      end

      def validate_dispatch_configuration!
        raise ConfigurationError, 'TSV 관리자 암호가 설정되지 않았습니다.' if password.empty?
        if github_token.empty?
          raise ConfigurationError, 'GitHub workflow token이 설정되지 않았습니다.'
        end
        unless /\A[\w.-]+\/[\w.-]+\z/.match?(repository)
          raise ConfigurationError, 'GitHub repository 설정이 올바르지 않습니다.'
        end
        unless /\A[\w.-]+\.ya?ml\z/.match?(workflow)
          raise ConfigurationError, 'GitHub workflow 설정이 올바르지 않습니다.'
        end
      end

      def dispatch_uri
        URI("https://api.github.com/repos/#{repository}/actions/workflows/" \
          "#{workflow}/dispatches")
      end

      def workflow_url
        "https://github.com/#{repository}/actions/workflows/#{workflow}"
      end

      def check_error output, exitstatus
        detail = output.lines.grep(/^\[error\]/).last&.strip
        detail || "TSV 확인 명령이 종료 코드 #{exitstatus}로 실패했습니다."
      end
    end
  end
end
