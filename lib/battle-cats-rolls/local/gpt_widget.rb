# frozen_string_literal: true

require 'json'
require 'digest'
require 'base64'

module BattleCatsRolls
  # Resource packaging only. Kept separate from RPC and catalog handlers;
  # changing the build implementation must preserve resource/DOM contracts.
  class GptWidget
    ASSETS = File.expand_path('../asset', __dir__)
    TEMPLATE = File.expand_path('../view/gpt_app.html', __dir__)
    ICON = File.expand_path('../../../plugins/catsroll/assets/icon.png', __dir__)
    def self.build(version:, public_origin:, ui_origin:)
      shared = %w[event-series-search.js multi-track-virtual.js multi-track.js
        multi-find-catalog.js multi-find.js multi-plan.js]
      files = %w[track-engine.js multi-find-engine.js seeker-vampireflower.js
        seeker-vampireflower.wasm gpt-runtime.js gpt-worker.js gpt-inputs.js gpt-input-transfer.js gpt-snapshot.js gpt-result-summary.js gpt-host-bridge.js gpt-application-state.js gpt-share.js gpt-app.js gpt-app.css
        multi-find-worker.js multi-find.css multi-plan.css event-filter.css style/tacit.css] + shared
      multi_template = File.read(File.expand_path('../view/multi.erb', __dir__))
      digest = Digest::SHA256.hexdigest(files.map { |file|
        File.binread(File.join(ASSETS, file))
      }.join + multi_template.b + File.binread(TEMPLATE) + File.binread(ICON) +
        version + public_origin + ui_origin)
      @widget ||= {}
      @widget = {} unless @widget.key?(digest)
      @widget[digest] ||= begin
        worker = %w[track-engine.js multi-find-engine.js seeker-vampireflower.js
          gpt-runtime.js].map { |file| File.read(File.join(ASSETS, file)) }.join("\n;\n")
        binary = Base64.strict_encode64(File.binread(File.join(ASSETS, 'seeker-vampireflower.wasm')))
        worker += "\n;self.CATSROLL_WASM_BASE64=#{JSON.generate(binary)};\n"
        worker += File.read(File.join(ASSETS, 'gpt-worker.js'))
        modules = shared.map { |file| "function(){\n#{File.read(File.join(ASSETS, file))}\n}" }.join(",\n")
        scripts = %w[track-engine.js multi-find-engine.js gpt-runtime.js].map { |file|
          File.read(File.join(ASSETS, file))
        }.join("\n;\n")
        scripts += "\n;window.CatsrollMountMulti=function(){[#{modules}].forEach(function(m){m();});};\n"
        scripts += File.read(File.join(ASSETS, 'gpt-inputs.js')) + "\n;\n"
        scripts += File.read(File.join(ASSETS, 'gpt-input-transfer.js')) + "\n;\n"
        scripts += File.read(File.join(ASSETS, 'gpt-snapshot.js')) + "\n;\n"
        scripts += File.read(File.join(ASSETS, 'gpt-result-summary.js')) + "\n;\n"
        %w[gpt-host-bridge.js gpt-application-state.js gpt-share.js].each do |file|
          scripts += File.read(File.join(ASSETS, file)) + "\n;\n"
        end
        scripts += File.read(File.join(ASSETS, 'gpt-app.js'))
        scripts = scripts.gsub(%r{</script}i, '<\\/script')
        # Keep one maintained Multi DOM/CSS contract. Only transport scripts and
        # template expressions are replaced; controllers mount after MCP data arrives.
        multi = multi_template.gsub(/<%.*?%>/m, '').gsub(%r{<link\b[^>]*>}, '').
          gsub(%r{<script\b[^>]*>.*?</script>}m, '').
          sub(/data-find-worker="[^"]*"/, '').sub(/data-find-engine="[^"]*"/, '')
        find_worker = %w[track-engine.js multi-find-engine.js multi-find-worker.js].map { |file|
          File.read(File.join(ASSETS, file))
        }.join("\n;\n")
        base_style = File.read(File.join(ASSETS, 'style/tacit.css'))
        track_colors = base_style[base_style.index('.position {')...base_style.index('.attack {')]
        replacements = {
          '{{STYLE}}' => track_colors + %w[event-filter.css multi-find.css multi-plan.css gpt-app.css].map { |file|
            File.read(File.join(ASSETS, file))
          }.join("\n"),
          '{{MULTI}}' => multi,
          '{{ICON_DATA_URI}}' => "data:image/png;base64,#{Base64.strict_encode64(File.binread(ICON))}",
          '{{SCRIPTS}}' => scripts,
          '{{WORKER_SOURCE}}' => JSON.generate(worker).gsub('<', '\\u003c'),
          '{{FIND_WORKER_SOURCE}}' => JSON.generate(find_worker).gsub('<', '\\u003c')
        }
        html = File.read(TEMPLATE).gsub(/\{\{(?:STYLE|MULTI|ICON_DATA_URI|SCRIPTS|WORKER_SOURCE|FIND_WORKER_SOURCE)\}\}/) { |key|
          replacements.fetch(key)
        }
        {uri: "ui://catsroll/multi-#{digest[0, 16]}.html", text: html, digest: digest}
      end
    end

  end
end
