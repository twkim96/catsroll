# frozen_string_literal: true

require_relative 'root'
require_relative 'crystal_ball'
require_relative 'gacha_pool'
require_relative 'gacha'
require_relative 'owned'
require_relative 'aws_auth'
require_relative 'find_cat'
require_relative 'cat'
require_relative 'stat'

require 'cgi'
require 'date'
require 'forwardable'

module BattleCatsRolls
  class Route < Struct.new(:request)
    def self.load_ball lang
      CrystalBall.load("#{Root}/build", lang)
    end

    def self.reload_balls force=false
      %w[en tw jp kr].each do |lang|
        if public_send("ball_#{lang}").nil? || force
          public_send("ball_#{lang}=", load_ball(lang))
        end
      end
    end

    singleton_class.attr_accessor :ball_en, :ball_tw, :ball_jp, :ball_kr

    extend Forwardable

    def_delegator :request, :path_info

    def gacha
      @gacha ||= Gacha.new(pool, seed, version)
    end

    def ball
      @ball ||= Route.public_send("ball_#{lang}")
    end

    def cats
      ball.cats
    end

    def seek_source
      @seek_source ||=
        [seeker, version,
         gacha.rare, gacha.supa, gacha.uber, gacha.legend,
         gacha.rare_cats.size, gacha.supa_cats.size,
         gacha.uber_cats.size, gacha.legend_cats.size,
         *request.POST['rolls']].join(' ').squeeze(' ')
    end

    def seek_result key
      "/seek/result/#{key}?" \
        "event=#{event}&lang=#{lang}&" \
        "version=#{version}&seeker=#{seeker}&name=#{name}"
    end

    def show_tracks?
      event && seed.nonzero? && gacha.pool.exist?
    end

    def prepare_tracks
      gacha.pool.add_future_ubers(ubers) if ubers > 0

      if last.nonzero?
        gacha.last_roll = Cat.new(id: last)
        gacha.last_both = [gacha.last_roll, nil]
      end

      # Human counts from 1
      cats = 1.upto(count).map do |sequence|
        gacha.roll_both!(sequence)
      end

      if version == '8.6'
        gacha.finish_rerolled_links(cats)
      end

      if last.nonzero?
        gacha.finish_last_roll(cats.dig(0, 0))
      end

      if guaranteed_rolls > 0
        gacha.finish_guaranteed(cats, guaranteed_rolls)
      end

      if pick = request.params_coercion_with_nil('pick', :to_s)
        gacha.finish_picking(cats, pick, guaranteed_rolls)
      end

      found_cats =
        FindCat.search(gacha, find,
          cats: cats, guaranteed: !no_guaranteed, max: FindCat::Max)

      [cats, found_cats]
    end

    def cats_uri **args
      uri(path: "//#{web_host}/cats", **args)
    end

    def help_uri
      uri(path: "//#{web_host}/help")
    end

    def logs_uri
      uri(path: "//#{web_host}/logs")
    end

    def seek_uri
      uri(path: "//#{seek_host}/seek")
    end

    def uri path: "//#{web_host}/", query: {}, **args
      query = cleanup_query(default_query(query, **args))

      if query.empty?
        path
      else
        "#{path}?#{query_string(query)}"
      end
    end

    def seek_host
      SeekHost || request.host_with_port
    end

    def web_host
      WebHost || request.host_with_port
    end

    def tsv_expires_in
      600
    end

    def throttle_ip_expires_in
      600
    end

    def lang
      @lang ||=
        case value = request.params_coercion_with_nil('lang', :to_s)
        when 'tw', 'jp', 'kr'
          value
        else
          'en'
        end
    end

    def ui
      @ui ||=
        case value = request.params_coercion_with_nil('ui', :to_s)
        when 'en', 'tw', 'jp', 'kr'
          value
        else
          '' # Default to whatever lang is
        end
    end

    def ui_lang
      @ui_lang = if ui.empty? then lang else ui end
    end

    def version
      @version ||=
        case value = request.params_coercion_with_nil('version', :to_s)
        when '8.6', '8.5', '8.4'
          value
        else
          default_version
        end
    end

    def default_version
      case lang
      when 'jp'
        '8.6'
      else
        '8.6'
      end
    end

    def seeker
      @seeker ||=
        case value = request.params_coercion_with_nil('seeker', :to_s)
        when 'VampireFlower', 'forgothowtoreddid', 'godfat'
          value
        else
          default_seeker
        end
    end

    def default_seeker
      @default_seeker ||=
        case version
        when '8.6'
          'VampireFlower'
        else
          'godfat'
        end
    end

    def name
      @name ||=
        case value = request.params_coercion_with_nil('name', :to_i)
        when 1, 2, 3
          value
        else
          0
        end
    end

    def theme
      @theme ||=
        case value = request.params_coercion_with_nil('theme', :to_s)
        when 'mkweb'
          value
        else
          ''
        end
    end

    MaxSeed = 2 ** 32

    # This is the seed from the seed input field
    def seed
      @seed ||= request.params_coercion('seed', :to_i).abs % MaxSeed
    end

    def event
      @event ||= request.params_coercion_with_nil('event', :to_s) ||
        current_event
    end

    def upcoming_events
      @upcoming_events ||=
        [*grouped_events[:ongoing], *grouped_events[:upcoming]] || []
    end

    def past_events
      @past_events ||= grouped_events[:past] || []
    end

    def custom
      @custom ||= request.params_coercion_with_nil('custom', :to_i) ||
        ball.gacha.each_key.reverse_each.first.to_i
    end

    def rate
      @rate ||= request.params_coercion('rate', :to_s)
    end

    def c_rare
      @c_rare ||= get_rate('c_rare', 0)
    end

    def c_supa
      @c_supa ||= get_rate('c_supa', 1)
    end

    def c_uber
      @c_uber ||= get_rate('c_uber', 2)
    end

    def count
      @count ||=
        [
          1,
          [
            request.params_coercion_with_nil('count', :to_i) || 100,
            FindCat::Max
          ].min
        ].max
    end

    def find
      @find ||= request.params_coercion('find', :to_i)
    end

    def last
      @last ||= request.params_coercion('last', :to_i)
    end

    def no_guaranteed
      return @no_guaranteed if instance_variable_defined?(:@no_guaranteed)

      @no_guaranteed = request.params_coercion_true_or_nil('no_guaranteed')
    end

    def force_guaranteed
      @force_guaranteed ||= request.params_coercion('force_guaranteed', :to_i)
    end

    def guaranteed_rolls
      @guaranteed_rolls ||=
        if force_guaranteed.zero?
          gacha.pool.guaranteed_rolls
        else
          force_guaranteed
        end
    end

    def ubers
      @ubers ||= request.params_coercion('ubers', :to_i)
    end

    def details
      return @details if instance_variable_defined?(:@details)

      @details = request.params_coercion_true_or_nil('details')
    end

    def o
      @o ||=
        if owned.any?
          Owned.encode(owned)
        else
          ''
        end
    end

    def owned
      @owned ||=
        if ticked.any?
          ticked
        elsif (result = Owned.decode(request.params_coercion('o', :to_s))).any?
          result
        else
          Owned.decode_old(request.params_coercion('owned', :to_s))
        end.sort.uniq
    end

    def ticked
      @ticked ||= Array(request.params['t']).map(&:to_i).sort.uniq
    end

    def level
      @level ||= request.params_coercion_with_nil('level', :to_i)&.abs ||
        default_level
    end

    def default_level
      Stat::DefaultLevel
    end

    def hide_wave
      return @hide_wave if instance_variable_defined?(:@hide_wave)

      @hide_wave = request.params_coercion_true_or_nil('hide_wave')
    end

    def advanced_filters
      return @advanced_filters if instance_variable_defined?(:@advanced_filters)

      @advanced_filters = request.params_coercion_true_or_nil('advanced_filters')
    end

    def exclude_talents
      return @exclude_talents if instance_variable_defined?(:@exclude_talents)

      @exclude_talents = request.params_coercion_true_or_nil('exclude_talents')
    end

    def sum_no_wave
      return @sum_no_wave if instance_variable_defined?(:@sum_no_wave)

      @sum_no_wave = request.params_coercion_true_or_nil('sum_no_wave')
    end

    def dps_no_critical
      return @dps_no_critical if instance_variable_defined?(:@dps_no_critical)

      @dps_no_critical = request.params_coercion_true_or_nil('dps_no_critical')
    end

    def for_against
      @for_against ||=
        case value = request.params_coercion_with_nil('for_against', :to_s)
        when 'all', 'any'
          value
        else
          default_for_against
        end
    end

    def default_for_against
      @default_for_against ||= 'all'
    end

    def against
      @against ||= Array(request.params['against'])
    end

    def for_buff
      @for_buff ||=
        case value = request.params_coercion_with_nil('for_buff', :to_s)
        when 'any', 'all'
          value
        else
          default_for_buff
        end
    end

    def default_for_buff
      @default_for_buff ||= 'any'
    end

    def buff
      @buff ||= Array(request.params['buff'])
    end

    def for_resistant
      @for_resistant ||=
        case value = request.params_coercion_with_nil('for_resistant', :to_s)
        when 'or', 'and'
          value
        else
          default_for_resistant
        end
    end

    def default_for_resistant
      @default_for_resistant ||= 'or'
    end

    def resistant
      @resistant ||= Array(request.params['resistant'])
    end

    def for_range
      @for_range ||=
        case value = request.params_coercion_with_nil('for_range', :to_s)
        when 'any', 'all'
          value
        else
          default_for_range
        end
    end

    def default_for_range
      @default_for_range ||= 'any'
    end

    def range
      @range ||= Array(request.params['range'])
    end

    def area
      @area ||= request.params_coercion_with_nil('area', :to_s) ||
        default_area
    end

    def default_area
      @default_area ||= 'any'
    end

    def for_control
      @for_control ||=
        case value = request.params_coercion_with_nil('for_control', :to_s)
        when 'any', 'all'
          value
        else
          default_for_control
        end
    end

    def default_for_control
      @default_for_control ||= 'any'
    end

    def control
      @control ||= Array(request.params['control'])
    end

    def for_immunity
      @for_immunity ||=
        case value = request.params_coercion_with_nil('for_immunity', :to_s)
        when 'any', 'all'
          value
        else
          default_for_immunity
        end
    end

    def default_for_immunity
      @default_for_immunity ||= 'any'
    end

    def immunity
      @immunity ||= Array(request.params['immunity'])
    end

    def for_counter
      @for_counter ||=
        case value = request.params_coercion_with_nil('for_counter', :to_s)
        when 'any', 'all'
          value
        else
          default_for_counter
        end
    end

    def default_for_counter
      @default_for_counter ||= 'any'
    end

    def counter
      @counter ||= Array(request.params['counter'])
    end

    def for_combat
      @for_combat ||=
        case value = request.params_coercion_with_nil('for_combat', :to_s)
        when 'any', 'all'
          value
        else
          default_for_combat
        end
    end

    def default_for_combat
      @default_for_combat ||= 'any'
    end

    def combat
      @combat ||= Array(request.params['combat'])
    end

    def for_other
      @for_other ||=
        case value = request.params_coercion_with_nil('for_other', :to_s)
        when 'all', 'any'
          value
        else
          default_for_other
        end
    end

    def default_for_other
      @default_for_other ||= 'all'
    end

    def other
      @other ||= Array(request.params['other'])
    end

    def dps
      @dps ||= request.params_coercion_with_nil('dps', :to_s) || default_dps
    end

    def default_dps
      @default_dps ||= 'any'
    end

    def damage
      @damage ||= request.params_coercion_with_nil('damage', :to_s) ||
        default_damage
    end

    def default_damage
      @default_damage ||= 'any'
    end

    def health
      @health ||= request.params_coercion_with_nil('health', :to_s) ||
        default_health
    end

    def default_health
      @default_health ||= 'any'
    end

    def knockbacks
      @knockbacks ||= request.params_coercion_with_nil('knockbacks', :to_s) ||
        default_knockbacks
    end

    def default_knockbacks
      @default_knockbacks ||= 'any'
    end

    def stand
      @stand ||= request.params_coercion_with_nil('stand', :to_s) ||
        default_stand
    end

    def default_stand
      @default_stand ||= 'any'
    end

    def reach
      @reach ||= request.params_coercion_with_nil('reach', :to_s) ||
        default_reach
    end

    def default_reach
      @default_reach ||= 'any'
    end

    def speed
      @speed ||= request.params_coercion_with_nil('speed', :to_s) ||
        default_speed
    end

    def default_speed
      @default_speed ||= 'any'
    end

    def cost
      @cost ||= request.params_coercion_with_nil('cost', :to_s) ||
        default_cost
    end

    def default_cost
      @default_cost ||= 'any'
    end

    def production
      @production ||= request.params_coercion_with_nil('production', :to_s) ||
        default_production
    end

    def default_production
      @default_production ||= 'any'
    end

    def for_aspect
      @for_aspect ||=
        case value = request.params_coercion_with_nil('for_aspect', :to_s)
        when 'all', 'any'
          value
        else
          default_for_aspect
        end
    end

    def default_for_aspect
      @default_for_aspect ||= 'all'
    end

    def aspect
      @aspect ||= Array(request.params['aspect'])
    end

    def uri_to_roll cat
      uri(query: {seed: cat.slot_fruit.seed, last: cat.id})
    end

    def uri_to_cat cat
      uri(path: "//#{web_host}/cats/#{cat.id}")
    end

    def event_url *args, **options
      AwsAuth.event_url(lang, *args, base_uri: event_base_uri, **options)
    end

    private

    def pool
      @pool ||=
        case event
        when 'custom'
          event_data = {
            'id' => custom,
            'rare' => c_rare,
            'supa' => c_supa,
            'uber' => c_uber
          }

          GachaPool.new(ball, event_data: event_data)
        else
          GachaPool.new(ball, event_name: event)
        end
    end

    def current_event
      @current_event ||=
        upcoming_events.find{ |_, info| info['platinum'].nil? }&.first
    end

    def grouped_events
      @grouped_events ||= begin
        today = Date.today

        events = all_events.group_by do |_, value|
          if today <= value['start_on']
            :upcoming
          elsif today <= value['end_on']
            :ongoing
          else
            :past
          end
        end

        if events[:ongoing]
          # keep each types of platinum just once for ongoing events
          # uniq will keep the first occurrence so we reverse and reverse
          events[:ongoing] = events[:ongoing].reverse_each.uniq do |id, event|
            event['platinum'] || id
          end.reverse!
        end

        events
      end
    end

    def all_events
      @all_events ||= ball.events
    end

    def get_rate name, index
      int = request.params_coercion_with_nil(name, :to_i)&.abs ||
        CrystalBall.predefined_rates.dig(rate, :rate, index) ||
        predict_rate(index).to_i

      [int, 10000].min
    end

    def predict_rate index
      # We only want to predict if it's specified, especially because
      # for custom rates we don't want to predict to interfere it.
      # Keep in mind that for custom rates the rate == ''
      if rate == 'predicted'
        CrystalBall.predefined_rates.dig(
          # We also want to give something if no prediction can be made,
          # otherwise we won't be able to switch to custom rates when
          # we can't make prediction. In that case, just guess it with
          # the most common rates, regular. To verify this, check:
          # https://bc.godfat.org/?seed=1&event=custom&custom=2&rate=predicted
          # And switch to "Customize..." under "Predicted".
          ball.gacha.dig(custom, 'rate') || 'regular', :rate, index)
      end
    end

    def event_base_uri
      "#{request.scheme}://#{seek_host}/seek"
    end

    def query_string query
      query.flat_map do |key, value|
        case value
        when Array
          value.map do |v|
            "#{CGI.escape(key.to_s)}=#{CGI.escape(v.to_s)}"
          end
        else
          "#{CGI.escape(key.to_s)}=#{CGI.escape(value.to_s)}"
        end
      end.join('&')
    end

    def default_query query={}, include_filters: false
      keys = %i[
        seed last event custom rate c_rare c_supa c_uber level lang ui
        version seeker name theme count find
        no_guaranteed force_guaranteed ubers details
        advanced_filters exclude_talents sum_no_wave dps_no_critical
        hide_wave
        o
      ]

      if include_filters
        keys.push(
          :for_against, :against,
          :for_buff, :buff,
          :for_resistant, :resistant,
          :for_range, :range, :area,
          :for_control, :control,
          :for_immunity, :immunity,
          :for_counter, :counter,
          :for_combat, :combat,
          :for_other, :other)

        if advanced_filters
          keys.push(
            :dps, :damage, :health, :knockbacks,
            :stand, :reach, :speed, :cost, :production,
            :for_aspect, :aspect)
        end
      end

      ret = keys.inject({}) do |result, key|
        result[key] = query[key] || __send__(key)
        result
      end

      if ret[:rate] == '' && %i[c_rare c_supa c_uber].all?{ |c| ret[c].zero? }
        # When we first go into customization, all of them are in base values,
        # and we want to use the predicted rates in this case. However,
        # it can also be possible that all rates are zero, yet we have
        # already picked a specific rate. For example, this can happen if
        # we're checking a gacha having non-existing cats. In this case,
        # we don't want to change the rate already picked!
        # Try this and pick a different rate:
        # https://bc.godfat.org/?seed=1&event=custom&custom=2&rate=predicted
        # We want it to be preserved and we should be able to pick freely.
        ret[:rate] = 'predicted'
      end

      ret
    end

    def cleanup_query query
      query.compact.select do |key, value|
        if (key == :seed && value == 0) ||
           (key == :lang && value == 'en') ||
           (key == :ui && value == '') ||
           (key == :version && value == default_version) ||
           (key == :seeker && value == default_seeker) ||
           (key == :name && value == 0) ||
           (key == :theme && value == '') ||
           (key == :count && value == 100) ||
           (key == :find && value == 0) ||
           (key == :last && value == 0) ||
           (key == :force_guaranteed && value == 0) ||
           (key == :ubers && value == 0) ||
           (key == :level && value == default_level) ||
           (key == :o && value == '') ||
           (key == :for_against && value == default_for_against) ||
           (key == :against && value == []) ||
           (key == :for_buff && value == default_for_buff) ||
           (key == :buff && value == []) ||
           (key == :for_resistant && value == default_for_resistant) ||
           (key == :resistant && value == []) ||
           (key == :for_range && value == default_for_range) ||
           (key == :range && value == []) ||
           (key == :area && value == default_area) ||
           (key == :for_control && value == default_for_control) ||
           (key == :control && value == []) ||
           (key == :for_immunity && value == default_for_immunity) ||
           (key == :immunity && value == []) ||
           (key == :for_counter && value == default_for_counter) ||
           (key == :counter && value == []) ||
           (key == :for_combat && value == default_for_combat) ||
           (key == :combat && value == []) ||
           (key == :for_other && value == default_for_other) ||
           (key == :other && value == []) ||
           (key == :dps && value == default_dps) ||
           (key == :damage && value == default_damage) ||
           (key == :health && value == default_health) ||
           (key == :knockbacks && value == default_knockbacks) ||
           (key == :stand && value == default_stand) ||
           (key == :reach && value == default_reach) ||
           (key == :speed && value == default_speed) ||
           (key == :cost && value == default_cost) ||
           (key == :production && value == default_production) ||
           (key == :for_aspect && value == default_for_aspect) ||
           (key == :aspect && value == []) ||
           (key == :event && value == current_event) ||
           (query[:event] != 'custom' &&
              (key == :custom || key == :rate ||
               key == :c_rare || key == :c_supa || key == :c_uber)) ||
           (query[:event] == 'custom' &&
              (
                (key == :rate && value == '') ||
                (query[:rate] != '' &&
                  (key == :c_rare || key == :c_supa || key == :c_uber))
              ))
          false
        else
          true
        end
      end
    end
  end
end
