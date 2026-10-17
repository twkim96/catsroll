require 'pork/auto'
require 'battle-cats-rolls/local/gpt_banner_preview'

describe BattleCatsRolls::GptBannerPreview do
  KR_BALL = BattleCatsRolls::Route.ball_kr || BattleCatsRolls::Route.load_ball('kr')
  JP_BALL = BattleCatsRolls::TrackApi.raw_ball_jp

  def preview
    @preview ||= BattleCatsRolls::GptBannerPreview.new
  end

  would 'resolve Korean and Japanese collaboration names to the same live series' do
    korean = preview.lookup({'query' => '검심', 'lang' => 'kr'})
    japanese = preview.lookup({'query' => 'るろうに剣心', 'lang' => 'kr'})

    [korean, japanese].each do |result|
      expect(result.fetch('status')).eq 'ok'
      expect(result.fetch('recommended').fetch('series_id')).eq 63
    end

    candidate = korean.fetch('recommended')
    dates = candidate.fetch('regional_latest_dates')
    expected_source = if dates.fetch('jp') > dates.fetch('kr')
      'jp'
    elsif dates.fetch('kr') > dates.fetch('jp')
      'kr'
    else
      'kr'
    end
    expect(candidate.fetch('source_lang')).eq expected_source
    expect(dates.fetch('jp') > dates.fetch('kr')).eq true
    expect(candidate.fetch('regions').fetch('kr').size > 0).eq true
    expect(candidate.fetch('regions').fetch('jp').size > 0).eq true
    expect(candidate.fetch('label')).eq BattleCatsRolls::EventSeriesNames.korean(63)
    expect(candidate.fetch('source_period').first.fetch('start_on')).eq dates.fetch(expected_source)
    expect(korean.fetch('prepare_rows')).eq(candidate.fetch('recommended_events').map do |event|
      {'lang' => expected_source, 'event' => event.fetch('event'), 'previewFor' => 'kr'}
    end)
    expect(korean.fetch('notice').include?('NOT a confirmed schedule')).eq true

    signature = candidate.fetch('regions').fetch('jp').first.fetch('pool_signature')
    expect(signature.fetch('sha256').size).eq 64
    expect(signature.fetch('rates').keys.sort).eq %w[legend rare supa uber]
    expect(signature.fetch('guaranteed_rolls').is_a?(Integer)).eq true
    expect(signature.fetch('slot_counts').values.sum > 0).eq true
    expect(signature.key?('slots')).eq false
  end

  would 'report only source-pool names for units missing from the requested region' do
    candidate = preview.lookup({'query' => 'るろうに剣心', 'lang' => 'kr'}).fetch('recommended')
    event = candidate.fetch('regions').fetch('jp').first
    signature = event.fetch('pool_signature')
    missing = signature.fetch('missing_character_metadata')

    expect(missing.map { |item| item.fetch('id') }).eq signature.fetch('missing_character_ids')
    expect(missing.size > 0).eq true
    missing.each do |item|
      source_names = Array(JP_BALL.cats.dig(item.fetch('id'), 'name'))
      expect(item.fetch('source_names')).eq source_names
      expect(KR_BALL.cats.key?(item.fetch('id'))).eq false
    end
  end

  would 'keep same-date variants and expose only truthful source-name metadata' do
    kr = fixture_ball([
      ['2026-01-01_910', 910, 9101, 'KR unit'],
      ['2026-01-01_911', 911, 9102, 'KR variant']
    ])
    jp = fixture_ball([
      ['2026-01-02_912', 912, 9121, nil, 'Changed JP banner title']
    ])
    app = fixture_preview(kr, jp)

    result = app.lookup({'query' => 'fixturecollab', 'lang' => 'kr'})
    candidate = result.fetch('recommended')
    expect(candidate.fetch('source_lang')).eq 'jp'
    expect(candidate.fetch('regions').fetch('kr').map { |event| event.fetch('event') }).eq(
      %w[2026-01-01_910 2026-01-01_911])
    expect(candidate.fetch('regions').fetch('jp').first.fetch('pool_signature').
      fetch('missing_character_metadata')).eq([
        {'id' => 9121, 'source_names' => [], 'missing_from_requested_region' => true}
      ])
    expect(result.fetch('prepare_rows')).eq([
      {'lang' => 'jp', 'event' => '2026-01-02_912', 'previewFor' => 'kr'}
    ])

    tied = fixture_ball([
      ['2026-01-01_912', 912, 9121, nil, 'Changed JP banner title']
    ])
    tied_result = fixture_preview(kr, tied).lookup({'query' => 'fixturecollab', 'lang' => 'jp'})
    expect(tied_result.fetch('recommended').fetch('source_lang')).eq 'jp'
  end

  would 'return all matching series for ambiguous queries and let an exact id override query text' do
    ambiguous = preview.lookup({'query' => '고양이 축제'})
    expect(ambiguous.fetch('status')).eq 'ambiguous'
    expect(ambiguous.fetch('candidates').size > 1).eq true
    expect(ambiguous.fetch('prepare_rows')).eq []
    expect(ambiguous.fetch('truncated')).eq false
    expect(ambiguous.fetch('totalCandidates')).eq ambiguous.fetch('candidates').size

    many = fixture_preview(
      fixture_ball([['2026-01-01_910', 910, 9101, 'KR unit']]),
      fixture_ball([['2026-01-01_912', 912, 9121, 'JP unit']]))
    many_catalogs = (1..12).to_h do |series_id|
      [series_id, {labels: ["fixture#{series_id}"], names: []}]
    end
    many.define_singleton_method(:catalogs_for) { |_| many_catalogs }
    many.define_singleton_method(:matching_series) { |_, _| (1..12).to_a }
    capped = many.lookup({'query' => 'common'})
    expect(capped.fetch('candidates').size).eq 10
    expect(capped.fetch('totalCandidates')).eq 12
    expect(capped.fetch('truncated')).eq true
    expect(capped.fetch('prepare_rows')).eq []

    exact = preview.lookup({'query' => 'unrelated text', 'series_id' => 63})
    expect(exact.fetch('status')).eq 'ok'
    expect(exact.fetch('candidates').map { |item| item.fetch('series_id') }).eq [63]
  end

  would 'return no generic event for unmatched queries and reject invalid arguments' do
    result = preview.lookup({'query' => 'unrelated query with no banner match'})
    expect(result.fetch('status')).eq 'unmatched'
    expect(result.fetch('candidates')).eq []
    expect(result.fetch('prepare_rows')).eq []
    expect(preview.lookup({'query' => '!!!'}).fetch('candidates')).eq []

    [
      {},
      {'query' => ''},
      {'query' => 'x' * 101},
      {'query' => 'x', 'lang' => 'en'},
      {'query' => 'x', 'series_id' => '63'},
      {query: 'x'}
    ].each do |args|
      raised = begin
        preview.lookup(args)
        false
      rescue BattleCatsRolls::GptBannerPreview::InvalidInput
        true
      end
      expect(raised).eq true
    end
  end

  def fixture_ball(events)
    cats = {}
    gacha = {}
    event_data = {}
    events.each do |event_name, gacha_id, cat_id, cat_name, title = 'FixtureCollab banner'|
      cats[cat_id] = {'name' => cat_name ? [cat_name] : [], 'rarity' => BattleCatsRolls::Cat::Uber}
      gacha[gacha_id] = {'name' => title, 'series_id' => 91, 'cats' => [cat_id]}
      start_on = Date.parse(event_name.split('_').first)
      event_data[event_name] = {
        'id' => gacha_id,
        'start_on' => start_on,
        'end_on' => start_on + 7,
        'name' => title,
        'rare' => 7000,
        'supa' => 2500,
        'uber' => 500,
        'version' => 10000
      }
    end
    BattleCatsRolls::CrystalBall.new(
      BattleCatsRolls::CrystalBall.deep_freeze(
        'cats' => cats, 'gacha' => gacha, 'events' => event_data))
  end

  def fixture_preview(kr, jp)
    balls = {'kr' => kr, 'jp' => jp, 'jp_display' => jp}
    Class.new(BattleCatsRolls::GptBannerPreview) do
      define_method(:source_balls) { balls }
    end.new
  end
end
