require 'pork/auto'
require 'battle-cats-rolls/server'

describe 'Multi event date boundaries' do
  api = BattleCatsRolls::TrackApi
  today = Date.new(2026, 11, 10)
  make_event = lambda do |id, start_on, end_on, ticket = nil|
    {'id' => id, 'name' => "Event #{id}", 'start_on' => Date.parse(start_on),
     'end_on' => Date.parse(end_on), 'platinum' => ticket}
  end
  ball_type = Struct.new(:events, :gacha)

  with_today = lambda do |&block|
    original = Date.method(:today)
    Date.define_singleton_method(:today) { today }
    begin
      block.call
    ensure
      Date.define_singleton_method(:today, original)
    end
  end

  would 'classify start inclusive and end exclusive, including adjacent and overlapping events' do
    events = {
      'ended' => make_event.call(1, '2026-11-01', '2026-11-10'),
      'overlap' => make_event.call(2, '2026-11-05', '2026-11-11'),
      'starting' => make_event.call(3, '2026-11-10', '2026-11-12'),
      'future' => make_event.call(4, '2026-11-11', '2026-11-13')
    }
    ball = ball_type.new(events, {})
    with_today.call do
      entries = api.multi_events(ball)
      expect(entries.map { |item| item[:event] }).eq %w[overlap starting future ended]
      expect(entries.map { |item| [item[:event], item[:group], item[:preload]] }).eq [
        ['overlap', 'upcoming', true], ['starting', 'upcoming', true],
        ['future', 'upcoming', true], ['ended', 'past', false]
      ]
      ended = api.multi_events(ball, initial_event: 'ended').find { |item| item[:event] == 'ended' }
      expect([ended[:group], ended[:preload]]).eq ['past', true]
    end
  end

  would 'prefer an active ticket over a newer expired ticket, then use latest started fallback' do
    events = {
      'active' => make_event.call(1, '2026-11-01', '2026-11-11', 'platinum'),
      'expired' => make_event.call(2, '2026-11-05', '2026-11-10', 'platinum'),
      'future' => make_event.call(3, '2026-11-11', '2026-11-20', 'platinum')
    }
    ball = ball_type.new(events, {})
    original = api.method(:compact_find_pool_data)
    api.define_singleton_method(:compact_find_pool_data) { |_ball, event| {event: event} }
    begin
      with_today.call do
        expect(api.multi_ticket_pool(ball, 'platinum')[:event]).eq 'active'
        events.delete('active')
        expect(api.multi_ticket_pool(ball, 'platinum')[:event]).eq 'expired'
        events.delete('expired')
        expect(api.multi_ticket_pool(ball, 'platinum')[:event]).eq 'future'
        events['starting'] = make_event.call(4, '2026-11-10', '2026-11-12', 'platinum')
        expect(api.multi_ticket_pool(ball, 'platinum')[:event]).eq 'starting'
      end
    ensure
      api.define_singleton_method(:compact_find_pool_data, original)
    end
  end
end
