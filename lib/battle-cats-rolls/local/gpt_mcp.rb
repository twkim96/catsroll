# frozen_string_literal: true

require 'json'
require 'digest'
require 'base64'
require 'uri'
require 'rack'

module BattleCatsRolls
  # Stateless JSON Streamable HTTP. This adapter only prepares public game data;
  # the existing JS/WASM engines run in the user's UI, never on this server.
  class GptMcp
    VERSION = '0.1.0'
    PROTOCOLS = %w[2025-11-25 2025-06-18 2025-03-26].freeze
    MIME = 'text/html;profile=mcp-app'
    ASSETS = File.expand_path('../asset', __dir__)
    TEMPLATE = File.expand_path('../view/gpt_app.html', __dir__)
    BODY_LIMIT = 65_536
    INPUT_KEYS = %w[mode seed last count rows targets optimization maxGuaranteed
      maxPlatinum maxLegendTicket scheduleAware rolls].freeze

    class InvalidInput < StandardError; end
    class UnknownMethod < StandardError; end

    def self.enabled?
      ENV['CATSROLL_GPT_ENABLED'] == '1'
    end

    def self.public_origin
      ENV.fetch('CATSROLL_PUBLIC_ORIGIN', 'https://twkim96-my-cats-rolls.hf.space').sub(%r{/+\z}, '')
    end

    def self.widget
      files = %w[track-engine.js multi-find-engine.js seeker-vampireflower.js
        seeker-vampireflower.wasm gpt-runtime.js gpt-worker.js gpt-app.js gpt-app.css]
      digest = Digest::SHA256.hexdigest(files.map { |file|
        File.binread(File.join(ASSETS, file))
      }.join + File.binread(TEMPLATE))
      @widget ||= {}
      @widget = {} unless @widget.key?(digest)
      @widget[digest] ||= begin
        worker = %w[track-engine.js multi-find-engine.js seeker-vampireflower.js
          gpt-runtime.js].map { |file| File.read(File.join(ASSETS, file)) }.join("\n;\n")
        binary = Base64.strict_encode64(File.binread(File.join(ASSETS, 'seeker-vampireflower.wasm')))
        worker += "\n;self.CATSROLL_WASM_BASE64=#{JSON.generate(binary)};\n"
        worker += File.read(File.join(ASSETS, 'gpt-worker.js'))
        scripts = %w[gpt-runtime.js gpt-app.js].map { |file|
          File.read(File.join(ASSETS, file))
        }.join("\n;\n").gsub(%r{</script}i, '<\\/script')
        replacements = {
          '{{STYLE}}' => File.read(File.join(ASSETS, 'gpt-app.css')),
          '{{SCRIPTS}}' => scripts,
          '{{WORKER_SOURCE}}' => JSON.generate(worker).gsub('<', '\\u003c')
        }
        html = File.read(TEMPLATE).gsub(/\{\{(?:STYLE|SCRIPTS|WORKER_SOURCE)\}\}/) { |key|
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
         instructions: 'Use catsroll_events and catsroll_cats to resolve exact IDs. catsroll_prepare only prepares data; it does NOT compute a seed, array or route. The user must run the embedded app. Only describe computed results explicitly shared by the app. If UI is unavailable, provide the site link. Keep ambiguous seeds and partial searches explicitly uncertain. Never silently switch to server computation.'}
      when 'ping' then {}
      when 'tools/list' then {tools: tools}
      when 'tools/call'
        begin
          args = params.fetch('arguments', {})
          raise InvalidInput, 'arguments must be an object' unless args.is_a?(Hash)

          case params['name']
          when 'catsroll_events' then tool_reply(events(args))
          when 'catsroll_cats' then tool_reply(cats(args))
          when 'catsroll_prepare' then prepare(args)
          else raise InvalidInput, 'Unknown tool'
          end
        rescue InvalidInput => error
          {isError: true, content: [{type: 'text', text: error.message}]}
        end
      when 'resources/list'
        {resources: [{uri: self.class.widget[:uri], name: 'catsroll-multi', mimeType: MIME}]}
      when 'resources/templates/list' then {resourceTemplates: []}
      when 'resources/read'
        raise InvalidInput, 'Unknown resource; list resources again' unless params['uri'] == self.class.widget[:uri]

        meta = {ui: {csp: {connectDomains: [], resourceDomains: []}},
          'openai/widgetDescription' => 'Catsroll: device-only Multi arrays, route search and seed finder. Prepared inputs are not computed results.'}
        domain = ENV['CATSROLL_GPT_UI_ORIGIN']
        meta[:ui][:domain] = domain if domain && !domain.empty?
        {contents: [{uri: params['uri'], mimeType: MIME, text: self.class.widget[:text], _meta: meta}]}
      else
        # Method errors are handled separately from invalid tool arguments.
        raise UnknownMethod
      end
    end

    private

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
      row = schema({lang: lang, event: {type: 'string', maxLength: 100},
        ubers: int.call(0, 100), forceGuaranteed: {type: 'integer', enum: [0, 11, 15]}}, %w[lang event])
      input = schema({mode: {type: 'string', enum: %w[multi find seek]},
        seed: int.call(1, 4_294_967_295), last: int.call(0, 1_000_000),
        count: int.call(1, [TrackMaxCount, 999].min),
        rows: {type: 'array', minItems: 1, maxItems: 8, items: row},
        targets: {type: 'array', maxItems: 30,
          items: schema({cat_id: int.call(1, 1_000_000), allow_ticket: {type: 'boolean'}}, ['cat_id'])},
        optimization: {type: 'string', enum: %w[cost cost40 cost50 distance balance pareto]},
        maxGuaranteed: int.call(0, 20), maxPlatinum: int.call(0, 20),
        maxLegendTicket: int.call(0, 20), scheduleAware: {type: 'boolean'},
        rolls: {type: 'array', maxItems: 10, items: int.call(1, 1_000_000)}}, ['mode'])
      [
        ['catsroll_events', '배너 찾기', 'Find public KR/JP banners by name/date. Returns IDs and pagination; does not calculate.', schema(paging)],
        ['catsroll_cats', '캐릭터 찾기', 'Find exact character IDs by name (all forms) before selecting targets or seed-search rolls.', schema(paging)],
        ['catsroll_prepare', 'Multi·시드 계산 열기', 'Prepare the on-device app. Ask for seed for multi/find, exact banners, last rare if known, target and resource limits. seek accepts ordered character IDs; no seed required. This is NOT a computed result. User clicks calculate in app; no server fallback.', input]
      ].map do |name, title, description, input_schema|
        item = {name: name, title: title, description: description, inputSchema: input_schema,
          outputSchema: {type: 'object', additionalProperties: true},
          annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false}}
        if name == 'catsroll_prepare'
          item[:_meta] = {ui: {resourceUri: self.class.widget[:uri]},
            'openai/outputTemplate' => self.class.widget[:uri]}
        end
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
      term = query(args)
      entries = TrackApi.multi_events(region(lang)).select do |item|
        "#{item[:event]} #{item[:label]} #{item[:series_name]}".downcase.include?(term)
      end.map { |item| item.slice(:event, :label, :start_on, :end_on, :platinum).merge(lang: lang) }
      page(entries, args, :events)
    end

    def cats(args)
      lang = args.fetch('lang', 'kr')
      term = query(args)
      entries = region(lang).cats.filter_map do |id, info|
        names = Array(info['name']).compact
        next unless [2, 3, 4, 5].include?(info['rarity']) &&
          (id.to_s == term || names.any? { |name| name.downcase.include?(term) })

        {id: id, name: names.first || id.to_s, rarity: info['rarity']}
      end
      page(entries, args, :cats)
    end

    def prepare(args)
      raise InvalidInput, 'Unknown input fields' unless (args.keys - INPUT_KEYS).empty?
      mode = args['mode']
      raise InvalidInput, 'mode must be multi, find or seek' unless %w[multi find seek].include?(mode)

      request = {
        mode: mode, last: integer(args.fetch('last', 0), 'last', 0, 1_000_000),
        count: integer(args.fetch('count', 100), 'count', 1, [TrackMaxCount, 999].min),
        optimization: args.fetch('optimization', 'cost'),
        maxGuaranteed: integer(args.fetch('maxGuaranteed', 0), 'maxGuaranteed', 0, 20),
        maxPlatinum: integer(args.fetch('maxPlatinum', 0), 'maxPlatinum', 0, 20),
        maxLegendTicket: integer(args.fetch('maxLegendTicket', 0), 'maxLegendTicket', 0, 20),
        scheduleAware: boolean(args.fetch('scheduleAware', false), 'scheduleAware')
      }
      raise InvalidInput, 'Unknown optimization' unless %w[cost cost40 cost50 distance balance pareto].include?(request[:optimization])
      raise InvalidInput, 'Seed search cannot apply last; ordinary observations only' if mode == 'seek' && request[:last] != 0

      request[:seed] = integer(args['seed'], 'seed', 1, 4_294_967_295) if mode != 'seek' || args.key?('seed')
      rows = args.fetch('rows', [{ 'lang' => 'kr', 'event' => default_event('kr') }])
      raise InvalidInput, 'rows: expected 1..8 banners' unless rows.is_a?(Array) && (1..8).cover?(rows.size)
      raise InvalidInput, 'seek requires exactly one banner' if mode == 'seek' && rows.size != 1

      prepared_events = rows.map do |row|
        raise InvalidInput, 'Invalid banner row' unless row.is_a?(Hash) &&
          (row.keys - %w[lang event ubers forceGuaranteed]).empty?
        lang = row['lang']
        ball = region(lang)
        name = row['event']
        raise InvalidInput, 'Unknown banner; look up its exact event ID first' unless name.is_a?(String) && ball.events.key?(name)

        info = ball.events.fetch(name)
        pool = TrackApi.compact_find_pool_data(ball, name)
        raise InvalidInput, 'Banner has no usable pool data' unless pool[:exist]

        ubers = integer(row.fetch('ubers', 0), 'ubers', 0, 100)
        forced = row.fetch('forceGuaranteed', 0)
        raise InvalidInput, 'forceGuaranteed must be 0, 11 or 15' unless [0, 11, 15].include?(forced)
        if mode == 'seek' && (pool[:platinum] || pool[:guaranteed_rolls] == 15 || ubers > 0 || forced != 0)
          raise InvalidInput, 'Seed search currently supports ordinary draws on an unmodified regular banner only'
        end
        {lang: lang, event: name, label: TrackApi.multi_event_label(info),
         start_on: info['start_on'].to_s, end_on: info['end_on'].to_s,
         ubers: ubers, forceGuaranteed: forced, pool: pool}
      end
      request[:rows] = prepared_events.map { |event| event.slice(:lang, :event, :ubers, :forceGuaranteed) }
      targets = args.fetch('targets', [])
      raise InvalidInput, 'targets: expected at most 30 unique cats' unless targets.is_a?(Array) && targets.size <= 30
      request[:targets] = targets.map do |target|
        raise InvalidInput, 'Invalid target' unless target.is_a?(Hash) && (target.keys - %w[cat_id allow_ticket]).empty?
        id = integer(target['cat_id'], 'cat_id', 1, 1_000_000)
        raise InvalidInput, 'Unknown target character' unless prepared_events.any? { |event| region(event[:lang]).cats[id] }

        {cat_id: id, allow_ticket: boolean(target.fetch('allow_ticket', false), 'allow_ticket')}
      end
      raise InvalidInput, 'Duplicate targets' unless request[:targets].map { |t| t[:cat_id] }.uniq.size == targets.size
      tickets = []
      if mode == 'find'
        raise InvalidInput, 'Find requires targets' if targets.empty?
        raise InvalidInput, 'Find currently requires banners from one region' unless rows.map { |row| row['lang'] }.uniq.size == 1

        tickets = %w[platinum legend].filter_map do |kind|
          selected = prepared_events.find { |event| event[:pool][:platinum] == kind }
          ticket = selected || TrackApi.multi_ticket_pool(region(rows.first['lang']), kind)
          ticket&.merge(kind: kind, lang: rows.first['lang'])
        end
      end
      payload = {request: request, events: prepared_events, tickets: tickets}
      payload[:seeker] = seeker_data(args, prepared_events.first, request) if mode == 'seek'
      version = Digest::SHA256.hexdigest(JSON.generate(payload))
      payload[:dataVersion] = version
      summary = {status: 'prepared', execution: 'client', request: request, dataVersion: version,
        engineVersion: self.class.widget[:digest],
        events: prepared_events.map { |event| event.slice(:lang, :event, :label, :start_on, :end_on) },
        siteUrl: site_url(request),
        warnings: ['계산 준비만 완료했습니다. 앱에서 계산을 실행한 뒤 결과를 공유해야 합니다.']}
      tool_reply(summary).merge(_meta: {'catsroll/data' => payload})
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
