# frozen_string_literal: true

require_relative 'route'
require_relative 'request'
require_relative 'seek_seed'
require_relative 'cache'
require_relative 'aws_auth'
require_relative 'aws_cf'
require_relative 'stat'
require_relative 'talent'
require_relative 'filter'
require_relative 'view'
require_relative 'help'

require 'jellyfish'

require 'json'
require 'net/http'
require 'digest/sha1'

module BattleCatsRolls
  class Web
    module Imp
      def with_canonical_uri path
        canonical_uri = route.uri(path: path, include_filters: true)

        if request.fullpath != canonical_uri
          found canonical_uri
        else
          yield
        end
      end

      def route
        @route ||= Route.new(request)
      end

      def request
        @request ||= Request.new(env)
      end

      def serve_tsv lang, file
        key = "#{lang}/#{file}"

        cache[key] ||
          cache.store(
            key, request_tsv(lang, file), expires_in: route.tsv_expires_in)
      end

      def request_tsv lang, file
        aws = aws_auth(lang, file)
        request = Net::HTTP::Get.new(aws.uri)

        aws.headers.each do |key, value|
          request[key] = value
        end

        response = Net::HTTP.start(
          aws.uri.hostname,
          aws.uri.port,
          use_ssl: true) do |http|
          http.request(request)
        end

        response.body
      end

      def aws_auth lang, file
        prefix =
          case lang
          when 'jp'
            ''
          else
            lang
          end

        url =
          "https://nyanko-events-prd.s3.ap-northeast-1.amazonaws.com/battlecats#{prefix}_production/#{file}"

        AwsAuth.new(:get, url)
      end

      def throttle_ip
        key = "#{request.path} #{request.ip}"

        if cache[key]
          render :throttled
        else
          cache.store(key, '1', expires_in: route.throttle_ip_expires_in)
          yield(lambda{ cache.delete(key) })
        end
      end

      def cache
        @cache ||= Cache.default(logger)
      end

      def logger
        @logger ||= env['rack.logger'] || begin
          require 'logger'
          Logger.new(env['rack.errors'])
        end
      end

      def render name, arg=nil
        View.new(route, arg).render(name)
      end
    end

    include Jellyfish
    controller_include NormalizedPath, Imp

    get '/' do
      canonical_uri = route.uri(path: '/')

      if request.fullpath.sub(/&pick=[^&]+\z/, '') != canonical_uri
        found canonical_uri
      elsif route.show_tracks?
        cats, found_cats = route.prepare_tracks

        render :index, cats: cats, found_cats: found_cats, details: true
      else
        render :index
      end
    end

    get '/warmup' do
      if Route.ball_en
        'NOOP'
      else
        cache
        Route.reload_balls
        View.warmup
        'OK'
      end
    end

    get %r{^/cats/(?<id>\d+)} do |m|
      id = m[:id].to_i

      with_canonical_uri("/cats/#{id}") do
        if info = route.cats[id]
          cat = Cat.new(id: id, info: info)
          stats = info['name'].size.times.map do |index|
            conjure_id = info.dig('stat', index, 'conjure')
            Stat.new(id: id, info: info, index: index, level: route.level,
              conjure_info: conjure_id && route.cats[conjure_id],
              cat: cat,
              sum_no_wave: route.sum_no_wave,
              dps_no_critical: route.dps_no_critical)
          end
          talents = Talent.build(info).group_by(&:ultra?)
        else
          stats = []
          talents = {}
        end

        render :stats, cat: cat, stats: stats, talents: talents
      end
    end

    get '/cats' do
      with_canonical_uri('/cats') do
        chain = Filter::Chain.new(cats: route.cats.dup,
          level: route.level,
          exclude_talents: route.exclude_talents,
          sum_no_wave: route.sum_no_wave,
          dps_no_critical: route.dps_no_critical)

        from_resistant =
          if route.for_resistant == 'or'
            route.resistant
          else
            []
          end

        chain.filter!(route.against, route.for_against,
          Filter::Specialization)

        chain.filter!(route.buff + from_resistant, route.for_buff,
          Filter::Buff.merge(Filter::Resistant))

        # Resistant uses the same condition from buff, and
        # OR will be filtered with buffs together, so we only filter
        # in the case that it's AND, where it's ignored from buff.
        chain.filter!(route.resistant, route.for_buff,
          Filter::Resistant) if route.for_resistant == 'and'

        chain.filter!(route.range, route.for_range, Filter::Range)
        chain.filter!([route.area], 'any', Filter::Area) if route.area != 'any'
        chain.filter!(route.control, route.for_control, Filter::Control)
        chain.filter!(route.immunity, route.for_immunity, Filter::Immunity)
        chain.filter!(route.counter, route.for_counter, Filter::Counter)
        chain.filter!(route.combat, route.for_combat, Filter::Combat)
        chain.filter!(route.other, route.for_other, Filter::Other)
        chain.filter!([route.dps], 'any', Filter::DPS) if route.dps != 'any'
        chain.filter!([route.damage], 'any', Filter::Damage) if route.damage != 'any'
        chain.filter!([route.health], 'any', Filter::Health) if route.health != 'any'
        chain.filter!([route.knockbacks], 'any', Filter::Knockbacks) if route.knockbacks != 'any'
        chain.filter!([route.stand], 'any', Filter::Stand) if route.stand != 'any'
        chain.filter!([route.reach], 'any', Filter::Reach) if route.reach != 'any'
        chain.filter!([route.speed], 'any', Filter::Speed) if route.speed != 'any'
        chain.filter!([route.cost], 'any', Filter::Cost) if route.cost != 'any'
        chain.filter!([route.production], 'any', Filter::Production) if route.production != 'any'
        chain.filter!(route.aspect, route.for_aspect, Filter::Aspect)

        render :cats, cats: chain.cats,
          cats_by_rarity: CrystalBall.group_by_rarity(chain.cats)
      end
    end

    get '/help' do
      with_canonical_uri('/help') do
        render :help, help: Help.new
      end
    end

    get '/logs' do
      with_canonical_uri('/logs') do
        render :logs
      end
    end

    class Seek
      include Jellyfish
      controller_include NormalizedPath, Imp

      (%w[/en /tw /jp /kr] << '').each do |prefix|
        %w[gatya.tsv item.tsv sale.tsv].each do |file|
          lang = prefix[1..-1] || 'jp'

          get "/seek#{prefix}/#{file}" do
            headers 'Content-Type' => 'text/plain; charset=utf-8'
            body serve_tsv(lang, file)
          end

          get "/seek#{prefix}/curl/#{file}" do
            headers 'Content-Type' => 'text/plain; charset=utf-8'
            body "#{aws_auth(lang, file).to_curl}\n"
          end

          get "/seek#{prefix}/json/#{file}" do
            headers 'Content-Type' => 'application/json; charset=utf-8'
            body JSON.dump(aws_auth(lang, file).headers)
          end
        end
      end

      get %r{^/seek/webview/(?<path>.+)} do |m|
        aws = AwsCf.new("https://nyanko-webview.ponosgames.com/#{m[:path]}")

        found aws.generate
      end

      get '/seek' do
        with_canonical_uri('/seek') do
          render :seek, queue_size: SeekSeed.queue.size
        end
      end

      post '/seek/enqueue' do
        source = route.seek_source
        key = Digest::SHA1.hexdigest(source)

        if cache[key]
          found route.seek_result(key)
        else
          throttle_ip do |clear_throttle|
            SeekSeed.enqueue(source, key, logger, cache, clear_throttle)

            found route.seek_result(key)
          end
        end
      end

      get %r{^/seek/result/?(?<key>\w*)} do |m|
        key = m[:key]
        seed = cache[key] if /./.match?(key)
        seek = SeekSeed.queue[key]

        seek.yield if seek&.ended?

        render :seek_result, seed: seed, seek: seek
      end
    end
  end
end
