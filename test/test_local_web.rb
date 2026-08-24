
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
    expect(response.body.include?('id="multi_find_dialog"')).eq true
    expect(response.body.include?('id="multi_find_result"')).eq true
    expect(response.body.include?('id="multi_find_optimization"')).eq true
    expect(response.body.include?('id="multi_find_max_guaranteed"')).eq true
    expect(response.body.include?('id="multi_find_max_platinum"')).eq true
    expect(response.body.include?('id="multi_find_max_legend_ticket"')).eq true
    expect(response.body.include?('id="multi_find_help"')).eq true
    expect(response.body.include?('id="multi_find_help_dialog"')).eq true
    expect(response.body.include?('id="multi_plan_panel"')).eq true
    expect(response.body.include?('id="multi_plan_mode"')).eq true
    expect(response.body.include?('id="multi_plan_load"')).eq true
    expect(response.body.include?('id="multi_plan_name"')).eq true
    expect(response.body.include?('id="multi_plan_save"')).eq true
    expect(response.body.include?('id="multi_plan_selected_cats"')).eq true
    expect(response.body.include?('id="multi_plan_dialog"')).eq true
    expect(response.body.include?('id="multi_plan_confirm_dialog"')).eq true
    expect(response.body.index('id="multi_find_result"')).lt(
      response.body.index('id="multi_plan_panel"'))
    expect(response.body.index('id="multi_plan_panel"')).lt(
      response.body.index('id="multi_tables"'))
    expect(response.body.include?('검색 기준 안내')).eq true
    expect(response.body.include?('value="cost" selected>최소코스트')).eq true
    expect(response.body.include?('value="distance">최단거리')).eq true
    expect(response.body.include?('value="balance">균형')).eq true
    expect(response.body.include?('id="multi_find_title"')).eq false
    expect(response.body.include?('id="multi_find_targets" type="text" readonly')).eq true
    expect(response.body.include?('aria-label="선택한 캐릭터 필터 열기"')).eq true
    expect(response.body.index('id="multi_find_filter"')).lt(
      response.body.index('id="multi_find_optimization"'))
    expect(response.body.include?('Use ticket')).eq false
    expect(response.body.include?('1A부터 목표 캐릭터 최적 경로 계산')).eq false
    expect(response.body.include?('/asset/multi-find.js?')).eq true
    expect(response.body.include?('/asset/multi-share.js?')).eq true
    expect(response.body.include?('/asset/multi-track-virtual.js?')).eq true
    expect(response.body.include?('/asset/multi-find.css?')).eq true
    expect(response.body.include?('/asset/multi-find-engine.js?')).eq true
    expect(response.body.include?('/asset/multi-plan.js?')).eq true
    expect(response.body.include?('/asset/multi-plan.css?')).eq true
    expect(response.body.include?('/asset/table-share.js?')).eq true
    expect(response.body.include?(
      'data-html2canvas="/asset/html2canvas.min.js?1.4.1"')).eq true
    expect(response.body.include?('data-find-worker="/asset/multi-find-worker.js?')).eq true
    expect(response.body.include?('data-find-engine="/asset/multi-find-engine.js?')).eq true
    expect(response.body.include?('/asset/event-filter.css?')).eq true
    expect(response.body.include?('@media (max-width: 820px)')).eq false
    expect(response.body.include?('id="multi_share_notice"')).eq true
    expect(response.body.include?('기존 브라우저 설정은 바뀌지 않습니다')).eq true
    expect(response.body.index('multi_event_filter_selected_title')).lt(
      response.body.index('data-multi-filter-reset'))
    expect(response.body.index('data-multi-filter-reset')).lt(
      response.body.index('multi_event_filter_series_title'))

    payload = JSON.parse(response.body[/<script id="multi_track_data"[^>]*>(.*?)<\/script>/m, 1])
    expect(payload.dig('limits', 'rows')).eq 8
    event = payload.dig('regions', 'kr', 'events').find{ |item| item['series_id'] }
    expect(event['series_id']).eq(
      BattleCatsRolls::Route.ball_kr.gacha.dig(
        BattleCatsRolls::Route.ball_kr.events[event['event']]['id'], 'series_id'))
    named_event = payload.dig('regions', 'kr', 'events').find do |item|
      item['series_id'] == 6
    end
    expect(payload.dig('regions', 'kr', 'series_names', '6')).
      eq '초고대 전설의 용사 울트라 소울즈'
    expect(named_event.key?('series_name')).eq false

    find_cats = payload['find_cats']
    expect(find_cats.empty?).eq false
    expect(find_cats.all?{ |cat| [3, 4, 5].include?(cat['rarity']) }).eq true
    expect(find_cats.find{ |cat| cat['id'] == 564 }['name']).eq '아쿠아슈터 사키'

    ticket = payload.dig('regions', 'kr', 'tickets', 'platinum')
    expect(ticket['kind']).eq 'platinum'
    expect(ticket.dig('pool', 'platinum')).eq 'platinum'
    expect(ticket.dig('pool', 'rates', 'uber')).eq 10_000
    expect(ticket.dig('pool', 'rates', 'legend')).eq 0

    ball = BattleCatsRolls::Route.ball_kr
    today = Date.today
    candidates = ball.events.select{ |_, info| info['platinum'] == 'platinum' }
    active = candidates.select do |_, info|
      info['start_on'] <= today && today <= info['end_on']
    end
    started = candidates.select{ |_, info| info['start_on'] <= today }
    expected_ticket = active.max_by{ |_, info| info['start_on'] } ||
      started.max_by{ |_, info| info['start_on'] } ||
      candidates.min_by{ |_, info| info['start_on'] }
    expect(ticket['event']).eq expected_ticket.first

    legend_ticket = payload.dig('regions', 'kr', 'tickets', 'legend')
    expect(legend_ticket['kind']).eq 'legend'
    expect(legend_ticket.dig('pool', 'platinum')).eq 'legend'
    expect(legend_ticket.dig('pool', 'rates', 'uber')).eq 9_500
    expect(legend_ticket.dig('pool', 'rates', 'legend')).eq 500
    legend_candidates = ball.events.select{ |_, info| info['platinum'] == 'legend' }
    legend_active = legend_candidates.select do |_, info|
      info['start_on'] <= today && today <= info['end_on']
    end
    legend_started = legend_candidates.select do |_, info|
      info['start_on'] <= today
    end
    expected_legend_ticket = legend_active.max_by{ |_, info| info['start_on'] } ||
      legend_started.max_by{ |_, info| info['start_on'] } ||
      legend_candidates.min_by{ |_, info| info['start_on'] }
    expect(legend_ticket['event']).eq expected_legend_ticket.first
  end

  would 'load table sharing on the regular track page' do
    response = Rack::MockRequest.new(web).get('/?lang=kr')

    expect(response.status).eq 200
    expect(response.body.include?('/asset/table-share.js?')).eq true
    expect(response.body.include?(
      'data-html2canvas="/asset/html2canvas.min.js?1.4.1"')).eq true
  end

  would 'offer PNG and isolated URL sharing behind an editable row limit modal' do
    table_share = File.read('lib/battle-cats-rolls/asset/table-share.js')
    recent_seeds = File.read('lib/battle-cats-rolls/asset/recent-seeds.js')
    multi_find = File.read('lib/battle-cats-rolls/asset/multi-find.js')
    multi_track = File.read('lib/battle-cats-rolls/asset/multi-track.js')
    multi_share = File.read('lib/battle-cats-rolls/asset/multi-share.js')
    multi_plan = File.read('lib/battle-cats-rolls/asset/multi-plan.js')
    multi_plan_css = File.read('lib/battle-cats-rolls/asset/multi-plan.css')
    multi_view = File.read('lib/battle-cats-rolls/view/multi.erb')

    expect(table_share.include?('몇 번까지 포함할까요?')).eq true
    expect(table_share.include?('Find route 도착 위치')).eq true
    expect(table_share.include?('left:-100000px')).eq true
    expect(table_share.include?('trimMultiRows')).eq true
    expect(table_share.include?('open: open')).eq true
    expect(table_share.include?('data-table-share-action="save"')).eq true
    expect(table_share.include?('data-table-share-action="copy"')).eq true
    expect(table_share.include?('data-table-share-action="link"')).eq true
    expect(table_share.include?('PNG 복사')).eq true
    expect(table_share.include?('navigator.share')).eq true
    expect(table_share.include?('>취소</button>')).eq false
    expect(recent_seeds.include?('share.textContent = "공유"')).eq true
    expect(recent_seeds.include?('CatsRollTableShare.open()')).eq true
    expect(recent_seeds.include?('isSharedMultiSession()')).eq true
    expect(multi_find.include?('getDestination: function')).eq true
    expect(multi_find.include?('getShareSettings: function')).eq true
    expect(multi_find.include?('decorateRouteMarks: function')).eq true
    expect(multi_find.include?('els.targets.addEventListener("click", openFilterDialog)')).eq true
    expect(multi_find.include?('"확뽑 후 도착 · " + action.next')).eq true
    expect(multi_find.include?('MultiShareApp.setFindSettings(settings)')).eq true
    expect(multi_track.include?('getShareState: function')).eq true
    expect(multi_track.include?('outputs.length > 5')).eq true
    expect(multi_track.include?('scrollTrackPage')).eq true
    expect(multi_track.include?('data-multi-track-scroll')).eq true
    multi_virtual = File.read('lib/battle-cats-rolls/asset/multi-track-virtual.js')
    expect(multi_virtual.include?('Number(navigator.maxTouchPoints || 0) > 1')).eq true
    expect(multi_virtual.include?('return "iphone"')).eq true
    expect(multi_track.include?(
      'virtualizedAppleSafariDevices = { ipad: true, iphone: true }')).eq true
    expect(multi_track.include?('bufferChunks: 2')).eq true
    expect(multi_track.include?('multi-track:window-updated')).eq true
    expect(multi_track.include?('populateCaptureClone')).eq true
    expect(multi_track.include?('data-plan-column-index')).eq true
    expect(multi_track.include?('loadPlanState: function')).eq true
    expect(multi_track.include?('isolatedPlanSession')).eq true
    expect(multi_track.include?('MultiPlanApp.decorateMarks(copy)')).eq true
    expect(multi_track.include?('getPlanSelectedCats: function')).eq true
    expect(multi_plan.include?('battle-cats-rolls.multiPlans.v1')).eq true
    expect(multi_plan.include?('변경 내용은 플랜 저장을 누를 때만 반영됩니다')).eq true
    expect(multi_plan.include?('event.stopPropagation()')).eq true
    expect(multi_plan.include?('els.mode.checked = true')).eq true
    expect(multi_plan.include?('플랜 덮어쓰기')).eq true
    expect(multi_plan.include?('findPlanByName')).eq true
    expect(multi_plan.include?('removePlan')).eq true
    expect(multi_plan.include?('data-plan-locked')).eq true
    expect(multi_plan.include?('trackFingerprint')).eq true
    expect(multi_plan.include?('summarizeCats')).eq true
    expect(multi_plan.include?('buildRoutePlan')).eq true
    expect(multi_plan.include?('data-plan-pick-kind')).eq true
    expect(multi_plan.include?('현재 구성으로 도달 불가')).eq true
    expect(multi_plan_css.include?('.multi-plan-marked::after')).eq true
    expect(multi_plan_css.include?('.multi-plan-delete')).eq true
    expect(multi_plan_css.include?('.multi-plan-summary-output')).eq true
    expect(multi_plan_css.include?('.multi-plan-route')).eq true
    expect(multi_plan_css.include?('.multi-plan-next')).eq true
    expect(multi_plan_css.include?('.multi-plan-cell-notice')).eq true
    expect(multi_plan_css.include?('max-width: none')).eq true
    expect(table_share.include?('MultiTrackApp.getRowCount()')).eq true
    expect(multi_view.include?('.multi-track-app.is-ipad .multi-track-table th')).eq false
    expect(multi_view.include?('position: -webkit-sticky')).eq true
    expect(multi_track.include?('MultiShareApp.setTrackState')).eq true
    expect(multi_share.include?('payload.r.slice(0, 8)')).eq true
    expect(multi_share.include?('url.hash = "share=" + codec.encode(payload)')).eq true
    expect(table_share.include?('fullTableWidth')).eq true
    expect(multi_share.include?('공유 링크로 연 임시 세션')).eq false
  end

  would 'render the TSV admin controls on seed view stats' do
    response = Rack::MockRequest.new(web).get('/seed-views')

    expect(response.body.include?('KR/JP TSV 업데이트 + 배포')).eq true
    expect(response.body.include?('KR/JP TSV 업데이트 확인')).eq true
    expect(response.body.include?('/asset/seed-view-admin.js?')).eq true
    expect(response.body.include?('top: 42%')).eq true
    expect(response.body.include?('transform: translate(-50%, -50%)')).eq true
    expect(response.body.include?('/asset/table-share.js?')).eq false
  end

  would 'render the event filter modal and its reset control' do
    response = Rack::MockRequest.new(BattleCatsRolls::Server).get('/?lang=kr')
    event_filter_css = File.read('lib/battle-cats-rolls/asset/event-filter.css')

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
    expect(event_filter_css.include?('align-items: flex-start')).eq true
    expect(event_filter_css.include?(
      'padding: max(9dvh, calc((100dvh - 760px) / 2)) 0')).eq true
    expect(event_filter_css.include?('padding: 6dvh 0')).eq true
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
