require 'pork/auto'
require 'battle-cats-rolls/server'
require 'json'
require 'rack/mock'

describe 'Catsroll MCP device-computation adapter' do
  BattleCatsRolls::Web.new.call('PATH_INFO' => '/warmup')
  mcp = BattleCatsRolls::GptMcp.new
  client = Rack::MockRequest.new(mcp)

  def rpc(client, method, params = {}, headers = {})
    previous = ENV['CATSROLL_GPT_ENABLED']
    ENV['CATSROLL_GPT_ENABLED'] = '1'
    response = client.post('/mcp', {'CONTENT_TYPE' => 'application/json',
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
    _, body = rpc(client, 'ping', {}, 'HTTP_MCP_PROTOCOL_VERSION' => 'bad')
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

  would 'route actual novice wording to explanations and supported boundaries' do
    {
      '처음인데 뭐부터 해요' => 'start',
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
  end

  would 'prepare original pools without calculating or exposing full pools to the model' do
    args = {mode: 'multi', seed: 2762818371, count: 30,
      rows: [{lang: 'kr', event: '2026-02-13_1042', ubers: 2, forceGuaranteed: 11}]}
    result = call_tool(client, 'catsroll_prepare', args)
    summary = result.fetch('structuredContent')
    expect(summary.fetch('status')).eq 'prepared'
    expect(summary.fetch('execution')).eq 'client'
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
    [{seed: 0}, {seed: 2**32}, {count: 1000}, {seed: '42'},
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

  would 'serve a self-contained versioned app resource and the same standalone preview' do
    _, listed = rpc(client, 'resources/list')
    resource = listed.fetch('result').fetch('resources').first
    _, read = rpc(client, 'resources/read', {uri: resource.fetch('uri')})
    content = read.fetch('result').fetch('contents').first
    expect(content.fetch('mimeType')).eq 'text/html;profile=mcp-app'
    expect(content.fetch('text').include?('{{WORKER_SOURCE}}')).eq false
    expect(content.fetch('text').include?('catsroll-worker-source')).eq true
    expect(content.fetch('_meta').dig('ui', 'csp', 'connectDomains')).eq []
    previous = ENV['CATSROLL_GPT_ENABLED']
    ENV['CATSROLL_GPT_ENABLED'] = '1'
    expect(client.get('/gpt').body).eq content.fetch('text')
    ENV['CATSROLL_GPT_ENABLED'] = previous
  end
end
