# frozen_string_literal: true

require 'pork/auto'
require 'battle-cats-rolls/web'
require 'battle-cats-rolls/route'

describe BattleCatsRolls::Web do
  text_select_event = '(Select an event here)'
  text_selected_group = '<optgroup label="Selected:">'

  web = BattleCatsRolls::Web.new
  web.call('PATH_INFO' => '/warmup')

  BattleCatsRolls::Route.reload_balls

  define_method(:expect_request) do |path, query='',
    status: 200, &block|
    response_status, headers, body = web.call(
      'PATH_INFO' => path, 'QUERY_STRING' => query)

    expect(response_status).eq status

    block&.call(body.first, headers)
  end

  %w[/ /cats /help /logs].each do |path|
    would "respond 200 for #{path}" do
      expect_request(path)
    end
  end

  would 'respond 200 for am existing cat' do
    expect_request('/cats/1')
  end

  would 'respond 200 for a non-existing cat' do
    expect_request('/cats/9999')
  end

  BattleCatsRolls::Route.ball_jp.cats.each_key do |id|
    would "respond 200 for /cats/#{id}?lang=jp" do
      expect_request("/cats/#{id}", 'lang=jp')
    end
  end

  describe 'event pagination' do
    would 'have a next_page link but no prev_page link on page 1' do
      expect_request('/') do |body|
        expect(body).include? '<option value="next_page">'
        expect(body).not.include? '<option value="prev_page">'
      end
    end

    would 'have a prev_page link on page 2' do
      expect_request('/', 'event_page=2') do |body|
        expect(body).include? '<option value="next_page">'
        expect(body).include? '<option value="prev_page">'
      end
    end

    would 'redirect to next page if event=next_page' do
      expect_request('/', 'event=next_page',
        status: 302) do |body, header|
        location = header['location']
        expect(location).include? 'event_page=2'
        expect(location).not.include? 'event='
      end
    end

    would 'redirect to previous page if event=prev_page' do
      expect_request('/', 'event=prev_page&event_page=3',
        status: 302) do |body, header|
        location = header['location']
        expect(location).include? 'event_page=2'
        expect(location).not.include? 'event='
      end
    end

    would 'not go lower than event_page=1' do
      expect_request('/', 'event=prev_page',
        status: 302) do |body, header|
        location = header['location']
        expect(location).not.include? 'event_page='
        expect(location).not.include? 'event='
      end
    end

    would 'show the selected event even when it is not in the current page' do
      expect_request('/', 'event=2018-06-06_245') do |body|
        expect(body).include? text_selected_group
        expect(body).not.include? text_select_event

        expect(body).include? \
          '<option value="2018-06-06_245" selected="selected">'
      end
    end

    would 'use a default event when not specified' do
      expect_request('/') do |body|
        expect(body).not.include? text_selected_group
        expect(body).not.include? text_select_event

        expect(body).include? ' selected="selected">'
      end
    end

    would 'ask for selecting an event if the selected one is invalid' do
      expect_request('/', 'event=non-existing') do |body|
        expect(body).not.include? text_selected_group
        expect(body).include? text_select_event
      end
    end

    would 'not use a default event when not specified on page 2' do
      expect_request('/', 'event_page=2') do |body|
        expect(body).not.include? text_selected_group
        expect(body).include? text_select_event
      end
    end

    would 'load the last page correctly' do
      last_page = (BattleCatsRolls::Route.ball_en.events.size.to_f /
        BattleCatsRolls::CrystalBall::EventsPerPage).ceil
      last_event = /<option\s+value="2018-06-06_245"\s*>/

      expect_request('/', "event_page=#{last_page}") do |body|
        expect(body).not.include? text_selected_group
        expect(body).include? text_select_event

        expect(body).match? last_event
      end

      expect_request('/', "event_page=#{last_page + 1}") do |body|
        expect(body).not.include? text_selected_group
        expect(body).include? text_select_event

        expect(body).not.match? last_event
      end
    end
  end
end
