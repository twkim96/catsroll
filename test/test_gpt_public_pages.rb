require 'pork/auto'
require 'rack/mock'
require 'battle-cats-rolls/local/gpt_public_pages'

describe BattleCatsRolls::GptPublicPages do
  app = BattleCatsRolls::GptPublicPages.new
  client = Rack::MockRequest.new(app)
  page_gate = 'CATSROLL_GPT_PUBLIC_PAGES'
  challenge_key = 'CATSROLL_OPENAI_DOMAIN_CHALLENGE'

  def with_env(values)
    previous = values.each_with_object({}) { |(key, _value), memo| memo[key] = ENV[key] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous&.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end

  would 'keep the three informational pages opt-in and render factual UTF-8 HTML' do
    paths = %w[/gpt/about /gpt/privacy /gpt/terms]
    with_env(page_gate => nil) do
      paths.each { |path| expect(client.get(path).status).eq 404 }
    end

    with_env(page_gate => '1') do
      about, privacy, terms = paths.map { |path| client.get(path) }
      [about, privacy, terms].each do |response|
        expect(response.status).eq 200
        expect(response['content-type']).eq 'text/html; charset=utf-8'
        expect(response['x-content-type-options']).eq 'nosniff'
        expect(response.body.encoding).eq Encoding::UTF_8
        expect(response.body.valid_encoding?).eq true
        expect(response.body.include?('https://github.com/twkim96/catsroll/issues')).eq true
        expect(response.body.include?('<script')).eq false
        expect(response.body.include?('<link ')).eq false
      end
      expect(about.body.include?('아직 확인되지 않았습니다')).eq true
      expect(about.body.include?('사용자 기기의 메모리')).eq true
      expect(privacy.body.include?('초안')).eq true
      expect(privacy.body.include?('소유자 검토')).eq true
      expect(privacy.body.include?('보관 방침')).eq true
      expect(privacy.body.include?('비공개로 접수할 연락 방법')).eq true
      expect(terms.body.include?('초안')).eq true
      expect(terms.body.include?('정식 약관')).eq true
      expect(terms.body.include?('데이터 삭제 기한')).eq true
    end
  end

  would 'accept only exact page paths and allow GET and HEAD' do
    with_env(page_gate => '1') do
      ['/gpt/', '/gpt/about/', '/gpt/unknown', '/gpt/../../etc/passwd'].each do |path|
        expect(client.get(path).status).eq 404
      end
      response = client.post('/gpt/about')
      expect(response.status).eq 405
      expect(response['allow']).eq 'GET, HEAD'
      expect(client.get('/gpt/about?next=/etc/passwd').status).eq 200

      get = client.get('/gpt/about')
      head = client.head('/gpt/about')
      expect(head.status).eq 200
      expect(head.body).eq ''
      expect(head['content-type']).eq get['content-type']
      expect(head['content-length']).eq get.body.bytesize.to_s
    end
  end

  would 'route public information through the production middleware' do
    require 'battle-cats-rolls/server'
    server = Rack::MockRequest.new(BattleCatsRolls::Server)
    with_env(page_gate => '1', challenge_key => 'test-domain-proof') do
      expect(server.get('/gpt/privacy').status).eq 200
      expect(server.get(BattleCatsRolls::GptPublicPages::CHALLENGE_PATH).body).eq 'test-domain-proof'
    end
  end

  would 'serve the exact configured challenge independently of the page gate' do
    with_env(page_gate => nil, challenge_key => '  challenge-token  ') do
      response = client.get(BattleCatsRolls::GptPublicPages::CHALLENGE_PATH)
      expect(response.status).eq 200
      expect(response['content-type']).eq 'text/plain; charset=utf-8'
      expect(response['cache-control']).eq 'no-store'
      expect(response['x-content-type-options']).eq 'nosniff'
      expect(response.body).eq '  challenge-token  '

      head = client.head(BattleCatsRolls::GptPublicPages::CHALLENGE_PATH)
      expect(head.status).eq 200
      expect(head.body).eq ''
      expect(head['content-length']).eq '19'

      response = client.post(BattleCatsRolls::GptPublicPages::CHALLENGE_PATH)
      expect(response.status).eq 405
      expect(response['allow']).eq 'GET, HEAD'
    end
  end

  would 'hide missing, empty, controlled, and oversized challenge values' do
    invalid_values = [nil, '', "line1\r\nline2", "bad\u0001token", "bad\u0085token", 'x' * 4097]
    invalid_values.each do |token|
      with_env(challenge_key => token) do
        response = client.get(BattleCatsRolls::GptPublicPages::CHALLENGE_PATH)
        expect(response.status).eq 404
        expect(response.body.include?('challenge')).eq false
      end
    end

    with_env(challenge_key => 'x' * 4096) do
      expect(client.get(BattleCatsRolls::GptPublicPages::CHALLENGE_PATH).body.bytesize).eq 4096
    end
    with_env(challenge_key => 'proof-token') do
      expect(client.get('/.well-known/openai-apps-challenge/extra').status).eq 404
    end
  end
end
