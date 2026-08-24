# frozen_string_literal: true

# Read-only JSON endpoint for the client-side ("내 기기 연산") track renderer.
#
# This is an ADDITIVE path for Feature B (seed -> track) in
# Seeker/CLIENT_SIDE_SEEKER.md. It does not touch the existing server track
# route/render: it only reuses Route#pool to expose the gacha pool + cat
# metadata for an event/lang as JSON, so the browser can roll and render the
# track locally.
#
# GET /track.json?event=...&lang=...&name=...&custom=...&ubers=...
#   -> { exist, version, rates, guaranteed_rolls, slots, cats }

require_relative 'route'
require_relative 'request'
require_relative 'cat'
require_relative 'event_series_names'

require 'jellyfish'
require 'json'

module BattleCatsRolls
  class TrackApi
    include Jellyfish

    Langs = %w[en tw jp kr].freeze
    MultiLangs = %w[kr jp].freeze
    MultiLabels = {
      'kr' => 'KR',
      'jp' => 'JP'
    }.freeze
    # Cat metadata only exposes rarity. Keep the regular rare-capsule Super
    # Rare roster by stable unit ID so limited/collaboration Super Rares remain
    # available as Find targets.
    RegularSupaCatIds = [
      31, 32, 33, 34, 36, 37, 40, 41, 62,
      151, 152, 153, 154, 200, 308, 378, 523
    ].freeze

    get '/track.json' do
      route = Route.new(Request.new(env))

      headers \
        'content-type' => 'application/json; charset=utf-8',
        'cache-control' => 'public, max-age=600'

      body JSON.generate(TrackApi.pool_data(route))
    end

    # Lightweight region event list for client-side region switching: lets the
    # browser repopulate the event dropdown without a full page reload.
    # GET /events.json?lang=...  -> { current, upcoming:[{value,label}], past:[..] }
    # GET /events.json?lang=...&catalog=series -> { series:[{id,label,count,aliases}] }
    get '/events.json' do
      route = Route.new(Request.new(env))

      headers \
        'content-type' => 'application/json; charset=utf-8',
        'cache-control' => 'public, max-age=600'

      data =
        if route.request.params_coercion_with_nil('catalog', :to_s) == 'series'
          TrackApi.event_series_data(route)
        else
          TrackApi.events_data(route)
        end

      body JSON.generate(data)
    end

    def self.events_data route
      to_opt = lambda do |(event_name, info)|
        { value: event_name,
          label: "#{info['start_on']} ~ #{info['end_on']}: #{info['name']}" }
      end

      {
        current: route.event,
        upcoming: route.upcoming_events.map(&to_opt),
        past: route.past_events.reverse.map(&to_opt)
      }
    end

    def self.event_series_data route
      series = {}
      characters = event_series_characters(route.ball)
      cat_aliases = event_series_cat_aliases(characters)

      route.ball.events.each_value do |info|
        series_id = route.ball.gacha.dig(info['id'], 'series_id')
        next unless series_id

        name = event_filter_name(info['name'])
        item = series[series_id] ||= {
          id: series_id,
          label: name,
          count: 0,
          aliases: [],
          latest: info['start_on']
        }
        item[:count] += 1
        item[:aliases] << name unless item[:aliases].include?(name)

        if item[:latest] <= info['start_on']
          item[:latest] = info['start_on']
          item[:label] = name
        end
      end

      route.ball.gacha.each do |gacha_id, info|
        series_id = info['series_id']
        next unless series_id

        name = event_filter_name(info['name'])
        item = series[series_id] ||= {
          id: series_id,
          label: name.empty? ? "Series #{series_id}" : name,
          count: 0,
          aliases: [],
          latest: nil
        }
        item[:aliases] << name if !name.empty? && !item[:aliases].include?(name)
        id_alias = gacha_id.to_s
        item[:aliases] << id_alias unless item[:aliases].include?(id_alias)
      end

      {
        series: series.values.sort_by{ |item| [item[:latest] || Date.new, item[:id]] }.
          reverse_each.map do |item|
            if label = EventSeriesNames.korean(item[:id])
              item[:label] = label
              item[:aliases].unshift(label) unless item[:aliases].include?(label)
            end
            EventSeriesNames.shortcuts(item[:id]).reverse_each do |shortcut|
              item[:aliases].unshift(shortcut) unless item[:aliases].include?(shortcut)
            end
            Array(cat_aliases[item[:id]]).each do |name|
              item[:aliases] << name unless item[:aliases].include?(name)
            end
            item.reject{ |key, _| key == :latest }
          end,
        characters: characters
      }
    end

    def self.event_series_characters ball
      kr_cats = (Route.ball_kr || ball).cats
      characters = {}

      ball.gacha.each_value do |info|
        series_id = info['series_id']
        next if series_id.nil?

        Array(info['cats']).each do |id|
          kr_info = kr_cats[id]
          local_info = ball.cats[id]
          rarity = kr_info&.dig('rarity') || local_info&.dig('rarity')
          next unless [Cat::Uber, Cat::Legend].include?(rarity)

          item = characters[id] ||= {
            id: id,
            rarity: rarity,
            names: [],
            series_ids: []
          }
          item[:series_ids] << series_id unless item[:series_ids].include?(series_id)
          [kr_info, local_info].compact.each do |cat|
            Array(cat['name']).each do |name|
              next if name.to_s.empty? || item[:names].include?(name)

              item[:names] << name
            end
          end
        end
      end

      characters.values.sort_by{ |item| item[:id] }.each do |item|
        item[:name] = item[:names].first || item[:id].to_s
        item[:series_ids].sort!
      end
    end

    def self.event_series_cat_aliases characters
      aliases = Hash.new{ |hash, key| hash[key] = [] }
      characters.each do |character|
        character[:series_ids].each do |series_id|
          character[:names].each do |name|
            aliases[series_id] << name unless aliases[series_id].include?(name)
          end
        end
      end
      aliases
    end

    def self.event_filter_name name
      name.to_s.gsub('★확률, 상세 내용은 배너를 클릭!★', '').
        gsub(/\s+/, ' ').strip
    end

    def self.multi_data route
      initial_lang =
        if MultiLangs.include?(route.lang)
          route.lang
        else
          'kr'
        end
      find_cats = multi_find_cats(route.name)

      {
        initial: {
          seed: route.seed,
          count: [route.count, 500].min,
          lang: initial_lang,
          event: route.event,
          name: route.name
        },
        limits: {
          rows: 8,
          count: 500
        },
        last_cats: multi_last_cats(route.name),
        find_cats: find_cats,
        find_series: multi_find_series(find_cats),
        regions: MultiLangs.each_with_object({}) do |lang, result|
          ball = Route.public_send("ball_#{lang}")
          initial_event = route.event if lang == initial_lang
          events = multi_events(ball, initial_event: initial_event)
          current = events.find do |event|
            event[:group] == 'upcoming' && !event[:platinum]
          end || events.first
          series_names = events.each_with_object({}) do |event, names|
            next unless event[:series_id]

            names[event[:series_id]] ||= event[:series_name]
          end

          result[lang] = {
            label: MultiLabels.fetch(lang),
            current: current&.fetch(:event, nil),
            tickets: {
              platinum: multi_ticket_pool(ball, 'platinum'),
              legend: multi_ticket_pool(ball, 'legend')
            }.compact,
            series_names: series_names,
            events: events.map do |event|
              item = {
                event: event[:event],
                label: event[:label],
                group: event[:group],
                series_id: event[:series_id]
              }
              item[:pool] = pool_data_for(ball, event[:event]) if event[:preload]
              item
            end
          }
        end
      }
    end

    def self.raw_ball_jp
      @raw_ball_jp ||= Route.load_ball('jp')
    end

    def self.multi_last_cats name_index
      balls = {
        'kr' => Route.ball_kr,
        'jp' => raw_ball_jp
      }
      ids = balls.values.flat_map{ |ball| ball.cats.keys }.uniq.sort

      ids.each_with_object({}) do |id, result|
        names = {
          kr: pick_cat_name(balls['kr'].cats[id], name_index),
          jp: pick_cat_name(balls['jp'].cats[id], name_index)
        }.compact
        result[id] = names if names.any?
      end
    end

    def self.multi_find_cats name_index
      balls = {
        'kr' => Route.ball_kr,
        'jp' => raw_ball_jp
      }
      ids = balls.values.flat_map{ |ball| ball.cats.keys }.uniq.sort

      ids.filter_map do |id|
        kr_info = balls['kr'].cats[id]
        jp_info = balls['jp'].cats[id]
        rarity = kr_info&.dig('rarity') || jp_info&.dig('rarity')
        next unless [Cat::Supa, Cat::Uber, Cat::Legend].include?(rarity)
        next if rarity == Cat::Supa && RegularSupaCatIds.include?(id)

        kr = pick_cat_name(kr_info, name_index)
        jp = pick_cat_name(jp_info, name_index)
        {
          id: id,
          rarity: rarity,
          name: kr || jp || id.to_s,
          kr: kr,
          jp: jp
        }.compact
      end
    end

    def self.multi_find_series find_cats
      allowed = find_cats.each_with_object({}) do |cat, result|
        result[cat[:id]] = true
      end
      series = {}
      balls = {
        'kr' => Route.ball_kr,
        'jp' => raw_ball_jp
      }

      balls.each do |lang, ball|
        ball.gacha.each_value do |info|
          series_id = info['series_id']
          next if series_id.nil?

          item = series[series_id] ||= {
            id: series_id,
            cat_ids: {}
          }
          label = event_filter_name(info['name'])
          unless label.empty?
            key = lang == 'kr' ? :kr_label : :fallback_label
            item[key] = label
          end
          Array(info['cats']).each do |cat_id|
            cat_id = cat_id.to_i
            item[:cat_ids][cat_id] = true if allowed[cat_id]
          end
        end
      end

      series.values.filter_map do |item|
        cat_ids = item[:cat_ids].keys.sort
        next if cat_ids.empty?

        {
          id: item[:id],
          label: EventSeriesNames.korean(item[:id]) || item[:kr_label] ||
            item[:fallback_label] || "시리즈 #{item[:id]}",
          aliases: EventSeriesNames.shortcuts(item[:id]),
          cat_ids: cat_ids
        }
      end
    end

    # Find uses one concrete default pool for each special ticket resource.
    # A selected special-ticket event can override this default in the client,
    # while platinum and legend tickets retain independent usage limits.
    def self.multi_ticket_pool ball, kind
      today = Date.today
      candidates = ball.events.select do |_, info|
        info['platinum'] == kind
      end
      active = candidates.select do |_, info|
        info['start_on'] <= today && today <= info['end_on']
      end
      started = candidates.select do |_, info|
        info['start_on'] <= today
      end
      selected = active.max_by{ |_, info| info['start_on'] } ||
        started.max_by{ |_, info| info['start_on'] } ||
        candidates.min_by{ |_, info| info['start_on'] }
      return unless selected

      event_name, info = selected
      {
        event: event_name,
        kind: kind,
        label: multi_event_label(info),
        start_on: info['start_on'].to_s,
        end_on: info['end_on'].to_s,
        pool: compact_find_pool_data(ball, event_name)
      }
    end

    def self.compact_find_pool_data ball, event_name
      data = pool_data_for(ball, event_name)
      return data unless data[:exist]

      data.merge(
        cats: data[:cats].transform_values do |cat|
          {name: cat[:name], rarity: cat[:rarity]}
        end)
    end

    def self.pick_cat_name info, index
      return unless info

      names = info['name'] || []
      index.downto(0) do |i|
        return names[i] if names[i] && !names[i].empty?
      end
      nil
    end

    def self.multi_event_label info
      name = info['name'].to_s.
        gsub('★확률, 상세 내용은 배너를 클릭!★', '').strip
      range = "#{short_event_date(info['start_on'])} ~ " \
        "#{short_event_date(info['end_on'])}"

      name.empty? ? range : "#{range}: #{name}"
    end

    def self.short_event_date date
      date.strftime('%y.%m.%d')
    end

    # Mirrors what Route#prepare_tracks feeds into Gacha, but as plain data.
    def self.pool_data route
      pool = route.gacha.pool

      return {exist: false} unless pool.exist?

      pool.add_future_ubers(route.ubers) if route.ubers > 0

      slots = pool.slots

      {
        exist: true,
        version: pool.version,
        platinum: route.platinum?,
        rates: {
          rare: pool.rare,
          supa: pool.supa,
          uber: pool.uber,
          legend: pool.legend
        },
        base: GachaPool::Base,
        guaranteed_rolls: pool.guaranteed_rolls,
        slots: {
          Cat::Rare => Array(slots[Cat::Rare]),
          Cat::Supa => Array(slots[Cat::Supa]),
          Cat::Uber => Array(slots[Cat::Uber]),
          Cat::Legend => Array(slots[Cat::Legend])
        },
        cats: cats_data(route, pool, slots)
      }
    end

    def self.pool_data_for ball, event_name
      event = ball.events[event_name]
      return {exist: false} unless event

      pool = GachaPool.new(ball, event_name: event_name)
      return {exist: false} unless pool.exist?

      slots = pool.slots

      {
        exist: true,
        version: pool.version,
        platinum: event['platinum'],
        rates: {
          rare: pool.rare,
          supa: pool.supa,
          uber: pool.uber,
          legend: pool.legend
        },
        base: GachaPool::Base,
        guaranteed_rolls: pool.guaranteed_rolls,
        slots: {
          Cat::Rare => Array(slots[Cat::Rare]),
          Cat::Supa => Array(slots[Cat::Supa]),
          Cat::Uber => Array(slots[Cat::Uber]),
          Cat::Legend => Array(slots[Cat::Legend])
        },
        cats: cats_data_for_pool(pool, slots)
      }
    end

    # id => { name: [forms...], desc: [forms...], rarity: n, img: src|nil }
    # for cats that appear in slots. img is resolved for the requested form
    # (route.name) + lang, mirroring Cat#pick_img_src (the server is the only
    # side that knows which image files exist).
    def self.cats_data route, pool, slots
      ids = slots.values.flatten.uniq

      ids.each_with_object({}) do |id, result|
        info = pool.dig_cat(id)
        cat = Cat.new(id: id, info: info)

        result[id] = {
          name: info && info['name'],
          desc: info && info['desc'],
          rarity: info && info['rarity'],
          img: (cat.pick_img_src(route.name, route.lang) if info && id > 0)
        }
      end
    end

    def self.cats_data_for_pool pool, slots
      ids = slots.values.flatten.uniq

      ids.each_with_object({}) do |id, result|
        info = pool.dig_cat(id)

        result[id] = {
          name: info && info['name'],
          desc: info && info['desc'],
          rarity: info && info['rarity'],
          img: nil
        }
      end
    end

    def self.multi_events ball, initial_event: nil
      today = Date.today

      grouped = ball.events.group_by do |_, event|
        if today <= event['start_on']
          :upcoming
        elsif today <= event['end_on']
          :ongoing
        else
          :past
        end
      end

      ongoing = grouped[:ongoing] || []
      ongoing = ongoing.reverse_each.uniq do |id, event|
        event['platinum'] || id
      end.reverse

      upcoming = [*ongoing, *(grouped[:upcoming] || [])]
      past = (grouped[:past] || []).reverse
      entries = [*upcoming, *past]

      if initial_event && ball.events[initial_event] &&
        !entries.any?{ |event_name, _| event_name == initial_event }
        entries.unshift([initial_event, ball.events[initial_event]])
      end

      entries.map do |event_name, info|
        series_id = ball.gacha.dig(info['id'], 'series_id')
        series_name = EventSeriesNames.korean(series_id)
        series_name ||= event_filter_name(ball.gacha.dig(info['id'], 'name'))
        series_name = event_filter_name(info['name']) if series_name.empty?

        {
          event: event_name,
          group: today <= info['end_on'] ? 'upcoming' : 'past',
          preload: today <= info['end_on'] || event_name == initial_event,
          platinum: info['platinum'],
          series_id: series_id,
          series_name: series_name,
          label: multi_event_label(info)
        }
      end
    end
  end
end
