# frozen_string_literal: true

require 'json'

module BattleCatsRolls
  # Reviewed identity aliases only. Names, forms and abilities remain in game data.
  class CharacterAliases
    PATH = File.expand_path('../../doc/gpt-knowledge/character-aliases.json', __dir__).freeze

    def initialize
      @aliases = JSON.parse(File.read(PATH, encoding: 'UTF-8')).fetch('entries').to_h do |entry|
        [entry.fetch('cat_id'), entry.fetch('aliases')]
      end
    end

    def for(id)
      @aliases.fetch(id, [])
    end
  end
end
