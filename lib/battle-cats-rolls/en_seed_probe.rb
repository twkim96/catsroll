# frozen_string_literal: true

require 'digest/sha1'
require 'json'
require 'time'

module BattleCatsRolls
  # Temporary EN traffic probe. Keep this isolated so it is easy to remove.
  module EnSeedProbe
    PATH = '/data/en_seed_probe.jsonl'
    MAX_RECORDS = 5_000
    TIME_ZONE = '+09:00'
    @mutex = Mutex.new
    @records = []

    module_function

    def capture route, request, now=Time.now
      return false unless route.lang == 'en'

      params = request.params
      record = {
        at: now.getlocal(TIME_ZONE).iso8601,
        method: request.request_method,
        path: request.path,
        fullpath: request.fullpath,
        seed: route.seed,
        event: route.event,
        count: route.count,
        count_param: params.key?('count'),
        details: !!route.details,
        details_param: params.key?('details'),
        find: route.find,
        last: route.last,
        force_guaranteed: route.force_guaranteed,
        no_guaranteed: !!route.no_guaranteed,
        ubers: route.ubers,
        user_agent: request.user_agent.to_s,
        referer: request.referer.to_s,
        accept_language: request.env['HTTP_ACCEPT_LANGUAGE'].to_s,
        ip_hash: ip_hash(request.ip)
      }

      @mutex.synchronize do
        @records << record
        @records.shift(@records.size - MAX_RECORDS) if @records.size > MAX_RECORDS
      end

      true
    rescue StandardError
      false
    end

    def flush path=probe_path
      records = @mutex.synchronize{ @records.dup }
      return true if records.empty?
      return false unless persistable?(path)

      File.open(path, 'a') do |file|
        records.each{ |record| file.puts(JSON.dump(record)) }
      end

      @mutex.synchronize{ @records.shift(records.size) }
      true
    rescue SystemCallError
      false
    end

    def probe_path
      ENV.fetch('EN_SEED_PROBE_PATH', PATH)
    end

    def ip_hash ip
      Digest::SHA1.hexdigest(ip.to_s)[0, 12]
    end

    def persistable? path
      dir = File.dirname(path)
      File.directory?(dir) && File.writable?(dir)
    end
  end
end
