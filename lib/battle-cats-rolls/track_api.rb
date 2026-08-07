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
    get '/events.json' do
      route = Route.new(Request.new(env))

      headers \
        'content-type' => 'application/json; charset=utf-8',
        'cache-control' => 'public, max-age=600'

      body JSON.generate(TrackApi.events_data(route))
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

    def self.multi_data route
      initial_lang =
        if MultiLangs.include?(route.lang)
          route.lang
        else
          'kr'
        end

      {
        initial: {
          seed: route.seed,
          count: [route.count, 500].min,
          lang: initial_lang,
          event: route.event,
          name: route.name
        },
        limits: {
          rows: 5,
          count: 500
        },
        last_cats: multi_last_cats(route.name),
        regions: MultiLangs.each_with_object({}) do |lang, result|
          ball = Route.public_send("ball_#{lang}")
          initial_event = route.event if lang == initial_lang
          events = multi_events(ball, initial_event: initial_event)
          current = events.find do |event|
            event[:group] == 'upcoming' && !event[:platinum]
          end || events.first

          result[lang] = {
            label: MultiLabels.fetch(lang),
            current: current&.fetch(:event, nil),
            events: events.map do |event|
              item = {
                event: event[:event],
                label: event[:label],
                group: event[:group]
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
        {
          event: event_name,
          group: today <= info['end_on'] ? 'upcoming' : 'past',
          preload: today <= info['end_on'] || event_name == initial_event,
          platinum: info['platinum'],
          label: multi_event_label(info)
        }
      end
    end
  end
end
