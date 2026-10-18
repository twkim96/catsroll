# frozen_string_literal: true

require 'json'

module BattleCatsRolls
  # Pure snapshot projections. No storage, clock, mutex or publication policy.
  class GptResultQuery
    def initialize(max_response_bytes:, authority:, summary_keys:)
      @max_response_bytes = max_response_bytes
      @page_budget = max_response_bytes - 1024
      @authority = authority
      @summary_keys = summary_keys
    end

    def call(snapshot, options, result_id:)
      view = options.fetch('view', 'summary')
      response = case view
      when 'summary' then summary_view(snapshot)
      when 'array' then array_view(snapshot, options)
      when 'character' then character_view(snapshot, options)
      when 'route' then route_view(snapshot, options)
      when 'plan' then plan_view(snapshot, options)
      end
      response['status'] ||= 'ok'
      response['view'] = view
      response['authority'] = @authority
      response['result_id'] = result_id
      if view == 'array'
        (response['banners'] || [response]).each do |page|
          page['nextConditionalQuery']['result_id'] = result_id if page['nextConditionalQuery']
        end
      end
      bounded_response!(response)
    end

    def reference(snapshot)
      reference_summary(snapshot)
    end

    def bounded(response)
      bounded_response!(response)
    end

    private

    def bounded_response!(response)
      response['authority'] ||= @authority
      size = JSON.generate(response).bytesize
      raise GptResults::InvalidInput, 'Result page could not be bounded' if size > @max_response_bytes

      response
    end

    def reference_summary(snapshot)
      find = snapshot['find'] || {}
      plan = snapshot['plan'] || {}
      acquisitions = Array(find['targetsAcquired'])
      brief_find = {'status' => find['status'] || 'unknown'}
      (@summary_keys - %w[enabled]).each do |key|
        brief_find[key] = find[key] if find.key?(key)
      end
      brief_find['enabled'] = snapshot.dig('input', 'findEnabled')
      brief_find['targetsAcquired'] = acquisitions.first(20)
      brief_find['targetsAcquiredTotal'] = acquisitions.length
      brief_plan = {
        'enabled' => plan['enabled'] == true,
        'name' => plan['name'],
        'marksTotal' => Array(plan['marks']).length,
        'routeTotal' => Array(plan['route']).length,
        'catsTotal' => Array(plan['cats']).length,
        'progress' => plan['progress']
      }.reject { |_key, value| value.nil? }
      {
        'authority' => @authority,
        'data_version' => snapshot['data_version'],
        'input' => snapshot['input'],
        'costMeaning' => 'Engine comparison weights, not game currency or money',
        'track' => {
          'seed' => snapshot.dig('input', 'track', 'seed'),
          'last' => snapshot.dig('input', 'track', 'last'),
          'count' => snapshot.dig('input', 'track', 'count'),
          'banners' => Array(snapshot.dig('input', 'track', 'rows')).length
        },
        'find' => brief_find,
        'plan' => brief_plan,
        'banners' => snapshot['banners'].map do |banner|
          {'banner' => banner['banner'], 'lang' => banner['lang'],
            'rowsTotal' => banner['rowsTotal'], 'rowsIncluded' => banner['rowsIncluded'],
            'rowsOmitted' => banner['rowsOmitted'],
            'conditionalTotal' => banner['conditionalTotal'],
            'conditionalIncluded' => banner['conditionalIncluded'],
            'conditionalOmitted' => banner['conditionalOmitted']}
        end
      }
    end

    def summary_view(snapshot)
      summary = reference_summary(snapshot)
      summary.merge('status' => 'ok', 'schema_version' => snapshot['schema_version'],
        'view' => 'summary')
    end

    def array_view(snapshot, options)
      banners = snapshot['banners']
      if options.key?('banner') && options['banner'] >= banners.length
        raise GptResults::InvalidInput, 'banner index is unavailable in this snapshot'
      end
      selected = options.key?('banner') ? [[options['banner'], banners[options['banner']]]] : banners.each_with_index.map { |banner, index| [index, banner] }
      start = options.fetch('start', 1)
      page_size = options.fetch('limit', 20)
      branch_size = page_size
      conditional_offset = options.fetch('offset', 0)
      loop do
        pages = selected.map do |index, banner|
          build_array_page(index, banner, start, page_size, conditional_offset,
            branch_size, options['rowEnd'])
        end
        response = if options.key?('banner')
          pages.first.merge('status' => 'ok', 'view' => 'array')
        else
          {'status' => 'ok', 'view' => 'array', 'banners' => pages}
        end
        return response if JSON.generate(response).bytesize <= @page_budget
        if branch_size > 1
          branch_size -= 1
        elsif !options.key?('rowEnd') && page_size > 1
          page_size -= 1
        else
          raise GptResults::InvalidInput, 'Array row or conditional branch cannot fit in a result page'
        end
      end
    end

    def build_array_page(index, banner, start, limit, conditional_offset = 0,
      conditional_limit = limit, row_end = nil)
      rows = Array(banner['rows'])
      finish = row_end || [start + limit - 1, banner['rowsTotal']].min
      raise GptResults::InvalidInput, 'rowEnd exceeds available rows' if finish > banner['rowsTotal']
      selected = rows.each_with_index.filter_map do |pair, offset|
        next if row_end
        row_number = offset + 1
        next if row_number < start || row_number > finish

        {'row' => row_number,
          'A' => expand_cell(pair[0], banner['names']),
          'B' => expand_cell(pair[1], banner['names'])}
      end
      branches = banner['conditional'].select do |item|
        number = item[0].to_s[/\A\d+/].to_i
        number >= start && number <= finish
      end
      conditional_page = branches.slice(conditional_offset, conditional_limit) || []
      next_start = finish + 1
      omitted = [banner['rowsTotal'] - finish, 0].max
      result = {
        'bannerIndex' => index, 'banner' => banner['banner'], 'lang' => banner['lang'],
        'rowsTotal' => banner['rowsTotal'], 'rowsIncluded' => selected.length,
        'rowsOmitted' => omitted, 'start' => start, 'rows' => selected,
        'conditionalTotal' => branches.length, 'conditionalOffset' => conditional_offset,
        'conditionalStart' => start, 'conditionalEnd' => finish,
        'conditionalIncluded' => conditional_page.length,
        'conditionalOmitted' => [branches.length - conditional_offset - conditional_page.length, 0].max,
        'conditional' => conditional_page.map { |item| expand_conditional(item, banner['names']) }
      }
      if banner.key?('rarities')
        page_ids = {}
        collect_ids = lambda do |cell|
          next unless cell
          page_ids[cell['id'].to_s] = true
          collect_ids.call(cell['reroll'])
          collect_ids.call(cell['guaranteed'])
        end
        selected.each { |row| collect_ids.call(row['A']); collect_ids.call(row['B']) }
        conditional_page.each { |item| page_ids[item[1][2].to_s] = true }
        result['rarities'] = banner['rarities'].select { |id, _rarity| page_ids.key?(id) }
      end
      result['nextStart'] = next_start if next_start <= rows.length
      if conditional_offset + conditional_page.length < branches.length
        result['nextConditionalOffset'] = conditional_offset + conditional_page.length
        result['nextConditionalQuery'] = {'view' => 'array', 'banner' => index,
          'start' => start, 'rowEnd' => finish, 'limit' => limit, 'offset' => result['nextConditionalOffset']}
      end
      result
    end

    def expand_conditional(item, names)
      position, branch = item
      {'position' => position, 'kind' => branch[0], 'variant' => branch[1],
        'id' => branch[2], 'name' => names[branch[2].to_s],
        'resultLabel' => branch[3], 'rerolled' => branch[4],
        'guaranteed' => branch[5], 'pullNext' => branch[6],
        'next' => branch[7], 'prerequisite' => expand_prerequisite(branch[8]),
        'lastRareId' => branch[9]}
    end

    def expand_cell(cell, names)
      return nil unless cell

      {'id' => cell[0], 'name' => names[cell[0].to_s],
        'position' => cell[1], 'next' => cell[2],
        'reroll' => expand_link(cell[3], names, nested_guaranteed: true),
        'guaranteed' => expand_link(cell[4], names)}
    end

    def expand_link(link, names, nested_guaranteed: false)
      return nil unless link

      result = {'id' => link[0], 'name' => names[link[0].to_s],
        'position' => link[1], 'next' => link[2]}
      result['guaranteed'] = expand_link(link[3], names) if nested_guaranteed && link[3]
      result
    end

    def character_view(snapshot, options)
      target_id = options.fetch('cat_id')
      occurrences = []
      snapshot['banners'].each_with_index do |banner, banner_index|
        banner.fetch('rows').each_with_index do |row, row_index|
          %w[A B].each_with_index do |column, cell_index|
            collect_cell_occurrences(occurrences, banner, banner_index, row_index + 1,
              column, row[cell_index], target_id)
          end
        end
        banner.fetch('conditional').each do |item|
          position, branch = item
          id = branch[2]
          next unless id == target_id

          occurrences << {
            'bannerIndex' => banner_index, 'banner' => banner['banner'],
            'position' => position, 'resultPosition' => branch[3],
            'branch' => conditional_branch(branch), 'id' => id,
            'name' => banner['names'][id.to_s], 'next' => branch[7],
            'rerolled' => branch[4], 'guaranteed' => branch[5],
            'conditional' => true, 'kind' => branch[0], 'variant' => branch[1],
            'prerequisite' => expand_prerequisite(branch[8]),
            'lastRareId' => branch[9]
          }
        end
      end
      page = paged_records(occurrences, options.fetch('offset', 0), options.fetch('limit', 20))
      page.merge('cat_id' => target_id,
        'scope' => 'observed_snapshot_branches_only',
        'independent_reachability_verified' => false)
    end

    def collect_cell_occurrences(output, banner, banner_index, row_index, column, cell, target_id)
      return unless cell

      base_position = cell[1] || "#{row_index}#{column}"
      record = lambda do |id, position, next_position, branch, rerolled, guaranteed, extra = {}|
        next unless id == target_id

        output << {'bannerIndex' => banner_index, 'banner' => banner['banner'],
          'row' => row_index, 'column' => column, 'position' => position,
          'id' => id, 'name' => banner['names'][id.to_s], 'next' => next_position,
          'branch' => branch, 'rerolled' => rerolled, 'guaranteed' => guaranteed,
          'conditional' => false}.merge(extra)
      end
      record.call(cell[0], base_position, cell[2], 'base', false, false)
      if cell[4]
        record.call(cell[4][0], cell[4][1], cell[4][2], 'G', false, true)
      end
      reroll = cell[3]
      return unless reroll

      record.call(reroll[0], reroll[1], reroll[2], 'R', true, false)
      if reroll[3]
        record.call(reroll[3][0], reroll[3][1], reroll[3][2], 'RG', true, true)
      end
    end

    def conditional_branch(branch)
      if branch[5]
        branch[1] == 'rerolled' ? 'RG' : 'G'
      elsif branch[0] == 'reroll'
        'R'
      else
        'base'
      end
    end

    def expand_prerequisite(value)
      return nil unless value

      {'bannerIndex' => value[0], 'position' => value[1],
        'name' => value[2], 'kind' => value[3]}
    end

    def route_view(snapshot, options)
      find = snapshot['find'] || {}
      actions = Array(find['actions'])
      offset = options.fetch('offset', 0)
      page_size = options.fetch('limit', 20)
      loop do
        selected = actions.slice(offset, page_size) || []
        contexts, reindexed_actions = selected_contexts(selected, Array(find['actionContexts']))
        cat_ids = selected.flat_map do |action|
          [action['catId'], action['originalCatId']].compact.map(&:to_s)
        end.uniq
        cats = (find['actionCats'] || {}).select { |id, _item| cat_ids.include?(id) }
        action_ranges = selected.map do |action|
          first = action['actionStart'] || action['actionIndex']
          last = action['actionEnd'] || first
          first && last ? (first..last) : nil
        end.compact
        acquisitions = Array(find['targetsAcquired']).select do |item|
          action_ranges.any? { |range| range.cover?(item['actionIndex']) }
        end
        response = find_summary_for_route(find).merge(
          'findStatus' => find['status'], 'status' => 'ok', 'totalActions' => actions.length,
          'offset' => offset, 'actions' => reindexed_actions,
          'actionContexts' => contexts, 'actionCats' => cats,
          'targetsAcquired' => acquisitions,
          'targetsAcquiredTotal' => Array(find['targetsAcquired']).length
        )
        response['nextOffset'] = offset + selected.length < actions.length ? offset + selected.length : nil
        return response if JSON.generate(response).bytesize <= @page_budget
        raise GptResults::InvalidInput, 'Route action cannot fit in a result page' if page_size <= 1

        page_size -= 1
      end
    end

    def find_summary_for_route(find)
      @summary_keys.each_with_object({}) do |key, result|
        result[key == 'nextOffset' ? 'nextTrackOffset' : key] = find[key] if find.key?(key)
      end
    end

    def selected_contexts(actions, source_contexts)
      indexes = {}
      contexts = []
      cloned = actions.map do |action|
        item = action.dup
        if item.key?('context')
          old_index = item['context']
          indexes[old_index] ||= begin
            contexts << source_contexts.fetch(old_index)
            contexts.length - 1
          end
          item['context'] = indexes.fetch(old_index)
        end
        item
      end
      [contexts, cloned]
    end

    def plan_view(snapshot, options)
      plan = snapshot['plan'] || {}
      offset = options.fetch('offset', 0)
      limit = options.fetch('limit', 20)
      collections = %w[marks route cats].to_h do |key|
        values = Array(plan[key])
        page = values.slice(offset, limit) || []
        [key, {'total' => values.length, 'items' => page,
          'nextOffset' => offset + page.length < values.length ? offset + page.length : nil}]
      end
      response = {'status' => 'ok', 'enabled' => plan['enabled'] == true,
        'name' => plan['name'], 'progress' => plan['progress'],
        'offset' => offset, 'limit' => limit, 'collections' => collections}
      loop do
        return response if JSON.generate(response).bytesize <= @page_budget
        break if limit <= 1

        limit -= 1
        collections.each do |key, result|
          values = Array(plan[key])
          page = values.slice(offset, limit) || []
          result['items'] = page
          result['nextOffset'] = offset + page.length < values.length ? offset + page.length : nil
        end
        response['limit'] = limit
      end
      raise GptResults::InvalidInput, 'Plan record cannot fit in a result page'
    end

    def paged_records(records, offset, limit)
      page_size = limit
      loop do
        items = records.slice(offset, page_size) || []
        response = {'status' => 'ok', 'total' => records.length,
          'offset' => offset, 'items' => items}
        response['nextOffset'] = offset + items.length if offset + items.length < records.length
        return response if JSON.generate(response).bytesize <= @page_budget
        raise GptResults::InvalidInput, 'Character occurrence cannot fit in a result page' if page_size <= 1

        page_size -= 1
      end
    end
  end
end
