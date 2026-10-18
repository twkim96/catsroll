# frozen_string_literal: true

require 'json'
require 'securerandom'
require 'time'

module BattleCatsRolls
  # In-memory, host-scoped storage for snapshots explicitly shared by the UI.
  # It never computes or verifies the client-reported results.
  class GptResults
    class InvalidInput < StandardError; end
    class PublishError < InvalidInput
      attr_reader :code, :retryable, :retry_after_seconds

      def initialize(code, message, retryable: false, retry_after_seconds: nil)
        super(message)
        @code, @retryable, @retry_after_seconds = code, retryable, retry_after_seconds
      end
    end

    MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
    MAX_RESPONSE_BYTES = 32 * 1024
    PAGE_BUDGET = MAX_RESPONSE_BYTES - 1024
    MAX_BANNERS = 8
    MAX_ROWS = 999
    MAX_TTL = 3600
    DEFAULT_TTL = 3600
    DEFAULT_ENTRIES = 256
    DEFAULT_BYTES = 64 * 1024 * 1024
    SESSION_ENTRIES = 4
    SESSION_BYTES = 16 * 1024 * 1024
    MAX_IN_FLIGHT = 2
    HOSTS = %i[chatgpt claude].freeze
    AUTHORITY = 'client_computed_not_server_verified'.freeze

    Entry = Struct.new(:json, :expires_at, :expires_iso, :bytes, :session,
      :operation, keyword_init: true)

    FIND_SUMMARY_KEYS = %w[
      enabled status message destination nextOffset optimization cost scoreUnits
      costUnits rawCost baseCost regularUnitCost balanceCredit harvestDraws
      paretoBaseCost paretoAllowance paretoBudget uberDraws legendDraws
      paretoPrunedTargetCost paretoPrunedTargetCapacity paretoPrunedHarvestBound
      regularUses ticketUses platinumUses legendTicketUses guaranteedUses
      targetAcquired targetTotal explored elapsedMs stateLimit totalDraws
      regularActions ticketActions guaranteedActions
    ].freeze
    FIND_KEYS = (FIND_SUMMARY_KEYS + %w[
      actionContexts actionCats targetsAcquired actions
    ]).freeze
    ACTION_KEYS = %w[
      type actionIndex ticketKind lang event eventLabel scheduleDay
      scheduleStartDay scheduleEndDay start resultLabel next catId catName
      rarity rerolled rerollSteps originalCatId originalCatName avoidedR
      defense pulls guaranteedLabel uberDraws legendDraws harvestDraws cost
      context acquired routePulls count actionStart actionEnd
    ].freeze
    TRACK_KEYS = %w[seed last count formIndex rows].freeze
    ROW_KEYS = %w[lang event ubers forceGuaranteed customName customNameAuto
      seriesIds previewFor].freeze
    SETTINGS_KEYS = %w[optimization maxGuaranteed scheduleAware maxPlatinum
      maxLegendTicket targets].freeze
    BANNER_KEYS = %w[banner lang rowsTotal rowsIncluded rowsOmitted
      conditionalTotal conditionalIncluded conditionalOmitted names rows
      conditional rarities].freeze
    PLAN_KEYS = %w[enabled name marks route cats progress].freeze
    MARK_KEYS = %w[column position kind variant].freeze
    CAT_KEYS = %w[id name rarity positions].freeze
    CONTEXT_KEYS = %w[lang event eventLabel scheduleDay scheduleStartDay
      scheduleEndDay].freeze
    TARGET_KEYS = %w[targetIndex catId catName resultLabel drawNumber drawRange].freeze
    ACQUISITION_KEYS = %w[actionIndex targetIndex catId catName resultLabel drawNumber drawRange].freeze
    # Eight 999-row banners can contain four conditional histories per A/B
    # position plus nested R/G cells. Keep that supported shape within bounds.
    MAX_NODES = 2_000_000
    DEFAULT_MUTEX = Mutex.new
    PUBLISH_MUTEX = Mutex.new

    class << self
      def default
        DEFAULT_MUTEX.synchronize { @default ||= new }
      end

      # The default registry is process-global. This class-level throttle also
      # prevents bypassing it by constructing additional registries.
      def reserve_publish!(now = Process.clock_gettime(Process::CLOCK_MONOTONIC))
        PUBLISH_MUTEX.synchronize do
          @publish_times ||= []
          @publish_times.reject! { |time| now - time >= 60 || now < time }
          if @publish_times.length >= 60
            raise PublishError.new('rate_limited', 'Sharing is temporarily rate limited',
              retryable: true, retry_after_seconds: 60)
          end

          @publish_times << now
        end
      end

    end

    def initialize(clock: nil, ttl: DEFAULT_TTL, max_entries: DEFAULT_ENTRIES,
      max_bytes: DEFAULT_BYTES, max_session_entries: SESSION_ENTRIES,
      max_session_bytes: SESSION_BYTES)
      unless ttl.is_a?(Integer) && (1..MAX_TTL).cover?(ttl)
        raise ArgumentError, "ttl must be an integer from 1 to #{MAX_TTL}"
      end
      unless max_entries.is_a?(Integer) && max_entries.positive?
        raise ArgumentError, 'max_entries must be a positive integer'
      end
      unless max_bytes.is_a?(Integer) && max_bytes.positive?
        raise ArgumentError, 'max_bytes must be a positive integer'
      end
      unless [max_session_entries, max_session_bytes].all? { |value| value.is_a?(Integer) && value.positive? }
        raise ArgumentError, 'session budgets must be positive integers'
      end

      @ttl = ttl
      @max_entries = max_entries
      @max_bytes = max_bytes
      @max_session_entries, @max_session_bytes = max_session_entries, max_session_bytes
      @clock = clock || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
      raise ArgumentError, 'clock must respond to call' unless @clock.respond_to?(:call)

      @entries = {}
      @bytes = 0
      @in_flight = 0
      @session_writes = {}
      @mutex = Mutex.new
    end

    def publish(snapshot, host: :chatgpt, session_id: nil, idempotency_key: nil)
      namespace = normalize_host(host)
      if session_id || idempotency_key
        unless [session_id, idempotency_key].all? { |value| value.is_a?(String) && /\A[0-9a-f]{64}\z/.match?(value) }
          raise InvalidInput, 'session_id and idempotency_key must both be 64 lowercase hex characters'
        end
      end
      session = [namespace, session_id || 'legacy']
      now, wall_now = clock_values
      reserved = false
      @mutex.synchronize do
        purge_expired!(now)
        if @in_flight >= MAX_IN_FLIGHT
          raise PublishError.new('busy', 'Snapshot processing is busy', retryable: true, retry_after_seconds: 2)
        end
        retrying = idempotency_key && @entries.values.any? { |item| item.session == session && item.operation == idempotency_key }
        unless retrying
          @session_writes.delete_if { |_key, times| times.reject! { |time| now - time >= 60 || now < time }; times.empty? }
          times = @session_writes.fetch(session, [])
          if times.length >= 6 || (!@session_writes.key?(session) && @session_writes.length >= 1024)
            raise PublishError.new('rate_limited', 'This anonymous session is temporarily rate limited', retryable: true, retry_after_seconds: 60)
          end
          self.class.reserve_publish!
          (@session_writes[session] ||= []) << now
        end
        @in_flight += 1
        reserved = true
      end
      json = normalize_snapshot(snapshot)
      json_size = json.bytesize
      raise InvalidInput, 'Snapshot exceeds the 8 MiB limit' if json_size > MAX_SNAPSHOT_BYTES

      expires_at = now + @ttl
      expires_iso = (wall_now.utc + @ttl).iso8601

      @mutex.synchronize do
        purge_expired!(now)
        owned = @entries.select { |_key, item| item.session == session }
        if idempotency_key
          existing = owned.find { |_key, item| item.operation == idempotency_key }
          if existing
            key, entry = existing
            unless entry.json == json
              raise PublishError.new('idempotency_conflict', 'Share key already belongs to a different snapshot')
            end
            return publish_response(key[1], entry)
          end
        end
        if owned.length >= @max_session_entries || owned.values.sum(&:bytes) + json_size > @max_session_bytes
          raise PublishError.new('session_full', 'This anonymous session has reached its snapshot budget')
        end
        if @entries.length >= @max_entries || @bytes + json_size > @max_bytes
          raise PublishError.new('storage_full', 'Snapshot storage is at capacity; export your result or try later', retryable: true)
        end

        result_id = nil
        loop do
          candidate = SecureRandom.hex(32)
          unless @entries.key?([namespace, candidate])
            result_id = candidate
            break
          end
        end
        entry = Entry.new(json: json.freeze,
          expires_at: expires_at, expires_iso: expires_iso, bytes: json_size,
          session: session, operation: idempotency_key)
        response = publish_response(result_id, entry)
        @entries[[namespace, result_id]] = entry
        @bytes += json_size
        response
      end
    ensure
      @mutex.synchronize { @in_flight -= 1 } if reserved
    end

    def lookup(args, host: :chatgpt)
      namespace = normalize_host(host)
      options = normalize_query(args)
      result_id = options.fetch('result_id')
      view = options.fetch('view', 'summary')
      unless result_id.is_a?(String) && /\A[0-9a-f]{64}\z/.match?(result_id)
        return unavailable(view)
      end

      now = monotonic_now
      entry = @mutex.synchronize do
        purge_expired!(now)
        key = [namespace, result_id]
        found = @entries[key]
        if found && now >= found.expires_at
          delete_entry!(key)
          nil
        else
          found
        end
      end
      return unavailable(view) unless entry

      reserved = false
      @mutex.synchronize do
        if @in_flight >= MAX_IN_FLIGHT
          raise PublishError.new('busy', 'Snapshot processing is busy', retryable: true, retry_after_seconds: 2)
        end
        @in_flight += 1
        reserved = true
      end
      snapshot = JSON.parse(entry.json)
      response = case view
      when 'summary' then summary_view(snapshot)
      when 'array' then array_view(snapshot, options)
      when 'character' then character_view(snapshot, options)
      when 'route' then route_view(snapshot, options)
      when 'plan' then plan_view(snapshot, options)
      end
      response['status'] ||= 'ok'
      response['view'] = view
      response['authority'] = AUTHORITY
      response['result_id'] = result_id
      if view == 'array'
        (response['banners'] || [response]).each do |page|
          page['nextConditionalQuery']['result_id'] = result_id if page['nextConditionalQuery']
        end
      end
      bounded_response!(response)
    ensure
      @mutex.synchronize { @in_flight -= 1 } if reserved
    end

    private

    def publish_response(result_id, entry)
      bounded_response!({'result_id' => result_id, 'expires_at' => entry.expires_iso,
        'ttl_seconds' => [entry.expires_at - monotonic_now, 0].max.floor,
        'summary' => reference_summary(JSON.parse(entry.json))})
    end

    def monotonic_now
      clock_values.first
    end

    def clock_values
      if @clock.respond_to?(:monotonic) && @clock.respond_to?(:now)
        monotonic = @clock.monotonic
        wall = @clock.now
      elsif @clock.arity == 0
        value = @clock.call
        if value.is_a?(Time)
          monotonic = value.to_f
          wall = value
        else
          monotonic = value
          wall = Time.now
        end
      else
        monotonic, wall = @clock.call
      end
      monotonic = monotonic.to_f
      raise ArgumentError, 'clock must provide a finite monotonic time and a Time wall clock' unless monotonic.finite? && wall.is_a?(Time)

      [monotonic, wall]
    end

    def normalize_host(host)
      value = host.is_a?(String) ? host.to_sym : host
      raise InvalidInput, 'Unsupported result host' unless HOSTS.include?(value)

      value
    end

    def normalize_query(args)
      raise InvalidInput, 'arguments must be an object' unless args.is_a?(Hash) && args.keys.all? { |key| key.is_a?(String) }

      allowed = %w[result_id view banner start rowEnd limit offset cat_id]
      unknown = args.keys - allowed
      raise InvalidInput, 'Unknown result query argument' unless unknown.empty?
      raise InvalidInput, 'result_id is required' unless args.key?('result_id')

      view = args.fetch('view', 'summary')
      raise InvalidInput, 'view must be summary, array, character, route, or plan' unless %w[summary array character route plan].include?(view)

      integer_option(args, 'banner', 0, MAX_BANNERS - 1) if args.key?('banner')
      integer_option(args, 'start', 1, MAX_ROWS) if args.key?('start')
      if args.key?('rowEnd')
        integer_option(args, 'rowEnd', args.fetch('start', 1), MAX_ROWS)
        raise InvalidInput, 'rowEnd requires an array banner continuation' unless view == 'array' && args.key?('banner')
      end
      integer_option(args, 'limit', 1, 50) if args.key?('limit')
      integer_option(args, 'offset', 0, 100_000) if args.key?('offset')
      integer_option(args, 'cat_id', 1, 2_000_000) if args.key?('cat_id')
      if view == 'character' && !args.key?('cat_id')
        raise InvalidInput, 'cat_id is required for character view'
      end
      args.merge('view' => view)
    end

    def integer_option(args, key, min, max)
      value = args[key]
      raise InvalidInput, "#{key} must be an integer from #{min} to #{max}" unless value.is_a?(Integer) && (min..max).cover?(value)

      value
    end

    def normalize_snapshot(snapshot)
      walk_snapshot(snapshot)
      raise InvalidInput, 'Snapshot must be an object' unless snapshot.is_a?(Hash)

      exact_keys!(snapshot, %w[schema_version data_version input find plan banners], required: %w[schema_version data_version input find plan banners])
      raise InvalidInput, 'Unsupported snapshot schema' unless snapshot['schema_version'] == 1
      string!(snapshot['data_version'], 'data_version', max: 128)
      validate_input!(snapshot['input'])
      validate_find!(snapshot['find'])
      validate_plan!(snapshot['plan'])
      validate_banners!(snapshot['banners'])
      JSON.generate(snapshot, max_nesting: 20).freeze
    rescue JSON::GeneratorError, EncodingError, TypeError => error
      raise InvalidInput, "Malformed snapshot: #{error.class}"
    end

    def walk_snapshot(value, depth = 0, counter = [0])
      counter[0] += 1
      raise InvalidInput, 'Snapshot is too structurally complex' if counter[0] > MAX_NODES || depth > 20

      case value
      when Hash
        raise InvalidInput, 'Snapshot objects must have string keys' unless value.keys.all? { |key| key.is_a?(String) && key.bytesize <= 128 }
        value.each do |key, child|
          string!(key, 'snapshot key', max: 128)
          walk_snapshot(child, depth + 1, counter)
        end
      when Array
        raise InvalidInput, 'Snapshot array is too large' if value.length > 100_000
        value.each { |child| walk_snapshot(child, depth + 1, counter) }
      when String
        string!(value, 'snapshot text', max: 16_384)
      when Integer, TrueClass, FalseClass, NilClass
        nil
      when Float
        raise InvalidInput, 'Snapshot numbers must be finite' unless value.finite?
      else
        raise InvalidInput, 'Snapshot contains an unsupported value'
      end
    end

    def validate_input!(input)
      exact_keys!(input, %w[track findEnabled findSettings], required: %w[track findEnabled findSettings])
      track = input['track']
      exact_keys!(track, TRACK_KEYS, required: TRACK_KEYS)
      integer_value!(track['seed'], 0, 4_294_967_295, 'track.seed')
      integer_value!(track['last'], 0, 10_000_000, 'track.last')
      integer_value!(track['count'], 1, MAX_ROWS, 'track.count')
      integer_value!(track['formIndex'], 0, 20, 'track.formIndex')
      array!(track['rows'], 'track.rows', max: MAX_BANNERS)
      track['rows'].each do |row|
        exact_keys!(row, ROW_KEYS, required: %w[lang event])
        string!(row['lang'], 'track row lang', max: 12, min: 1)
        string!(row['event'], 'track row event', max: 180, min: 1)
        integer_value!(row['ubers'], 0, 100, 'track row ubers') if row.key?('ubers')
        integer_value!(row['forceGuaranteed'], 0, 15, 'track row forceGuaranteed') if row.key?('forceGuaranteed')
        string!(row['customName'], 'track row customName', max: 160) if row.key?('customName')
        boolean!(row['customNameAuto'], 'track row customNameAuto') if row.key?('customNameAuto')
        if row.key?('seriesIds')
          array!(row['seriesIds'], 'seriesIds', max: 100)
          row['seriesIds'].each { |id| integer_value!(id, 0, 100_000, 'series id') }
        end
        string!(row['previewFor'], 'previewFor', max: 2) if row.key?('previewFor')
      end
      boolean!(input['findEnabled'], 'findEnabled')
      validate_find_settings!(input['findSettings'])
    end

    def validate_find_settings!(settings)
      return if settings.nil?

      exact_keys!(settings, SETTINGS_KEYS)
      %w[optimization].each { |key| string!(settings[key], key, max: 40) if settings.key?(key) }
      %w[maxGuaranteed maxPlatinum maxLegendTicket].each do |key|
        integer_value!(settings[key], 0, 100_000, key) if settings.key?(key)
      end
      boolean!(settings['scheduleAware'], 'scheduleAware') if settings.key?('scheduleAware')
      if settings.key?('targets')
        array!(settings['targets'], 'find targets', max: 100)
        settings['targets'].each do |target|
          exact_keys!(target, %w[cat_id allow_ticket], required: %w[cat_id allow_ticket])
          integer_value!(target['cat_id'], 1, 2_000_000, 'target cat_id')
          boolean!(target['allow_ticket'], 'target allow_ticket')
        end
      end
    end

    def validate_find!(find)
      exact_keys!(find, FIND_KEYS)
      string!(find['status'], 'find.status', max: 60) if find.key?('status')
      %w[message destination optimization].each do |key|
        string!(find[key], "find.#{key}", max: key == 'message' ? 2000 : 300) if find.key?(key) && !find[key].nil?
      end
      %w[enabled].each { |key| boolean!(find[key], "find.#{key}") if find.key?(key) }
      FIND_SUMMARY_KEYS.each do |key|
        next unless find.key?(key) && !%w[enabled status message destination optimization].include?(key)
        next if find[key].nil?

        if find[key].is_a?(Integer)
          raise InvalidInput, "find.#{key} is out of range" unless find[key].between?(-1_000_000_000, 1_000_000_000_000)
        elsif find[key].is_a?(Float)
          raise InvalidInput, "find.#{key} is not finite" unless find[key].finite?
        else
          raise InvalidInput, "find.#{key} must be numeric"
        end
      end
      if find.key?('actionContexts')
        array!(find['actionContexts'], 'actionContexts', max: 100_000)
        find['actionContexts'].each do |context|
          exact_keys!(context, CONTEXT_KEYS)
          context.each do |key, value|
            if %w[scheduleDay scheduleStartDay scheduleEndDay].include?(key)
              integer_value!(value, 0, 10_000_000, "action context #{key}") unless value.nil?
            else
              string!(value, "action context #{key}", max: 300)
            end
          end
        end
      end
      if find.key?('actionCats')
        hash!(find['actionCats'], 'actionCats', max: 100_000)
        find['actionCats'].each do |id, item|
          raise InvalidInput, 'actionCats keys must be integer IDs' unless /\A-?\d{1,8}\z/.match?(id)
          exact_keys!(item, %w[name rarity])
          string!(item['name'], 'action cat name', max: 300) if item.key?('name')
          integer_value!(item['rarity'], 0, 10, 'action cat rarity') if item.key?('rarity')
        end
      end
      if find.key?('targetsAcquired')
        array!(find['targetsAcquired'], 'targetsAcquired', max: 100_000)
        find['targetsAcquired'].each { |target| validate_acquisition!(target) }
      end
      return unless find.key?('actions')

      array!(find['actions'], 'find.actions', max: 100_000)
      find['actions'].each do |action|
        exact_keys!(action, ACTION_KEYS, required: %w[type])
        raise InvalidInput, 'Unsupported action type' unless %w[roll ticket guaranteed rollBatch].include?(action['type'])
        action.each do |key, value|
          case key
          when 'lang', 'event', 'eventLabel', 'scheduleDay', 'scheduleStartDay', 'scheduleEndDay', 'start', 'resultLabel', 'next', 'ticketKind', 'guaranteedLabel', 'catName', 'originalCatName'
            if %w[scheduleDay scheduleStartDay scheduleEndDay].include?(key)
              integer_value!(value, 0, 10_000_000, "action.#{key}") unless value.nil?
            else
              string!(value, "action.#{key}", max: 300) unless value.nil?
            end
          when 'context'
            integer_value!(value, 0, 100_000, 'action.context')
            raise InvalidInput, 'action context index is out of range' unless value < Array(find['actionContexts']).length
          when 'acquired'
            array!(value, 'action.acquired', max: 100)
            value.each { |item| validate_action_acquisition!(item) }
          when 'routePulls'
            array!(value, 'action.routePulls', max: 100)
            value.each do |pull|
              exact_keys!(pull, %w[resultLabel rerolled guaranteed])
              string!(pull['resultLabel'], 'route pull resultLabel', max: 300) if pull.key?('resultLabel')
              boolean!(pull['rerolled'], 'route pull rerolled') if pull.key?('rerolled')
              boolean!(pull['guaranteed'], 'route pull guaranteed') if pull.key?('guaranteed')
            end
          when 'rerolled', 'avoidedR', 'defense'
            boolean!(value, "action.#{key}") unless value.nil?
          when 'type'
            nil
          when 'cost'
            numeric_value!(value, 'action.cost') unless value.nil?
          else
            integer_value!(value, -1_000_000, 1_000_000_000_000, "action.#{key}") unless value.nil?
          end
        end
      end
    end

    def validate_acquisition!(target)
      exact_keys!(target, ACQUISITION_KEYS, required: %w[actionIndex catId resultLabel])
      integer_value!(target['actionIndex'], 1, 1_000_000, 'acquisition actionIndex')
      integer_value!(target['targetIndex'], 0, 100_000, 'acquisition targetIndex') if target.key?('targetIndex')
      integer_value!(target['catId'], 1, 2_000_000, 'acquisition catId')
      string!(target['catName'], 'acquisition catName', max: 300) if target.key?('catName') && !target['catName'].nil?
      string!(target['resultLabel'], 'acquisition resultLabel', max: 300)
      integer_value!(target['drawNumber'], 1, 1_000_000, 'drawNumber') if target.key?('drawNumber') && !target['drawNumber'].nil?
      if target.key?('drawRange') && target['drawRange']
        array!(target['drawRange'], 'drawRange', max: 2)
        raise InvalidInput, 'drawRange must have two positions' unless target['drawRange'].length == 2
        target['drawRange'].each { |number| integer_value!(number, 1, 1_000_000, 'drawRange') }
      end
    end

    def validate_action_acquisition!(target)
      exact_keys!(target, TARGET_KEYS - %w[drawNumber drawRange],
        required: %w[catId resultLabel])
      integer_value!(target['targetIndex'], 0, 100_000, 'acquisition targetIndex') if target.key?('targetIndex')
      integer_value!(target['catId'], 1, 2_000_000, 'acquisition catId')
      string!(target['catName'], 'acquisition catName', max: 300) if target.key?('catName') && !target['catName'].nil?
      string!(target['resultLabel'], 'acquisition resultLabel', max: 300)
    end

    def validate_plan!(plan)
      return if plan.nil?

      exact_keys!(plan, PLAN_KEYS)
      boolean!(plan['enabled'], 'plan.enabled') if plan.key?('enabled')
      string!(plan['name'], 'plan.name', max: 300) if plan.key?('name') && !plan['name'].nil?
      string!(plan['progress'], 'plan.progress', max: 2000) if plan.key?('progress') && !plan['progress'].nil?
      %w[marks route].each do |key|
        next unless plan.key?(key)

        array!(plan[key], "plan.#{key}", max: 100_000)
        plan[key].each do |mark|
          exact_keys!(mark, MARK_KEYS)
          integer_value!(mark['column'], 0, MAX_BANNERS - 1, 'plan mark column') if mark.key?('column')
          validate_position!(mark['position'], max: MAX_ROWS, label: 'plan position') if mark.key?('position')
          string!(mark['kind'], 'plan mark kind', max: 30) if mark.key?('kind')
          string!(mark['variant'], 'plan mark variant', max: 30) if mark.key?('variant')
        end
      end
      if plan.key?('cats')
        array!(plan['cats'], 'plan.cats', max: 100_000)
        plan['cats'].each do |cat|
          exact_keys!(cat, CAT_KEYS)
          integer_value!(cat['id'], 1, 2_000_000, 'plan cat id') if cat.key?('id') && !cat['id'].nil?
          string!(cat['name'], 'plan cat name', max: 300) if cat.key?('name')
          integer_value!(cat['rarity'], 0, 10, 'plan cat rarity') if cat.key?('rarity')
          if cat.key?('positions')
            array!(cat['positions'], 'plan cat positions', max: 999)
            cat['positions'].each { |position| validate_position!(position, max: MAX_ROWS, label: 'plan cat position') }
          end
        end
      end
    end

    def validate_banners!(banners)
      array!(banners, 'banners', max: MAX_BANNERS)
      banners.each do |banner|
        exact_keys!(banner, BANNER_KEYS, required: BANNER_KEYS - %w[rarities])
        string!(banner['banner'], 'banner name', max: 300)
        string!(banner['lang'], 'banner lang', max: 12)
        total = integer_value!(banner['rowsTotal'], 0, MAX_ROWS, 'rowsTotal')
        included = integer_value!(banner['rowsIncluded'], 0, MAX_ROWS, 'rowsIncluded')
        omitted = integer_value!(banner['rowsOmitted'], 0, MAX_ROWS, 'rowsOmitted')
        raise InvalidInput, 'Banner row counts do not match' unless included + omitted == total
        rows = array!(banner['rows'], 'banner rows', max: MAX_ROWS)
        raise InvalidInput, 'Banner row count does not match rowsIncluded' unless rows.length == included
        rows.each do |row|
          raise InvalidInput, 'Each banner row must have A/B cells' unless row.is_a?(Array) && row.length == 2
          validate_cell!(row[0])
          validate_cell!(row[1])
        end
        conditional_total = integer_value!(banner['conditionalTotal'], 0, 100_000, 'conditionalTotal')
        conditional_included = integer_value!(banner['conditionalIncluded'], 0, 100_000, 'conditionalIncluded')
        conditional_omitted = integer_value!(banner['conditionalOmitted'], 0, 100_000, 'conditionalOmitted')
        raise InvalidInput, 'Conditional counts do not match' unless conditional_included + conditional_omitted == conditional_total
        conditionals = array!(banner['conditional'], 'banner conditional', max: 100_000)
        raise InvalidInput, 'Conditional count does not match conditionalIncluded' unless conditionals.length == conditional_included
        hash!(banner['names'], 'banner names', max: 100_000)
        banner['names'].each do |id, name|
          raise InvalidInput, 'Name keys must be integer IDs' unless /\A-?\d{1,8}\z/.match?(id)
          string!(name, 'character name', max: 300)
        end
        if banner.key?('rarities')
          hash!(banner['rarities'], 'banner rarities', max: 100_000)
          banner['rarities'].each do |id, rarity|
            raise InvalidInput, 'Rarity keys must name known character IDs' unless banner['names'].key?(id)
            integer_value!(rarity, 0, 10, 'character rarity')
          end
        end
        conditionals.each { |item| validate_conditional!(item) }
      end
    end

    def validate_cell!(cell)
      return if cell.nil?
      raise InvalidInput, 'Malformed compact cell' unless cell.is_a?(Array) && cell.length == 5

      compact_id!(cell[0], 'cell id')
      validate_position!(cell[1], max: 999, label: 'cell position') unless cell[1].nil?
      validate_position!(cell[2], max: 1000, label: 'cell next') unless cell[2].nil?
      validate_link!(cell[3], reroll: true)
      validate_link!(cell[4], reroll: false)
    end

    def validate_link!(link, reroll:)
      return if link.nil?
      raise InvalidInput, 'Malformed compact linked cell' unless link.is_a?(Array)
      valid_length = reroll ? [3, 4].include?(link.length) : link.length == 3
      raise InvalidInput, 'Malformed compact linked cell' unless valid_length

      compact_id!(link[0], 'linked cell id')
      validate_position!(link[1], max: 1100, label: 'linked position') unless link[1].nil?
      validate_position!(link[2], max: 1100, label: 'linked next') unless link[2].nil?
      validate_link!(link[3], reroll: false) if reroll && link.length == 4
    end

    def compact_id!(value, label)
      return if value.nil?
      integer_value!(value, -100_000, 2_000_000, label)
    end

    def validate_conditional!(item)
      raise InvalidInput, 'Malformed conditional branch' unless item.is_a?(Array) && item.length == 2

      validate_position!(item[0], max: 999, label: 'conditional position')
      branch = item[1]
      raise InvalidInput, 'Malformed conditional branch data' unless branch.is_a?(Array) && branch.length == 10
      kind, variant, id, result_label, rerolled, guaranteed, pull_next, next_position, prerequisite, last_rare_id = branch
      raise InvalidInput, 'Invalid conditional kind' unless %w[regular reroll guaranteed].include?(kind)
      raise InvalidInput, 'Invalid conditional variant' unless variant.nil? || %w[base rerolled].include?(variant)
      compact_id!(id, 'conditional id')
      validate_label!(result_label, 'conditional result') unless result_label.nil?
      boolean!(rerolled, 'conditional rerolled')
      boolean!(guaranteed, 'conditional guaranteed')
      validate_label!(pull_next, 'conditional pull next') unless pull_next.nil?
      validate_label!(next_position, 'conditional next') unless next_position.nil?
      if prerequisite
        raise InvalidInput, 'Malformed conditional prerequisite' unless prerequisite.is_a?(Array) && prerequisite.length == 4
        integer_value!(prerequisite[0], 0, MAX_BANNERS - 1, 'prerequisite banner')
        validate_position!(prerequisite[1], max: 999, label: 'prerequisite position') unless prerequisite[1].nil?
        string!(prerequisite[2], 'prerequisite name', max: 300) unless prerequisite[2].nil?
        string!(prerequisite[3], 'prerequisite kind', max: 30) unless prerequisite[3].nil?
      end
      compact_id!(last_rare_id, 'conditional lastRareId')
    end

    def exact_keys!(value, allowed, required: [])
      raise InvalidInput, 'Expected an object' unless value.is_a?(Hash) && value.keys.all? { |key| key.is_a?(String) }

      raise InvalidInput, 'Snapshot contains an unsupported field' unless (value.keys - allowed).empty?
      raise InvalidInput, 'Snapshot is missing a required field' unless (required - value.keys).empty?
    end

    def hash!(value, label, max:)
      raise InvalidInput, "#{label} must be an object" unless value.is_a?(Hash) && value.length <= max

      value
    end

    def array!(value, label, max:)
      raise InvalidInput, "#{label} must be an array" unless value.is_a?(Array) && value.length <= max

      value
    end

    def string!(value, label, max:, min: 0)
      raise InvalidInput, "#{label} must be a string" unless value.is_a?(String) && value.valid_encoding? && value.bytesize.between?(min, max)

      value
    end

    def integer_value!(value, min, max, label)
      raise InvalidInput, "#{label} must be an integer in range" unless value.is_a?(Integer) && (min..max).cover?(value)

      value
    end

    def numeric_value!(value, label)
      unless (value.is_a?(Integer) && value.between?(-1_000_000_000, 1_000_000_000_000)) || (value.is_a?(Float) && value.finite?)
        raise InvalidInput, "#{label} must be finite numeric data"
      end
      value
    end

    def boolean!(value, label)
      raise InvalidInput, "#{label} must be a boolean" unless value == true || value == false

      value
    end

    def validate_label!(value, label)
      string!(value, label, max: 32)
      raise InvalidInput, "#{label} has an invalid position" unless /\A\d{1,7}[AB](?:RG|R|G)?\z/.match?(value)
    end

    def validate_position!(value, max:, label:)
      string!(value, label, max: 16)
      match = /\A([1-9]\d{0,3})[AB](?:RG|R|G)?\z/.match(value)
      raise InvalidInput, "#{label} has an invalid position" unless match && match[1].to_i <= max

      value
    end

    def purge_expired!(now)
      @entries.keys.each do |key|
        delete_entry!(key) if now >= @entries.fetch(key).expires_at
      end
    end

    def delete_entry!(key)
      entry = @entries.delete(key)
      @bytes -= entry.bytes if entry
    end

    def unavailable(view)
      {'status' => 'expired_or_unavailable', 'view' => view,
        'authority' => AUTHORITY}
    end

    def bounded_response!(response)
      response['authority'] ||= AUTHORITY
      size = JSON.generate(response).bytesize
      raise InvalidInput, 'Result page could not be bounded' if size > MAX_RESPONSE_BYTES

      response
    end

    def reference_summary(snapshot)
      find = snapshot['find'] || {}
      plan = snapshot['plan'] || {}
      acquisitions = Array(find['targetsAcquired'])
      brief_find = {'status' => find['status'] || 'unknown'}
      (FIND_SUMMARY_KEYS - %w[enabled]).each do |key|
        brief_find[key] = find[key] if find.key?(key)
      end
      brief_find['enabled'] = snapshot.dig('input', 'findEnabled')
      brief_find['targetsAcquired'] = acquisitions.first(20)
      brief_find['targetsAcquiredTotal'] = acquisitions.length
      brief_plan = {
        'enabled' => plan['enabled'] == true,
        'name' => plan['name'],
        'marksTotal' => Array(plan['marks']).length,
        'routeTotal' => Array(plan['route']).length,
        'catsTotal' => Array(plan['cats']).length,
        'progress' => plan['progress']
      }.reject { |_key, value| value.nil? }
      {
        'authority' => AUTHORITY,
        'data_version' => snapshot['data_version'],
        'input' => snapshot['input'],
        'costMeaning' => 'Engine comparison weights, not game currency or money',
        'track' => {
          'seed' => snapshot.dig('input', 'track', 'seed'),
          'last' => snapshot.dig('input', 'track', 'last'),
          'count' => snapshot.dig('input', 'track', 'count'),
          'banners' => Array(snapshot.dig('input', 'track', 'rows')).length
        },
        'find' => brief_find,
        'plan' => brief_plan,
        'banners' => snapshot['banners'].map do |banner|
          {'banner' => banner['banner'], 'lang' => banner['lang'],
            'rowsTotal' => banner['rowsTotal'], 'rowsIncluded' => banner['rowsIncluded'],
            'rowsOmitted' => banner['rowsOmitted'],
            'conditionalTotal' => banner['conditionalTotal'],
            'conditionalIncluded' => banner['conditionalIncluded'],
            'conditionalOmitted' => banner['conditionalOmitted']}
        end
      }
    end

    def summary_view(snapshot)
      summary = reference_summary(snapshot)
      summary.merge('status' => 'ok', 'schema_version' => snapshot['schema_version'],
        'view' => 'summary')
    end

    def array_view(snapshot, options)
      banners = snapshot['banners']
      if options.key?('banner') && options['banner'] >= banners.length
        raise InvalidInput, 'banner index is unavailable in this snapshot'
      end
      selected = options.key?('banner') ? [[options['banner'], banners[options['banner']]]] : banners.each_with_index.map { |banner, index| [index, banner] }
      start = options.fetch('start', 1)
      page_size = options.fetch('limit', 20)
      branch_size = page_size
      conditional_offset = options.fetch('offset', 0)
      loop do
        pages = selected.map do |index, banner|
          build_array_page(index, banner, start, page_size, conditional_offset,
            branch_size, options['rowEnd'])
        end
        response = if options.key?('banner')
          pages.first.merge('status' => 'ok', 'view' => 'array')
        else
          {'status' => 'ok', 'view' => 'array', 'banners' => pages}
        end
        return response if JSON.generate(response).bytesize <= PAGE_BUDGET
        if branch_size > 1
          branch_size -= 1
        elsif !options.key?('rowEnd') && page_size > 1
          page_size -= 1
        else
          raise InvalidInput, 'Array row or conditional branch cannot fit in a result page'
        end
      end
    end

    def build_array_page(index, banner, start, limit, conditional_offset = 0,
      conditional_limit = limit, row_end = nil)
      rows = Array(banner['rows'])
      finish = row_end || [start + limit - 1, banner['rowsTotal']].min
      raise InvalidInput, 'rowEnd exceeds available rows' if finish > banner['rowsTotal']
      selected = rows.each_with_index.filter_map do |pair, offset|
        next if row_end
        row_number = offset + 1
        next if row_number < start || row_number > finish

        {'row' => row_number,
          'A' => expand_cell(pair[0], banner['names']),
          'B' => expand_cell(pair[1], banner['names'])}
      end
      branches = banner['conditional'].select do |item|
        number = item[0].to_s[/\A\d+/].to_i
        number >= start && number <= finish
      end
      conditional_page = branches.slice(conditional_offset, conditional_limit) || []
      next_start = finish + 1
      omitted = [banner['rowsTotal'] - finish, 0].max
      result = {
        'bannerIndex' => index, 'banner' => banner['banner'], 'lang' => banner['lang'],
        'rowsTotal' => banner['rowsTotal'], 'rowsIncluded' => selected.length,
        'rowsOmitted' => omitted, 'start' => start, 'rows' => selected,
        'conditionalTotal' => branches.length, 'conditionalOffset' => conditional_offset,
        'conditionalStart' => start, 'conditionalEnd' => finish,
        'conditionalIncluded' => conditional_page.length,
        'conditionalOmitted' => [branches.length - conditional_offset - conditional_page.length, 0].max,
        'conditional' => conditional_page.map { |item| expand_conditional(item, banner['names']) }
      }
      if banner.key?('rarities')
        page_ids = {}
        collect_ids = lambda do |cell|
          next unless cell
          page_ids[cell['id'].to_s] = true
          collect_ids.call(cell['reroll'])
          collect_ids.call(cell['guaranteed'])
        end
        selected.each { |row| collect_ids.call(row['A']); collect_ids.call(row['B']) }
        conditional_page.each { |item| page_ids[item[1][2].to_s] = true }
        result['rarities'] = banner['rarities'].select { |id, _rarity| page_ids.key?(id) }
      end
      result['nextStart'] = next_start if next_start <= rows.length
      if conditional_offset + conditional_page.length < branches.length
        result['nextConditionalOffset'] = conditional_offset + conditional_page.length
        result['nextConditionalQuery'] = {'view' => 'array', 'banner' => index,
          'start' => start, 'rowEnd' => finish, 'limit' => limit, 'offset' => result['nextConditionalOffset']}
      end
      result
    end

    def expand_conditional(item, names)
      position, branch = item
      {'position' => position, 'kind' => branch[0], 'variant' => branch[1],
        'id' => branch[2], 'name' => names[branch[2].to_s],
        'resultLabel' => branch[3], 'rerolled' => branch[4],
        'guaranteed' => branch[5], 'pullNext' => branch[6],
        'next' => branch[7], 'prerequisite' => expand_prerequisite(branch[8]),
        'lastRareId' => branch[9]}
    end

    def expand_cell(cell, names)
      return nil unless cell

      {'id' => cell[0], 'name' => names[cell[0].to_s],
        'position' => cell[1], 'next' => cell[2],
        'reroll' => expand_link(cell[3], names, nested_guaranteed: true),
        'guaranteed' => expand_link(cell[4], names)}
    end

    def expand_link(link, names, nested_guaranteed: false)
      return nil unless link

      result = {'id' => link[0], 'name' => names[link[0].to_s],
        'position' => link[1], 'next' => link[2]}
      result['guaranteed'] = expand_link(link[3], names) if nested_guaranteed && link[3]
      result
    end

    def character_view(snapshot, options)
      target_id = options.fetch('cat_id')
      occurrences = []
      snapshot['banners'].each_with_index do |banner, banner_index|
        banner.fetch('rows').each_with_index do |row, row_index|
          %w[A B].each_with_index do |column, cell_index|
            collect_cell_occurrences(occurrences, banner, banner_index, row_index + 1,
              column, row[cell_index], target_id)
          end
        end
        banner.fetch('conditional').each do |item|
          position, branch = item
          id = branch[2]
          next unless id == target_id

          occurrences << {
            'bannerIndex' => banner_index, 'banner' => banner['banner'],
            'position' => position, 'resultPosition' => branch[3],
            'branch' => conditional_branch(branch), 'id' => id,
            'name' => banner['names'][id.to_s], 'next' => branch[7],
            'rerolled' => branch[4], 'guaranteed' => branch[5],
            'conditional' => true, 'kind' => branch[0], 'variant' => branch[1],
            'prerequisite' => expand_prerequisite(branch[8]),
            'lastRareId' => branch[9]
          }
        end
      end
      page = paged_records(occurrences, options.fetch('offset', 0), options.fetch('limit', 20))
      page.merge('cat_id' => target_id,
        'scope' => 'observed_snapshot_branches_only',
        'independent_reachability_verified' => false)
    end

    def collect_cell_occurrences(output, banner, banner_index, row_index, column, cell, target_id)
      return unless cell

      base_position = cell[1] || "#{row_index}#{column}"
      record = lambda do |id, position, next_position, branch, rerolled, guaranteed, extra = {}|
        next unless id == target_id

        output << {'bannerIndex' => banner_index, 'banner' => banner['banner'],
          'row' => row_index, 'column' => column, 'position' => position,
          'id' => id, 'name' => banner['names'][id.to_s], 'next' => next_position,
          'branch' => branch, 'rerolled' => rerolled, 'guaranteed' => guaranteed,
          'conditional' => false}.merge(extra)
      end
      record.call(cell[0], base_position, cell[2], 'base', false, false)
      if cell[4]
        record.call(cell[4][0], cell[4][1], cell[4][2], 'G', false, true)
      end
      reroll = cell[3]
      return unless reroll

      record.call(reroll[0], reroll[1], reroll[2], 'R', true, false)
      if reroll[3]
        record.call(reroll[3][0], reroll[3][1], reroll[3][2], 'RG', true, true)
      end
    end

    def conditional_branch(branch)
      if branch[5]
        branch[1] == 'rerolled' ? 'RG' : 'G'
      elsif branch[0] == 'reroll'
        'R'
      else
        'base'
      end
    end

    def expand_prerequisite(value)
      return nil unless value

      {'bannerIndex' => value[0], 'position' => value[1],
        'name' => value[2], 'kind' => value[3]}
    end

    def route_view(snapshot, options)
      find = snapshot['find'] || {}
      actions = Array(find['actions'])
      offset = options.fetch('offset', 0)
      page_size = options.fetch('limit', 20)
      loop do
        selected = actions.slice(offset, page_size) || []
        contexts, reindexed_actions = selected_contexts(selected, Array(find['actionContexts']))
        cat_ids = selected.flat_map do |action|
          [action['catId'], action['originalCatId']].compact.map(&:to_s)
        end.uniq
        cats = (find['actionCats'] || {}).select { |id, _item| cat_ids.include?(id) }
        action_ranges = selected.map do |action|
          first = action['actionStart'] || action['actionIndex']
          last = action['actionEnd'] || first
          first && last ? (first..last) : nil
        end.compact
        acquisitions = Array(find['targetsAcquired']).select do |item|
          action_ranges.any? { |range| range.cover?(item['actionIndex']) }
        end
        response = find_summary_for_route(find).merge(
          'findStatus' => find['status'], 'status' => 'ok', 'totalActions' => actions.length,
          'offset' => offset, 'actions' => reindexed_actions,
          'actionContexts' => contexts, 'actionCats' => cats,
          'targetsAcquired' => acquisitions,
          'targetsAcquiredTotal' => Array(find['targetsAcquired']).length
        )
        response['nextOffset'] = offset + selected.length < actions.length ? offset + selected.length : nil
        return response if JSON.generate(response).bytesize <= PAGE_BUDGET
        raise InvalidInput, 'Route action cannot fit in a result page' if page_size <= 1

        page_size -= 1
      end
    end

    def find_summary_for_route(find)
      FIND_SUMMARY_KEYS.each_with_object({}) do |key, result|
        result[key == 'nextOffset' ? 'nextTrackOffset' : key] = find[key] if find.key?(key)
      end
    end

    def selected_contexts(actions, source_contexts)
      indexes = {}
      contexts = []
      cloned = actions.map do |action|
        item = action.dup
        if item.key?('context')
          old_index = item['context']
          indexes[old_index] ||= begin
            contexts << source_contexts.fetch(old_index)
            contexts.length - 1
          end
          item['context'] = indexes.fetch(old_index)
        end
        item
      end
      [contexts, cloned]
    end

    def plan_view(snapshot, options)
      plan = snapshot['plan'] || {}
      offset = options.fetch('offset', 0)
      limit = options.fetch('limit', 20)
      collections = %w[marks route cats].to_h do |key|
        values = Array(plan[key])
        page = values.slice(offset, limit) || []
        [key, {'total' => values.length, 'items' => page,
          'nextOffset' => offset + page.length < values.length ? offset + page.length : nil}]
      end
      response = {'status' => 'ok', 'enabled' => plan['enabled'] == true,
        'name' => plan['name'], 'progress' => plan['progress'],
        'offset' => offset, 'limit' => limit, 'collections' => collections}
      loop do
        return response if JSON.generate(response).bytesize <= PAGE_BUDGET
        break if limit <= 1

        limit -= 1
        collections.each do |key, result|
          values = Array(plan[key])
          page = values.slice(offset, limit) || []
          result['items'] = page
          result['nextOffset'] = offset + page.length < values.length ? offset + page.length : nil
        end
        response['limit'] = limit
      end
      raise InvalidInput, 'Plan record cannot fit in a result page'
    end

    def paged_records(records, offset, limit)
      page_size = limit
      loop do
        items = records.slice(offset, page_size) || []
        response = {'status' => 'ok', 'total' => records.length,
          'offset' => offset, 'items' => items}
        response['nextOffset'] = offset + items.length if offset + items.length < records.length
        return response if JSON.generate(response).bytesize <= PAGE_BUDGET
        raise InvalidInput, 'Character occurrence cannot fit in a result page' if page_size <= 1

        page_size -= 1
      end
    end
  end
end
