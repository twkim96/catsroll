
require 'pork/auto'
require 'battle-cats-rolls/en_seed_probe'
require 'json'
require 'ostruct'
require 'tmpdir'

describe BattleCatsRolls::EnSeedProbe do
  before do
    BattleCatsRolls::EnSeedProbe.instance_variable_set(:@records, [])
  end

  def route lang
    OpenStruct.new(
      lang: lang,
      seed: 123,
      event: '2020-09-11_433',
      count: 100,
      details: nil,
      find: 0,
      last: 0,
      force_guaranteed: 0,
      no_guaranteed: nil,
      ubers: 0)
  end

  def request count: nil
    params = {'seed' => '123', 'event' => '2020-09-11_433'}
    params['count'] = count.to_s if count

    OpenStruct.new(
      params: params,
      request_method: 'GET',
      path: '/',
      fullpath: '/?seed=123&event=2020-09-11_433',
      user_agent: 'ProbeBot/1.0',
      referer: 'https://example.com/',
      env: {'HTTP_ACCEPT_LANGUAGE' => 'en-US,en;q=0.9'},
      ip: '203.0.113.10')
  end

  would 'capture and flush en seed requests as jsonl' do
    Dir.mktmpdir do |dir|
      path = "#{dir}/en_seed_probe.jsonl"

      expect(BattleCatsRolls::EnSeedProbe.capture(route('en'),
        request(count: 100), Time.utc(2026, 6, 20, 15))).eq true
      expect(BattleCatsRolls::EnSeedProbe.flush(path)).eq true

      rows = File.readlines(path).map{ |line| JSON.parse(line) }

      expect(rows.size).eq 1
      expect(rows[0]['at']).eq '2026-06-21T00:00:00+09:00'
      expect(rows[0]['seed']).eq 123
      expect(rows[0]['event']).eq '2020-09-11_433'
      expect(rows[0]['count']).eq 100
      expect(rows[0]['count_param']).eq true
      expect(rows[0]['user_agent']).eq 'ProbeBot/1.0'
      expect(rows[0]['ip_hash']).eq \
        BattleCatsRolls::EnSeedProbe.ip_hash('203.0.113.10')
    end
  end

  would 'ignore non en seed requests' do
    Dir.mktmpdir do |dir|
      path = "#{dir}/en_seed_probe.jsonl"

      expect(BattleCatsRolls::EnSeedProbe.capture(route('kr'), request)).eq false
      expect(BattleCatsRolls::EnSeedProbe.flush(path)).eq true

      expect(File.exist?(path)).eq false
    end
  end
end
