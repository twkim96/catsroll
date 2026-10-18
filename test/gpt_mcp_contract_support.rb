# frozen_string_literal: true
require 'battle-cats-rolls/server'
require 'json'

module GptMcpContractSupport
  def self.normalize(value)
    case value
    when Hash
      value.to_h { |key, item| [key.to_s, %w[dataVersion engineVersion].include?(key.to_s) ? '<version>' : normalize(item)] }
    when Array then value.map { |item| normalize(item) }
    when String
      if value.start_with?('{', '[')
        begin
          return JSON.generate(normalize(JSON.parse(value)))
        rescue JSON::ParserError
          # Ordinary non-JSON text remains verbatim.
        end
      end
      value.gsub(/ui:\/\/catsroll\/multi-[0-9a-f]{16}/, 'ui://catsroll/multi-<hash>').
        gsub(BattleCatsRolls::GptMcp.public_origin, '<origin>')
    else value
    end
  end

  def self.capture
    BattleCatsRolls::Web.new.call('PATH_INFO' => '/warmup')
    %i[chatgpt claude].to_h do |host|
      mcp = BattleCatsRolls::GptMcp.new(ui_host: host)
      cases = {
        initialize: ['initialize', {}], tools: ['tools/list', {}], resources: ['resources/list', {}],
        multi: ['tools/call', {'name' => 'catsroll_prepare', 'arguments' => {'mode' => 'multi', 'seed' => 42, 'rows' => [{'lang' => 'kr', 'event' => '2019-01-23_348'}]}}],
        find_optional_name: ['tools/call', {'name' => 'catsroll_prepare', 'arguments' => {'mode' => 'find', 'seed' => 42, 'last' => 3, 'count' => 300, 'maxGuaranteed' => 2, 'maxPlatinum' => 1, 'targets' => [{'cat_id' => 38}], 'rows' => [{'lang' => 'kr', 'event' => '2019-01-23_348'}]}}],
        seek: ['tools/call', {'name' => 'catsroll_prepare', 'arguments' => {'mode' => 'seek', 'rows' => [{'lang' => 'kr', 'event' => '2019-01-23_348'}]}}],
        cats: ['tools/call', {'name' => 'catsroll_cats', 'arguments' => {'lang' => 'kr', 'event' => '2019-01-23_348', 'rarity' => 4, 'limit' => 2}}],
        unknown: ['tools/call', {'name' => 'missing', 'arguments' => {}}],
        bad_arguments: ['tools/call', {'name' => 'catsroll_prepare', 'arguments' => []}],
        bad_field: ['tools/call', {'name' => 'catsroll_prepare', 'arguments' => {'mode' => 'multi', 'unexpected' => true}}],
        bad_seed: ['tools/call', {'name' => 'catsroll_prepare', 'arguments' => {'mode' => 'multi', 'seed' => 0}}],
        missing_targets: ['tools/call', {'name' => 'catsroll_prepare', 'arguments' => {'mode' => 'find', 'seed' => 42, 'rows' => [{'lang' => 'kr', 'event' => '2019-01-23_348'}]}}],
        bad_share: ['tools/call', {'name' => 'catsroll_share_result', 'arguments' => {}}],
        missing_result: ['tools/call', {'name' => 'catsroll_result', 'arguments' => {'result_id' => '0' * 64}}]
      }
      [host.to_s, cases.to_h { |name, (method, params)| [name.to_s, normalize(mcp.dispatch(method, params))] }]
    end
  end
end
