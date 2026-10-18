# frozen_string_literal: true
require 'pork/auto'
require_relative 'gpt_mcp_contract_support'

describe 'Frozen 870cc54d MCP contracts' do
  would 'keep static definitions shared by listing and dispatch with metadata-only visibility' do
    registry = BattleCatsRolls::GptToolRegistry
    mcp = BattleCatsRolls::GptMcp.new
    expect(registry::DEFINITIONS.frozen?).eq true
    expect(registry::BY_NAME.size).eq registry::DEFINITIONS.size
    expect(registry::DEFINITIONS.all? { |definition| definition.frozen? && definition[:inputSchema].frozen? && mcp.respond_to?(definition[:handler], true) }).eq true
    expect(mcp.dispatch('tools/list', {}).fetch(:tools).map { |tool| tool.fetch(:name) }).eq registry::BY_NAME.keys
    expect(registry::BY_NAME.fetch('catsroll_share_result').fetch(:access_policy)).eq :anonymous_explicit_share
    expect(registry::BY_NAME.fetch('catsroll_result').fetch(:access_policy)).eq :anonymous_result_id
    expect(registry::BY_NAME.fetch('catsroll_multi_data').fetch(:access_policy)).eq :anonymous_public
    # App visibility does not gate anonymous calls: the actual share/read tests
    # use ordinary MCP requests with no fake identity or app-authentication token.
  end

  would 'preserve complete descriptors and representative handler replies for both hosts' do
    baseline = JSON.parse(File.read(File.join(__dir__, 'fixtures/gpt_mcp/870cc54d.json')))
    # Explicit versioned delta: only collection instructions, prepare descriptions
    # and additive targetSelection schema changes. Every other old contract stays exact.
    delta = JSON.parse(File.read(File.join(__dir__, 'fixtures/gpt_mcp/selection_delta_v1.json')))
    delta.each do |host, changes|
      baseline.fetch(host).fetch('initialize')['instructions'] = changes.fetch('instructions')
      prepare = baseline.fetch(host).fetch('tools').fetch('tools').find { |tool| tool['name'] == 'catsroll_prepare' }
      prepare['description'] = changes.fetch('prepare').fetch('description')
      properties = prepare.fetch('inputSchema').fetch('properties')
      properties['targetSelection'] = changes.fetch('prepare').fetch('targetSelection')
    end
    ticket_delta = JSON.parse(File.read(File.join(__dir__, 'fixtures/gpt_mcp/selection_delta_v2.json')))
    ticket_delta.each do |host, changes|
      prepare = baseline.fetch(host).fetch('tools').fetch('tools').find { |tool| tool['name'] == 'catsroll_prepare' }
      prepare['description'] = changes.fetch('prepare').fetch('description')
      selection_properties = prepare.fetch('inputSchema').fetch('properties').fetch('targetSelection').fetch('properties')
      changes.fetch('prepare').fetch('targetSelection').fetch('properties').each do |name, property|
        selection_properties[name] = property
      end
    end
    # Additive navigation-only tool, guide topics and website links. Keep every
    # pre-existing prepare field, UI metadata and handler contract unchanged.
    site_delta = JSON.parse(File.read(File.join(__dir__, 'fixtures/gpt_mcp/site_links_delta_v1.json')))
    site_delta.each do |host, changes|
      cases = baseline.fetch(host)
      cases.fetch('initialize')['instructions'] = changes.fetch('instructions')
      cases.fetch('tools').fetch('tools') << changes.fetch('siteTool')
      guide = cases.fetch('tools').fetch('tools').find { |tool| tool['name'] == 'catsroll_guide' }
      guide.fetch('inputSchema').fetch('properties').fetch('topic')['enum'] = changes.fetch('guideTopics')
      changes.fetch('websiteLinks').each do |name, links|
        reply = cases.fetch(name)
        reply.fetch('structuredContent')['websiteLinks'] = links
        reply.fetch('content').each do |item|
          data = JSON.parse(item.fetch('text'))
          data = data.to_a.flat_map { |key, value|
            key == 'warnings' ? [['websiteLinks', links], [key, value]] : [[key, value]]
          }.to_h
          item['text'] = JSON.generate(data)
        end
      end
    end
    # Reviewed routing-only delta: focused guide calls, concept/character
    # separation and visible user evidence. No tool inputs or engines change.
    guide_delta = JSON.parse(File.read(File.join(__dir__, 'fixtures/gpt_mcp/guide_routing_delta_v1.json')))
    guide_delta.each do |host, changes|
      baseline.fetch(host).fetch('initialize')['instructions'] = changes.fetch('instructions')
      changes.fetch('descriptions').each do |name, description|
        baseline.fetch(host).fetch('tools').fetch('tools').find { |tool| tool['name'] == name }['description'] = description
      end
    end
    # Full sourced-tier coverage changes descriptions only; inputs/UI stay frozen.
    tier_delta = JSON.parse(File.read(File.join(__dir__, 'fixtures/gpt_mcp/tier_coverage_delta_v1.json')))
    tier_delta.each do |host, changes|
      changes.fetch('descriptions').each do |name, description|
        baseline.fetch(host).fetch('tools').fetch('tools').find { |tool| tool['name'] == name }['description'] = description
      end
    end
    expect(GptMcpContractSupport.capture).eq baseline
  end
end
