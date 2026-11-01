# frozen_string_literal: true

require 'json'
require_relative '../character_aliases'
require_relative 'gpt_tier_catalog'

module BattleCatsRolls
  # Source opinions stay separate from the live game's names and mechanics.
  class GptCharacterKnowledge
    PATH = File.expand_path('../../../doc/gpt-knowledge/character-notes.json', __dir__).freeze
    TIER_PATH = File.expand_path('../../../doc/gpt-knowledge/tier-picks.json', __dir__).freeze
    INVESTMENT_RANK = {'none' => 0, 'talents' => 1, 'ultra' => 2}.freeze
    TIER_NOTICE = 'Source ratings are opinions within each series and are not globally equivalent.'.freeze
    TIER_RANGE_NOTICE = 'A tier range preserves an ambiguous source-chart boundary; its lower end is used only for recommendation sorting.'.freeze

    def initialize(tier_path: TIER_PATH, final_path: nil)
      @data = JSON.parse(File.read(PATH, encoding: 'UTF-8'))
      @tier_path = File.expand_path(tier_path)
      @final_path = final_path
      @aliases = CharacterAliases.new
    end

    def alias_matches?(id, query)
      term = normalize_name(query)
      return false if term.empty?

      entry = @data.fetch('entries').find { |item| item.fetch('cat_id') == id }
      Array(entry && entry['aliases']).any? { |name| normalize_name(name).include?(term) } ||
        @aliases.for(id).any? { |name| normalize_name(name) == term }
    end

    def notes(ball, id, form_index: nil, investment: nil)
      info = ball.cats.fetch(id)
      entry = @data.fetch('entries').find { |item| item.fetch('cat_id') == id }
      return [] unless entry

      entry.fetch('observations').filter_map do |note|
        index = note['form_index']
        next if index && !info.fetch('name')[index]
        next if form_index && index && form_index != index
        next if investment && index && INVESTMENT_RANK.fetch(note.fetch('investment')) > INVESTMENT_RANK.fetch(investment)

        result = {'kind' => 'source_opinion', 'summary' => note.fetch('summary'),
          'source' => @data.fetch('sources').fetch(note.fetch('source_id'))}
        if index
          result['evaluation_context'] = {'form_index' => index,
            'form_name' => info.fetch('name').fetch(index), 'investment' => note.fetch('investment')}
        end
        result
      end
    end

    def details(ball, id)
      info = ball.cats.fetch(id)
      forms = info.fetch('name').each_with_index.map do |name, index|
        stat = Stat.new(id: id, info: info, index: index)
        specialization = Ability::Specialization
        {'form_index' => index, 'name' => name,
         'base_traits' => stat.abilities.grep(specialization).flat_map(&:list).map(&:downcase).uniq,
         'base_abilities' => stat.abilities.reject { |ability| ability.is_a?(specialization) }.map(&:name).uniq}
      end
      {'forms' => forms, 'talents' => Talent.build(info).map { |talent| {'ability' => talent.name, 'ultra' => talent.ultra?} },
       'metadata_scope' => 'Base form abilities; talent entries identify available upgrades, not unlocked account state. See recommendation evaluated form for applied talents.',
       'source_notes' => notes(ball, id),
       'tier_source' => tier_data['source'],
       'tier_sources' => tier_data['sources'],
       'growth_policy' => 'Low growth uses earlier_evaluation with its form/investment gates; high growth uses final_build only. Earlier high-growth entries are historical comparisons, not the active final ranking. Do not fill a missing final rating from the earlier source.',
       'tier_notice' => TIER_NOTICE,
       'tier_range_notice' => TIER_RANGE_NOTICE,
       'source_ratings' => source_ratings(ball, id, tier_data),
       'pending_evaluations' => pending_evaluations(id, tier_data)}
    end

    def ratings_for(ball, id)
      source_ratings(ball, id, tier_data)
    end

    private

    def normalize_name(value)
      value.unicode_normalize(:nfkc).downcase.gsub(/[^\p{Alnum}]/, '')
    end

    def tier_data
      @tier_data ||= GptTierCatalog.new(path: @tier_path, final_path: @final_path).data
    end

    def source_ratings(ball, id, data)
      info = ball.cats[id]
      return [] unless info

      (Array(data['ratings']) + Array(data['reference_ratings'])).filter_map do |rating|
        next unless rating.is_a?(Hash) && rating['cat_id'] == id

        form_index = rating['form_index']
        form_name = info.fetch('name')[form_index] if form_index.is_a?(Integer)
        next unless form_name.is_a?(String)

        tier = rating['tier']
        result = {
          'kind' => 'source_tier_rating',
          'cat_id' => id,
          'tier' => tier,
          'series_id' => rating['series_id'],
          'form_index' => form_index,
          'evaluated_form' => form_name,
          'investment' => rating['investment'],
          'source_image_index' => rating['source_image'],
          'source' => rating['source'] || data['source'],
          'evaluation_role' => rating['evaluation_role'],
          'evaluation_assumptions' => rating['evaluation_assumptions'],
          'acquisition_scope' => rating['acquisition_scope'],
          'tier_notice' => TIER_NOTICE
        }
        if tier.is_a?(String) && tier.include?('/')
          result['tier_range'] = tier
          result['tier_conservative_rank'] = tier.split('/').last
          result['tier_range_notice'] = TIER_RANGE_NOTICE
        end
        result['requirements'] = rating['requirements'] if rating.key?('requirements')
        result
      end
    end

    def pending_evaluations(id, data)
      Array(data['unresolved_evaluations']).filter_map do |entry|
        next unless entry.is_a?(Hash) &&
          (entry['cat_id'] == id || Array(entry['cat_ids']).include?(id))

        entry.merge('kind' => 'pending_source_evaluation', 'status' => 'pending',
          'source' => entry['source'] || data['source'])
      end
    end
  end
end
