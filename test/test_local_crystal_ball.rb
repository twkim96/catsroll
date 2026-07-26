
require 'pork/auto'
require 'battle-cats-rolls/server'

describe 'local crystal ball translations' do
  def jp_ball
    BattleCatsRolls::Route.ball_jp
  end

  would 'use Korean cat names when the same cat exists in BCKR' do
    expect(jp_ball.cats.dig(1, 'name')).eq(
      BattleCatsRolls::Route.ball_kr.cats.dig(1, 'name'))
  end

  would 'keep Japanese cat names when BCKR has no matching cat data' do
    raw_jp = BattleCatsRolls::CrystalBall.load(
      File.expand_path('../build', __dir__), 'jp')
    missing_id = raw_jp.cats.keys.find do |id|
      !BattleCatsRolls::Route.ball_kr.cats.key?(id)
    end

    if missing_id
      expect(jp_ball.cats.dig(missing_id, 'name')).eq(
        raw_jp.cats.dig(missing_id, 'name'))
    end
  end

  would 'use a matched Korean event name within the date window' do
    jp = ball_with_events(
      '2026-06-01_10' => event(
        id: 10, start_on: '2026-06-01', name: 'JP name'))
    kr = ball_with_events(
      '2026-07-01_10' => event(
        id: 10, start_on: '2026-07-01', name: 'KR name'))

    translated = jp.with_event_names_from(kr, window_days: 240)

    expect(translated.events.dig('2026-06-01_10', 'name')).eq 'KR name'
  end

  would 'keep the original name without a date-window match' do
    jp = ball_with_events(
      '2026-06-01_10' => event(
        id: 10, start_on: '2026-06-01', name: 'JP name'))
    kr = ball_with_events(
      '2027-06-01_10' => event(
        id: 10, start_on: '2027-06-01', name: 'KR name'))

    translated = jp.with_event_names_from(kr, window_days: 240)

    expect(translated.events.dig('2026-06-01_10', 'name')).eq 'JP name'
  end

  would 'keep the original name when the gacha id differs' do
    jp = ball_with_events(
      '2026-06-01_10' => event(
        id: 10, start_on: '2026-06-01', name: 'JP name'))
    kr = ball_with_events(
      '2026-06-01_11' => event(
        id: 11, start_on: '2026-06-01', name: 'KR name'))

    translated = jp.with_event_names_from(kr)

    expect(translated.events.dig('2026-06-01_10', 'name')).eq 'JP name'
  end

  def ball_with_events events
    BattleCatsRolls::CrystalBall.new(
      BattleCatsRolls::CrystalBall.deep_freeze(
        'cats' => {}, 'gacha' => {}, 'events' => events))
  end

  def event id:, start_on:, name:, platinum: nil
    data = {
      'id' => id,
      'start_on' => Date.parse(start_on),
      'end_on' => Date.parse(start_on),
      'name' => name
    }
    data['platinum'] = platinum if platinum
    data
  end
end
