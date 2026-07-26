# frozen_string_literal: true

require 'json'

module BattleCatsRolls
  module LocalWebImp
    def json_response status_code, payload
      status status_code
      headers 'Content-Type' => 'application/json; charset=utf-8'
      body JSON.dump(payload)
    end

    def authorize_tsv_admin
      key = "tsv-admin-auth #{request.ip}"

      if failed_at = cache[key]
        if Time.now.to_f - failed_at.to_f < 5
          json_response(429, ok: false,
            message: '암호 확인 실패 후 잠시 기다려야 합니다.')
          return false
        end

        cache.delete(key)
      end
      if LiveEventsAdmin.authorized?(request.params['password'])
        cache.delete(key)
        return true
      end

      cache.store(key, Time.now.to_f.to_s, expires_in: 5)
      json_response(
        ENV['TSV_ADMIN_PASSWORD'].to_s.empty? ? 503 : 401,
        ok: false,
        message: ENV['TSV_ADMIN_PASSWORD'].to_s.empty? ?
          'TSV 관리자 기능이 설정되지 않았습니다.' : '암호가 올바르지 않습니다.')
      false
    end

    def render name, arg=nil, **kwargs
      seed_views_today = kwargs.delete(:seed_views_today)
      arg ||= kwargs unless kwargs.empty?
      seed_views_today ||=
        if name == :index && arg.is_a?(Hash) && arg[:details]
          SeedViewCounter.increment(
            cache, lang: route.lang, event: route.event)
        else
          SeedViewCounter.count(cache)
        end

      view = View.new(route, arg)
      view.seed_views_today = seed_views_today
      view.render(name)
    end
  end

  Web::Imp.prepend(LocalWebImp)

  class Web
    get '/seed-views' do
      with_canonical_uri('/seed-views') do
        render :seed_views, SeedViewCounter.snapshot
      end
    end

    post '/seed-views/admin' do
      next body unless authorize_tsv_admin

      result =
        case request.params['action']
        when 'check'
          LiveEventsAdmin.check
        when 'deploy'
          LiveEventsAdmin.dispatch
        else
          next json_response(422, ok: false, message: '알 수 없는 작업입니다.')
        end

      json_response(200, result)
    rescue LiveEventsAdmin::Busy => e
      json_response(409, ok: false, message: e.message)
    rescue LiveEventsAdmin::ConfigurationError => e
      json_response(503, ok: false, message: e.message)
    rescue StandardError => e
      logger.error("TSV admin failed: <#{e.class}> #{e.message}")
      json_response(502, ok: false, message: e.message)
    end

    get '/multi' do
      render :multi, multi_data: TrackApi.multi_data(route)
    end

    get '/expand/result' do
      headers 'Content-Type' => 'application/json; charset=utf-8'

      if !ExpandCompareSupported
        body JSON.dump(supported: false, available: false)
      else
        result = route.expanded_result
        if result
          body JSON.dump(result)
        else
          not_found JSON.dump(available: false)
        end
      end
    end

    get '/expand/events' do
      headers 'Content-Type' => 'application/json; charset=utf-8'

      if !ExpandCompareSupported
        body JSON.dump(supported: false, lang: route.lang, events: [])
      else
        body JSON.dump(lang: route.lang, events: route.expanded_events)
      end
    end
  end
end
