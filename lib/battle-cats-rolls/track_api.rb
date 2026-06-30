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

    get '/track.json' do
      route = Route.new(Request.new(env))

      headers \
        'content-type' => 'application/json; charset=utf-8',
        'cache-control' => 'public, max-age=600'

      body JSON.generate(TrackApi.pool_data(route))
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
  end
end
