# frozen_string_literal: true

require 'json'
require 'digest'
require 'base64'
require 'uri'
require 'rack'
require_relative 'gpt_guide'
require_relative 'gpt_recommendations'
require_relative 'gpt_banner_preview'

module BattleCatsRolls
  # Stateless JSON Streamable HTTP. This adapter only prepares public game data;
  # the existing JS/WASM engines run in the user's UI, never on this server.
  class GptMcp
    VERSION = '0.2.4'
    DEFAULT_COUNT = 300
    PROTOCOLS = %w[2025-11-25 2025-06-18 2025-03-26].freeze
    MIME = 'text/html;profile=mcp-app'
    ASSETS = File.expand_path('../asset', __dir__)
    TEMPLATE = File.expand_path('../view/gpt_app.html', __dir__)
    ICON = File.expand_path('../../../plugins/catsroll/assets/icon.png', __dir__)
    BODY_LIMIT = 65_536
    CLAUDE_ROUTING = <<~TEXT.freeze
      냥코대전쟁 뽑기 도구다. 배열표/배너 조회는 mode=multi이며 목표 캐릭터는 필요 없다.
      배너 이름·별명은 catsroll_events(query=...)로 찾는다. 다마군/다군은 다이너마이트 군단 배너이며 캐릭터가 아니다.
      캐릭터를 얻고 싶다는 요청에만 catsroll_cats로 목표를 찾고 Find를 사용한다. 캐릭터 검색 실패를 배너가 없다는 근거로 삼지 않는다.
      시드를 모르면 mode=seek로 화면을 연다. seek는 시드와 관측 결과 없이도 준비 가능하고 관측은 화면에서 선택한다.
      횟수 생략은 300이다. 지역은 사용자가 말한 값을 유지하고 모르면 지역만 묻는다.
      날짜 없는 앞으로의 배열 조회는 해당 지역의 현재 배너를 우선한다. 현재 후보가 여러 변형이면 차이만 묻는다.
      지난 뽑기로 시드를 찾을 때는 실제 뽑은 배너/기간을 확인한다. forceGuaranteed=0은 배너 기본값이며 확정 없음/비활성이라는 뜻이 아니다.
    TEXT
    CLAUDE_TOOL_HINTS = {
      'catsroll_events' => '배너/뽑기 시리즈 검색용. 다마군, 다군, 다이너마이트 군단 같은 이름은 여기에 query로 넣는다. 공백과 기존 시리즈 별명을 지원한다.',
      'catsroll_cats' => '개별 고양이 검색 전용. 배너나 시리즈 이름을 캐릭터로 찾지 않는다. 배열표 조회에는 이 도구나 목표 캐릭터가 필수가 아니다.',
      'catsroll_prepare' => '배열표를 열 때 mode=multi와 seed, rows를 사용한다. targets는 선택이며 없어도 정상이다. 목표를 얻는 경로 요청에만 targets/Find를 사용한다. 시드가 없으면 mode=seek로 화면을 연다. 관측도 화면에서 입력 가능하다. count 생략은 300. forceGuaranteed=0은 배너 기본값이다. 준비는 계산 결과가 아니며 화면에서 계산 후 공유한 결과만 설명한다.'
    }.freeze
    INPUT_KEYS = %w[mode seed last count rows targets optimization maxGuaranteed
      maxPlatinum maxLegendTicket scheduleAware rolls findEnabled planMode planName].freeze

    class InvalidInput < StandardError; end
    class UnknownMethod < StandardError; end

    def initialize(ui_host: :chatgpt)
      @ui_host = ui_host
    end

    def self.enabled?
      ENV['CATSROLL_GPT_ENABLED'] == '1'
    end

    def self.public_origin
      ENV.fetch('CATSROLL_PUBLIC_ORIGIN', 'https://twkim96-my-cats-rolls.hf.space').sub(%r{/+\z}, '')
    end

    def self.widget
      shared = %w[event-series-search.js multi-track-virtual.js multi-track.js
        multi-find-catalog.js multi-find.js multi-plan.js]
      files = %w[track-engine.js multi-find-engine.js seeker-vampireflower.js
        seeker-vampireflower.wasm gpt-runtime.js gpt-worker.js gpt-inputs.js gpt-result-summary.js gpt-app.js gpt-app.css
        multi-find-worker.js multi-find.css multi-plan.css event-filter.css style/tacit.css] + shared
      multi_template = File.read(File.expand_path('../view/multi.erb', __dir__))
      digest = Digest::SHA256.hexdigest(files.map { |file|
        File.binread(File.join(ASSETS, file))
      }.join + multi_template.b + File.binread(TEMPLATE) + File.binread(ICON) +
        VERSION + self.public_origin + ENV.fetch('CATSROLL_GPT_UI_ORIGIN', self.public_origin))
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
        scripts += File.read(File.join(ASSETS, 'gpt-result-summary.js')) + "\n;\n"
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

    def call(env)
      return response(404, {error: 'Not found'}) unless self.class.enabled?
      request = Rack::Request.new(env)
      return response(403, {error: 'Origin not allowed'}) unless allowed_origin?(request)
      if request.path_info == '/gpt'
        return response(405, {error: 'Use GET'}, 'allow' => 'GET') unless request.get?

        return [200, {'content-type' => 'text/html; charset=utf-8',
          'cache-control' => 'no-store', 'x-content-type-options' => 'nosniff',
          'referrer-policy' => 'no-referrer'}, [self.class.widget[:text]]]
      end
      return response(405, {error: 'Use POST'}, 'allow' => 'POST') unless request.post?
      unless request.media_type == 'application/json'
        return response(415, {error: 'Expected application/json'})
      end
      accept = env['HTTP_ACCEPT'].to_s
      unless accept.empty? || accept.include?('application/json') || accept.include?('*/*')
        return response(406, {error: 'Accept application/json and text/event-stream'})
      end
      protocol = env['HTTP_MCP_PROTOCOL_VERSION']
      if protocol && !PROTOCOLS.include?(protocol)
        return response(400, {error: 'Unsupported MCP protocol version'})
      end
      body = env['rack.input'].read(BODY_LIMIT + 1)
      return response(413, {error: 'Request too large'}) if body.bytesize > BODY_LIMIT

      message = JSON.parse(body)
      unless message.is_a?(Hash) && message['jsonrpc'] == '2.0' && message['method'].is_a?(String) &&
          (!message.key?('id') || message['id'].is_a?(String) || message['id'].is_a?(Integer))
        return rpc_error(nil, -32600, 'Invalid Request', 400)
      end
      unless message.key?('id')
        return [202, {'cache-control' => 'no-store'}, []] if message['method'].start_with?('notifications/')

        return rpc_error(nil, -32600, 'Request id required', 400)
      end
      id = message['id']
      params = message.fetch('params', {})
      raise InvalidInput, 'params must be an object' unless params.is_a?(Hash)

      result = dispatch(message['method'], params)
      response(200, {jsonrpc: '2.0', id: id, result: result})
    rescue JSON::ParserError
      rpc_error(nil, -32700, 'Parse error', 400)
    rescue InvalidInput => error
      rpc_error(id, -32602, error.message)
    rescue UnknownMethod
      rpc_error(id, -32601, 'Method not found')
    end

    def dispatch(method, params)
      case method
      when 'initialize'
        {protocolVersion: PROTOCOLS.include?(params['protocolVersion']) ? params['protocolVersion'] : PROTOCOLS.first,
         capabilities: {tools: {}, resources: {}}, serverInfo: {name: 'catsroll', version: VERSION},
         instructions: 'For beginner, vague or conceptual questions, first use catsroll_guide with the user question; ask only the next 1-2 missing details. For what-to-pull or trait-gap questions use catsroll_recommend, then check banner membership and optional Find routes; no seed is needed for performance candidates. Use catsroll_events and catsroll_cats to resolve exact IDs, not ask beginners for IDs. For unscheduled collab/event arrays use catsroll_banner_preview to compare KR/JP reference pools; never present source dates as a confirmed future schedule. catsroll_prepare only prepares data; it does NOT compute a seed, array or route. The user must run the embedded app. Only describe computed results explicitly shared by the app. If UI is unavailable, provide the site link. Keep ambiguous seeds and partial searches explicitly uncertain. Never silently switch to server computation.' + (@ui_host == :claude ? "\n" + CLAUDE_ROUTING : '')}
      when 'ping' then {}
      when 'tools/list' then {tools: tools}
      when 'tools/call'
        begin
          args = params.fetch('arguments', {})
          raise InvalidInput, 'arguments must be an object' unless args.is_a?(Hash)

          case params['name']
          when 'catsroll_guide' then guide_reply(args)
          when 'catsroll_recommend' then tool_reply(GptRecommendations.new.lookup(args))
          when 'catsroll_banner_preview' then tool_reply(GptBannerPreview.new.lookup(args))
          when 'catsroll_events' then event_reply(args)
          when 'catsroll_cats' then tool_reply(cats(args))
          when 'catsroll_multi_data' then multi_data_reply(args)
          when 'catsroll_prepare' then prepare(args)
          else raise InvalidInput, 'Unknown tool'
          end
        rescue InvalidInput, GptGuide::InvalidInput, GptRecommendations::InvalidInput, GptBannerPreview::InvalidInput => error
          {isError: true, content: [{type: 'text', text: error.message}]}
        end
      when 'resources/list'
        {resources: [{uri: widget[:uri], name: 'catsroll-multi', mimeType: MIME},
          {uri: 'catsroll://guide/index', name: 'catsroll-guide', mimeType: 'text/markdown',
           description: 'Beginner guide index; use catsroll_guide for focused retrieval.'}]}
      when 'resources/templates/list' then {resourceTemplates: []}
      when 'resources/read'
        if params['uri'] == 'catsroll://guide/index'
          index = GptGuide.new.lookup('topic' => 'index').fetch('documents').first
          return {contents: [{uri: params['uri'], mimeType: 'text/markdown', text: index.fetch('content')}]}
        end
        raise InvalidInput, 'Unknown resource; list resources again' unless compatible_widget_uri?(params['uri'])

        meta = {ui: {csp: {connectDomains: [], resourceDomains: []}},
          'openai/widgetDescription' => 'Catsroll: device-only Multi arrays, route search and seed finder. Prepared inputs are not computed results.'}
        domain = if @ui_host == :claude
          Digest::SHA256.hexdigest("#{self.class.public_origin}/mcp/claude")[0, 32] + '.claudemcpcontent.com'
        else
          ENV.fetch('CATSROLL_GPT_UI_ORIGIN', self.class.public_origin)
        end
        meta[:ui][:domain] = domain if domain && !domain.empty?
        {contents: [{uri: params['uri'], mimeType: MIME, text: widget[:text], _meta: meta}]}
      else
        # Method errors are handled separately from invalid tool arguments.
        raise UnknownMethod
      end
    end

    private

    def compatible_widget_uri?(uri)
      return false unless uri.is_a?(String)

      # Hosts can retain a tool descriptor across deployments. Serve the current
      # compatible app for our older handles, preserving host-specific isolation.
      pattern = @ui_host == :claude ? %r{\Aui://catsroll/multi-[0-9a-f]{16}-claude-1\.html\z} :
        %r{\Aui://catsroll/multi-[0-9a-f]{16}\.html\z}
      pattern.match?(uri)
    end

    def widget
      base = self.class.widget
      return base unless @ui_host == :claude

      # Host-specific domain metadata must never share the cached ChatGPT URI.
      base.merge(uri: base[:uri].sub(/\.html\z/, '-claude-1.html'),
        text: base[:text].sub('<html ', '<html data-catsroll-ui-host="claude" '))
    end

    def allowed_origin?(request)
      origin = request.env['HTTP_ORIGIN']
      return true if origin.nil? || origin.empty?

      allowed = [self.class.public_origin]
      allowed << request.base_url if %w[127.0.0.1 localhost ::1].include?(request.host)
      allowed.include?(origin)
    end

    def response(status, object, headers = {})
      [status, {'content-type' => 'application/json; charset=utf-8',
        'cache-control' => 'no-store', 'x-content-type-options' => 'nosniff'}.merge(headers), [JSON.generate(object)]]
    end

    def rpc_error(id, code, message, status = 200)
      response(status, {jsonrpc: '2.0', id: id, error: {code: code, message: message}})
    end

    def tool_reply(data)
      {content: [{type: 'text', text: JSON.generate(data)}], structuredContent: data}
    end

    def schema(properties, required = [])
      {type: 'object', properties: properties, required: required, additionalProperties: false}
    end

    def tools
      int = lambda { |min, max| {type: 'integer', minimum: min, maximum: max} }
      lang = {type: 'string', enum: %w[kr jp]}
      paging = {lang: lang, query: {type: 'string', maxLength: 100},
        offset: int.call(0, 100_000), limit: int.call(1, 50)}
      event_input = paging.merge(catalog: {type: 'boolean'}, cat_id: int.call(1, 1_000_000))
      row = schema({lang: lang, event: {type: 'string', maxLength: 100},
        previewFor: {type: 'string', enum: %w[kr jp], description: 'Reference simulation for this game region using the selected source pool. NOT a confirmed future schedule.'},
        ubers: int.call(0, 100), forceGuaranteed: {type: 'integer', enum: [0, 2, 7, 11, 15]}}, %w[lang event])
      input = schema({mode: {type: 'string', enum: %w[multi find seek]},
        seed: int.call(1, 4_294_967_295), last: int.call(0, 1_000_000),
        count: int.call(1, [TrackMaxCount, 999].min).merge(default: DEFAULT_COUNT,
          description: 'Default 300 when the user does not specify a range; preserve explicit counts.'),
        rows: {type: 'array', minItems: 1, maxItems: 8, items: row},
        targets: {type: 'array', maxItems: 30,
          items: schema({cat_id: int.call(1, 1_000_000), cat_name: {type: 'string', maxLength: 100},
            allow_ticket: {type: 'boolean'}}, %w[cat_id cat_name])},
        findEnabled: {type: 'boolean', description: 'Find option inside Multi; targets enable it by default. Legacy mode=find opens the same Multi UI.'},
        planMode: {type: 'boolean'}, planName: {type: 'string', maxLength: 80},
        optimization: {type: 'string', enum: %w[cost cost40 cost50 distance balance pareto]},
        maxGuaranteed: int.call(0, 20), maxPlatinum: int.call(0, 20),
        maxLegendTicket: int.call(0, 20), scheduleAware: {type: 'boolean'},
        rolls: {type: 'array', maxItems: 10, items: int.call(1, 1_000_000)}}, ['mode'])
      [
        ['catsroll_guide', '배열 초보자 안내', 'Search verified Catsroll guidance BEFORE answering beginner, vague or conceptual questions. Pass the user question naturally, including Korean slang; empty input returns the index. Explains seeds, A/B and R/G/RG, guarantees, tickets, banner dates, future ubers, colors, Find and unsupported draws. Ask only missing essentials. This retrieves documentation, NOT predictions; use live catalogs and app results for actual outcomes.',
          schema({query: {type: 'string', maxLength: 300},
            topic: {type: 'string', enum: %w[index start seed tracks guaranteed banners colors find troubleshooting recommendations]},
            limit: int.call(1, 3)})],
        ['catsroll_recommend', '속성별 뽑기 추천', 'Use for vague good-cat/what-to-pull questions and trait gaps such as 빨적 부족. Returns reviewed SS/S/A tier candidates joined by cat ID to current Catsroll names, per-form targets and abilities. No traits: high-tier broad candidates. Multiple traits: match=all unless user accepts any. Default allows 3rd form and ordinary talents, not 4th/ultra. State requirements and subjective within-series tier limits. Attached source_notes are dated opinions for the evaluated form/investment, not game facts or a global rank. For collection priority, distinguish collab scarcity from combat strength; never invent rerun schedules. Use catsroll_cats(details=true) for individual role notes. event filters actual pool membership, NOT current sale or seed reachability. No seed needed for performance candidates; use catalogs and Find for actual pulls.',
          schema({lang: lang,
            traits: {type: 'array', maxItems: 10, items: {type: 'string', maxLength: 30}},
            match: {type: 'string', enum: %w[all any]},
            event: {type: 'string', maxLength: 100},
            owned: {type: 'array', maxItems: 1000, items: int.call(1, 1_000_000)},
            max_form: int.call(0, 3), investment: {type: 'string', enum: %w[none talents ultra]},
            limit: int.call(1, 10)})],
        ['catsroll_events', '배너 찾기', 'Find public KR/JP banners by name/date or exact cat_id membership. For a desired character, resolve its ID with catsroll_cats then pass cat_id here WITHOUT using the cat name as the banner query. Only banners whose actual pool contains that cat are returned; source dates are not future availability. Returns IDs and pagination; does not calculate. catalog=true prepares the full dropdown catalog privately for the app, not model search results.', schema(event_input)],
        ['catsroll_banner_preview', '미정 배너 참고 풀 찾기', 'Use for unscheduled collab/event preview requests such as 검심 배열. Resolve series using existing KR/JP names, aliases and character IDs; compare latest known KR/JP pools. Newer JP pools may be used only as a reference simulation, NOT a confirmed Korean schedule/pool. Return candidates and exact prepare rows with previewFor. Ask which variant if ambiguous. Names are joined by stable cat IDs; untranslated new units retain source names. Do not fabricate release dates or extra units. Does not calculate.',
          schema({query: {type: 'string', minLength: 1, maxLength: 100}, lang: lang,
            series_id: int.call(0, 100_000)}, ['query'])],
        ['catsroll_cats', '캐릭터 찾기', 'Find exact character IDs by name (all forms) before selecting targets or seed-search rolls. details=true (at most 5 results) adds current base-form abilities, available talent types and dated source opinions with explicit form/investment context. Distinguish collection scarcity, farming/combo roles and combat tiers; missing notes mean unreviewed, not weak.', schema(paging.merge(details: {type: 'boolean'}))],
        ['catsroll_multi_data', 'Multi 화면 데이터', 'App transport for shared Multi selectors and public pools. Does not calculate.',
          schema({section: {type: 'string', enum: %w[bootstrap pool series]}, lang: lang,
            event: {type: 'string', maxLength: 100}, previewFor: lang}, ['section'])],
        ['catsroll_prepare', 'Multi·시드 계산 열기', 'Prepare the on-device app. Default count is 300 unless the user specifies it. Multi includes optional Find, Found cats list, route stamps and planMode. For vague beginner questions use catsroll_guide first. Resolve exact banner/cat IDs with catalog tools and pass cat_name with each target to verify identity; never guess numeric IDs. Before choosing a banner for a target, use catsroll_events(cat_id=...) to verify pool membership. Missing targets in selected pools or permitted tickets are rejected. maxGuaranteed is a resource budget, not proof a banner offers a guarantee; forceGuaranteed explicitly simulates it. Ask missing seed, region, banner, target and resource permissions only. seek accepts ordered character IDs; no seed required. This is NOT a computed result. User clicks Calculate in app; no server fallback.', input]
      ].map do |name, title, description, input_schema|
        if @ui_host == :claude && CLAUDE_TOOL_HINTS.key?(name)
          description = if name == 'catsroll_prepare'
            CLAUDE_TOOL_HINTS.fetch(name)
          else
            CLAUDE_TOOL_HINTS.fetch(name) + ' ' + description
          end
        end
        item = {name: name, title: title, description: description, inputSchema: input_schema,
          outputSchema: {type: 'object', additionalProperties: true},
          annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false}}
        if name == 'catsroll_prepare'
          item[:_meta] = {ui: {resourceUri: widget[:uri]},
            'openai/outputTemplate' => widget[:uri]}
        end
        item[:_meta] = {ui: {visibility: ['app']}} if name == 'catsroll_multi_data'
        item
      end
    end

    def integer(value, label, min, max)
      raise InvalidInput, "#{label}: expected integer #{min}..#{max}" unless value.is_a?(Integer) && (min..max).cover?(value)

      value
    end

    def boolean(value, label)
      raise InvalidInput, "#{label}: expected boolean" unless value == true || value == false

      value
    end

    def region(lang)
      raise InvalidInput, 'lang must be kr or jp' unless TrackApi::MultiLangs.include?(lang)

      Route.public_send("ball_#{lang}")
    end

    def page(items, args, key)
      offset = integer(args.fetch('offset', 0), 'offset', 0, 100_000)
      limit = integer(args.fetch('limit', 20), 'limit', 1, 50)
      {key => items.slice(offset, limit) || [], total: items.size,
       nextOffset: offset + limit < items.size ? offset + limit : nil}
    end

    def query(args)
      value = args.fetch('query', '')
      raise InvalidInput, 'query must be a string of at most 100 characters' unless value.is_a?(String) && value.size <= 100

      value.downcase
    end

    def events(args)
      lang = args.fetch('lang', 'kr')
      term = query(args).gsub(/\s+/, '')
      exact_series_ids = EventSeriesNames.exact_shortcut_ids(term)
      ball = region(lang)
      cat_id = integer(args['cat_id'], 'cat_id', 1, 1_000_000) if args.key?('cat_id')
      raise InvalidInput, 'Unknown character; resolve with catsroll_cats first' if cat_id && !ball.cats.key?(cat_id)
      entries = TrackApi.multi_events(ball).select do |item|
        next false unless exact_series_ids.empty? || exact_series_ids.include?(item[:series_id])
        names = [item[:event], item[:label], item[:series_name], *EventSeriesNames.shortcuts(item[:series_id])]
        next false unless names.join(' ').downcase.gsub(/\s+/, '').include?(term)
        !cat_id || GachaPool.new(ball, event_name: item[:event]).slots.values.any? { |ids| ids.include?(cat_id) }
      end.map { |item| item.slice(:event, :label, :series_id, :series_name, :start_on, :end_on, :platinum).merge(lang: lang) }
      page(entries, args, :events)
    end

    def event_reply(args)
      catalog = boolean(args.fetch('catalog', false), 'catalog')
      return tool_reply(events(args)) unless catalog
      raise InvalidInput, 'cat_id is for banner search, not the full app catalog' if args.key?('cat_id')

      lang = args.fetch('lang', 'kr')
      entries = TrackApi.multi_events(region(lang)).map do |item|
        item.slice(:event, :label, :series_id, :series_name, :start_on, :end_on,
          :group, :platinum).merge(lang: lang)
      end
      tool_reply({lang: lang, total: entries.size}).merge(_meta: {'catsroll/events' => entries})
    end

    def guide_reply(args)
      data = GptGuide.new.lookup(args)
      data['scope'] = 'explanation_only'
      data['authority'] = 'Use live Catsroll catalogs and explicitly shared app results for actual predictions.'
      data['responsePolicy'] = '초심자에게 먼저 핵심 2~4문장과 다음 행동 하나를 제안한다. 누락된 필수 정보 1~2개만 묻고 ID는 도구로 찾는다. prepared는 계산 전이다. 모르는 사실은 추측하지 않는다.'
      data.fetch('documents').each do |document|
        document['sourceUrl'] = "https://github.com/twkim96/catsroll/blob/main/doc/gpt-knowledge/#{document.fetch('id')}.md"
      end
      tool_reply(data)
    end

    def cats(args)
      lang = args.fetch('lang', 'kr')
      term = query(args)
      details = boolean(args.fetch('details', false), 'details')
      if details
        args = args.merge('limit' => args.fetch('limit', 5))
        integer(args['limit'], 'limit with details', 1, 5)
      end
      ball = region(lang)
      knowledge = GptCharacterKnowledge.new if details || !term.empty?
      entries = ball.cats.filter_map do |id, info|
        names = Array(info['name']).compact
        next unless [2, 3, 4, 5].include?(info['rarity']) &&
          (id.to_s == term || names.any? { |name| name.downcase.include?(term) } ||
            knowledge&.alias_matches?(id, term))

        {id: id, name: names.first || id.to_s, rarity: info['rarity']}
      end
      result = page(entries, args, :cats)
      if details
        result[:cats].each { |cat| cat.merge!(knowledge.details(ball, cat.fetch(:id))) }
      end
      result
    end

    def multi_data_reply(args)
      raise InvalidInput, 'Unknown UI data fields' unless (args.keys - %w[section lang event previewFor]).empty?
      lang = args.fetch('lang', 'kr')
      ball = region(lang)
      data = case args['section']
      when 'bootstrap'
        route = Struct.new(:lang, :name, :seed, :count, :event).
          new(lang, 0, 0, DEFAULT_COUNT, default_event(lang))
        TrackApi.multi_data(route)
      when 'series'
        TrackApi.event_series_data(Struct.new(:ball).new(ball))
      when 'pool'
        event = args['event']
        raise InvalidInput, 'Unknown banner' unless event.is_a?(String) && ball.events.key?(event)

        pool = TrackApi.pool_data_for(ball, event)
        args['previewFor'] ? localize_pool(pool, args['previewFor']) : pool
      else raise InvalidInput, 'Unknown UI data section'
      end
      tool_reply({status: 'data_ready', section: args['section'], execution: 'client',
        dataVersion: Digest::SHA256.hexdigest(JSON.generate(data))}).
        merge(_meta: {'catsroll/multi' => data})
    end

    def localize_pool(pool, display_lang)
      display_ball = region(display_lang)
      return pool unless pool[:cats]

      pool.merge(cats: pool[:cats].to_h { |id, cat|
        localized = Array(display_ball.cats[id]&.fetch('name', nil))
        names = Array(cat[:name]).each_with_index.map { |name, index|
          translated = localized[index]
          translated.is_a?(String) && !translated.empty? ? translated : name
        }
        [id, cat.merge(name: names)]
      })
    end

    def prepare(args)
      raise InvalidInput, 'Unknown input fields' unless (args.keys - INPUT_KEYS).empty?
      mode = args['mode']
      raise InvalidInput, 'mode must be multi, find or seek' unless %w[multi find seek].include?(mode)

      request = {
        mode: mode, last: integer(args.fetch('last', 0), 'last', 0, 1_000_000),
        count: integer(args.fetch('count', DEFAULT_COUNT), 'count', 1, [TrackMaxCount, 999].min),
        optimization: args.fetch('optimization', 'cost'),
        maxGuaranteed: integer(args.fetch('maxGuaranteed', 0), 'maxGuaranteed', 0, 20),
        maxPlatinum: integer(args.fetch('maxPlatinum', 0), 'maxPlatinum', 0, 20),
        maxLegendTicket: integer(args.fetch('maxLegendTicket', 0), 'maxLegendTicket', 0, 20),
        scheduleAware: boolean(args.fetch('scheduleAware', false), 'scheduleAware')
      }
      request[:findEnabled] = boolean(args.fetch('findEnabled', mode == 'find' ||
        (args['targets'].is_a?(Array) && !args['targets'].empty?)), 'findEnabled')
      request[:planMode] = boolean(args.fetch('planMode', false), 'planMode')
      request[:planName] = args.fetch('planName', '')
      raise InvalidInput, 'planName must be at most 80 characters' unless request[:planName].is_a?(String) && request[:planName].size <= 80
      raise InvalidInput, 'Unknown optimization' unless %w[cost cost40 cost50 distance balance pareto].include?(request[:optimization])
      raise InvalidInput, 'Seed search cannot apply last; ordinary observations only' if mode == 'seek' && request[:last] != 0

      request[:seed] = integer(args['seed'], 'seed', 1, 4_294_967_295) if mode != 'seek' || args.key?('seed')
      rows = args.fetch('rows', [{ 'lang' => 'kr', 'event' => default_event('kr') }])
      raise InvalidInput, 'rows: expected 1..8 banners' unless rows.is_a?(Array) && (1..8).cover?(rows.size)
      raise InvalidInput, 'seek requires exactly one banner' if mode == 'seek' && rows.size != 1

      event_catalogs = {}
      prepared_events = rows.map do |row|
        raise InvalidInput, 'Invalid banner row' unless row.is_a?(Hash) &&
          (row.keys - %w[lang event ubers forceGuaranteed previewFor]).empty?
        lang = row['lang']
        ball = region(lang)
        name = row['event']
        raise InvalidInput, 'Unknown banner; look up its exact event ID first' unless name.is_a?(String) && ball.events.key?(name)

        info = ball.events.fetch(name)
        catalog = event_catalogs[lang] ||= TrackApi.multi_events(ball)
        display_name = catalog.find { |item| item[:event] == name }&.fetch(:series_name, nil)
        pool = TrackApi.compact_find_pool_data(ball, name)
        raise InvalidInput, 'Banner has no usable pool data' unless pool[:exist]
        preview_for = row['previewFor']
        if preview_for
          raise InvalidInput, 'Reference preview does not identify an observed seed-search pool' if mode == 'seek'
          pool = localize_pool(pool, preview_for)
        end

        ubers = integer(row.fetch('ubers', 0), 'ubers', 0, 100)
        forced = row.fetch('forceGuaranteed', 0)
        raise InvalidInput, 'forceGuaranteed must be 0, 2, 7, 11 or 15' unless [0, 2, 7, 11, 15].include?(forced)
        if mode == 'seek' && (pool[:platinum] || pool[:guaranteed_rolls] == 15 || ubers > 0 || forced != 0)
          raise InvalidInput, 'Seed search currently supports ordinary draws on an unmodified regular banner only'
        end
        {lang: lang, event: name, label: TrackApi.multi_event_label(info), displayName: display_name,
         start_on: info['start_on'].to_s, end_on: info['end_on'].to_s,
         ubers: ubers, forceGuaranteed: forced, previewFor: preview_for, pool: pool}.compact
      end
      request[:rows] = prepared_events.map { |event| event.slice(:lang, :event, :ubers, :forceGuaranteed, :previewFor) }
      if request[:scheduleAware] && prepared_events.any? { |event| event[:previewFor] }
        raise InvalidInput, 'Reference previews have no confirmed future schedule; scheduleAware must be false'
      end
      targets = args.fetch('targets', [])
      raise InvalidInput, 'targets: expected at most 30 unique cats' unless targets.is_a?(Array) && targets.size <= 30
      request[:targets] = targets.map do |target|
        raise InvalidInput, 'Invalid target' unless target.is_a?(Hash) && (target.keys - %w[cat_id cat_name allow_ticket]).empty?
        id = integer(target['cat_id'], 'cat_id', 1, 1_000_000)
        raise InvalidInput, 'Unknown target character' unless prepared_events.any? { |event| region(event[:lang]).cats[id] }

        info = prepared_events.filter_map { |event| region(event[:lang]).cats[id] }.first
        names = Array(info&.fetch('name', nil)).compact
        identity_names = (names + TrackApi::MultiLangs.flat_map { |lang|
          Array(region(lang).cats[id]&.fetch('name', nil))
        }).compact
        if target.key?('cat_name') && (!target['cat_name'].is_a?(String) ||
            target['cat_name'].size > 100 ||
            !(identity_names.include?(target['cat_name']) || GptCharacterKnowledge.new.alias_matches?(id, target['cat_name'])))
          raise InvalidInput, "Target name does not match ID #{id}; resolve with catsroll_cats first"
        end
        {cat_id: id, cat_name: names.first || id.to_s,
          allow_ticket: boolean(target.fetch('allow_ticket', false), 'allow_ticket')}
      end
      raise InvalidInput, 'Duplicate targets' unless request[:targets].map { |t| t[:cat_id] }.uniq.size == targets.size
      tickets = []
      if mode == 'find' || request[:findEnabled]
        raise InvalidInput, 'Find requires targets' if targets.empty?
        raise InvalidInput, 'Find currently requires banners from one region' unless rows.map { |row| row['lang'] }.uniq.size == 1

        tickets = %w[platinum legend].filter_map do |kind|
          selected = prepared_events.find { |event| event[:pool][:platinum] == kind }
          ticket = selected || TrackApi.multi_ticket_pool(region(rows.first['lang']), kind)
          ticket&.merge(kind: kind, lang: rows.first['lang'])
        end
        request[:targets].each do |target|
          member = prepared_events.any? { |event|
            !event[:pool][:platinum] && pool_has_cat?(event[:pool], target[:cat_id]) }
          if target[:allow_ticket]
            member ||= tickets.any? { |ticket|
              budget = ticket[:kind] == 'legend' ? request[:maxLegendTicket] : request[:maxPlatinum]
              budget > 0 && pool_has_cat?(ticket[:pool], target[:cat_id]) }
          end
          unless member
            raise InvalidInput, "Target #{target[:cat_name]} (#{target[:cat_id]}) is absent from selected regular pools and permitted tickets; use catsroll_events with cat_id=#{target[:cat_id]} to select a matching banner"
          end
        end
      end
      payload = {request: request, events: prepared_events, tickets: tickets}
      payload[:seeker] = seeker_data(args, prepared_events.first, request) if mode == 'seek'
      version = Digest::SHA256.hexdigest(JSON.generate(payload))
      payload[:dataVersion] = version
      warnings = ['계산 준비만 완료했습니다. 앱에서 계산을 실행한 뒤 결과를 공유해야 합니다.']
      prepared_events.select { |event| event[:previewFor] }.each do |event|
        warnings << "참고 시뮬레이션: #{event[:lang].upcase} #{event[:event]} 풀을 #{event[:previewFor].upcase}용으로 가정합니다. 해당 지역의 미래 일정·풀 확정이 아닙니다."
      end
      if request[:maxGuaranteed] > 0 && prepared_events.none? { |event|
          !event[:pool][:platinum] && (event[:forceGuaranteed] > 0 || event[:pool][:guaranteed_rolls] > 0) }
        warnings << '확뽑 한도는 자원 예산입니다. 선택한 배너에는 확정 조건이 없어 이 설정으로는 확뽑을 사용하지 않습니다. 강제 확정은 실제 일정과 다른 가정임을 명시해야 합니다.'
      end
      summary = {status: 'prepared', execution: 'client', request: request, dataVersion: version,
        engineVersion: self.class.widget[:digest],
        guide: {tool: 'catsroll_guide', topics: mode == 'seek' ? %w[seed troubleshooting] :
          (request[:findEnabled] ? %w[find tracks guaranteed] : %w[tracks guaranteed colors])},
        events: prepared_events.map { |event| event.slice(:lang, :event, :label, :displayName, :start_on, :end_on, :previewFor).
          merge(guaranteedRolls: event[:forceGuaranteed] > 0 ? event[:forceGuaranteed] : event[:pool][:guaranteed_rolls],
            simulatedGuarantee: event[:forceGuaranteed] > 0) },
        siteUrl: site_url(request),
        warnings: warnings}
      tool_reply(summary).merge(_meta: {'catsroll/data' => payload})
    end

    def pool_has_cat?(pool, cat_id)
      pool[:exist] && pool[:slots].values.any? { |ids| ids.include?(cat_id) }
    end

    def default_event(lang)
      entries = TrackApi.multi_events(region(lang))
      (entries.find { |item| item[:group] == 'upcoming' && !item[:platinum] } || entries.first)&.fetch(:event)
    end

    def seeker_data(args, event, request)
      pool = event[:pool]
      choices = pool[:slots].flat_map do |rarity, ids|
        ids.each_with_index.map do |id, slot|
          {id: id, name: Array(pool[:cats][id]&.fetch(:name, nil)).first || id.to_s,
           rarity: rarity, slot: slot}
        end
      end
      # A repeated unit ID cannot encode a unique seeker slot; never guess one.
      raise InvalidInput, 'Seed search does not support duplicate pool IDs' unless choices.map { |cat| cat[:id] }.uniq.size == choices.size
      rolls = args.fetch('rolls', [])
      raise InvalidInput, 'rolls must be an ordered list of up to 10 character IDs' unless rolls.is_a?(Array) && rolls.size <= 10
      indexed = choices.to_h { |cat| [cat[:id], cat] }
      flat = rolls.flat_map do |id|
        integer(id, 'roll id', 1, 1_000_000)
        cat = indexed[id]
        raise InvalidInput, 'A rolled cat is absent from this banner' unless cat

        [cat[:rarity], cat[:slot]]
      end
      request[:rolls] = rolls
      {rates: %i[rare supa uber legend].map { |rarity| pool[:rates].fetch(rarity) },
       slots: [2, 3, 4, 5].map { |rarity| pool[:slots].fetch(rarity, []).size },
       rolls: flat, choices: choices}
    end

    def site_url(request)
      row = request[:rows].first
      query = {lang: row[:lang], event: row[:event]}
      if request[:mode] == 'seek'
        "#{self.class.public_origin}/seek?#{URI.encode_www_form(query)}"
      else
        "#{self.class.public_origin}/multi?#{URI.encode_www_form(query.merge(seed: request[:seed], count: request[:count]))}"
      end
    end
  end
end
