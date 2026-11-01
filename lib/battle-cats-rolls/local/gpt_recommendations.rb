# frozen_string_literal: true

require 'json'
require_relative '../route'
require_relative '../track_api'
require_relative '../event_series_names'
require_relative 'gpt_character_knowledge'
require_relative 'gpt_tier_catalog'

module BattleCatsRolls
  # Resolves curated, within-series ratings against the current Catsroll data.
  # This returns recommendation candidates only; it never predicts draws or
  # computes a seed/array route.
  class GptRecommendations
    DEFAULT_PATH = File.expand_path('../../../doc/gpt-knowledge/tier-picks.json', __dir__).freeze
    INPUT_KEYS = %w[
      lang traits match event owned max_form investment limit
    ].freeze
    TIER_LEVELS = %w[SSS SS S A B C D].freeze
    TIERS = (TIER_LEVELS + TIER_LEVELS.each_cons(2).map { |upper, lower| "#{upper}/#{lower}" }).freeze
    TIER_RANK = TIER_LEVELS.each_with_index.to_h { |tier, index| [tier, TIER_LEVELS.size - index] }.freeze
    INVESTMENT_RANK = {'none' => 0, 'talents' => 1, 'ultra' => 2}.freeze
    TRAIT_ALIASES = {
      'red' => %w[red 빨 빨간 빨적 빨강 빨간적],
      'float' => %w[float 떠 뜬 떠있는 떠적 뜬적 부유],
      'black' => %w[black 검 검은 검적 검정 검은적],
      'metal' => %w[metal 메탈 메탈적 금속],
      'angel' => %w[angel 천 천사 천사적 천적],
      'alien' => %w[alien 에일 에이리언 에일리언 외계 외계적],
      'zombie' => %w[zombie 좀 좀비 좀비적],
      'aku' => %w[aku 악 악마 악마적],
      'relic' => %w[relic 고 고대 고대종 고대적 유물],
      'white' => %w[white 무 흰 흰적 흰색 무속성]
    }.freeze
    TRAIT_LOOKUP = TRAIT_ALIASES.each_with_object({}) do |(trait, aliases), lookup|
      ([trait] + aliases).each do |name|
        lookup[name.unicode_normalize(:nfkc).downcase.gsub(/[^\p{Alnum}]/, '')] = trait
      end
    end.freeze
    NOTICE = 'Tiers are relative within each series and are not globally equivalent. These are recommendation candidates, not predictions.'.freeze
    TIER_RANGE_NOTICE = 'A tier range preserves an ambiguous source-chart boundary; sorting uses its lower end. Tier opinions are within-series and do not imply global equivalence.'.freeze
    TRAIT_NOTICE = 'Target traits describe eligible enemy types; they do not imply critical hits, Zombie Killer, barrier or shield breaking, or full counter coverage.'.freeze

    class InvalidInput < ArgumentError; end
    class InvalidDataset < StandardError; end

    def initialize(path: DEFAULT_PATH, final_path: nil)
      @path = File.expand_path(path)
      @final_path = final_path
    end

    def lookup(args)
      options = normalize_args(args)
      ball_accessor = "ball_#{options.fetch('lang')}"
      ball = Route.public_send(ball_accessor) if Route.respond_to?(ball_accessor)
      ball ||= Route.load_ball(options.fetch('lang'))
      event_pool = load_event_pool(ball, options['event'])
      dataset = load_dataset

      return unavailable_result(options, event_pool) unless dataset

      ratings = validate_dataset(dataset)
      high_growth = options.fetch('investment') == 'ultra'
      has_final_source = ratings.any? { |rating| rating['evaluation_role'] == 'final_build' }
      if high_growth && (@path == DEFAULT_PATH || @final_path) && !has_final_source
        return unavailable_result(options, event_pool)
      end
      active_role = high_growth && has_final_source ? 'final_build' : 'earlier_evaluation'
      active_ratings = ratings.select { |rating| rating['evaluation_role'] == active_role }
      unavailable_ids = []
      excluded_event_ids = []

      candidates = active_ratings.filter_map do |rating|
        candidate = candidate_for(rating, ball, options, event_pool)
        if candidate == :unavailable
          unavailable_ids << rating.fetch('cat_id')
          next
        end
        if candidate == :outside_event
          excluded_event_ids << rating.fetch('cat_id')
          next
        end

        candidate
      end

      ranked = rank(candidates, options.fetch('traits'))
      best_per_cat = ranked.uniq { |candidate| candidate.fetch('cat_id') }
      selected = best_per_cat.first(options.fetch('limit'))
      knowledge = GptCharacterKnowledge.new(tier_path: @path, final_path: @final_path)
      selected.each do |candidate|
        candidate['source_notes'] = knowledge.notes(ball, candidate.fetch('cat_id'),
          form_index: candidate.fetch('form_index'), investment: candidate.fetch('investment'))
        evaluations = knowledge.ratings_for(ball, candidate.fetch('cat_id'))
        candidate['previous_evaluations'] = evaluations.reject { |rating| rating['evaluation_role'] == 'final_build' }
        candidate['final_evaluation'] = evaluations.find { |rating| rating['evaluation_role'] == 'final_build' }
        candidate['other_form_notes'] = knowledge.notes(ball, candidate.fetch('cat_id')) - candidate['source_notes']
      end

      GptTierCatalog.without_links({
        'status' => 'ok',
        'citation_policy' => GptTierCatalog::CITATION_POLICY,
        'source' => active_role == 'final_build' ? dataset.fetch('source') : dataset.fetch('sources').last,
        'sources' => dataset.fetch('sources', [dataset.fetch('source')]),
        'growth_mode' => high_growth ? 'high_growth' : 'low_growth',
        'evaluation_policy' => 'Low growth (none/talents) uses the existing source unchanged; high growth (ultra, default) uses Bestnyanko only when available. Never mix earlier high-growth ratings into the new high-growth ranking or apply new ratings to low growth. Missing/excluded ratings mean unassessed, not weak. Default high growth is a development assumption, not the user account state.',
        'scope' => 'recommendation_candidates_not_predictions',
        'notice' => NOTICE,
        'tier_range_notice' => TIER_RANGE_NOTICE,
        'trait_notice' => TRAIT_NOTICE,
        'dataset_coverage' => dataset_coverage(dataset, ratings),
        'total_candidates' => best_per_cat.size,
        'returned_count' => selected.size,
        'availability' => event_pool ? event_pool.fetch(:status) : 'not_checked',
        'event' => options['event'],
        'filters' => {
          'lang' => options.fetch('lang'),
          'traits' => options.fetch('traits'),
          'match' => options.fetch('match'),
          'max_form' => options.fetch('max_form')
        },
        'investment_budget' => options.fetch('investment'),
        'recommendations' => selected,
        'unavailable_cat_ids' => unavailable_ids.uniq.sort,
        'excluded_event_cat_ids' => excluded_event_ids.uniq.sort
      })
    end

    private

    def normalize_args(args)
      unless args.is_a?(Hash) && args.keys.all? { |key| key.is_a?(String) }
        raise InvalidInput, 'arguments must be a string-keyed object'
      end

      unknown = args.keys - INPUT_KEYS
      raise InvalidInput, "unknown argument: #{unknown.first}" if unknown.any?

      lang = args.fetch('lang', 'kr')
      raise InvalidInput, 'lang must be kr or jp' unless %w[kr jp].include?(lang)

      raw_traits = args.fetch('traits', [])
      unless raw_traits.is_a?(Array) && raw_traits.size <= 10 &&
          raw_traits.all? { |trait| trait.is_a?(String) && trait.length <= 30 }
        raise InvalidInput, 'traits must be an array of at most 10 strings, each at most 30 characters'
      end
      traits = raw_traits.map do |trait|
        TRAIT_LOOKUP[normalize_trait(trait)] ||
          raise(InvalidInput, "unknown trait: #{trait}")
      end.uniq

      match = args.fetch('match', 'all')
      raise InvalidInput, 'match must be all or any' unless %w[all any].include?(match)

      event = args['event']
      if args.key?('event') && (!event.is_a?(String) || event.empty? || event.size > 100)
        raise InvalidInput, 'event must be an exact event ID string'
      end

      owned = args.fetch('owned', [])
      unless owned.is_a?(Array) && owned.size <= 1_000 && owned.all? { |id| id.is_a?(Integer) && id.positive? }
        raise InvalidInput, 'owned must be an array of at most 1000 positive cat IDs'
      end

      max_form = integer_arg(args, 'max_form', 3, 0..3)
      investment = args.fetch('investment', 'ultra')
      unless INVESTMENT_RANK.key?(investment)
        raise InvalidInput, 'investment must be none, talents, or ultra'
      end

      limit = integer_arg(args, 'limit', 5, 1..10)

      {
        'lang' => lang,
        'traits' => traits,
        'match' => match,
        'event' => event,
        'owned' => owned.to_set,
        'max_form' => max_form,
        'investment' => investment,
        'limit' => limit
      }
    end

    def integer_arg(args, key, default, range)
      value = args.fetch(key, default)
      raise InvalidInput, "#{key} must be an integer in #{range}" unless value.is_a?(Integer) && range.cover?(value)

      value
    end

    def normalize_trait(trait)
      trait.unicode_normalize(:nfkc).downcase.gsub(/[^\p{Alnum}]/, '')
    end

    def load_dataset
      return unless File.file?(@path)

      GptTierCatalog.new(path: @path, final_path: @final_path).data
    rescue JSON::ParserError => error
      raise InvalidDataset, "Invalid recommendations dataset: #{error.message}"
    end

    def validate_dataset(dataset)
      unless dataset.is_a?(Hash) && dataset['schema_version'] == 1 &&
          dataset['source'].is_a?(Hash) && dataset['ratings'].is_a?(Array)
        raise InvalidDataset, 'Recommendations dataset must have schema_version 1, source, and ratings'
      end

      %w[url title game_version updated_on tier_scope].each do |key|
        unless dataset['source'][key].is_a?(String)
          raise InvalidDataset, "Recommendations source is missing #{key}"
        end
      end

      dataset['ratings'].each { |rating| validate_rating(rating) }
      dataset['ratings']
    end

    def valid_tier?(tier)
      return false unless tier.is_a?(String) && TIERS.include?(tier)

      parts = tier.split('/')
      parts.size == 1 || parts.each_cons(2).all? do |upper, lower|
        TIER_LEVELS.index(lower) == TIER_LEVELS.index(upper) + 1
      end
    end

    def dataset_coverage(dataset, ratings)
      {
        'source_claim' => dataset.fetch('source')['coverage'],
        'rating_entries' => ratings.size,
        'rated_characters' => ratings.map { |rating| rating.fetch('cat_id') }.uniq.size,
        'reference_only_evaluations' => Array(dataset['reference_ratings']).size,
        'pending_evaluations' => Array(dataset['unresolved_evaluations']).size
      }
    end

    def validate_rating(rating)
      unless rating.is_a?(Hash) &&
          rating['cat_id'].is_a?(Integer) && rating['cat_id'].positive? &&
          rating['series_id'].is_a?(Integer) && rating['series_id'] >= 0 &&
          valid_tier?(rating['tier']) &&
          rating['form_index'].is_a?(Integer) && (0..3).cover?(rating['form_index']) &&
          INVESTMENT_RANK.key?(rating['investment']) &&
          rating['source_image'].is_a?(Integer) && rating['source_image'] >= 0 &&
          (!rating.key?('requirements') ||
            (rating['requirements'].is_a?(String) && rating['requirements'].size <= 240))
        raise InvalidDataset, 'Invalid recommendation rating entry'
      end
    end

    def load_event_pool(ball, event)
      return unless event
      raise InvalidInput, 'unknown event ID' unless ball.events.key?(event)

      pool = TrackApi.compact_find_pool_data(ball, event)
      raise InvalidInput, 'event has no usable pool data' unless pool[:exist]

      members = Array(pool.dig(:slots, 4)) + Array(pool.dig(:slots, 5))
      if members.empty?
        {status: 'unverified', members: Set.new}
      else
        {status: 'pool_member', members: members.to_set}
      end
    end

    def candidate_for(rating, ball, options, event_pool)
      id = rating.fetch('cat_id')
      info = ball.cats[id]
      return :unavailable unless info &&
        info['name'].is_a?(Array) && info['stat'].is_a?(Array)

      form_index = rating.fetch('form_index')
      return :unavailable unless info['name'][form_index].is_a?(String) && info['stat'][form_index].is_a?(Hash)
      return if form_index > options.fetch('max_form')
      return if options.fetch('owned').include?(id)
      # A fourth form is an ultra-form gate even when the recommendation data
      # itself requires no talent investment.
      return if form_index >= 3 && options.fetch('investment') != 'ultra'

      requirement = rating.fetch('investment')
      budget = options.fetch('investment')
      return if INVESTMENT_RANK.fetch(requirement) > INVESTMENT_RANK.fetch(budget)
      return if requirement == 'talents' && form_index < 2

      if event_pool && event_pool[:members] && !event_pool[:members].include?(id)
        return :outside_event
      end

      available_talents = requirement == 'none' ? [] : Talent.build(info)
      return :unavailable if requirement == 'talents' && available_talents.reject(&:ultra?).empty?
      return :unavailable if requirement == 'ultra' && available_talents.none?(&:ultra?)
      talents = case requirement
      when 'none' then nil
      when 'talents' then available_talents.reject(&:ultra?)
      when 'ultra' then available_talents
      end
      stat = Stat.new(id: id, info: info, index: form_index).augment(talents)
      specialization = Ability::Specialization
      traits = stat.abilities.grep(specialization).flat_map(&:list).
        map { |trait| normalize_trait(trait) }.uniq
      requested = options.fetch('traits')
      return unless traits_match?(traits, requested, options.fetch('match'))

      abilities = stat.abilities.reject do |ability|
        ability.is_a?(specialization)
      end.map(&:name).uniq
      matched = traits & requested
      forms = info.fetch('name')

      {
        'cat_id' => id,
        'name' => forms.first,
        'form_names' => forms,
        'evaluated_form' => forms.fetch(form_index),
        'form_index' => form_index,
        'traits' => traits,
        'matched_traits' => matched,
        'abilities' => abilities,
        'tier' => rating.fetch('tier'),
        'tier_range' => rating.fetch('tier').include?('/') ? rating.fetch('tier') : nil,
        'tier_conservative_rank' => rating.fetch('tier').split('/').last,
        'series_id' => rating.fetch('series_id'),
        'series_name' => series_name(ball, rating.fetch('series_id')),
        'rarity' => info['rarity'],
        'investment' => requirement,
        'source' => rating['source'],
        'evaluation_role' => rating['evaluation_role'],
        'evaluation_assumptions' => rating['evaluation_assumptions'],
        'requirements' => requirements(rating, form_index),
        'sourceImageIndex' => rating.fetch('source_image'),
        'availability' => event_pool ? event_pool.fetch(:status) : 'not_checked'
      }
    end

    def traits_match?(traits, requested, mode)
      return true if requested.empty?

      matched_count = (traits & requested).size
      mode == 'all' ? matched_count == requested.size : matched_count.positive?
    end

    def requirements(rating, form_index)
      gates = [form_index >= 3 ? 'form 4 gate' : "form #{form_index + 1}"]
      gates << case rating.fetch('investment')
      when 'talents' then 'talent investment'
      when 'ultra' then 'ultra talent investment'
      end
      source_note = rating['requirements']
      gates << source_note if source_note && !source_note.empty?
      gates.compact.join('; ')
    end

    def series_name(ball, series_id)
      @series_names ||= {}
      @series_names[[ball.object_id, series_id]] ||=
        EventSeriesNames.korean(series_id) ||
          TrackApi.multi_events(ball).find { |event| event[:series_id] == series_id }&.fetch(:series_name) ||
          ball.gacha.values.find { |gacha| gacha['series_id'] == series_id }&.fetch('name', nil)
    end

    def rank(candidates, requested)
      candidates.sort_by do |candidate|
        tie_hint = if requested.empty?
          candidate.fetch('traits').size
        else
          candidate.fetch('matched_traits').size
        end
        [
          -TIER_RANK.fetch(candidate.fetch('tier').split('/').last),
          -tie_hint,
          INVESTMENT_RANK.fetch(candidate.fetch('investment')),
          candidate.fetch('cat_id'),
          candidate.fetch('form_index'),
          candidate.fetch('sourceImageIndex')
        ]
      end
    end

    def unavailable_result(options, event_pool)
      {
        'status' => 'dataset_unavailable',
        'source' => nil,
        'scope' => 'recommendation_candidates_not_predictions',
        'notice' => NOTICE,
        'tier_range_notice' => TIER_RANGE_NOTICE,
        'trait_notice' => TRAIT_NOTICE,
        'dataset_coverage' => nil,
        'total_candidates' => 0,
        'returned_count' => 0,
        'availability' => event_pool ? event_pool.fetch(:status) : 'not_checked',
        'event' => options['event'],
        'filters' => {
          'lang' => options.fetch('lang'),
          'traits' => options.fetch('traits'),
          'match' => options.fetch('match'),
          'max_form' => options.fetch('max_form')
        },
        'investment_budget' => options.fetch('investment'),
        'recommendations' => [],
        'unavailable_cat_ids' => [],
        'excluded_event_cat_ids' => []
      }
    end
  end
end
