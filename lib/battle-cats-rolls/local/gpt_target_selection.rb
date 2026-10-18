# frozen_string_literal: true

require_relative 'gpt_validation'

module BattleCatsRolls
  # Catalog filtering only: no engine, pagination, resource changes or ownership
  # inference. The normalized request receives ordinary direct targets.
  class GptTargetSelection
    include GptValidation
    MAXIMUM = 30
    KEYS = %w[type lang event rarity excludeOwnedIds].freeze

    def initialize(value, prepared_events)
      GptValidation.object!(value, 'targetSelection must be an object')
      raise GptMcp::InvalidInput, 'Unknown targetSelection fields' unless (value.keys - KEYS).empty?
      raise GptMcp::InvalidInput, 'targetSelection type must be banner_collection' unless value['type'] == 'banner_collection'
      raise GptMcp::InvalidInput, 'targetSelection lang must be kr or jp' unless TrackApi::MultiLangs.include?(value['lang'])
      raise GptMcp::InvalidInput, 'targetSelection rarity must be 4' unless value['rarity'].is_a?(Integer) && value['rarity'] == 4
      @event = prepared_events.find { |event| event[:lang] == value['lang'] && event[:event] == value['event'] }
      raise GptMcp::InvalidInput, 'targetSelection event/lang must match a selected banner row' unless @event

      @ball = Route.public_send("ball_#{value['lang']}")
      owned = value.fetch('excludeOwnedIds', [])
      raise GptMcp::InvalidInput, 'excludeOwnedIds must be an array of character IDs' unless owned.is_a?(Array)
      @owned = owned.map do |id|
        integer(id, 'excludeOwnedIds character ID', 1, 1_000_000)
        raise GptMcp::InvalidInput, 'Unknown excludeOwnedIds character ID' unless @ball.cats.key?(id)
        id
      end.uniq
      @value = value
    end

    def resolve
      ids = Array(@event[:pool].dig(:slots, 4)).uniq
      matched = ids.map do |id|
        info = @ball.cats[id]
        raise GptMcp::InvalidInput, 'Selected rarity slot has no character record' unless info
        {cat_id: id, cat_name: Array(info['name']).first || id.to_s}
      end
      excluded, included = matched.partition { |target| @owned.include?(target[:cat_id]) }
      selection = {type: 'banner_collection', lang: @value['lang'], event: @value['event'], rarity: 4,
        excludeOwnedIds: @owned, matched_count: matched.size,
        included_count: included.size, excluded_count: excluded.size,
        matched_ids: ids, included_ids: included.map { |target| target[:cat_id] },
        excluded_ids: excluded.map { |target| target[:cat_id] },
        included: included.map { |target| target.merge(reason: 'selected_banner_rarity_slot') },
        excluded: excluded.map { |target| target.merge(reason: 'explicitly_owned') },
        unmatched_owned_ids: @owned - ids}
      reason = if included.empty?
        'no_remaining_targets'
      elsif included.size > MAXIMUM
        'target_limit_exceeded'
      end
      {targets: included.map { |target| target.transform_keys(&:to_s) }, selection: selection,
       reason: reason}
    end
  end
end
