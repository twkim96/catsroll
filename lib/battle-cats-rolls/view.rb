# frozen_string_literal: true

require_relative 'cat'
require_relative 'find_cat'
require_relative 'gacha'
require_relative 'owned'
require_relative 'l10n'

require 'tilt'

require 'cgi'
require 'erb'
require 'forwardable'

module BattleCatsRolls
  class View < Struct.new(:route, :arg)
    extend Forwardable

    def_delegator :route, :gacha

    def render name
      erb(:layout){ erb(name) }
    end

    private

    def html_title
      if picked_stat
        h picked_stat.name
      else
        route.path_info[/\w+/]&.capitalize || 'Tracks'
      end
    end

    def meta_description
      if picked_stat
        h picked_stat.desc.tr("\n", ' ').squeeze(' ')
      end
    end

    def og_image
      "//#{route.web_host}#{picked_stat.img_src(route.lang)}"
    end

    def picked_stat
      return @picked_stat if instance_variable_defined?(:@picked_stat)

      @picked_stat = if stats = arg&.dig(:stats)
        stats[route.name] || stats.last
      end
    end

    def l10n text
      L10n.translate(route.ui_lang, text)
    end

    def each_cats_by_rarity cats_by_rarity
      cats_by_rarity.reverse_each do |rarity, data|
        yield(rarity, data.map{ |id, info| Cat.new(id: id, info: info) })
      end
    end

    def each_ab_cat
      arg[:cats].inject(nil) do |prev_b, ab|
        yield(prev_b, ab)

        ab.last
      end
    end

    def each_attack stat
      if route.hide_wave
        stat.attacks_raw
      else
        stat.attacks
      end.each do |attack|
        yield(attack)
      end
    end

    def color_label cat, type, rerolled
      return unless cat

      if type == :cat || !(rerolled || cat.rerolled)
        picked = cat.picked_label
        cursor = :pick
      else
        cursor = :navigate
      end

      "#{cursor} #{color_rarity(cat)} #{picked}".chomp(' ')
    end

    def color_rarity cat
      case rarity_label = cat.rarity_label
      when :legend
        :legend
      else
        case cat.id
        when route.find
          :found
        when *route.owned
          :owned
        when *FindCat.exclusives
          :exclusive
        else
          rarity_label
        end
      end
    end

    def color_guaranteed cat
      case cat.guaranteed.id
      when route.find
        :found
      when *FindCat.exclusives
        :exclusive
      when Integer
        :rare
      end
    end

    def number_td cat, other_cat
      rowspan = 2 + [cat.rerolled, other_cat&.rerolled].compact.size

      <<~HTML
        <td rowspan="#{rowspan}" id="N#{cat.number}">
          <a href="#{uri_for_number_td(cat)}">#{cat.number}</a>
        </td>
      HTML
    end

    def uri_for_number_td cat
      # Rotate between regular and rerolled when it's not 1A
      # For 1A rerolled or not should be determined only by the last cat
      pos = if route.pos == cat.number && cat.rerolled && cat.number != '1A'
        "#{cat.number}R"
      else
        cat.number
      end

      # For 1A we want to keep the last cat
      last = 0 if cat.number != '1A'

      "#{route.uri(query: {pos: pos, last: last})}#N#{cat.number}"
    end

    def uri_for_backtrack steps
      route.uri(query: {
        seed: route.gacha.backtrack_seed(route.seed, steps),
        last: 0, pos: '1A'})
    end

    def score_tds cat, other_cat
      rowspan =
        if other_cat&.rerolled
          2
        else
          1
        end

      content =
        if show_details
          "#{cat.score}, #{cat.slot}"
        else
          "\u00A0"
        end

      single = td(cat, :score, rowspan: rowspan, content: content)
      guaranteed = td(cat.guaranteed, :score, rowspan: rowspan,
        rerolled: cat.rerolled&.guaranteed)

      "#{single}\n#{guaranteed}"
    end

    def cat_tds cat, type=:roll
      single = td_to_cat(cat, type)
      guaranteed = td_to_cat(cat.guaranteed, :next)

      "#{single}\n#{guaranteed}"
    end

    def td_to_cat cat, link_type
      td(cat, :cat, content: cat && __send__("link_to_#{link_type}", cat))
    end

    def td cat, type, rowspan: 1, content: nil, rerolled: nil
      <<~HTML
        <td
          rowspan="#{rowspan}"
          class="#{type} #{color_label(cat, type, rerolled)}"
          #{onclick_pick(cat, type)}>
          #{content}
        </td>
      HTML
    end

    def link_to_roll cat
      name = h cat.pick_name(route.name)
      title = h cat.pick_title(route.name)
      show_link_to_stat = cat.id > 0

      if cat.slot_fruit
        link =
          %Q{<a href="#{h route.uri_to_roll(cat)}" title="#{title}">#{name}</a>}
        if show_link_to_stat
          %Q{#{link}<a href="#{route.uri_to_cat(cat)}">🐾</a>}
        else
          link
        end
      elsif show_link_to_stat
        %Q{<a href="#{route.uri_to_cat(cat)}" title="#{title}">#{name}</a>}
      else
        %Q{<span title="#{title}">#{name}</span>}
      end
    end

    def link_to_next cat
      cat_link = link_to_roll(cat)
      next_cat = cat.next

      case next_cat&.track
      when 0
        "&lt;- #{next_cat.number} #{cat_link}"
      when 1
        "#{cat_link} -&gt; #{next_cat.number}"
      when nil
        "&lt;?&gt; #{cat_link}"
      else
        raise "Unknown track: #{next_cat.track.inspect}"
      end
    end

    def pick_option cats
      cats.map.with_index do |cat, slot|
        <<~HTML
          <option value="#{cat.rarity} #{slot}">#{slot} #{cat_name(cat)}</option>
        HTML
      end.join
    end

    def selected_lang lang_name
      'selected="selected"' if route.lang == lang_name
    end

    def selected_pos pos
      'selected="selected"' if route.pos == pos
    end

    def selected_version version_name
      'selected="selected"' if route.version == version_name
    end

    def selected_seeker seeker_name
      'selected="selected"' if route.seeker == seeker_name
    end

    def selected_name name_name
      'selected="selected"' if route.name == name_name
    end

    def selected_theme theme_name
      'selected="selected"' if route.theme == theme_name
    end

    def selected_ui ui_name
      'selected="selected"' if route.ui == ui_name
    end

    def selected_current_event event_name
      'selected="selected"' if route.event == event_name
    end

    def selected_custom_gacha gacha_id
      'selected="selected"' if route.custom == gacha_id
    end

    def selected_rate rate
      'selected="selected"' if route.rate == rate
    end

    def selected_find cat
      'selected="selected"' if route.find == cat.id
    end

    def selected_last cat
      'selected="selected"' if route.last == cat.id
    end

    def checked_no_guaranteed
      'checked="checked"' if route.no_guaranteed
    end

    def selected_force_guaranteed n
      'selected="selected"' if route.force_guaranteed == n
    end

    def selected_ubers n
      'selected="selected"' if route.ubers == n
    end

    def checked_details
      'checked="checked"' if route.details
    end

    def checked_advanced_filters
      'checked="checked"' if route.advanced_filters
    end

    def checked_exclude_talents
      'checked="checked"' if route.exclude_talents
    end

    def checked_hide_wave
      'checked="checked"' if route.hide_wave
    end

    def checked_sum_no_wave
      'checked="checked"' if route.sum_no_wave
    end

    def checked_dps_no_critical
      'checked="checked"' if route.dps_no_critical
    end

    def checked_for_against value
      'checked="checked"' if route.for_against == value
    end

    def checked_against value
      'checked="checked"' if route.against.member?(value)
    end

    def checked_for_buff value
      'checked="checked"' if route.for_buff == value
    end

    def checked_buff value
      'checked="checked"' if route.buff.member?(value)
    end

    def checked_for_resistant value
      'checked="checked"' if route.for_resistant == value
    end

    def checked_resistant value
      'checked="checked"' if route.resistant.member?(value)
    end

    def checked_for_range value
      'checked="checked"' if route.for_range == value
    end

    def checked_range value
      'checked="checked"' if route.range.member?(value)
    end

    def checked_area value
      'checked="checked"' if route.area == value
    end

    def checked_for_control value
      'checked="checked"' if route.for_control == value
    end

    def checked_control value
      'checked="checked"' if route.control.member?(value)
    end

    def checked_for_immunity value
      'checked="checked"' if route.for_immunity == value
    end

    def checked_immunity value
      'checked="checked"' if route.immunity.member?(value)
    end

    def checked_for_counter value
      'checked="checked"' if route.for_counter == value
    end

    def checked_counter value
      'checked="checked"' if route.counter.member?(value)
    end

    def checked_for_combat value
      'checked="checked"' if route.for_combat == value
    end

    def checked_combat value
      'checked="checked"' if route.combat.member?(value)
    end

    def checked_for_other value
      'checked="checked"' if route.for_other == value
    end

    def checked_other value
      'checked="checked"' if route.other.member?(value)
    end

    def checked_dps value
      'checked="checked"' if route.dps == value
    end

    def checked_damage value
      'checked="checked"' if route.damage == value
    end

    def checked_health value
      'checked="checked"' if route.health == value
    end

    def checked_knockbacks value
      'checked="checked"' if route.knockbacks == value
    end

    def checked_stand value
      'checked="checked"' if route.stand == value
    end

    def checked_reach value
      'checked="checked"' if route.reach == value
    end

    def checked_speed value
      'checked="checked"' if route.speed == value
    end

    def checked_cost value
      'checked="checked"' if route.cost == value
    end

    def checked_production value
      'checked="checked"' if route.production == value
    end

    def checked_for_aspect value
      'checked="checked"' if route.for_aspect == value
    end

    def checked_aspect value
      'checked="checked"' if route.aspect.member?(value)
    end

    def attack_tr_class attack
      if attack.kind_of?(BattleCatsRolls::TriggeredAttack)
        'triggered_attack'
      else
        'attack'
      end
    end

    def checked_cat cat
      ticked = route.ticked

      if ticked.empty?
        'checked="checked"' if route.owned.member?(cat.id)
      elsif ticked.member?(cat.id)
        'checked="checked"'
      end
    end

    def show_details
      arg&.dig(:details) && route.details
    end

    def hidden_inputs *input_names
      input_names.map do |name|
        <<~HTML
          <input type="hidden" name="#{name}" value="#{route.public_send(name)}">
        HTML
      end.join("\n")
    end

    def show_event info
      h "#{info['start_on']} ~ #{info['end_on']}: #{info['name']}"
    end

    def show_gacha_slots cats
      cats.map.with_index do |cat, i|
        "#{i} #{link_to_roll(cat)}"
      end.join(', ')
    end

    def cat_name cat
      h cat.pick_name(route.name)
    end

    def display_ability ability
      display_list(ability.display(&method(:itself)), strong: true)
    end

    def display_list text_or_list, strong: false
      case text_or_list
      when Array
        text_or_list.map do |text|
          if strong
            "<strong>#{l10n(text)}</strong>"
          else
            l10n(text)
          end
        end.join(l10n(', '))
      else
        l10n(text_or_list)
      end
    end

    def display_filter filter
      h l10n(filter.sub(/^./, &:upcase).tr('_', ' '))
    end

    def stat_time frames
      case frames
      when Numeric
        title = "#{frames} frames"
        %Q{<span title="#{title}">#{(frames.to_f / Stat::FPS).round(2)}s</span>}
      else
        frames || '?'
      end
    end

    def stat_int number
      case number
      when Numeric
        number.round
      when NilClass
        '?'
      else
        number
      end
    end

    def growth_rate growth
      return unless growth

      init = [[2, 10, growth.first]]
      growth.drop(1).each.with_index.inject(init) do |result, (rate, index)|
        last = result.last
        if last[2] == rate
          last[1] += 10
        else
          result << [last[1].succ, last[1] + 10, rate]
        end
        result
      end.map do |(start, last, rate)|
        "lv#{start}~#{last}: #{rate}%"
      end.join(", ")
    end

    def h str
      CGI.escape_html(str)
    end

    def made10rolls? seeds
      gacha = Gacha.new(
        route.gacha.pool, seeds.first, route.version)
      gacha.send(:advance_seed!) # Account offset
      9.times.inject(nil){ |last| gacha.roll! } # Only 9 rolls left

      if gacha.seed == seeds.last
        gacha.send(:advance_seed!) # Account for guaranteed roll
        gacha.seed
      end
    end

    def rarity_header rarity, size
      label = BattleCatsRolls::Cat.wiki_rarity_label(rarity)
      header(2, "#{label} (#{size})", label.downcase.gsub(/\W+/, '-'))
    end

    def header n, name, id=name.to_s.downcase.gsub(/\W+/, '-')
      <<~HTML
        <a href="##{id}">⚓</a> <h#{n} id="#{id}">#{name}</h#{n}>
      HTML
    end

    def seed_tds fruit, cat
      return unless show_details

      rowspan =
        if cat&.rerolled
          2
        else
          1
        end

      value =
        if fruit.seed == fruit.value
          '-'
        else
          fruit.value
        end

      <<~HTML
        <td rowspan="#{rowspan}">#{fruit.seed}</td>
        <td rowspan="#{rowspan}">#{value}</td>
      HTML
    end

    def onclick_pick cat, type
      return unless cat && route.path_info == '/'

      number =
        case type
        when :cat
          cat.number
        else
          "#{cat.number}X"
        end

      %Q{onclick="pick('#{number}')"}
    end

    def uri_to_wiki cat
      return unless info = Route.ball_en.cats[cat.id]

      en_cat = Cat.new(info: info)
      "https://battlecats.miraheze.org/wiki/#{h(en_cat.wiki_entry_name)}"
    end

    def uri_to_cat_db cat
      "https://battlecats-db.com/unit/#{sprintf('%03d', cat.id)}.html"
    end

    def uri_to_my_gamatoto cat
      "https://mygamatoto.com/catinfo/#{sprintf('%03d', cat.id)}/cat"
    end

    def uri_to_own_all_cats
      route.cats_uri(query: {o: Owned.encode(route.owned + arg[:cats].keys)},
        include_filters: true)
    end

    def uri_to_drop_all_cats
      route.cats_uri(query: {o: Owned.encode(route.owned - arg[:cats].keys)},
        include_filters: true)
    end

    def erb name, nested_arg=nil, &block
      context =
        if nested_arg
          self.class.new(route, arg&.merge(nested_arg) || nested_arg)
        else
          self
        end

      self.class.template(name).render(context, &block)
    end

    def self.template name
      (@template ||= {})[name.to_s] ||=
        Tilt.new("#{__dir__}/view/#{name}.erb", trim: '-')
    end

    def self.warmup
      prefix = Regexp.escape("#{__dir__}/view/")

      Dir.glob("#{__dir__}/view/**/*") do |name|
        next if File.directory?(name)

        template(name[/\A#{prefix}(.+)\.erb\z/m, 1])
      end
    end
  end
end
