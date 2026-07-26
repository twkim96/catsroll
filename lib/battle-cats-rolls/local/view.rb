# frozen_string_literal: true

require 'json'

module BattleCatsRolls
  module LocalView
    private

    def found_cat_numbers cat
      numbers = cat.respond_to?(:numbers) ? cat.numbers : [cat.number]
      numbers.map{ |number| found_cat_number_link(number) }.join(', ')
    end

    def found_cat_number_link number
      anchor = number.to_s.gsub(/[RGX]/, '')
      sequence = anchor.to_i
      label = h(number.to_s)

      if sequence.between?(1, route.count)
        %Q{<a href="#N#{h(anchor)}">#{label}</a>}
      else
        label
      end
    end

    def td cat, type, rowspan: 1, content: nil, rerolled: nil
      <<~HTML
        <td
          rowspan="#{rowspan}"
          class="#{type} #{color_label(cat, type, rerolled)}"
          #{expand_data_attrs(cat, type)}
          #{onclick_pick(cat, type)}>
          #{content}
        </td>
      HTML
    end

    def expand_data_attrs cat, type
      return unless type == :score && cat&.slot_seed

      attrs = {
        'data-expand-kind' => cat.extra_label.to_s.include?('G') ?
          'guaranteed' : 'roll',
        'data-expand-slot-seed' => cat.slot_seed
      }
      attrs['data-expand-rarity-seed'] = cat.rarity_seed if cat.rarity_seed

      attrs.map{ |key, value| %Q{#{key}="#{h(value.to_s)}"} }.join(' ')
    end

    def link_to_roll cat, text: true, image: false, prefix: nil, suffix: nil
      name = h cat.pick_name(route.name)
      title = h cat.pick_title(route.name)
      stat_uri = h route.uri_to_cat(cat) if cat.id > 0
      roll_uri = h route.uri_to_roll(cat) if cat.slot_seed
      avatar = avatar_tag(cat, name) if image && stat_uri
      text_roll = roll_tag(roll_uri, title, name) if text || !avatar
      stat = %Q{ <a href="#{stat_uri}">🐾</a>} if stat_uri
      content = "<span>#{prefix}#{text_roll}#{stat}#{suffix}</span>"

      if avatar
        image_roll = roll_tag(roll_uri, title, avatar)
        %Q{<span class="track_avatar_wrap">#{image_roll}#{content}</span>}
      else
        content
      end
    end

    def avatar_tag cat, name
      @avatar_tag ||= {}
      return @avatar_tag[cat.id] if @avatar_tag.key?(cat.id)

      @avatar_tag[cat.id] = begin
        src = cat.pick_img_src(route.name, route.lang)
        if src
          src = h src
          alt = name if route.display == 'image'

          <<~HTML.strip
            <span class="track_avatar_clip">
              <img class="track_avatar" src="#{src}" alt="#{alt}"
                decoding="async"></span>
          HTML
        end
      end
    end

    def seed_view_line_chart points, axis_every: 1, axis_label: :time
      width = 960
      height = 290
      pad_x = 32
      pad_top = 24
      pad_bottom = 54
      plot_width = width - (pad_x * 2)
      plot_height = height - pad_top - pad_bottom
      max = [points.map{ |point| point[:count] }.max.to_i, 1].max
      step = plot_width.to_f / [points.size - 1, 1].max
      coords = points.map.with_index do |point, index|
        x = pad_x + (index * step)
        y = pad_top + plot_height -
          (point[:count].to_f / max * plot_height)
        [point, x, y, index]
      end
      polyline = coords.map{ |_point, x, y| "#{x.round(2)},#{y.round(2)}" }.
        join(' ')
      axis_y = height - pad_bottom

      <<~HTML
        <svg class="seed-view-line-chart" viewBox="0 0 #{width} #{height}"
          role="img" aria-label="Seed view line chart">
          <line class="seed-view-axis" x1="#{pad_x}" y1="#{axis_y}"
            x2="#{width - pad_x}" y2="#{axis_y}"></line>
          #{seed_view_axis_tags(coords, axis_y, axis_every, axis_label)}
          <polyline class="seed-view-line" points="#{polyline}"></polyline>
          #{seed_view_point_tags(coords)}
        </svg>
      HTML
    end

    def seed_view_axis_tags coords, axis_y, axis_every, axis_label
      axis_every = [axis_every.to_i, 1].max
      coords.each_with_object([]) do |(point, x, _y, index), result|
        next unless (index % axis_every).zero?

        label = h point[:label]
        result << <<~HTML
          <g>
            <title>#{label}: #{point[:count]}</title>
            <line class="seed-view-axis-tick" x1="#{x.round(2)}" y1="#{axis_y}"
              x2="#{x.round(2)}" y2="#{axis_y + 4}"></line>
            <text class="seed-view-axis-label"
              transform="translate(#{x.round(2)} #{axis_y + 28}) rotate(-45)">
              #{seed_view_axis_label(point[:label], axis_label)}
            </text>
          </g>
        HTML
      end.join
    end

    def seed_view_axis_label label, axis_label
      label = label.to_s
      h(
        case axis_label
        when :date
          label.split.first || label
        else
          label.sub(/\A\d{2}-\d{2} /, '')
        end
      )
    end

    def seed_view_point_tags coords
      coords.map do |point, x, y, _index|
        count = point[:count]
        label = h point[:label]
        text =
          if count.positive?
            <<~HTML
              <text class="seed-view-point-label" x="#{x.round(2)}"
                y="#{[y - 7, 9].max.round(2)}">#{count}</text>
            HTML
          end

        <<~HTML
          <g>
            <title>#{label}: #{count}</title>
            <circle class="seed-view-point" cx="#{x.round(2)}"
              cy="#{y.round(2)}" r="2"></circle>
            #{text}
          </g>
        HTML
      end.join
    end

    def seed_view_region_label lang
      h lang.to_s.upcase
    end

    def seed_view_event_name lang, event
      ball = Route.public_send("ball_#{lang}")
      info = ball.events[event]

      h(
        if info
          "#{info['start_on']} ~ #{info['end_on']}: #{info['name']}"
        else
          event.to_s
        end
      )
    rescue NoMethodError
      h event.to_s
    end

    def json_script data
      JSON.generate(data).gsub('</', '<\/')
    end

    def local_partial name
      self.class.template(name).render(self)
    end

    def local_seek_form_data_attrs
      {
        'data-rates' => route.seek_rates.join(' '),
        'data-slots' => route.seek_slots.join(' '),
        'data-track-base' => route.uri
      }.map{ |key, value| %Q{#{key}="#{h(value.to_s)}"} }.join(' ')
    end
  end

  class View
    attr_accessor :seed_views_today

    class << self
      def recent_seeds_digest
        @recent_seeds_digest ||=
          Digest::MD5.file(File.expand_path(
            '../asset/recent-seeds.js', __dir__)).hexdigest
      end

      def track_compare_digest
        @track_compare_digest ||=
          Digest::MD5.file(File.expand_path(
            '../asset/track-compare.js', __dir__)).hexdigest
      end

      def multi_track_digest
        @multi_track_digest ||=
          Digest::MD5.file(File.expand_path(
            '../asset/multi-track.js', __dir__)).hexdigest
      end

      def seed_view_admin_digest
        @seed_view_admin_digest ||=
          Digest::MD5.file(File.expand_path(
            '../asset/seed-view-admin.js', __dir__)).hexdigest
      end
    end

    prepend LocalView
  end
end
