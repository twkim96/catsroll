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
    # and one additive input field change. Every other old contract stays exact.
    delta = JSON.parse(File.read(File.join(__dir__, 'fixtures/gpt_mcp/selection_delta_v1.json')))
    delta.each do |host, changes|
      baseline.fetch(host).fetch('initialize')['instructions'] = changes.fetch('instructions')
      prepare = baseline.fetch(host).fetch('tools').fetch('tools').find { |tool| tool['name'] == 'catsroll_prepare' }
      prepare['description'] = changes.fetch('prepare').fetch('description')
      prepare.fetch('inputSchema').fetch('properties')['targetSelection'] = changes.fetch('prepare').fetch('targetSelection')
    end
    expect(GptMcpContractSupport.capture).eq baseline
  end
end
