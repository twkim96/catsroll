
require 'pork/auto'
require 'battle-cats-rolls/server'
require 'json'
require 'rack/mock'
require 'muack'

describe 'local web features' do
  include Muack::API

  web = BattleCatsRolls::Web.new
  web.call('PATH_INFO' => '/warmup')

  %w[/seed-views /multi].each do |path|
    would "respond 200 for #{path}" do
      response = Rack::MockRequest.new(web).get(path)
      expect(response.status).eq 200
    end
  end

  would 'render the TSV admin controls on seed view stats' do
    response = Rack::MockRequest.new(web).get('/seed-views')

    expect(response.body.include?('KR/JP TSV 업데이트 + 배포')).eq true
    expect(response.body.include?('KR/JP TSV 업데이트 확인')).eq true
    expect(response.body.include?('/asset/seed-view-admin.js?')).eq true
    expect(response.body.include?('top: 42%')).eq true
    expect(response.body.include?('transform: translate(-50%, -50%)')).eq true
  end

  would 'reject an invalid TSV admin password' do
    previous = ENV['TSV_ADMIN_PASSWORD']
    ENV['TSV_ADMIN_PASSWORD'] = 'correct-password'
    response = Rack::MockRequest.new(web).post('/seed-views/admin',
      'REMOTE_ADDR' => '192.0.2.10',
      input: 'action=check&password=wrong-password',
      'CONTENT_TYPE' => 'application/x-www-form-urlencoded')
    data = JSON.parse(response.body)

    expect(response.status).eq 401
    expect(data['ok']).eq false
  ensure
    ENV['TSV_ADMIN_PASSWORD'] = previous
  end

  would 'run an authorized TSV update check' do
    previous = ENV['TSV_ADMIN_PASSWORD']
    ENV['TSV_ADMIN_PASSWORD'] = 'correct-password'
    result = {
      ok: true,
      action: 'check',
      update_available: true,
      update_count: 2,
      message: 'KR: 최신 버전 / JP: 업데이트 2건'
    }
    stub(BattleCatsRolls::LiveEventsAdmin).check{ result }
    response = Rack::MockRequest.new(web).post('/seed-views/admin',
      'REMOTE_ADDR' => '192.0.2.11',
      input: 'action=check&password=correct-password',
      'CONTENT_TYPE' => 'application/x-www-form-urlencoded')

    expect(response.status).eq 200
    expect(JSON.parse(response.body)).eq(JSON.parse(JSON.dump(result)))
  ensure
    ENV['TSV_ADMIN_PASSWORD'] = previous
    Muack.reset
  end

  would 'skip expanded track result when unsupported' do
    event = BattleCatsRolls::Route.ball_en.events.keys.first
    response = Rack::MockRequest.new(web).get(
      "/expand/result?event=#{event}&rarity_seed=1&slot_seed=2")
    data = JSON.parse(response.body)

    expect(response.status).eq 200
    expect(data['supported']).eq false
    expect(data['available']).eq false
  end

  would 'skip expanded events when unsupported' do
    response = Rack::MockRequest.new(web).get('/expand/events?lang=jp')
    data = JSON.parse(response.body)

    expect(response.status).eq 200
    expect(data['supported']).eq false
    expect(data['lang']).eq 'jp'
    expect(data['events']).eq []
  end
end
