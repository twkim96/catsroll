require 'pork/auto'
require 'battle-cats-rolls/server'
require 'json'
require 'rack/mock'

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
end
