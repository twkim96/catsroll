require 'pork/auto'
require 'muack'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'battle-cats-rolls/local/gpt_recommendations'

describe 'Catsroll tier recommendations adapter' do
  include Muack::API

  before { Muack.reset }
  after { Muack.verify }

  Recommendations = BattleCatsRolls::GptRecommendations
  BALL = BattleCatsRolls::Route.load_ball('kr')

  def adapter(ratings)
    Dir.mktmpdir do |root|
      path = File.join(root, 'tier-picks.json')
      File.write(path, JSON.generate({
        'schema_version' => 1,
        'source' => {
          'url' => 'https://example.invalid/guide',
          'title' => 'Fixture tier guide',
          'game_version' => '15.6',
          'updated_on' => '2026-09-24',
          'tier_scope' => 'within_series'
        },
        'ratings' => ratings
      }), encoding: 'UTF-8')
      yield Recommendations.new(path: path)
    end
  end

  def rating(cat_id, series_id:, tier:, form_index:, investment: 'none', source_image: 0, requirements: nil)
    {
      'cat_id' => cat_id,
      'series_id' => series_id,
      'tier' => tier,
      'form_index' => form_index,
      'investment' => investment,
      'source_image' => source_image,
      'requirements' => requirements
    }.compact
  end

  def raises_input?(args)
    yield.lookup(args)
    false
  rescue Recommendations::InvalidInput
    true
  end

  would 'reuse current forms and abilities while matching canonical and Korean traits' do
    ratings = [
      rating(1, series_id: 0, tier: 'A', form_index: 2),
      rating(3, series_id: 0, tier: 'SS', form_index: 2, source_image: 1),
      rating(6, series_id: 6, tier: 'S', form_index: 2, source_image: 2),
      rating(6, series_id: 6, tier: 'S', form_index: 0, source_image: 3)
    ]

    adapter(ratings) do |recommendations|
      red = recommendations.lookup('traits' => ['빨적'])
      expect(red.fetch('scope')).eq 'recommendation_candidates_not_predictions'
      expect(red.fetch('trait_notice').include?('Zombie Killer')).eq true
      expect(red.fetch('source').fetch('game_version')).eq '15.6'
      expect(red.fetch('filters')).eq({'lang' => 'kr', 'traits' => ['red'], 'match' => 'all', 'max_form' => 3})
      expect(red.fetch('recommendations').map { |item| item.fetch('cat_id') }).eq [3]
      red_cat = red.fetch('recommendations').first
      expect(red_cat.fetch('form_names')).eq BALL.cats.fetch(3).fetch('name')
      expect(red_cat.fetch('traits')).eq ['red']
      expect(red_cat.fetch('abilities').include?('Strong')).eq true
      expect(red_cat.fetch('sourceImageIndex')).eq 1

      generalist = recommendations.lookup({}).fetch('recommendations').
        find { |item| item.fetch('cat_id') == 1 }
      expect(generalist.fetch('requirements')).eq 'form 3'

      angel = recommendations.lookup('traits' => ['천사'], 'max_form' => 2)
      expect(angel.fetch('recommendations').map { |item| item.fetch('cat_id') }).eq [6]
      expect(angel.fetch('recommendations').first.fetch('evaluated_form')).eq '천공의 고양이'
      expect(angel.fetch('recommendations').first.fetch('abilities').include?('Weaken')).eq true

      no_angel_form = recommendations.lookup('traits' => ['angel'], 'max_form' => 1)
      expect(no_angel_form.fetch('recommendations')).eq []

      %w[빨 천 검 떠 뜬 에일 좀 악 고 무].each_with_index do |alias_name, index|
        canonical = %w[red angel black float float alien zombie aku relic white][index]
        expect(recommendations.lookup('traits' => [alias_name]).fetch('filters').fetch('traits')).eq [canonical]
      end
    end
  end

  would 'apply only the talents required by a rating and respect form and budget gates' do
    ratings = [
      rating(12, series_id: 0, tier: 'A', form_index: 1, investment: 'none'),
      rating(12, series_id: 0, tier: 'S', form_index: 2, investment: 'talents',
        source_image: 1, requirements: 'Unlock target specialization')
    ]

    adapter(ratings) do |recommendations|
      no_investment = recommendations.lookup('traits' => ['zombie'], 'investment' => 'none')
      expect(no_investment.fetch('recommendations')).eq []

      talent_budget = recommendations.lookup('traits' => ['zombie'], 'investment' => 'talents')
      candidate = talent_budget.fetch('recommendations').first
      expect(candidate.fetch('cat_id')).eq 12
      expect(candidate.fetch('traits')).eq ['zombie']
      expect(candidate.fetch('investment')).eq 'talents'
      expect(candidate.fetch('requirements')).eq 'form 3; talent investment; Unlock target specialization'

      too_early = recommendations.lookup('traits' => ['zombie'], 'investment' => 'talents', 'max_form' => 1)
      expect(too_early.fetch('recommendations')).eq []
    end
  end

  would 'allow ultra talents at form three only within the ultra budget' do
    ratings = [
      rating(196, series_id: 1, tier: 'S', form_index: 2, investment: 'ultra', source_image: 4),
      rating(337, series_id: 4, tier: 'A', form_index: 2, investment: 'ultra', source_image: 5),
      rating(74, series_id: 18, tier: 'A', form_index: 3, investment: 'none', source_image: 6)
    ]

    adapter(ratings) do |recommendations|
      talents = recommendations.lookup('traits' => ['angel'], 'investment' => 'talents')
      expect(talents.fetch('recommendations')).eq []

      ultra = recommendations.lookup('traits' => ['angel'], 'investment' => 'ultra')
      candidate = ultra.fetch('recommendations').first
      expect(candidate.fetch('cat_id')).eq 196
      expect(candidate.fetch('traits')).eq %w[angel alien]
      expect(candidate.fetch('matched_traits')).eq ['angel']
      expect(candidate.fetch('series_name')).eq BattleCatsRolls::EventSeriesNames.korean(1)

      fourth_form = recommendations.lookup('investment' => 'ultra').fetch('recommendations').
        find { |item| item.fetch('cat_id') == 74 }
      expect(fourth_form.fetch('requirements')).eq 'form 4 gate'
      expect(fourth_form.fetch('form_names').size).eq 4
    end
  end

  would 'use the live event series label if no canonical mapping exists' do
    adapter([rating(35, series_id: 35, tier: 'S', form_index: 1)]) do |recommendations|
      candidate = recommendations.lookup({}).fetch('recommendations').first
      expected = BattleCatsRolls::TrackApi.multi_events(BALL).
        find { |item| item[:series_id] == 35 }.fetch(:series_name)
      expect(candidate.fetch('series_name')).eq expected
    end
  end

  would 'validate event pool membership using only Uber and Legend slots' do
    event = '2018-10-13_320'
    pool = BattleCatsRolls::TrackApi.compact_find_pool_data(BALL, event)
    member = (Array(pool.dig(:slots, 4)) + Array(pool.dig(:slots, 5))).first
    nonmember = 1
    ratings = [
      rating(member, series_id: 0, tier: 'S', form_index: 0),
      rating(nonmember, series_id: 0, tier: 'SS', form_index: 0)
    ]

    adapter(ratings) do |recommendations|
      result = recommendations.lookup('event' => event)
      expect(result.fetch('availability')).eq 'pool_member'
      expect(result.fetch('recommendations').map { |item| item.fetch('cat_id') }).eq [member]
      expect(result.fetch('recommendations').first.fetch('availability')).eq 'pool_member'
      expect(result.fetch('excluded_event_cat_ids')).eq [nonmember]
      expect(recommendations.lookup({}).fetch('availability')).eq 'not_checked'

      stub(BattleCatsRolls::TrackApi).compact_find_pool_data(BALL, event) { {exist: false} }
      expect(raises_input?({'event' => event}) { recommendations }).eq true
    end
  end

  would 'report missing Catsroll metadata and reject invalid arguments' do
    ratings = [rating(999_999, series_id: 0, tier: 'A', form_index: 0)]

    adapter(ratings) do |recommendations|
      missing = recommendations.lookup({})
      expect(missing.fetch('recommendations')).eq []
      expect(missing.fetch('unavailable_cat_ids')).eq [999_999]
      [
        {lang: 'kr'},
        {'trait' => 'red'},
        {'lang' => 'en'},
        {'traits' => ['unknown']},
        {'traits' => ['red'] * 11},
        {'traits' => ['x' * 31]},
        {'match' => 'maybe'},
        {'event' => 'not-an-event'},
        {'owned' => [0]},
        {'max_form' => 4},
        {'investment' => 'all'},
        {'limit' => 11}
      ].each do |args|
        expect(raises_input?(args) { recommendations }).eq true
      end
    end
  end

  would 'keep source opinions separate and avoid leaking upgrades into cheaper evaluations' do
    knowledge = BattleCatsRolls::GptCharacterKnowledge.new
    ordinary = knowledge.notes(BALL, 107, form_index: 2, investment: 'talents')
    expect(ordinary.any? { |note| note.dig('source', 'title') == '갤걸 티어표' }).eq false
    ultra = knowledge.notes(BALL, 107, form_index: 2, investment: 'ultra')
    expect(ultra.any? { |note| note.dig('evaluation_context', 'investment') == 'ultra' }).eq true
    expect(knowledge.notes(BALL, 497, form_index: 2, investment: 'ultra')).eq []
    fourth = knowledge.notes(BALL, 497, form_index: 3, investment: 'none')
    expect(fourth.first.fetch('evaluation_context').fetch('form_name')).eq BALL.cats.fetch(497).fetch('name').fetch(3)
    unreviewed = knowledge.details(BALL, 1)
    expect(unreviewed.fetch('source_notes')).eq []
    expect(unreviewed.key?('tier')).eq false

    adapter([rating(107, series_id: 4, tier: 'S', form_index: 2)]) do |recommendations|
      candidate = recommendations.lookup({}).fetch('recommendations').first
      expect(candidate.fetch('source_notes')).eq []
    end
  end

  would 'resolve every curated ID and evaluation form against current game data' do
    data = JSON.parse(File.read(Recommendations::DEFAULT_PATH))
    invalid = data.fetch('ratings').reject do |rating|
      info = BALL.cats[rating.fetch('cat_id')]
      info && info.fetch('stat')[rating.fetch('form_index')] &&
        info.fetch('name')[rating.fetch('form_index')] &&
        BALL.gacha.values.any? { |gacha| gacha['series_id'] == rating.fetch('series_id') &&
          Array(gacha['cats']).flatten.include?(rating.fetch('cat_id')) }
    end
    expect(invalid).eq []
    notes = JSON.parse(File.read(BattleCatsRolls::GptCharacterKnowledge::PATH))
    invalid_notes = notes.fetch('entries').reject do |entry|
      info = BALL.cats[entry.fetch('cat_id')]
      info && entry.fetch('observations').all? do |note|
        notes.fetch('sources').key?(note.fetch('source_id')) &&
          (!note['form_index'] || info.fetch('stat')[note.fetch('form_index')])
      end
    end
    expect(invalid_notes).eq []
  end
end
