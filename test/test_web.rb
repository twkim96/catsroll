
require 'pork/auto'
require 'battle-cats-rolls/web'
require 'json'
require 'rack/mock'

describe BattleCatsRolls::Web do
  web = BattleCatsRolls::Web.new
  web.call('PATH_INFO' => '/warmup')

  define_method(:expect_status_200) do |path|
    status, _headers, _body = web.call('PATH_INFO' => path)

    expect(status).eq 200
  end

  %w[/ /cats /help /logs /seed-views].each do |path|
    would "respond 200 for #{path}" do
      expect_status_200(path)
    end
  end

  would 'respond 200 for am existing cat' do
    expect_status_200('/cats/1')
  end

  would 'respond 200 for a non-existing cat' do
    expect_status_200('/cats/9999')
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
