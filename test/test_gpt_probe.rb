require 'pork/auto'
require 'battle-cats-rolls/server'
require 'json'
require 'rack/mock'
require 'stringio'

describe 'Connection-only MCP control' do
  would 'serve a separate lightweight UI without exposing calculation or storage tools' do
    probe = BattleCatsRolls::GptProbe.new
    tools = probe.dispatch('tools/list', {})[:tools]
    expect(tools.map { |tool| tool[:name] }).eq ['catsroll_probe']
    uri = tools[0].dig(:_meta, :ui, :resourceUri)
    resource = probe.dispatch('resources/read', {'uri' => uri})[:contents][0]
    html = resource[:text]
    expect(html.bytesize < 30_000).eq true
    expect(html.include?('CatsrollHostBridge')).eq true
    expect(html.include?('CatsrollDiagnostics')).eq true
    expect(html.include?('new Worker')).eq false
    expect(html.include?('seeker-vampireflower')).eq false
    expect(html.include?('catsroll_multi_data')).eq false
    expect(html.include?('{{')).eq false
    expect(resource[:_meta].dig(:ui, :csp, :connectDomains)).eq []
    expect(probe.dispatch('tools/call', {'name' => 'catsroll_probe'})[:structuredContent]).eq({status: 'connection_probe', computed: false})
    begin
      probe.dispatch('tools/call', {'name' => 'catsroll_prepare', 'arguments' => {}})
      expect(false).eq true
    rescue BattleCatsRolls::GptMcp::InvalidInput
      expect(true).eq true
    end
    expect(BattleCatsRolls::GptMcp.new.dispatch('tools/list', {})[:tools].any? { |tool| tool[:name] == 'catsroll_probe' }).eq false
  end

  would 'preserve opt-in and same-origin checks on HTTP entrypoints' do
    previous = ENV['CATSROLL_GPT_ENABLED']
    client = Rack::MockRequest.new(BattleCatsRolls::Server)
    ENV['CATSROLL_GPT_ENABLED'] = '0'
    expect(client.get('/gpt/probe').status).eq 404
    ENV['CATSROLL_GPT_ENABLED'] = '1'
    expect(client.get('/gpt/probe').status).eq 200
    response = client.post('/mcp/probe', 'CONTENT_TYPE' => 'application/json',
      input: JSON.generate(jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}))
    expect(response.status).eq 200
    expect(JSON.parse(response.body).dig('result', 'tools', 0, 'name')).eq 'catsroll_probe'
    expect(client.post('/mcp/probe', 'HTTP_ORIGIN' => 'https://untrusted.example').status).eq 403
  ensure
    ENV['CATSROLL_GPT_ENABLED'] = previous
  end

  would 'isolate the SDK tool and resource while bundling the official App locally' do
    sdk = BattleCatsRolls::GptSdkProbe.new
    tools = sdk.dispatch('tools/list', {})[:tools]
    expect(tools.map { |tool| tool[:name] }).eq ['catsroll_probe_sdk']
    uri = tools.first.dig(:_meta, :ui, :resourceUri)
    expect(uri.start_with?('ui://catsroll/probe-sdk-')).eq true
    resource = sdk.dispatch('resources/read', {'uri' => uri})[:contents].first
    html = resource[:text]
    expect(html.include?('Catsroll SDK connection probe')).eq true
    expect(html.include?('ui/initialize')).eq true
    expect(html.include?('ui/notifications/initialized')).eq true
    expect(html.include?('SDK 연결 확인 중')).eq true
    %w[CatsrollHostBridge CatsrollDiagnostics seeker-vampireflower catsroll_multi_data catsroll_share_result {{].each do |forbidden|
      expect(html.include?(forbidden)).eq false
    end
    expect(html.match?(/<script[^>]+src=/)).eq false
    expect(resource[:_meta].dig(:ui, :csp)).eq({connectDomains: [], resourceDomains: []})
    expect(sdk.dispatch('tools/call', {'name' => 'catsroll_probe_sdk'})[:structuredContent]).eq({status: 'connection_probe', computed: false})
    [BattleCatsRolls::GptProbe.new, sdk].each do |probe|
      other_uri = probe == sdk ? BattleCatsRolls::GptProbe.widget[:uri] : uri
      begin
        probe.dispatch('resources/read', {'uri' => other_uri})
        expect(false).eq true
      rescue BattleCatsRolls::GptMcp::InvalidInput
        expect(true).eq true
      end
    end
    normal = BattleCatsRolls::GptMcp.new.dispatch('tools/list', {})[:tools]
    expect(normal.length).eq 10
    expect(normal.any? { |tool| tool[:name].start_with?('catsroll_probe') }).eq false
  end

  would 'correlate each successful diagnostic response without recording request data or failed generation' do
    original = $stderr
    $stderr = StringIO.new
    [BattleCatsRolls::GptProbe, BattleCatsRolls::GptSdkProbe].each do |klass|
      probe = klass.new
      uri = klass.widget[:uri]
      first = probe.dispatch('resources/read', {'uri' => uri})[:contents].first[:text]
      second = probe.dispatch('resources/read', {'uri' => uri})[:contents].first[:text]
      id = first[/data-catsroll-resource-id="([^"]+)"/, 1]
      next_id = second[/data-catsroll-resource-id="([^"]+)"/, 1]
      expect(id.match?(/\A[0-9a-f-]{36}\z/)).eq true
      expect(id == next_id).eq false
      records = $stderr.string.lines.last(2).map { |line| JSON.parse(line) }
      expect(records.map { |record| record['resourceId'] }).eq [id, next_id]
      expect(records.all? { |record| record.keys.sort == %w[build probeVariant resourceId time] }).eq true
      expect(records.map { |record| record['probeVariant'] }.uniq).eq [klass == BattleCatsRolls::GptProbe ? 'manual' : 'sdk']
      expect(records.first['build']).eq first[/data-catsroll-build="([^"]+)"/, 1]
    end
    before = $stderr.string.dup
    sdk = BattleCatsRolls::GptSdkProbe.new
    sdk.dispatch('tools/list', {})
    sdk.dispatch('tools/call', {'name' => 'catsroll_probe_sdk'})
    broken = Class.new(BattleCatsRolls::GptSdkProbe) do
      def self.widget
        super.merge(text: '<!doctype html><html>incomplete')
      end
    end
    begin
      broken.new.dispatch('resources/read', {'uri' => broken.widget[:uri]})
      expect(false).eq true
    rescue BattleCatsRolls::GptMcp::InvalidInput
      expect(true).eq true
    end
    expect($stderr.string).eq before
  ensure
    $stderr = original
  end

  would 'apply HTTP opt-in and origin checks before recording or serving either probe variant' do
    previous = ENV['CATSROLL_GPT_ENABLED']
    original = $stderr
    $stderr = StringIO.new
    client = Rack::MockRequest.new(BattleCatsRolls::Server)
    %w[/gpt/probe /gpt/probe/sdk /mcp/probe /mcp/probe/sdk].each do |path|
      ENV['CATSROLL_GPT_ENABLED'] = '0'
      expect(client.get(path).status).eq 404
      ENV['CATSROLL_GPT_ENABLED'] = '1'
      expect(client.get(path, 'HTTP_ORIGIN' => 'https://untrusted.example').status).eq 403
    end
    expect($stderr.string).eq ''
    %w[/gpt/probe /gpt/probe/sdk].each do |path|
      response = client.get(path)
      expect(response.status).eq 200
      expect(response['cache-control']).eq 'no-store'
      expect(response.body.include?('{{')).eq false
      id = response.body[/data-catsroll-resource-id="([^"]+)"/, 1]
      expect(JSON.parse($stderr.string.lines.last)['resourceId']).eq id
    end
    %w[/mcp/probe /mcp/probe/sdk].zip(%w[catsroll_probe catsroll_probe_sdk]).each do |path, name|
      response = client.post(path, 'CONTENT_TYPE' => 'application/json', input: JSON.generate(
        jsonrpc: '2.0', id: 7, method: 'tools/list', params: {}))
      tool = JSON.parse(response.body).dig('result', 'tools', 0)
      expect(tool['name']).eq name
      response = client.post(path, 'CONTENT_TYPE' => 'application/json', input: JSON.generate(
        jsonrpc: '2.0', id: 8, method: 'resources/read', params: {uri: tool.dig('_meta', 'ui', 'resourceUri')}))
      html = JSON.parse(response.body).dig('result', 'contents', 0, 'text')
      expect(response.status).eq 200
      expect(html.include?('{{')).eq false
      expect(JSON.parse($stderr.string.lines.last)['resourceId']).eq html[/data-catsroll-resource-id="([^"]+)"/, 1]
      expect(client.post(path, 'HTTP_ORIGIN' => 'https://untrusted.example').status).eq 403
    end
  ensure
    ENV['CATSROLL_GPT_ENABLED'] = previous
    $stderr = original
  end
end
