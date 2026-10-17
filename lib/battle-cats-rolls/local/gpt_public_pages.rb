# frozen_string_literal: true

module BattleCatsRolls
  # Static public information pages and the OpenAI domain challenge endpoint.
  class GptPublicPages
    VIEW_ROOT = File.expand_path('../view/gpt_public', __dir__)
    PAGE_FILES = {
      '/gpt/about' => 'about.html',
      '/gpt/privacy' => 'privacy.html',
      '/gpt/terms' => 'terms.html'
    }.freeze
    CHALLENGE_PATH = '/.well-known/openai-apps-challenge'
    HTML_TYPE = 'text/html; charset=utf-8'
    CHALLENGE_TYPE = 'text/plain; charset=utf-8'

    def initialize
      layout = File.read(File.join(VIEW_ROOT, 'layout.html'), encoding: 'UTF-8')
      @pages = PAGE_FILES.each_with_object({}) do |(path, filename), pages|
        fragment = File.read(File.join(VIEW_ROOT, filename), encoding: 'UTF-8')
        pages[path] = layout.sub('<!-- CONTENT -->', fragment).freeze
      end.freeze
    end

    def call(env)
      path = env['PATH_INFO']
      return challenge_response(env) if path == CHALLENGE_PATH
      return not_found unless PAGE_FILES.key?(path)
      return not_found unless ENV['CATSROLL_GPT_PUBLIC_PAGES'] == '1'

      method = env['REQUEST_METHOD']
      return method_not_allowed unless %w[GET HEAD].include?(method)

      html_response(@pages.fetch(path), method)
    end

    private

    def challenge_response(env)
      token = ENV['CATSROLL_OPENAI_DOMAIN_CHALLENGE']
      return not_found unless valid_challenge?(token)

      method = env['REQUEST_METHOD']
      return method_not_allowed unless %w[GET HEAD].include?(method)

      body = method == 'HEAD' ? '' : token
      [200, {
        'content-type' => CHALLENGE_TYPE,
        'cache-control' => 'no-store',
        'x-content-type-options' => 'nosniff',
        'content-length' => token.bytesize.to_s
      }, [body]]
    end

    def valid_challenge?(token)
      token.is_a?(String) && !token.empty? && token.bytesize <= 4096 &&
        token.valid_encoding? && !token.match?(/\p{Cc}/)
    end

    def html_response(html, method)
      [200, {
        'content-type' => HTML_TYPE,
        'cache-control' => 'no-store',
        'x-content-type-options' => 'nosniff',
        'content-length' => html.bytesize.to_s
      }, [method == 'HEAD' ? '' : html]]
    end

    def method_not_allowed
      [405, {
        'content-type' => 'text/plain; charset=utf-8',
        'cache-control' => 'no-store',
        'x-content-type-options' => 'nosniff',
        'allow' => 'GET, HEAD'
      }, ['Method not allowed']]
    end

    def not_found
      [404, {
        'content-type' => 'text/plain; charset=utf-8',
        'cache-control' => 'no-store',
        'x-content-type-options' => 'nosniff'
      }, ['Not found']]
    end
  end
end
