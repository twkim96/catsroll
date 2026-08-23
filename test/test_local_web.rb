
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

  would 'render multi as a desktop layout with collapsible found cats' do
    response = Rack::MockRequest.new(web).get('/multi?lang=kr')

    expect(response.status).eq 200
    expect(response.body.include?("setAttribute('content', 'width=1200')")).eq true
    expect(response.body.include?('id="multi_found"')).eq true
    expect(response.body.include?('id="multi_found_cats"')).eq true
    expect(response.body.include?('id="multi_event_filter_dialog"')).eq true
    expect(response.body.include?('/asset/event-filter.css?')).eq true
    expect(response.body.include?('@media (max-width: 820px)')).eq false
    expect(response.body.index('multi_event_filter_selected_title')).lt(
      response.body.index('data-multi-filter-reset'))
    expect(response.body.index('data-multi-filter-reset')).lt(
      response.body.index('multi_event_filter_series_title'))

    payload = JSON.parse(response.body[/<script id="multi_track_data"[^>]*>(.*?)<\/script>/m, 1])
    event = payload.dig('regions', 'kr', 'events').find{ |item| item['series_id'] }
    expect(event['series_id']).eq(
      BattleCatsRolls::Route.ball_kr.gacha.dig(
        BattleCatsRolls::Route.ball_kr.events[event['event']]['id'], 'series_id'))
  end

  would 'render the TSV admin controls on seed view stats' do
    response = Rack::MockRequest.new(web).get('/seed-views')

    expect(response.body.include?('KR/JP TSV 업데이트 + 배포')).eq true
    expect(response.body.include?('KR/JP TSV 업데이트 확인')).eq true
    expect(response.body.include?('/asset/seed-view-admin.js?')).eq true
    expect(response.body.include?('top: 42%')).eq true
    expect(response.body.include?('transform: translate(-50%, -50%)')).eq true
  end

  would 'render the event filter modal and its reset control' do
    response = Rack::MockRequest.new(BattleCatsRolls::Server).get('/?lang=kr')

    expect(response.status).eq 200
    expect(response.body.include?('id="event_filter_button"')).eq true
    expect(response.body.include?('id="event_filter_dialog"')).eq true
    expect(response.body.include?('data-event-filter-backdrop')).eq true
    expect(response.body.include?('data-event-filter-reset')).eq true
    expect(response.body.include?('/asset/event-filter.css?')).eq true
    expect(response.body.include?('/asset/event-filter.js?')).eq true
    expect(response.body.index('event_filter_selected_title')).lt(
      response.body.index('data-event-filter-reset'))
    expect(response.body.index('data-event-filter-reset')).lt(
      response.body.index('event_filter_series_title'))
  end

  would 'show every event from the selected series without event pagination' do
    ball = BattleCatsRolls::Route.ball_kr
    expected = ball.events.select do |_, info|
      ball.gacha.dig(info['id'], 'series_id') == 24
    end.keys.sort
    response = Rack::MockRequest.new(BattleCatsRolls::Server).get(
      '/?event_series=24&lang=kr')
    rendered = response.body.scan(/<option\s+value="(\d{4}-\d{2}-\d{2}_\d+)"/).
      flatten.sort

    expect(response.status).eq 200
    expect(rendered).eq expected
    expect(response.body.include?('name="event_series" value="24"')).eq true
    expect(response.body.include?('Customize...')).eq true
  end

  would 'combine selected event series with OR semantics' do
    ball = BattleCatsRolls::Route.ball_kr
    expected = ball.events.select do |_, info|
      [24, 28].include?(ball.gacha.dig(info['id'], 'series_id'))
    end.keys.sort
    response = Rack::MockRequest.new(BattleCatsRolls::Server).get(
      '/?event_series=24&event_series=28&lang=kr')
    rendered = response.body.scan(/<option\s+value="(\d{4}-\d{2}-\d{2}_\d+)"/).
      flatten.sort

    expect(response.status).eq 200
    expect(rendered).eq expected
  end

  would 'allow series zero without coercing invalid filters to zero' do
    ball = BattleCatsRolls::Route.ball_kr
    expected = ball.events.select do |_, info|
      ball.gacha.dig(info['id'], 'series_id') == 0
    end.keys.sort
    request = Rack::MockRequest.new(BattleCatsRolls::Server)
    response = request.get('/?event_series=invalid&event_series=0&lang=kr')
    response = request.get(response['location']) if response.redirect?
    rendered = response.body.scan(/<option\s+value="(\d{4}-\d{2}-\d{2}_\d+)"/).
      flatten.sort

    expect(response.status).eq 200
    expect(rendered).eq expected
    expect(response.body.scan(/name="event_series"/).size).eq 1
  end

  would 'serve searchable event series metadata' do
    response = Rack::MockRequest.new(BattleCatsRolls::Server).get(
      '/events.json?lang=kr&catalog=series')
    data = JSON.parse(response.body)
    series = data['series'].find{ |item| item['id'] == 24 }
    ball = BattleCatsRolls::Route.ball_kr
    expected_count = ball.events.count do |_, info|
      ball.gacha.dig(info['id'], 'series_id') == 24
    end

    expect(response.status).eq 200
    expect(series['count']).eq expected_count
    expect(series['label']).eq '강철군대 아이언워즈'
    expect(series['aliases'].any?{ |name| name.include?('곡사포대 런처즈') }).eq true
    expect(series['aliases'].any?{ |name| name.include?('좀비에 강력한') }).eq true
    expect(series['aliases'].include?('979')).eq true

    ultra_souls = data['series'].find{ |item| item['id'] == 6 }
    expect(ultra_souls['label']).eq '초고대 전설의 용사 울트라 소울즈'
    expect(ultra_souls['aliases'].any?{ |name| name.include?('냥꽃 할배') }).eq true
    expect(ultra_souls['aliases'].include?('울소')).eq true

    shortcuts = {
      1 => '다군', 3 => '갤걸', 4 => '드엠', 18 => '갓즈',
      19 => '울고축', 24 => '아워즈', 27 => '하고축', 28 => '걸몬',
      42 => '울하고축'
    }
    shortcuts.each do |series_id, shortcut|
      item = data['series'].find{ |candidate| candidate['id'] == series_id }
      expect(item['aliases'].include?(shortcut)).eq true
    end

    fallback = data['series'].find{ |item| item['id'] == 35 }
    expect(fallback['label'].empty?).eq false
    expect(fallback['aliases'].include?(fallback['label'])).eq true
  end

  would 'share the series filter with custom gacha while keeping Custom visible' do
    ball = BattleCatsRolls::Route.ball_kr
    expected = ball.gacha.select do |_, info|
      info['series_id'] == 24
    end.keys.reverse
    request = Rack::MockRequest.new(BattleCatsRolls::Server)
    response = request.get('/?event=custom&event_series=24&lang=kr')
    response = request.get(response['location']) if response.redirect?
    custom_select = response.body[/<select id="custom_select".*?<\/select>/m]
    rendered = custom_select.to_s.scan(/<option\s+value="(\d+)"/).
      flatten.map(&:to_i)

    expect(response.status).eq 200
    expect(response.body.include?('Customize...')).eq true
    expect(response.body.include?('(Select an event here)')).eq false
    expect(response.body.include?('id="custom_event_filter_button"')).eq false
    expect(rendered).eq expected
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
