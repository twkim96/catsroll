# frozen_string_literal: true

require_relative 'gpt_mcp'

module BattleCatsRolls
  # Separate connection-only control. Never advertised by the normal connectors.
  class GptProbe < GptMcp
    def self.widget
      sources = %w[gpt-diagnostics.js gpt-host-bridge.js].map { |file| File.read(File.join(ASSETS, file)) }
      template = File.read(File.expand_path('../view/gpt_probe.html', __dir__))
      digest = Digest::SHA256.hexdigest(sources.join + template)
      {uri: "ui://catsroll/probe-#{digest[0, 16]}.html", digest: digest,
       text: template.sub('{{BUILD}}', digest[0, 16]).sub('{{DIAGNOSTICS}}') { sources[0] }.sub('{{BRIDGE}}') { sources[1] }}
    end

    def call(env)
      env = env.merge('PATH_INFO' => '/gpt') if env['PATH_INFO'] == '/gpt/probe'
      super(env)
    end

    def dispatch(method, params)
      case method
      when 'initialize'
        super.merge(serverInfo: {name: 'catsroll-connection-probe', version: VERSION},
          instructions: 'Connection-only diagnostic. Open catsroll_probe; no seed, catalog, calculations or sharing. Do not claim computed results.')
      when 'tools/list'
        {tools: [{name: 'catsroll_probe', title: 'Catsroll 연결 진단',
          description: 'Open a minimal connection-only UI. No catalogs, engines, WASM, calculations or result sharing.',
          inputSchema: {type: 'object', properties: {}, additionalProperties: false},
          annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
          _meta: {ui: {resourceUri: widget[:uri]}, 'openai/outputTemplate' => widget[:uri]}}]}
      when 'tools/call'
        args = params.fetch('arguments', {})
        raise InvalidInput, 'Unknown diagnostic tool or arguments' unless params['name'] == 'catsroll_probe' && args.is_a?(Hash) && args.empty?

        tool_reply(status: 'connection_probe', computed: false)
      when 'resources/list'
        {resources: [{uri: widget[:uri], name: 'catsroll-connection-probe', mimeType: MIME}]}
      when 'resources/read'
        raise InvalidInput, 'Unknown probe resource' unless compatible_widget_uri?(params['uri'])

        result = super
        result[:contents][0][:_meta]['openai/widgetDescription'] = 'Connection-only diagnostic, no calculation.'
        result
      else
        super
      end
    end

    private

    def compatible_widget_uri?(uri)
      uri.is_a?(String) && %r{\Aui://catsroll/probe-[0-9a-f]{16}\.html\z}.match?(uri)
    end
  end
end
