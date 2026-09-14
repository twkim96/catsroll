require 'pork/auto'
require 'muack'
require 'tmpdir'
require 'stringio'
require 'battle-cats-rolls/official_events'
require_relative '../bin/update-live-events'

describe BattleCatsRolls::OfficialEvents do
  include Muack::API

  would 'load private credentials and request regional TSV with a fresh JWT' do
    Dir.mktmpdir do |repo|
      File.write("#{repo}/.env", "INQUIRY_CODE='file-code'\nPASSWORD=unused\n")
      client = BattleCatsRolls::OfficialEvents.new(repo: repo,
        env: {'PASSWORD' => 'env-password'})
      auth = BattleCatsRolls::OfficialEvents::Auth.new('file-code', 'env-password')
      mock(BattleCatsRolls::OfficialEvents::Auth).new('file-code', 'env-password') { auth }
      version = BattleCatsRolls::Runner.new(*BattleCatsRolls::Runner.jp).version_id
      mock(auth).generate_jwt(version) { 'test-jwt' }
      response = Net::HTTPOK.new('1.1', '200', 'OK')
      response.instance_variable_set(:@read, true)
      response.body = "[start]\n[end]\n"
      http = Object.new
      requested = nil
      http.define_singleton_method(:request) do |request|
        requested = request
        response
      end
      mock(Net::HTTP).start('nyanko-events.ponosgames.com', 443,
        use_ssl: true, open_timeout: 10, read_timeout: 20) { |*_, &block| block.call(http) }
      expect(client.read('jp')).eq "[start]\n[end]\n"
      expect(requested.path).eq '/battlecats_production/gatya.tsv?jwt=test-jwt'
      expect(requested['Accept-Encoding']).eq nil
      Muack.verify
    end
  ensure
    Muack.reset
  end

  would 'fail clearly without credentials instead of reporting current data' do
    Dir.mktmpdir do |repo|
      client = BattleCatsRolls::OfficialEvents.new(repo: repo, env: {})
      error = begin
        client.read('kr')
        nil
      rescue BattleCatsRolls::OfficialEvents::Error => e
        e.message
      end
      expect(error.include?('INQUIRY_CODE')).eq true
    end
  end

  would 'report rejected authentication without leaking response contents' do
    auth = BattleCatsRolls::OfficialEvents::Auth.new('code', 'password')
    response = Net::HTTPUnauthorized.new('1.1', '401', 'Unauthorized')
    stub(Net::HTTP).start('nyanko-auth.ponosgames.com', 443,
      use_ssl: true, open_timeout: 10, read_timeout: 20) { response }
    error = begin
      auth.generate_jwt('150500')
      nil
    rescue BattleCatsRolls::OfficialEvents::Error => e
      e.message
    end
    expect(error).eq 'PONOS authentication failed (HTTP 401)'
  ensure
    Muack.reset
  end

  would 'redact authentication exceptions containing credentials or JWTs' do
    Dir.mktmpdir do |repo|
      client = BattleCatsRolls::OfficialEvents.new(repo: repo,
        env: {'INQUIRY_CODE' => 'secret-code', 'PASSWORD' => 'secret-password'})
      stub(BattleCatsRolls::OfficialEvents::Auth).new('secret-code', 'secret-password') do
        raise IOError, 'secret-code secret-password ?jwt=secret-jwt'
      end
      error = begin
        client.read('kr')
        nil
      rescue BattleCatsRolls::OfficialEvents::Error => e
        e.message
      end
      expect(error.include?('IOError')).eq true
      expect(error.include?('secret-')).eq false
    end
  ensure
    Muack.reset
  end

  would 'check official events without writing and then apply those same events' do
    Dir.mktmpdir do |repo|
      FileUtils.mkdir_p("#{repo}/lib/battle-cats-rolls")
      FileUtils.touch("#{repo}/lib/battle-cats-rolls/tsv_reader.rb")
      FileUtils.mkdir_p("#{repo}/build")
      build = "#{repo}/build/bc-jp.yaml"
      # Use an existing real TSV to exercise the parser and build merge together.
      tsv = File.read(File.expand_path('../data/jp/events/20260301.tsv', __dir__), encoding: 'UTF-8')
      events = BattleCatsRolls::TsvReader.new(tsv).gacha
      File.write(build, YAML.dump('events' => {}, 'gacha' => {}, 'cats' => {}))
      before = File.read(build)
      client = Object.new
      stub(client).read('jp') { tsv }
      stub(BattleCatsRolls::OfficialEvents).new(repo: repo) { client }
      previous_stdout, previous_stderr = $stdout, $stderr
      $stdout, $stderr = StringIO.new, StringIO.new

      expect(BattleCatsRolls::LiveEventsUpdater.main(['jp', '--repo', repo, '--check'])).eq 0
      expect($stdout.string.include?("JP: 업데이트 #{events.size}건")).eq true
      expect(File.read(build)).eq before
      expect(Dir.exist?("#{repo}/data")).eq false

      expect(BattleCatsRolls::LiveEventsUpdater.main(['jp', '--repo', repo])).eq 0
      saved = YAML.safe_load_file(build, permitted_classes: [Date])
      expect(saved['events']).eq events
      expect(Dir["#{repo}/data/jp/events/*.tsv"].size).eq 1
      $stdout = StringIO.new
      expect(BattleCatsRolls::LiveEventsUpdater.main(['jp', '--repo', repo, '--check'])).eq 0
      expect($stdout.string.include?('JP: 최신 버전')).eq true
    ensure
      $stdout, $stderr = previous_stdout, previous_stderr if previous_stdout
    end
  ensure
    Muack.reset
  end
end
