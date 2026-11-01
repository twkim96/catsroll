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

  def adapter(ratings, final_ratings: nil)
    Dir.mktmpdir do |root|
      path = File.join(root, 'tier-picks.json')
      File.write(path, JSON.generate({
        'schema_version' => 1,
        'source' => {
          'url' => 'https://example.invalid/guide',
          'title' => 'Fixture tier guide',
          'game_version' => '15.6',
          'updated_on' => '2026-09-24',
          'tier_scope' => 'within_series',
          'coverage' => 'fixture_subset'
        },
        'ratings' => ratings
      }), encoding: 'UTF-8')
      final_path = nil
      if final_ratings
        final_path = File.join(root, 'final-tier-picks.json')
        final = JSON.parse(File.read(path))
        final['source']['title'] = 'Final-build fixture'
        final['source']['url'] = 'https://example.invalid/final'
        final['ratings'] = final_ratings
        File.write(final_path, JSON.generate(final), encoding: 'UTF-8')
      end
      yield Recommendations.new(path: path, final_path: final_path)
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

  would 'accept all exact tiers and adjacent ranges, sorting ranges by their lower end' do
    tier_rows = [
      [1, 'SS'], [2, 'SS/S'], [3, 'S'], [4, 'S/A'], [5, 'A'],
      [6, 'A/B'], [7, 'B'], [8, 'B/C'], [9, 'C'], [10, 'C/D'], [11, 'D']
    ]
    ratings = tier_rows.map { |id, tier| rating(id, series_id: 0, tier: tier, form_index: 0) }

    adapter(ratings) do |recommendations|
      full = recommendations.lookup('owned' => [1], 'limit' => 10)
      candidates = full.fetch('recommendations')
      expect(candidates.map { |item| item.fetch('cat_id') }.sort).eq (2..11).to_a
      expect(candidates.to_h { |item| [item.fetch('cat_id'), item.fetch('tier')] }).eq(
        tier_rows.drop(1).to_h)
      conservative_ranks = candidates.map do |item|
        Recommendations::TIER_RANK.fetch(item.fetch('tier_conservative_rank'))
      end
      expect(conservative_ranks).eq conservative_ranks.sort.reverse
      expect(candidates.find { |item| item.fetch('cat_id') == 2 }.fetch('tier_conservative_rank')).eq 'S'
      expect(candidates.find { |item| item.fetch('cat_id') == 4 }.fetch('tier_conservative_rank')).eq 'A'
      expect(candidates.find { |item| item.fetch('cat_id') == 10 }.fetch('tier_conservative_rank')).eq 'D'
      expect(full.fetch('tier_range_notice').include?('lower end')).eq true
      expect(full.fetch('total_candidates')).eq 10
      expect(full.fetch('returned_count')).eq 10

      defaults = recommendations.lookup({})
      expect(defaults.fetch('recommendations').size).eq 5
      expect(defaults.fetch('total_candidates')).eq 11
      expect(defaults.fetch('returned_count')).eq 5
      expect(defaults.fetch('dataset_coverage')).eq({
        'source_claim' => 'fixture_subset', 'rating_entries' => 11,
        'rated_characters' => 11, 'pending_evaluations' => 0, 'reference_only_evaluations' => 0
      })
      expect(defaults.fetch('recommendations').first.fetch('tier')).eq 'SS'
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

  would 'prefer final-build source tiers while retaining earlier form and budget evaluations' do
    earlier = [rating(74, series_id: 18, tier: 'SS', form_index: 2),
      rating(196, series_id: 1, tier: 'B', form_index: 2, investment: 'talents')]
    final = [rating(74, series_id: 18, tier: 'C', form_index: 3),
      rating(196, series_id: 1, tier: 'SSS', form_index: 2, investment: 'ultra')]
    adapter(earlier, final_ratings: final) do |recommendations|
      result = recommendations.lookup({})
      expect(result.fetch('investment_budget')).eq 'ultra'
      expect(result.fetch('recommendations').map { |item| item.fetch('cat_id') }).eq [196, 74]
      fourth = result.fetch('recommendations').last
      expect(fourth.fetch('tier')).eq 'C'
      expect(fourth.fetch('source').fetch('title')).eq 'Final-build fixture'
      expect(fourth.fetch('evaluation_role')).eq 'final_build'
      expect(fourth.fetch('previous_evaluations').first.fetch('tier')).eq 'SS'
      expect(fourth.fetch('previous_evaluations').first.fetch('source').fetch('title')).eq 'Fixture tier guide'
      expect(result.fetch('sources').size).eq 2
      lower_budget = recommendations.lookup('investment' => 'talents').fetch('recommendations')
      expect(lower_budget.map { |item| item.fetch('tier') }).eq %w[SS B]
      expect(lower_budget.first.fetch('form_index')).eq 2
      expect(lower_budget.first.fetch('final_evaluation').fetch('tier')).eq 'C'
      expect(recommendations.lookup('max_form' => 2).fetch('recommendations').any? { |item| item.fetch('cat_id') == 74 }).eq false
      before_fourth = recommendations.lookup('max_form' => 2, 'investment' => 'talents').fetch('recommendations').find { |item| item.fetch('cat_id') == 74 }
      expect(before_fourth.fetch('tier')).eq 'SS'
      no_talents = recommendations.lookup('investment' => 'none').fetch('recommendations')
      expect(no_talents.map { |item| item.fetch('cat_id') }).eq [74]
    end
  end

  would 'keep a final-source low-form rating out of low-growth recommendations' do
    adapter([rating(3, series_id: 0, tier: 'S', form_index: 1), rating(1, series_id: 0, tier: 'SS', form_index: 0)],
      final_ratings: [rating(3, series_id: 0, tier: 'D', form_index: 1)]) do |recommendations|
      low = recommendations.lookup('investment' => 'none')
      expect(low.fetch('growth_mode')).eq 'low_growth'
      expect(low.fetch('recommendations').find { |item| item.fetch('cat_id') == 3 }.fetch('tier')).eq 'S'
      high = recommendations.lookup({})
      expect(high.fetch('growth_mode')).eq 'high_growth'
      expect(high.fetch('recommendations').first.fetch('tier')).eq 'D'
      expect(high.fetch('recommendations').map { |item| item.fetch('cat_id') }).eq [3]
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

  would 'include every character tier evaluation in details with its own investment and pending source context' do
    source = {
      'url' => 'https://example.invalid/source', 'title' => 'Full tier source',
      'game_version' => '15.6', 'updated_on' => '2026-09-24',
      'tier_scope' => 'within_series', 'coverage' => 'full_source_transcription'
    }
    tiers = %w[SS S A B C D SS/S S/A A/B B/C C/D D]
    entries = tiers.each_with_index.map do |tier, index|
      rating(107, series_id: 4, tier: tier, form_index: index.even? ? 1 : 2,
        investment: index == 11 ? 'ultra' : (index.odd? ? 'talents' : 'none'),
        source_image: index, requirements: "source condition #{index}")
    end
    Dir.mktmpdir do |root|
      tier_path = File.join(root, 'tier-picks.json')
      File.write(tier_path, JSON.generate({
        'schema_version' => 1, 'source' => source, 'ratings' => entries,
        'unresolved_evaluations' => [
          {'cat_id' => 107, 'source_image' => 20, 'note' => 'transcription pending'},
          {'cat_id' => 108, 'source_image' => 21, 'note' => 'other character'}
        ]
      }), encoding: 'UTF-8')

      details = BattleCatsRolls::GptCharacterKnowledge.new(tier_path: tier_path).details(BALL, 107)
      sourced = details.fetch('source_ratings')
      expect(sourced.size).eq 12
      expect(sourced.map { |item| item.fetch('tier') }).eq tiers
      expect(sourced.all? { |item| item.fetch('source') == source.reject { |key, _| key == 'url' } }).eq true
      expect(sourced.first.fetch('evaluated_form')).eq BALL.cats.fetch(107).fetch('name').fetch(1)
      expect(sourced.last.fetch('form_index')).eq 2
      expect(sourced.last.fetch('investment')).eq 'ultra'
      expect(sourced.last.fetch('requirements')).eq 'source condition 11'
      expect(sourced[6].fetch('tier_range')).eq 'SS/S'
      expect(sourced[6].fetch('tier_conservative_rank')).eq 'S'
      expect(details.fetch('tier_source')).eq source.reject { |key, _| key == 'url' }
      expect(details.fetch('pending_evaluations')).eq [{
        'cat_id' => 107, 'source_image' => 20, 'note' => 'transcription pending',
        'kind' => 'pending_source_evaluation', 'status' => 'pending', 'source' => source.reject { |key, _| key == 'url' }
      }]
      expect(details.key?('tier')).eq false
    end
  end

  would 'exclude an upgrade evaluation when the current character has no matching talents' do
    adapter([rating(669, series_id: 1, tier: 'A', form_index: 2, investment: 'talents')]) do |recommendations|
      result = recommendations.lookup({})
      expect(result.fetch('recommendations')).eq []
      expect(result.fetch('unavailable_cat_ids')).eq [669]
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

  would 'resolve final-source forms and expose fourth-form potential without rewriting earlier tiers' do
    data = JSON.parse(File.read(BattleCatsRolls::GptTierCatalog::FINAL_PATH))
    balls = [BALL, BattleCatsRolls::Route.load_ball('jp')]
    invalid = data.fetch('ratings').reject do |rating|
      balls.any? do |ball|
        info = ball.cats[rating.fetch('cat_id')]
        info && info.fetch('name')[rating.fetch('form_index')] && info.fetch('stat')[rating.fetch('form_index')] &&
          ball.gacha.values.any? { |gacha| gacha['series_id'] == rating.fetch('series_id') &&
            Array(gacha['cats']).flatten.include?(rating.fetch('cat_id')) }
      end
    end
    expect(invalid).eq []
    event = BattleCatsRolls::TrackApi.multi_events(BALL).find { |item| item[:series_id] == 6 }.fetch(:event)
    recommendations = Recommendations.new
    final = recommendations.lookup('event' => event, 'limit' => 10).fetch('recommendations')
    [138, 139].each do |id|
      candidate = final.find { |item| item.fetch('cat_id') == id }
      expect(candidate.fetch('tier')).eq 'SS'
      expect(candidate.fetch('form_index')).eq 3
      expect(candidate.fetch('source').key?('url')).eq false
      expect(candidate.fetch('previous_evaluations').empty?).eq false
      expect(candidate.fetch('evaluation_assumptions').fetch('source_tier_talent_conditions')).eq 'unspecified'
    end
    earlier = recommendations.lookup('event' => event, 'max_form' => 2, 'investment' => 'talents', 'limit' => 10).
      fetch('recommendations').find { |item| item.fetch('cat_id') == 138 }
    expect(earlier.fetch('evaluation_role')).eq 'earlier_evaluation'
    expect(earlier.fetch('source').fetch('title')).eq '울슐랭 가이드'
    expect(earlier.fetch('final_evaluation').fetch('form_index')).eq 3
    details = BattleCatsRolls::GptCharacterKnowledge.new.details(BALL, 139)
    expect(details.fetch('source_ratings').any? { |rating| rating['evaluation_role'] == 'final_build' }).eq true
    expect(details.fetch('source_ratings').any? { |rating| rating['evaluation_role'] == 'earlier_evaluation' }).eq true
    gift = BattleCatsRolls::GptCharacterKnowledge.new.details(BALL, 625).fetch('source_ratings').
      find { |rating| rating['evaluation_role'] == 'final_build' }
    expect(gift.fetch('tier')).eq 'SSS'
    expect(gift.fetch('acquisition_scope')).eq 'not_in_current_gacha_slots'
    expect(Recommendations.new.lookup('limit' => 10).fetch('recommendations').any? { |item| item.fetch('cat_id') == 625 }).eq false
    expect(Recommendations.new.lookup('limit' => 10).fetch('unavailable_cat_ids').include?(878)).eq true
  end

  would 'keep provenance links internal across recommendations and character details' do
    knowledge = BattleCatsRolls::GptCharacterKnowledge.new
    high = Recommendations.new.lookup('limit' => 3)
    low = Recommendations.new.lookup('investment' => 'talents', 'limit' => 3)
    payloads = [high, low, knowledge.details(BALL, 107), knowledge.details(BALL, 139), knowledge.notes(BALL, 107)]
    payloads.each do |payload|
      expect(JSON.generate(payload).match?(%r{https?://})).eq false
    end
    expect(high.fetch('recommendations').first.fetch('source').fetch('title').empty?).eq false
    expect(knowledge.details(BALL, 107).fetch('source_notes').empty?).eq false
    expect(JSON.parse(File.read(Recommendations::DEFAULT_PATH)).fetch('source').key?('url')).eq true
  end
end
