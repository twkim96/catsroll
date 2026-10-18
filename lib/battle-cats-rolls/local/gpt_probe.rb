# frozen_string_literal: true

require_relative 'gpt_mcp'
require 'securerandom'
require 'time'

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
      preview = env['PATH_INFO'] == preview_path
      response = super(preview ? env.merge('PATH_INFO' => '/gpt') : env)
      if preview && response[0] == 200
        response[2] = [correlate_html(response[2].join)]
      end
      response
    end

    def dispatch(method, params)
      case method
      when 'initialize'
        super.merge(serverInfo: {name: resource_name, version: VERSION},
          instructions: "Connection-only diagnostic. Open #{tool_name}; no seed, catalog, calculations or sharing. Do not claim computed results.")
      when 'tools/list'
        {tools: [{name: tool_name, title: "Catsroll #{variant} 연결 진단",
          description: 'Open a minimal connection-only UI. No catalogs, engines, WASM, calculations or result sharing.',
          inputSchema: {type: 'object', properties: {}, additionalProperties: false},
          annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
          _meta: {ui: {resourceUri: widget[:uri]}, 'openai/outputTemplate' => widget[:uri]}}]}
      when 'tools/call'
        args = params.fetch('arguments', {})
        raise InvalidInput, 'Unknown diagnostic tool or arguments' unless params['name'] == tool_name && args.is_a?(Hash) && args.empty?

        tool_reply(status: 'connection_probe', computed: false)
      when 'resources/list'
        {resources: [{uri: widget[:uri], name: resource_name, mimeType: MIME}]}
      when 'resources/read'
        raise InvalidInput, 'Unknown probe resource' unless compatible_widget_uri?(params['uri'])

        result = super
        result[:contents][0][:_meta]['openai/widgetDescription'] = 'Connection-only diagnostic, no calculation.'
        result[:contents][0][:text] = correlate_html(result[:contents][0][:text])
        result
      else
        super
      end
    end

    private

    def variant; 'manual'; end
    def tool_name; 'catsroll_probe'; end
    def resource_name; 'catsroll-connection-probe'; end
    def preview_path; '/gpt/probe'; end

    # Only generated diagnostic HTML is recorded. No request or account data.
    # Cached HTML retains its original ID; this is not a browser delivery receipt.
    def correlate_html(html)
      raise InvalidInput, 'Invalid probe HTML' unless html.start_with?('<!doctype html>') &&
        html.include?('</html>') && html.include?('{{RESOURCE_ID}}') &&
        !html.gsub('{{RESOURCE_ID}}', '').include?('{{')

      id = SecureRandom.uuid
      html = html.gsub('{{RESOURCE_ID}}', id)
      build = html[/data-catsroll-build="([0-9a-f]{16})"/, 1]
      raise InvalidInput, 'Invalid probe build' unless build

      $stderr.puts(JSON.generate(resourceId: id, probeVariant: variant, build: build, time: Time.now.utc.iso8601(3)))
      html
    end

    def compatible_widget_uri?(uri)
      uri.is_a?(String) && %r{\Aui://catsroll/probe-[0-9a-f]{16}\.html\z}.match?(uri)
    end
  end

  class GptSdkProbe < GptProbe
    def self.widget
      source = File.read(File.expand_path('../vendor/probe-sdk/probe.bundle.js', __dir__))
      template = File.read(File.expand_path('../view/gpt_sdk_probe.html', __dir__))
      digest = Digest::SHA256.hexdigest(source + template)
      {uri: "ui://catsroll/probe-sdk-#{digest[0, 16]}.html", digest: digest,
       text: template.sub('{{BUILD}}', digest[0, 16]).sub('{{SDK}}') { source }}
    end

    private

    def variant; 'sdk'; end
    def tool_name; 'catsroll_probe_sdk'; end
    def resource_name; 'catsroll-sdk-connection-probe'; end
    def preview_path; '/gpt/probe/sdk'; end

    def compatible_widget_uri?(uri)
      uri.is_a?(String) && %r{\Aui://catsroll/probe-sdk-[0-9a-f]{16}\.html\z}.match?(uri)
    end
  end
end
