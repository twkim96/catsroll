# frozen_string_literal: true

require 'base64'
require 'json'
require 'uri'
require_relative 'gpt_input_transfer'

module BattleCatsRolls
  # Navigation only, from an already validated prepare request. The existing
  # Multi share codec owns v1; do not silently clamp unsupported site settings.
  module GptSiteLinks
    module_function

    def build(origin, request)
      origin = origin.to_s.sub(%r{/+\z}, '')
      links = {app: {url: GptInputTransfer.url(origin, request),
        scope: 'complete_prepared_input', execution: 'client', autoCompute: false},
        multi: nil, tracks: [], unavailable: []}
      if request[:mode] == 'seek'
        links[:unavailable] << {view: 'multi/track', reason: 'Seed search uses the standalone app; an array link requires a known current seed.'}
        return links
      end

      rows = request.fetch(:rows)
      selectable = request[:findEnabled] ? TrackApi.multi_find_cats(0).map { |cat| cat[:id] } : []
      missing_targets = request[:findEnabled] && request.fetch(:targets).any? { |target| !selectable.include?(target[:cat_id]) }
      unsupported = rows.any? { |row| row[:previewFor] || row[:ubers] > 20 } || missing_targets
      if unsupported
        links[:unavailable] << {view: 'multi', reason: 'Reference previews, more than 20 future ubers, or targets missing from the website Find selector cannot be transferred to ordinary Multi. Use app.url to preserve every condition.'}
      else
        targets = request[:findEnabled] ? request.fetch(:targets) : []
        payload = {v: 1, t: [request[:seed], request[:last], request[:count], 0],
          r: rows.map { |row| [row[:lang], row[:event], row[:ubers], nil, [], row[:forceGuaranteed]] },
          f: [request[:optimization], request[:maxGuaranteed], request[:maxPlatinum],
            request[:maxLegendTicket], targets.map { |target| [target[:cat_id], target[:allow_ticket] ? 1 : 0] },
            request[:scheduleAware] ? 1 : 0]}
        token = Base64.urlsafe_encode64(JSON.generate(payload).encode(Encoding::UTF_8), padding: false)
        links[:multi] = {url: "#{origin}/multi#share=#{token}",
          scope: 'arrays_and_enabled_find_settings', execution: 'client', autoCompute: true,
          omitted: %w[planMode planName plan_marks computed_results],
          note: 'Opens an editable isolated share session; computes on the device. Plan activation and existing plan marks are not transferred. Website results are not automatically shared to chat.'}
      end
      rows.each_with_index do |row, index|
        if row[:previewFor] || row[:ubers] > 9
          links[:unavailable] << {view: 'track', banner: index,
            reason: 'Reference previews or more than 9 future ubers are not supported by the single-array site. Use app.url instead.'}
          next
        end
        query = {lang: row[:lang], event: row[:event], seed: request[:seed],
          last: request[:last], count: request[:count], ubers: row[:ubers],
          force_guaranteed: row[:forceGuaranteed], compute: 'client'}
        links[:tracks] << {banner: index, lang: row[:lang], event: row[:event],
          url: "#{origin}/?#{URI.encode_www_form(query)}", execution: 'client', autoCompute: true,
          scope: 'one_banner_array_only', omitted: %w[other_banners find_targets resource_budgets scheduleAware plan],
          note: 'An array view, not the prepared Find route. Check current seed/last and follow the computed next position. Website results are not automatically shared to chat.'}
      end
      links
    end
  end
end
