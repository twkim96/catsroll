require 'pork/auto'
require 'battle-cats-rolls/server'
require 'json'
require 'rack/mock'

describe 'Catsroll MCP device-computation adapter' do
  BattleCatsRolls::Web.new.call('PATH_INFO' => '/warmup')
  mcp = BattleCatsRolls::GptMcp.new
  client = Rack::MockRequest.new(mcp)

  def rpc(client, method, params = {}, headers = {}, path: '/mcp')
    previous = ENV['CATSROLL_GPT_ENABLED']
    ENV['CATSROLL_GPT_ENABLED'] = '1'
    response = client.post(path, {'CONTENT_TYPE' => 'application/json',
      input: JSON.generate(jsonrpc: '2.0', id: 1, method: method, params: params)}.merge(headers))
    [response, JSON.parse(response.body)]
  ensure
    ENV['CATSROLL_GPT_ENABLED'] = previous
  end

  def call_tool(client, name, args)
    rpc(client, 'tools/call', {name: name, arguments: args}).last.fetch('result')
  end

  would 'stay opt-in and reject cross-origin or oversized requests' do
    previous = ENV.delete('CATSROLL_GPT_ENABLED')
    expect(client.post('/mcp').status).eq 404
    ENV['CATSROLL_GPT_ENABLED'] = '1'
    expect(client.post('/mcp', 'HTTP_ORIGIN' => 'https://untrusted.example').status).eq 403
    expect(client.post('/mcp', 'CONTENT_TYPE' => 'application/json', input: ' ' * 65_537).status).eq 413
    expect(client.get('/mcp').status).eq 405
    ENV['CATSROLL_GPT_ENABLED'] = previous
  end

  would 'negotiate MCP and keep errors and notifications protocol-shaped' do
    response, body = rpc(client, 'initialize', {protocolVersion: '2025-06-18'})
    expect(response.status).eq 200
    expect(body.dig('result', 'protocolVersion')).eq '2025-06-18'
    expect(body.dig('result', 'capabilities', 'tools')).eq({})
    expect(body.dig('result', 'instructions').include?('does NOT compute')).eq true
    expect(body.dig('result', 'instructions').include?('For a shared result, use information already present in context first')).eq true
    expect(body.dig('result', 'instructions').include?('call catsroll_result only for missing or omitted details')).eq true
    expect(body.dig('result', 'instructions').include?('Do not search banners unless the user requests a new banner')).eq true
    claude = rpc(Rack::MockRequest.new(BattleCatsRolls::GptMcp.new(ui_host: :claude)),
      'initialize', {}, path: '/mcp/claude').last.dig('result', 'instructions')
    expect(claude.include?('For a shared result, use information already present in context first')).eq true
    expect(claude.include?('call catsroll_result only for missing or omitted details')).eq true
    expect(claude.include?('Do not search banners unless the user requests a new banner')).eq true
    _, body = rpc(client, 'ping', {}, {'HTTP_MCP_PROTOCOL_VERSION' => 'bad'})
    expect(body['error']).eq 'Unsupported MCP protocol version'
    previous = ENV['CATSROLL_GPT_ENABLED']
    ENV['CATSROLL_GPT_ENABLED'] = '1'
    response = client.post('/mcp', 'CONTENT_TYPE' => 'application/json',
      input: JSON.generate(jsonrpc: '2.0', method: 'notifications/initialized'))
    expect(response.status).eq 202
    expect(response.body).eq ''
    ENV['CATSROLL_GPT_ENABLED'] = previous
  end

  would 'search public catalogs with pagination and exact banner IDs' do
    result = call_tool(client, 'catsroll_events', {lang: 'kr', query: '2026-02-13_1042'})
    event = result.fetch('structuredContent').fetch('events').first
    expect(event.fetch('event')).eq '2026-02-13_1042'
    expected_name = BattleCatsRolls::TrackApi.multi_events(BattleCatsRolls::Route.ball_kr).
      find { |item| item[:event] == event.fetch('event') }.fetch(:series_name)
    expect(event.fetch('series_name')).eq expected_name
    expect(event.fetch('label').include?('26.02.13')).eq true
    expect(event.key?('pool')).eq false
    result = call_tool(client, 'catsroll_cats', {lang: 'kr', limit: 1})
    data = result.fetch('structuredContent')
    expect(data.fetch('cats').size).eq 1
    expect(data.fetch('nextOffset')).eq 1
    expect(call_tool(client, 'catsroll_events', {lang: 'xx'})['isError']).eq true
    catalog = call_tool(client, 'catsroll_events', {lang: 'kr', catalog: true})
    options = catalog.fetch('_meta').fetch('catsroll/events')
    expect(options.size > 50).eq true
    expect(catalog.fetch('structuredContent').fetch('total')).eq options.size
    expect(catalog.fetch('structuredContent').key?('events')).eq false
    selected = options.find { |item| item['event'] == event.fetch('event') }
    expect(selected.fetch('series_name')).eq expected_name
    expect(selected.fetch('group')).eq 'past'
    expect(call_tool(client, 'catsroll_events', {lang: 'kr', catalog: 'true'})['isError']).eq true
  end

  would 'filter cats by actual event pool IDs and paginate every rarity match' do
    cat_tool = rpc(client, 'tools/list').last.dig('result', 'tools').find { |tool| tool['name'] == 'catsroll_cats' }
    properties = cat_tool.dig('inputSchema', 'properties')
    expect(properties.key?('event') && properties.key?('rarity')).eq true
    expect(cat_tool.dig('inputSchema', 'properties', 'rarity', 'minimum')).eq 2
    expect(cat_tool.dig('inputSchema', 'properties', 'rarity', 'maximum')).eq 5
    ball = BattleCatsRolls::Route.ball_kr
    event = '2026-02-13_1042'
    pool_ids = BattleCatsRolls::TrackApi.compact_find_pool_data(ball, event).dig(:slots, 4)
    expected_ids = ball.cats.filter_map do |id, info|
      id if pool_ids.include?(id) && info['rarity'] == 4
    end
    args = {lang: 'kr', event: event, rarity: 4, limit: 50}
    first = call_tool(client, 'catsroll_cats', args).fetch('structuredContent')
    expect(first.fetch('nextOffset')).eq 50
    actual = first.fetch('cats')
    offset = first.fetch('nextOffset')
    while offset
      page = call_tool(client, 'catsroll_cats', args.merge(offset: offset)).fetch('structuredContent')
      actual.concat(page.fetch('cats'))
      offset = page.fetch('nextOffset')
    end
    expect(first.fetch('total')).eq expected_ids.size
    expect(actual.map { |cat| cat.fetch('id') }).eq expected_ids
    expect(actual.all? { |cat| cat.fetch('rarity') == 4 && pool_ids.include?(cat.fetch('id')) }).eq true
    expect(call_tool(client, 'catsroll_cats', {event: 'missing'})['isError']).eq true
    [1, 6].each do |rarity|
      expect(call_tool(client, 'catsroll_cats', {rarity: rarity})['isError']).eq true
    end
  end

  would 'prepare the complete event uber roster with unchanged inputs for both MCP hosts' do
    event = '2019-01-23_348'
    ball = BattleCatsRolls::Route.ball_kr
    pool = BattleCatsRolls::TrackApi.compact_find_pool_data(ball, event)
    event_uber_ids = Array(pool.dig(:slots, 4))
    expected_ids = ball.cats.filter_map do |id, info|
      id if event_uber_ids.include?(id) && info['rarity'] == 4
    end
    cats = call_tool(client, 'catsroll_cats', {lang: 'kr', event: event, rarity: 4, limit: 50}).
      fetch('structuredContent')
    expect(cats.fetch('nextOffset')).eq nil
    expect(cats.fetch('cats').map { |cat| cat.fetch('id') }).eq expected_ids
    targets = cats.fetch('cats').map do |cat|
      {cat_id: cat.fetch('id'), cat_name: cat.fetch('name')}
    end
    expect(targets.size <= 30).eq true

    hosts = [[client, '/mcp'],
      [Rack::MockRequest.new(BattleCatsRolls::GptMcp.new(ui_host: :claude)), '/mcp/claude']]
    hosts.each do |host_client, path|
      base = {mode: 'multi', seed: 42, rows: [{lang: 'kr', event: event}],
        targets: targets, findEnabled: true, planMode: true, planName: '풀 울슈레 확인',
        optimization: 'balance', maxGuaranteed: 1, maxPlatinum: 1, maxLegendTicket: 0}
      [nil, [BattleCatsRolls::TrackMaxCount, 300].min].each do |count|
        arguments = count ? base.merge(count: count) : base
        prepared = rpc(host_client, 'tools/call',
          {name: 'catsroll_prepare', arguments: arguments}, path: path).last.fetch('result')
        expect(prepared.fetch('isError', false)).eq false
        request = prepared.dig('structuredContent', 'request')
        expect(request.fetch('seed')).eq 42
        expect(request.fetch('count')).eq(count || 100)
        expect(request.fetch('targets').map { |target| target.fetch('cat_id') }).eq expected_ids
        expect(request.fetch('targets').map { |target| target.fetch('cat_name') }).eq cats.fetch('cats').map { |cat| cat.fetch('name') }
        expect(request.fetch('maxGuaranteed')).eq 1
        expect(request.fetch('maxPlatinum')).eq 1
        expect(request.fetch('maxLegendTicket')).eq 0
        expect(request.fetch('findEnabled')).eq true
        expect(request.fetch('planMode')).eq true
        expect(request.fetch('planName')).eq '풀 울슈레 확인'
      end
    end
  end

  would 'select complete KR and JP banner collections without pagination and preserve every input' do
    {'kr' => '2019-01-23_348', 'jp' => '2018-12-18_348'}.each do |lang, event|
      ball = BattleCatsRolls::Route.public_send("ball_#{lang}")
      expected_ids = BattleCatsRolls::TrackApi.compact_find_pool_data(ball, event).dig(:slots, 4).uniq
      owned = [expected_ids.first, expected_ids.first, 38]
      %w[multi find].each do |mode|
        rows = [{lang: lang, event: event, ubers: 2, forceGuaranteed: 11}]
        base = {mode: mode, seed: 42, last: 17, count: 287, rows: rows,
          optimization: 'balance', maxGuaranteed: 2, maxPlatinum: 3, maxLegendTicket: 4,
          scheduleAware: true, planMode: true, planName: '수집 계획',
          targetSelection: {type: 'banner_collection', lang: lang, event: event,
            rarity: 4, excludeOwnedIds: owned}}
        [[client, '/mcp'], [Rack::MockRequest.new(BattleCatsRolls::GptMcp.new(ui_host: :claude)), '/mcp/claude']].each do |host, path|
          reply = rpc(host, 'tools/call', {name: 'catsroll_prepare', arguments: base}, path: path).last.fetch('result')
          data = reply.fetch('structuredContent')
          expect(data.fetch('status')).eq 'prepared'
          request = data.fetch('request')
          %i[mode seed last count optimization maxGuaranteed maxPlatinum maxLegendTicket scheduleAware planMode planName].each do |key|
            expect(request.fetch(key.to_s)).eq base.fetch(key)
          end
          expect(request.fetch('rows')).eq JSON.parse(JSON.generate(rows))
          expect(request.fetch('findEnabled')).eq true
          expect(request.fetch('targets').map { |target| target.fetch('cat_id') }).eq expected_ids.drop(1)
          expect(request.fetch('targets').map { |target| target.fetch('cat_name') }).eq expected_ids.drop(1).map { |id| ball.cats.fetch(id).fetch('name').first }
          expect(request.fetch('targets').all? { |target| target.fetch('allow_ticket') == false }).eq true
          expect(request.key?('targetSelection')).eq false # fallback replays normalized direct targets
          selection = data.fetch('targetSelection')
          expect(selection.fetch('matched_ids')).eq expected_ids
          expect(selection.fetch('matched_count')).eq expected_ids.size
          expect(selection.fetch('included_count')).eq expected_ids.size - 1
          expect(selection.fetch('excluded_ids')).eq [expected_ids.first]
          expect(selection.fetch('unmatched_owned_ids')).eq [38]
          expect(selection.fetch('excluded').first.fetch('reason')).eq 'explicitly_owned'
          expect(selection.fetch('included').all? { |target| target.fetch('reason') == 'selected_banner_rarity_slot' }).eq true
          expect(reply.dig('_meta', 'catsroll/data', 'targetSelection')).eq selection
          expect(reply.dig('_meta', 'catsroll/data', 'request')).eq request
        end
        disabled = call_tool(client, 'catsroll_prepare', base.merge(findEnabled: false))
        expect(disabled.dig('structuredContent', 'request', 'findEnabled')).eq false
      end
    end
  end

  would 'report every large collection match and prepare only after explicit owned exclusions fit the limit' do
    event = '2026-10-30_1069'
    ids = BattleCatsRolls::TrackApi.compact_find_pool_data(BattleCatsRolls::Route.ball_kr, event).dig(:slots, 4).uniq
    expect(ids.size > 50).eq true # exceeds a catsroll_cats page as well as the target limit
    base = {mode: 'multi', seed: 42, last: 6, count: 273,
      maxGuaranteed: 0, maxPlatinum: 0, maxLegendTicket: 0,
      rows: [{lang: 'kr', event: event}],
      targetSelection: {type: 'banner_collection', lang: 'kr', event: event, rarity: 4}}
    reply = call_tool(client, 'catsroll_prepare', base)
    data = reply.fetch('structuredContent')
    expect(data.fetch('status')).eq 'needs_input'
    expect(data.fetch('reason')).eq 'target_limit_exceeded'
    expect(data.fetch('maximum')).eq 30
    expect(data.fetch('matched_count')).eq ids.size
    expect(data.fetch('next_action').empty?).eq false
    expect(data.dig('targetSelection', 'included_ids')).eq ids
    expect(data.dig('targetSelection', 'included_count')).eq ids.size
    expect(reply.dig('_meta', 'catsroll/data', 'targetSelection')).eq data.fetch('targetSelection')
    %w[request dataVersion engineVersion execution siteUrl].each { |key| expect(data.key?(key)).eq false }
    expect(reply.fetch('_meta').fetch('catsroll/data').key?('events')).eq false

    # No model/catalog page traversal: one prepare call sees IDs after page 1.
    narrowed = base.merge(targetSelection: base.fetch(:targetSelection).merge(excludeOwnedIds: ids[0...-30]))
    prepared = call_tool(client, 'catsroll_prepare', narrowed).fetch('structuredContent')
    expect(prepared.fetch('status')).eq 'prepared'
    request = prepared.fetch('request')
    expect(request.fetch('targets').map { |target| target.fetch('cat_id') }).eq ids.last(30)
    %i[seed last count maxGuaranteed maxPlatinum maxLegendTicket].each do |key|
      expect(request.fetch(key.to_s)).eq base.fetch(key)
    end
    none = call_tool(client, 'catsroll_prepare', base.merge(targetSelection:
      base.fetch(:targetSelection).merge(excludeOwnedIds: ids))).fetch('structuredContent')
    expect(none.fetch('status')).eq 'needs_input'
    expect(none.fetch('reason')).eq 'no_remaining_targets'
    expect(none.fetch('maximum')).eq 30
    expect(none.fetch('matched_count')).eq ids.size
    expect(none.dig('targetSelection', 'included_ids')).eq []
    expect(none.dig('targetSelection', 'excluded_ids')).eq ids
    expect(none.key?('request')).eq false
  end

  would 'reject ambiguous collections and invalid selection IDs without changing direct target compatibility' do
    selection = {type: 'banner_collection', lang: 'kr', event: '2019-01-23_348', rarity: 4}
    base = {mode: 'multi', seed: 42, rows: [{lang: 'kr', event: '2019-01-23_348'}], targetSelection: selection}
    bad = [base.merge(targets: []), base.merge(targets: [{cat_id: 418}]), base.merge(mode: 'seek')]
    [nil, [], selection.merge(type: 'other'), selection.merge(lang: 'xx'), selection.merge(lang: 'jp'),
      selection.merge(event: 'missing'), selection.merge(event: '2026-02-13_1042'),
      selection.merge(rarity: 5), selection.merge(rarity: 4.0), selection.merge(extra: true),
      selection.merge(excludeOwnedIds: '418'), selection.merge(excludeOwnedIds: [0]),
      selection.merge(excludeOwnedIds: ['418']), selection.merge(excludeOwnedIds: [999_999])].each do |value|
      bad << base.merge(targetSelection: value)
    end
    bad.each do |args|
      reply = call_tool(client, 'catsroll_prepare', args)
      expect(reply.fetch('isError', false)).eq true
      expect(reply.key?('_meta')).eq false
    end
    direct = call_tool(client, 'catsroll_prepare', base.reject { |key, _| key == :targetSelection }.
      merge(targets: [{cat_id: 418}]))
    expect(direct.dig('structuredContent', 'status')).eq 'prepared'
    expect(direct.dig('structuredContent', 'request', 'targets').first.fetch('cat_id')).eq 418
    expect(direct.fetch('structuredContent').key?('targetSelection')).eq false
  end

  would 'publish only explicit computed snapshots and query late rows without recalculation' do
    snapshot = {'schema_version' => 1, 'data_version' => 'fixture-v1',
      'input' => {'track' => {'seed' => 42, 'last' => 0, 'formIndex' => 0, 'count' => 300, 'rows' => []}, 'findEnabled' => false, 'findSettings' => {}},
      'find' => {'status' => 'not_requested', 'actions' => [], 'totalDraws' => 0, 'targetsAcquired' => [], 'actionContexts' => [], 'actionCats' => {}},
      'plan' => {'enabled' => false, 'name' => '', 'marks' => [], 'route' => [], 'cats' => [], 'progress' => ''},
      'banners' => [{'banner' => 'fixture', 'lang' => 'kr', 'rowsTotal' => 300, 'rowsIncluded' => 300, 'rowsOmitted' => 0,
        'conditionalTotal' => 0, 'conditionalIncluded' => 0, 'conditionalOmitted' => 0,
        'names' => {'38' => '고양이 홉핑'}, 'rows' => (1..300).map { |n| [[38, "#{n}A", "#{n + 1}A", nil, nil], [38, "#{n}B", "#{n + 1}B", nil, nil]] }, 'conditional' => []}]}
    listed = rpc(client, 'tools/list').last.dig('result', 'tools')
    write = listed.find { |item| item['name'] == 'catsroll_share_result' }
    expect(write.dig('_meta', 'ui', 'visibility')).eq ['app']
    expect(write.dig('annotations', 'readOnlyHint')).eq false
    read = listed.find { |item| item['name'] == 'catsroll_result' }
    expect(read.dig('annotations', 'readOnlyHint')).eq true
    shared = call_tool(client, 'catsroll_share_result', {'snapshot' => snapshot})
    expect(shared.fetch('isError', false)).eq false
    reference = shared.fetch('structuredContent')
    expect(reference.fetch('result_id').match?(/\A[0-9a-f]{64}\z/)).eq true
    result = call_tool(client, 'catsroll_result', {result_id: reference.fetch('result_id'), view: 'array', banner: 0, start: 299, limit: 2}).fetch('structuredContent')
    expect(result.fetch('rows').size).eq 2
    expect(result.fetch('rows').last.dig('A', 'position')).eq '300A'
    expect(result.fetch('rows').last.dig('B', 'next')).eq '301B'
    scoped = {snapshot: snapshot, session_id: 'a' * 64, idempotency_key: '1' * 64}
    first_scoped = call_tool(client, 'catsroll_share_result', scoped).fetch('structuredContent')
    expect(call_tool(client, 'catsroll_share_result', scoped).dig('structuredContent', 'result_id')).eq first_scoped.fetch('result_id')
    (2..4).each { |n| call_tool(client, 'catsroll_share_result', scoped.merge(idempotency_key: n.to_s * 64)) }
    full = call_tool(client, 'catsroll_share_result', scoped.merge(idempotency_key: '5' * 64))
    expect(full.fetch('isError')).eq true
    expect(full.dig('structuredContent', 'code')).eq 'session_full'
    expect(full.dig('structuredContent', 'retryable')).eq false
    expect(call_tool(client, 'catsroll_share_result', {snapshot: snapshot, session_id: 'a' * 64}).fetch('isError')).eq true
    wrong_host = rpc(Rack::MockRequest.new(BattleCatsRolls::GptMcp.new(ui_host: :claude)), 'tools/call', {name: 'catsroll_result', arguments: {result_id: reference.fetch('result_id')}}, path: '/mcp/claude').last.fetch('result')
    expect(wrong_host.dig('structuredContent', 'status')).eq 'expired_or_unavailable'
    # Upload allowance is specific to snapshot transport, not ordinary MCP calls.
    large = Marshal.load(Marshal.dump(snapshot))
    large.fetch('banners').first.fetch('rows').concat((301..999).map { |n| [[38, "#{n}A", "#{n + 1}A", nil, nil], [38, "#{n}B", "#{n + 1}B", nil, nil]] })
    large.fetch('banners').first.merge!('rowsTotal' => 999, 'rowsIncluded' => 999)
    large['input']['track']['count'] = 999
    large['banners'] *= 8
    expect(call_tool(client, 'catsroll_share_result', {'snapshot' => large}).fetch('isError', false)).eq false
    previous_enabled = ENV['CATSROLL_GPT_ENABLED']
    ENV['CATSROLL_GPT_ENABLED'] = '1'
    oversized = client.post('/mcp', 'CONTENT_TYPE' => 'application/json', input: JSON.generate(jsonrpc: '2.0', id: 1, method: 'ping', params: {ignored: 'x' * 70_000}))
    expect(oversized.status).eq 413
    ENV['CATSROLL_GPT_ENABLED'] = previous_enabled
    polluted = snapshot.merge('credentials' => {'password' => 'not-a-secret'})
    expect(call_tool(client, 'catsroll_share_result', {'snapshot' => polluted}).fetch('isError')).eq true
    expect(call_tool(client, 'catsroll_share_result', {'snapshot' => {'schema_version' => 2}}).fetch('isError')).eq true
  end

  would 'retrieve beginner guidance without opening a computation or leaking the whole corpus' do
    result = call_tool(client, 'catsroll_guide', {query: '보라칸이면 레레 확정임?'})
    data = result.fetch('structuredContent')
    expect(data.fetch('documents').first.fetch('id')).eq 'colors'
    expect(data.fetch('documents').size <= 2).eq true
    expect(data.fetch('documents').first.fetch('content').include?('일대일이 아니다')).eq true
    expect(result.key?('_meta')).eq false
    expect(data.key?('seed')).eq false
    expect(call_tool(client, 'catsroll_guide', {topic: '../.env'})['isError']).eq true
    expect(call_tool(client, 'catsroll_guide', {query: 'x' * 301})['isError']).eq true
    topics = rpc(client, 'resources/read', {uri: 'catsroll://guide/index'}).last.
      dig('result', 'contents').first
    expect(topics.fetch('text').include?('초심자')).eq true
    expect(topics.fetch('mimeType')).eq 'text/markdown'
    listed = rpc(client, 'tools/list').last.dig('result', 'tools')
    expect(listed.any? { |item| item['name'] == 'catsroll_guide' }).eq true
    prepared = call_tool(client, 'catsroll_prepare', {mode: 'multi', seed: 42,
      rows: [{lang: 'kr', event: '2019-01-23_348'}]})
    hint = prepared.fetch('structuredContent').fetch('guide')
    expect(hint.fetch('tool')).eq 'catsroll_guide'
    expect(hint.fetch('topics')).eq %w[tracks guaranteed colors]
  end

  would 'preserve every normalized condition in site fallback links including seek observations' do
    options = {mode: 'multi', seed: 42, last: 38, count: 300,
      findEnabled: false, planMode: true, planName: '복원 계획', optimization: 'balance',
      maxGuaranteed: 2, maxPlatinum: 1, maxLegendTicket: 2, scheduleAware: false,
      targets: [{cat_id: 38, allow_ticket: true}],
      rows: [{lang: 'kr', event: '2019-01-23_348', ubers: 2, forceGuaranteed: 11, previewFor: 'jp'},
        {lang: 'kr', event: '2019-01-23_348', ubers: 1, forceGuaranteed: 7}]}
    prepared = call_tool(client, 'catsroll_prepare', options).fetch('structuredContent')
    link = prepared.fetch('siteUrl')
    expect(link.include?('/gpt#catsroll-input=')).eq true
    expect(URI.parse(link).query).eq nil
    decode = ->(url) { JSON.parse(Base64.urlsafe_decode64(url.split('=', 2).last)) }
    envelope = decode.call(link)
    expect(envelope.fetch('version')).eq 1
    expect(envelope.fetch('arguments')).eq prepared.fetch('request')
    restored = call_tool(client, 'catsroll_prepare', envelope.fetch('arguments')).fetch('structuredContent')
    expect(restored.fetch('dataVersion')).eq prepared.fetch('dataVersion')
    seek = call_tool(client, 'catsroll_prepare', {mode: 'seek', rows: [{lang: 'kr', event: '2019-01-23_348'}]})
    observation = seek.fetch('_meta').fetch('catsroll/data').fetch('seeker').fetch('choices').first.fetch('id')
    request = seek.fetch('structuredContent').fetch('request').merge('rolls' => [observation, observation])
    seek_result = call_tool(client, 'catsroll_prepare', request).fetch('structuredContent')
    expect(decode.call(seek_result.fetch('siteUrl')).fetch('arguments')).eq seek_result.fetch('request')
  end

  would 'resolve banner nicknames and spacing without requiring a character target' do
    named = call_tool(client, 'catsroll_events', {lang: 'kr', query: '다이너마이트 군단'}).
      fetch('structuredContent').fetch('events')
    expect(named.empty?).eq false
    %w[다마군 다군 다이너마이트군단].each do |query|
      found = call_tool(client, 'catsroll_events', {lang: 'kr', query: query}).fetch('structuredContent').fetch('events')
      expect(found.map { |event| event.fetch('event') }).eq named.map { |event| event.fetch('event') }
      expect(found.all? { |event| event.fetch('series_id') == 1 }).eq true
    end
    {'하고축' => 27, '울하고축' => 42, '닼히' => 7}.each do |query, series_id|
      found = call_tool(client, 'catsroll_events', {lang: 'kr', query: query}).fetch('structuredContent').fetch('events')
      expect(found.empty?).eq false
      expect(found.map { |event| event.fetch('series_id') }.uniq).eq [series_id]
    end
    prepared = call_tool(client, 'catsroll_prepare', {mode: 'multi', seed: 42,
      rows: [{lang: 'kr', event: named.first.fetch('event')}]})
    expect(prepared.fetch('isError', false)).eq false
    expect(prepared.dig('structuredContent', 'request', 'count')).eq 100
    expect(prepared.dig('structuredContent', 'request', 'findEnabled')).eq false
  end

  would 'explain individual characters with current metadata and separate source conditions' do
    result = call_tool(client, 'catsroll_cats', {query: '107', details: true}).fetch('structuredContent')
    cat = result.fetch('cats').first
    expect(cat.fetch('name')).eq BattleCatsRolls::Route.ball_kr.cats.fetch(107).fetch('name').first
    expect(cat.fetch('forms').last.fetch('base_traits')).eq ['float']
    note = cat.fetch('source_notes').find { |item| item.fetch('source').fetch('title') == '갤걸 티어표' }
    expect(note.fetch('kind')).eq 'source_opinion'
    expect(note.fetch('evaluation_context').fetch('investment')).eq 'ultra'
    expect(note.fetch('source').fetch('published_on')).eq '2026-09-13'
    expect(cat.fetch('talents').any? { |item| item['ability'] == 'Specialized to' && item['ultra'] }).eq true
    expect(call_tool(client, 'catsroll_cats', {query: '107'}).fetch('structuredContent').fetch('cats').first.key?('source_notes')).eq false
    expect(call_tool(client, 'catsroll_cats', {details: true, limit: 6})['isError']).eq true
    expect(call_tool(client, 'catsroll_cats', {details: 'true'})['isError']).eq true
    %w[헬옹 쌍장성 엄동].zip([45, 352, 693]).each do |alias_name, id|
      named = call_tool(client, 'catsroll_cats', {query: alias_name, details: true}).fetch('structuredContent').fetch('cats').first
      expect(named.fetch('id')).eq id
      expect(named.fetch('name')).eq BattleCatsRolls::Route.ball_kr.cats.fetch(id).fetch('name').first
    end
    collection = call_tool(client, 'catsroll_guide', {query: '이번 콜라보 수집 우선순위가 궁금해'}).fetch('structuredContent')
    expect(collection.fetch('documents').first.fetch('id')).eq 'recommendations'
    expect(collection.fetch('documents').first.fetch('content').include?('반드시 복각')).eq true
  end

  would 'resolve reviewed Korean contractions without changing canonical names or collapsing ambiguous names' do
    {'문단' => 34, '라길' => 149, '암테' => 272, '크놋' => 440,
      '아이캣' => 40, '카맨' => 150, '거북카' => 325,
      '백슬리' => 530, '흑슬리' => 544, '백포노' => 691, '흑포노' => 706}.each do |query, id|
      result = call_tool(client, 'catsroll_cats', {query: query}).fetch('structuredContent').fetch('cats')
      expect(result.map { |cat| cat.fetch('id') }).eq [id]
      expect(result.first.fetch('name')).eq BattleCatsRolls::Route.ball_kr.cats.fetch(id).fetch('name').first
    end
    expect(call_tool(client, 'catsroll_cats', {query: '하데스'}).dig('structuredContent', 'cats').map { |cat| cat.fetch('id') }).eq [74, 535]
    expect(call_tool(client, 'catsroll_cats', {query: '해커'}).dig('structuredContent', 'cats').map { |cat| cat.fetch('id') }).eq [36, 430]
    catalog = BattleCatsRolls::TrackApi.event_series_characters(BattleCatsRolls::Route.ball_kr)
    expect(catalog.find { |cat| cat[:id] == 544 }.fetch(:aliases).include?('흑슬리')).eq true
    expect(catalog.find { |cat| cat[:id] == 544 }.fetch(:name)).eq '화근의 마녀 캐슬리'
    targets = BattleCatsRolls::TrackApi.multi_find_cats(0)
    expect(targets.find { |cat| cat[:id] == 544 }.fetch(:aliases).include?('흑슬리')).eq true
    aliases = JSON.parse(File.read(BattleCatsRolls::CharacterAliases::PATH))
    expect(aliases.fetch('entries').all? do |entry|
      BattleCatsRolls::Route.ball_kr.cats.key?(entry.fetch('cat_id')) &&
        entry.fetch('source_ids').all? { |id| aliases.fetch('sources').key?(id) }
    end).eq true
  end

  would 'route actual novice wording to explanations and supported boundaries' do
    {
      '처음인데 뭐부터 해요' => 'start',
      '좋은 캐릭 뭐 있어?' => 'recommendations',
      '빨적/천사 둘다 부족' => 'recommendations',
      '이번 콜라보부터 다 모을까?' => 'recommendations',
      '카이 악마 탱커라는데?' => 'recommendations',
      '없는 평가면 약한거야?' => 'recommendations',
      '내시드찾아줘' => 'seed',
      '포노먹고싶어' => 'find',
      '라길 두번 나오면 왜 B로 가요' => 'tracks',
      '보라칸이면 레레 확정임?' => 'colors',
      '신캐 나왔는데 전부 +1 하면 됨?' => 'banners',
      '플티로 열 넘길수있어?' => 'tracks',
      '11연 했는데 예상이랑 달라' => 'troubleshooting',
      '냥티로 닼캣아 먹고싶어' => 'troubleshooting',
      '배열이란게 뭐임' => 'start'
    }.each do |question, topic|
      response = call_tool(client, 'catsroll_guide', {query: question})
      expect(response.fetch('structuredContent').fetch('documents').first.fetch('id')).eq topic
    end
    unknown = call_tool(client, 'catsroll_guide', {query: '외계 행성 지도'})
    expect(unknown.fetch('structuredContent').fetch('matched')).eq false
    expect(unknown.fetch('structuredContent').fetch('documents').first.fetch('id')).eq 'index'
    recommend_guide = call_tool(client, 'catsroll_guide', {query: '빨적이 부족한데 뭐뽑을까'})
    expect(recommend_guide.fetch('structuredContent').fetch('documents').first.fetch('id')).eq 'recommendations'
  end

  would 'connect subjective tiers to real per-form game traits and an exact banner pool' do
    result = call_tool(client, 'catsroll_recommend', {traits: %w[빨 천], limit: 10})
    data = result.fetch('structuredContent')
    expect(data.fetch('scope')).eq 'recommendation_candidates_not_predictions'
    expect(data.fetch('source').fetch('tier_scope')).eq 'within_series'
    picks = data.fetch('recommendations')
    expect(picks.empty?).eq false
    expect(picks.all? { |item| (%w[red angel] - item.fetch('traits')).empty? }).eq true
    ball = BattleCatsRolls::Route.ball_kr
    expect(picks.all? { |item| ball.cats.fetch(item.fetch('cat_id')).fetch('name').include?(item.fetch('name')) }).eq true
    expect(result.key?('_meta')).eq false
    expect(data.key?('seed')).eq false
    owned = picks.first.fetch('cat_id')
    filtered = call_tool(client, 'catsroll_recommend', {traits: %w[red angel], owned: [owned],
      event: '2019-01-23_348', limit: 10}).fetch('structuredContent')
    members = BattleCatsRolls::TrackApi.compact_find_pool_data(ball, '2019-01-23_348').fetch(:slots)
    ids = Array(members[4]) + Array(members[5])
    expect(filtered.fetch('recommendations').all? { |item| ids.include?(item.fetch('cat_id')) && item.fetch('cat_id') != owned }).eq true
    expect(call_tool(client, 'catsroll_recommend', {traits: ['rainbow']})['isError']).eq true
    expect(call_tool(client, 'catsroll_recommend', {event: 'not-a-banner'})['isError']).eq true
  end

  would 'prepare original pools without calculating or exposing full pools to the model' do
    args = {mode: 'multi', seed: 2762818371, count: 30,
      rows: [{lang: 'kr', event: '2026-02-13_1042', ubers: 2, forceGuaranteed: 11}]}
    result = call_tool(client, 'catsroll_prepare', args)
    summary = result.fetch('structuredContent')
    expect(summary.fetch('status')).eq 'prepared'
    expect(summary.fetch('execution')).eq 'client'
    expect(summary.fetch('request').fetch('count')).eq 30
    expect(summary.key?('result')).eq false
    expect(summary.fetch('events').first.key?('pool')).eq false
    payload = result.fetch('_meta').fetch('catsroll/data')
    expected = BattleCatsRolls::TrackApi.compact_find_pool_data(
      BattleCatsRolls::Route.ball_kr, '2026-02-13_1042')
    expect(payload.fetch('events').first.fetch('pool')).eq JSON.parse(JSON.generate(expected))
    expect(payload.fetch('events').first.fetch('ubers')).eq 2
    expected_name = BattleCatsRolls::TrackApi.multi_events(BattleCatsRolls::Route.ball_kr).
      find { |item| item[:event] == '2026-02-13_1042' }.fetch(:series_name)
    expect(payload.fetch('events').first.fetch('displayName')).eq expected_name
    expect(payload.fetch('dataVersion')).eq summary.fetch('dataVersion')
    expect(summary.fetch('engineVersion').size).eq 64
  end

  would 'validate real calculation inputs instead of silently changing conditions' do
    base = {mode: 'multi', seed: 42, rows: [{lang: 'kr', event: '2026-02-13_1042'}]}
    expect(call_tool(client, 'catsroll_prepare', base).fetch('structuredContent').fetch('request').fetch('count')).eq 100
    expect(call_tool(client, 'catsroll_prepare', base.merge(count: 100)).fetch('structuredContent').fetch('request').fetch('count')).eq 100
    max_count = [BattleCatsRolls::TrackMaxCount, 300].min
    expect(call_tool(client, 'catsroll_prepare', base.merge(count: max_count)).fetch('structuredContent').fetch('request').fetch('count')).eq max_count
    listed = rpc(client, 'tools/list').last.dig('result', 'tools').find { |tool| tool['name'] == 'catsroll_prepare' }
    expect(listed.dig('inputSchema', 'properties', 'count', 'default')).eq 100
    expect(listed.dig('inputSchema', 'properties', 'count', 'maximum')).eq max_count
    [{seed: 0}, {seed: 2**32}, {count: max_count + 1}, {seed: '42'},
      {rows: [{lang: 'kr', event: 'missing'}]}, {scheduleAware: 'false'},
      {mode: 'find', targets: []}, {rows: []}, {custom: 1}].each do |change|
      expect(call_tool(client, 'catsroll_prepare', base.merge(change))['isError']).eq true
    end
    seek_base = base.merge(mode: 'seek', rows: [{lang: 'kr', event: '2019-01-23_348'}])
    result = call_tool(client, 'catsroll_prepare', seek_base.merge(rolls: [38]))
    expect(result['isError']).eq nil
    data = result.fetch('_meta').fetch('catsroll/data')
    cat = data.fetch('seeker').fetch('choices').find { |item| item['id'] == 38 }
    expect(data.fetch('seeker').fetch('rolls')).eq [cat['rarity'], cat['slot']]
    expect(call_tool(client, 'catsroll_prepare', seek_base.merge(
      rows: [{lang: 'kr', event: '2019-01-23_348', ubers: 1}]))['isError']).eq true
    expect(call_tool(client, 'catsroll_prepare', seek_base.merge(rolls: [999999]))['isError']).eq true
    expect(call_tool(client, 'catsroll_prepare', seek_base.merge(last: 38))['isError']).eq true
  end

  would 'prepare every Multi S/G choice without changing ordinary seed-search observations' do
    base = {mode: 'multi', seed: 42, count: 10,
      rows: [{lang: 'kr', event: '2019-01-23_348'}]}
    [2, 7, 11, 15].each do |rolls|
      args = base.merge(rows: [base[:rows].first.merge(forceGuaranteed: rolls)])
      result = call_tool(client, 'catsroll_prepare', args)
      expect(result.fetch('_meta').fetch('catsroll/data').fetch('events').first.fetch('forceGuaranteed')).eq rolls
      expect(result.fetch('structuredContent').fetch('status')).eq 'prepared'
      expect(call_tool(client, 'catsroll_prepare', args.merge(mode: 'seek', rolls: [38]))['isError']).eq true
    end
    bad = base.merge(rows: [base[:rows].first.merge(forceGuaranteed: 3)])
    expect(call_tool(client, 'catsroll_prepare', bad)['isError']).eq true
  end

  would 'use the shared Multi catalog and reject mismatched AI target identities' do
    bootstrap = call_tool(client, 'catsroll_multi_data', {section: 'bootstrap'})
    catalog = bootstrap.fetch('_meta').fetch('catsroll/multi')
    expect(catalog.fetch('initial').fetch('seed')).eq 0
    expect(catalog.fetch('initial').fetch('count')).eq 100
    expect(catalog.fetch('limits').fetch('count')).eq [BattleCatsRolls::TrackMaxCount, 300].min
    expect(catalog.fetch('find_cats').any? { |cat| cat['id'] == 545 && cat['name'] != '545' }).eq true
    expect(bootstrap.fetch('structuredContent').key?('regions')).eq false
    hidden = rpc(client, 'tools/list').last.dig('result', 'tools').find { |tool| tool['name'] == 'catsroll_multi_data' }
    expect(hidden.fetch('_meta').dig('ui', 'visibility')).eq ['app']
    base = {mode: 'multi', seed: 42, rows: [{lang: 'kr', event: '2019-01-23_348'}],
      targets: [{cat_id: 545, cat_name: 'ナナホではない名前'}], findEnabled: true}
    expect(call_tool(client, 'catsroll_prepare', base)['isError']).eq true
    name = BattleCatsRolls::Route.ball_kr.cats.fetch(545).fetch('name').first
    matching = call_tool(client, 'catsroll_events', {lang: 'kr', cat_id: 545}).fetch('structuredContent').fetch('events').
      find { |event| !event['platinum'] }
    good = call_tool(client, 'catsroll_prepare', base.merge(
      rows: [{lang: 'kr', event: matching.fetch('event')}],
      targets: [{cat_id: 545, cat_name: name}], planMode: true, planName: '메탈 대응'))
    request = good.fetch('structuredContent').fetch('request')
    expect(request.fetch('targets').first.fetch('cat_name')).eq name
    expect(request.fetch('findEnabled')).eq true
    expect(request.fetch('planMode')).eq true
    expect(request.fetch('planName')).eq '메탈 대응'
    expect(call_tool(client, 'catsroll_multi_data', {section: 'pool', lang: 'kr', event: 'missing'})['isError']).eq true
  end

  would 'resolve character banners from current pools and reject the wrong desired-cat banner' do
    events = call_tool(client, 'catsroll_events', {lang: 'kr', cat_id: 870, limit: 50}).fetch('structuredContent').fetch('events')
    dynamites = events.find { |event| event['series_name'] == '다이너마이트 군단' }
    expect(!!dynamites).eq true
    expect(events.any? { |event| event['event'] == '2026-10-20_947' }).eq false
    expect(call_tool(client, 'catsroll_events', {cat_id: 999999})['isError']).eq true
    expect(call_tool(client, 'catsroll_events', {cat_id: 870, catalog: true})['isError']).eq true
    args = {mode: 'multi', seed: 42, maxGuaranteed: 1,
      targets: [{cat_id: 870, cat_name: '변신소녀 단'}],
      rows: [{lang: 'kr', event: '2026-10-20_947'}]}
    wrong = call_tool(client, 'catsroll_prepare', args)
    expect(wrong['isError']).eq true
    expect(wrong.fetch('content').first.fetch('text').include?('catsroll_events with cat_id=870')).eq true
    right = call_tool(client, 'catsroll_prepare', args.merge(rows: [{lang: 'kr', event: dynamites.fetch('event')}]))
    expect(right.fetch('structuredContent').fetch('status')).eq 'prepared'
    # Ticket-only acquisition needs both a resource allowance and per-target consent.
    ticket = {mode: 'multi', seed: 42, rows: [{lang: 'kr', event: '2026-02-13_1042'}],
      targets: [{cat_id: 160, cat_name: '명계의 칼리파', allow_ticket: true}]}
    expect(call_tool(client, 'catsroll_prepare', ticket)['isError']).eq true
    expect(call_tool(client, 'catsroll_prepare', ticket.merge(maxPlatinum: 1)).fetch('structuredContent').fetch('status')).eq 'prepared'
    expect(call_tool(client, 'catsroll_prepare', ticket.merge(maxPlatinum: 1,
      targets: [{cat_id: 160, cat_name: '명계의 칼리파', allow_ticket: false}]))['isError']).eq true
  end

  would 'prepare unscheduled regional references without altering the source draw pool' do
    lookup = call_tool(client, 'catsroll_banner_preview', {query: '검심', lang: 'kr'}).
      fetch('structuredContent')
    expect(lookup.fetch('status')).eq 'ok'
    row = lookup.fetch('prepare_rows').first
    expect(row.fetch('lang')).eq 'jp'
    expect(row.fetch('previewFor')).eq 'kr'
    base = {mode: 'multi', seed: 42, count: 10, rows: [row]}
    result = call_tool(client, 'catsroll_prepare', base)
    summary = result.fetch('structuredContent')
    expect(summary.fetch('request').fetch('rows').first.fetch('previewFor')).eq 'kr'
    expect(summary.fetch('warnings').any? { |warning| warning.include?('미래 일정·풀 확정이 아닙니다') }).eq true
    pool = result.fetch('_meta').fetch('catsroll/data').fetch('events').first.fetch('pool')
    raw = BattleCatsRolls::TrackApi.compact_find_pool_data(
      BattleCatsRolls::TrackApi.raw_ball_jp, row.fetch('event'))
    original = JSON.parse(JSON.generate(raw))
    %w[slots rates guaranteed_rolls version].each do |field|
      expect(pool.fetch(field)).eq original.fetch(field)
    end
    ids = pool.fetch('slots').values.flatten.uniq
    known = ids.find { |id| BattleCatsRolls::Route.ball_kr.cats[id] }
    expect(pool.fetch('cats').fetch(known.to_s).fetch('name').first).
      eq BattleCatsRolls::Route.ball_kr.cats.fetch(known).fetch('name').first
    missing = ids.find { |id| !BattleCatsRolls::Route.ball_kr.cats[id] }
    expect(pool.fetch('cats').fetch(missing.to_s).fetch('name')).
      eq original.fetch('cats').fetch(missing.to_s).fetch('name')
    ui_pool = call_tool(client, 'catsroll_multi_data', row.merge('section' => 'pool')).
      fetch('_meta').fetch('catsroll/multi')
    expect(ui_pool.fetch('slots')).eq pool.fetch('slots')
    expect(ui_pool.fetch('cats').fetch(known.to_s).fetch('name')).eq pool.fetch('cats').fetch(known.to_s).fetch('name')
    expect(call_tool(client, 'catsroll_prepare', base.merge(scheduleAware: true))['isError']).eq true
    expect(call_tool(client, 'catsroll_prepare', base.merge(mode: 'seek'))['isError']).eq true
  end

  would 'serve a self-contained versioned app resource and the same standalone preview' do
    _, listed = rpc(client, 'resources/list')
    resource = listed.fetch('result').fetch('resources').first
    _, read = rpc(client, 'resources/read', {uri: resource.fetch('uri')})
    content = read.fetch('result').fetch('contents').first
    expect(content.fetch('mimeType')).eq 'text/html;profile=mcp-app'
    expect(content.fetch('text').include?('{{WORKER_SOURCE}}')).eq false
    expect(content.fetch('text').include?('catsroll-worker-source')).eq true
    expect(content.fetch('_meta').dig('ui', 'csp', 'connectDomains')).eq []
    expect(content.fetch('_meta').dig('ui', 'domain')).eq ENV.fetch('CATSROLL_GPT_UI_ORIGIN', BattleCatsRolls::GptMcp.public_origin)
    previous = ENV['CATSROLL_GPT_ENABLED']
    ENV['CATSROLL_GPT_ENABLED'] = '1'
    expect(client.get('/gpt').body).eq content.fetch('text')
    ENV['CATSROLL_GPT_ENABLED'] = previous
  end

  would 'isolate Claude UI domains and resource references from the ChatGPT connection' do
    web = Rack::MockRequest.new(BattleCatsRolls::LocalServerMiddleware.new(->(_) { [404, {}, ['Not found']] }))
    list = rpc(web, 'tools/list', path: '/mcp/claude').last.fetch('result').fetch('tools')
    uri = list.find { |tool| tool['name'] == 'catsroll_prepare' }.dig('_meta', 'ui', 'resourceUri')
    original_uri = rpc(web, 'tools/list').last.dig('result', 'tools').
      find { |tool| tool['name'] == 'catsroll_prepare' }.dig('_meta', 'ui', 'resourceUri')
    expect(uri == original_uri).eq false
    listed = rpc(web, 'resources/list', path: '/mcp/claude').last.dig('result', 'resources').first
    expect(listed.fetch('uri')).eq uri
    read = rpc(web, 'resources/read', {uri: uri}, path: '/mcp/claude').last.dig('result', 'contents').first
    endpoint = "#{BattleCatsRolls::GptMcp.public_origin}/mcp/claude"
    expect(read.dig('_meta', 'ui', 'domain')).eq Digest::SHA256.hexdigest(endpoint)[0, 32] + '.claudemcpcontent.com'
    original = rpc(web, 'resources/read', {uri: original_uri}).last.dig('result', 'contents').first
    expect(original.dig('_meta', 'ui', 'domain')).eq ENV.fetch('CATSROLL_GPT_UI_ORIGIN', BattleCatsRolls::GptMcp.public_origin)
    expect(read.fetch('text')).eq original.fetch('text').sub('<html ', '<html data-catsroll-ui-host="claude" ')
    expect(original.fetch('text').include?('<html data-catsroll-ui-host=')).eq false
    expect(rpc(web, 'resources/read', {uri: original_uri}, path: '/mcp/claude').last.key?('error')).eq true
    prepared = rpc(web, 'tools/call', {name: 'catsroll_prepare', arguments: {mode: 'multi', seed: 42,
      count: 100, rows: [{lang: 'kr', event: '2019-01-23_348'}]}}, path: '/mcp/claude').last.fetch('result')
    expect(prepared.dig('structuredContent', 'status')).eq 'prepared'
    expect(prepared.dig('structuredContent', 'execution')).eq 'client'
  end

  would 'keep cached widget handles usable after deployment without crossing hosts' do
    web = Rack::MockRequest.new(BattleCatsRolls::LocalServerMiddleware.new(->(_) { [404, {}, ['Not found']] }))
    old_gpt = 'ui://catsroll/multi-959980be993b3cc0.html'
    old_claude = old_gpt.sub('.html', '-claude-1.html')
    [['/mcp', old_gpt], ['/mcp/claude', old_claude]].each do |path, old_uri|
      current_uri = rpc(web, 'resources/list', {}, path: path).last.dig('result', 'resources').first.fetch('uri')
      current = rpc(web, 'resources/read', {uri: current_uri}, path: path).last.dig('result', 'contents').first
      cached = rpc(web, 'resources/read', {uri: old_uri}, path: path).last.dig('result', 'contents').first
      expect(cached.fetch('uri')).eq old_uri
      expect(cached.fetch('text')).eq current.fetch('text')
      expect(cached.fetch('_meta')).eq current.fetch('_meta')
    end
    expect(rpc(web, 'resources/read', {uri: old_claude}).last.key?('error')).eq true
    expect(rpc(web, 'resources/read', {uri: old_gpt}, path: '/mcp/claude').last.key?('error')).eq true
    ['https://example.com/app.html', 'ui://other/multi-959980be993b3cc0.html',
      'ui://catsroll/multi-959980be993b3cc0.html?host=claude', 'ui://catsroll/multi-not-a-hash.html'].each do |uri|
      expect(rpc(web, 'resources/read', {uri: uri}).last.key?('error')).eq true
    end
  end
end
