# frozen_string_literal: true

require 'json'

module BattleCatsRolls
  # Keep earlier form/investment opinions intact beside the final-build source.
  class GptTierCatalog
    LEGACY_PATH = File.expand_path('../../../doc/gpt-knowledge/tier-picks.json', __dir__).freeze
    FINAL_PATH = File.expand_path('../../../doc/gpt-knowledge/final-tier-picks.json', __dir__).freeze
    CITATION_POLICY = 'Do not display or invent external tier/evaluation source links. Source URLs are internal verification records; the owner will provide curated stable public references separately. Preserve evaluation conditions and source labels without hyperlinks.'.freeze

    def self.without_links(value)
      case value
      when Hash
        value.reject { |key, _| key.to_s.match?(/(?:url|uri|href|link)$/i) }.
          transform_values { |item| without_links(item) }
      when Array then value.map { |item| without_links(item) }
      else value
      end
    end

    def initialize(path: LEGACY_PATH, final_path: nil)
      @path = File.expand_path(path)
      @final_path = final_path || (FINAL_PATH if @path == LEGACY_PATH)
    end

    def data
      return {} unless File.file?(@path)

      legacy = JSON.parse(File.read(@path, encoding: 'UTF-8'))
      datasets = [[legacy, 'earlier_evaluation']]
      if @final_path && File.file?(@final_path)
        datasets.unshift([JSON.parse(File.read(@final_path, encoding: 'UTF-8')), 'final_build'])
      end
      legacy.merge(
        'source' => datasets.first.first.fetch('source'),
        'sources' => datasets.map { |dataset, _| dataset.fetch('source') },
        'ratings' => datasets.flat_map do |dataset, role|
          dataset.fetch('ratings').map do |rating|
            source = dataset.fetch('source')
            source = source.merge('url' => rating['source_url']) if rating['source_url']
            rating.merge('source' => source, 'evaluation_role' => role)
          end
        end,
        'reference_ratings' => datasets.flat_map do |dataset, role|
          Array(dataset['reference_ratings']).map do |rating|
            source = dataset.fetch('source').merge('url' => rating.fetch('source_url'))
            rating.merge('source' => source, 'evaluation_role' => role)
          end
        end,
        'unresolved_evaluations' => datasets.flat_map do |dataset, _|
          Array(dataset['unresolved_evaluations']).map { |entry| entry.merge('source' => dataset.fetch('source')) }
        end)
    end
  end
end
