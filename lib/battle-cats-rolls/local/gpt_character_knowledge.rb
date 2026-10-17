# frozen_string_literal: true

require 'json'

module BattleCatsRolls
  # Source opinions stay separate from the live game's names and mechanics.
  class GptCharacterKnowledge
    PATH = File.expand_path('../../../doc/gpt-knowledge/character-notes.json', __dir__).freeze
    INVESTMENT_RANK = {'none' => 0, 'talents' => 1, 'ultra' => 2}.freeze

    def initialize
      @data = JSON.parse(File.read(PATH, encoding: 'UTF-8'))
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
       'source_notes' => notes(ball, id)}
    end
  end
end
