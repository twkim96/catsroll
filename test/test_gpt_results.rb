require 'pork/auto'
require 'json'
require 'battle-cats-rolls/local/gpt_results'

describe 'Temporary client-computed result snapshots' do
  def snapshot(rows: 300, banners: 1)
    {'schema_version' => 1, 'data_version' => 'fixture',
      'input' => {'track' => {'seed' => 42, 'last' => 0, 'count' => rows, 'formIndex' => 0, 'rows' => [{'lang' => 'kr', 'event' => 'fixture'}]}, 'findEnabled' => false, 'findSettings' => {}},
      'find' => {'status' => 'not_requested', 'actions' => [], 'actionContexts' => [], 'actionCats' => {}, 'targetsAcquired' => [], 'totalDraws' => 0},
      'plan' => {'enabled' => false, 'name' => '', 'progress' => '', 'marks' => [], 'route' => [], 'cats' => []},
      'banners' => Array.new(banners) do |index|
        {'banner' => "Fixture #{index}", 'lang' => 'kr', 'rowsTotal' => rows, 'rowsIncluded' => rows, 'rowsOmitted' => 0,
          'conditionalTotal' => 0, 'conditionalIncluded' => 0, 'conditionalOmitted' => 0,
          'names' => {'38' => '고양이 홉핑', '870' => '변신소녀 단'},
          'rows' => (1..rows).map { |n| [[38, "#{n}A", "#{n + 1}A", nil, nil], [38, "#{n}B", "#{n + 1}B", nil, nil]] }, 'conditional' => []}
      end}
  end

  def invalid?
    yield
    false
  rescue BattleCatsRolls::GptResults::InvalidInput
    true
  end

  would 'expire without extending access and isolate host namespaces and restart state' do
    now = 0
    store = BattleCatsRolls::GptResults.new(clock: -> { now }, ttl: 10)
    first = store.publish(snapshot)
    second = store.publish(snapshot)
    expect(first['result_id'] != second['result_id']).eq true
    expect(first['result_id'].match?(/\A[0-9a-f]{64}\z/)).eq true
    id = first['result_id']
    expect(store.lookup({'result_id' => id}, host: :claude)['status']).eq 'expired_or_unavailable'
    expect(BattleCatsRolls::GptResults.new.lookup({'result_id' => id})['status']).eq 'expired_or_unavailable'
    now = 9
    expect(store.lookup({'result_id' => id})['status']).eq 'ok'
    now = 10
    expect(store.lookup({'result_id' => id})['status']).eq 'expired_or_unavailable'
    expect(store.lookup({'result_id' => '0' * 64})['status']).eq 'expired_or_unavailable'
    expect(BattleCatsRolls::GptResults.default.equal?(BattleCatsRolls::GptResults.default)).eq true
  end

  would 'retain immutable copies and refuse capacity without evicting live results' do
    data = snapshot(rows: 2)
    now = 0
    store = BattleCatsRolls::GptResults.new(clock: -> { now }, ttl: 1, max_entries: 1)
    id = store.publish(data)['result_id']
    data['banners'][0]['rows'][0][0][0] = 870
    page = store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 0})
    expect(page['rows'][0]['A']['id']).eq 38
    page['rows'][0]['A']['id'] = 870
    expect(store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 0})['rows'][0]['A']['id']).eq 38
    expect(invalid? { store.publish(snapshot) }).eq true
    expect(store.lookup({'result_id' => id})['status']).eq 'ok'
    now = 1
    expect(store.publish(snapshot)['result_id'].size).eq 64
    bytes = JSON.generate(snapshot(rows: 2)).bytesize
    limited = BattleCatsRolls::GptResults.new(max_bytes: bytes)
    limited.publish(snapshot(rows: 2))
    expect(invalid? { limited.publish(snapshot(rows: 2)) }).eq true
  end

  would 'retrieve the final row of all eight 999-row banners and preserve conditional RG identities' do
    data = snapshot(rows: 999, banners: 8)
    banner = data['banners'][7]
    banner['rows'][998][0][3] = [38, '999AR', '1000B', [870, '999ARG', '1010A']]
    banner['conditional'] = [['999A', ['guaranteed', 'rerolled', 870, '999ARG', false, true, '1010A', '1010A', [6, '998B', '고양이 홉핑', 'regular'], 38]]]
    banner.merge!('conditionalTotal' => 1, 'conditionalIncluded' => 1)
    store = BattleCatsRolls::GptResults.new
    id = store.publish(data)['result_id']
    8.times do |index|
      page = store.lookup({'result_id' => id, 'view' => 'array', 'banner' => index, 'start' => 999, 'limit' => 1})
      expect(page['rows'][0]['B']['position']).eq '999B'
      expect(page['rowsTotal']).eq 999
    end
    matches = store.lookup({'result_id' => id, 'view' => 'character', 'cat_id' => 870})
    expect(matches['items'].map { |item| item['branch'] }.uniq).eq ['RG']
    expect(matches['items'].any? { |item| item['prerequisite'] && item['prerequisite']['bannerIndex'] == 6 }).eq true
    expect(matches['independent_reachability_verified']).eq false
    expect(invalid? { store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 8}) }).eq true
  end

  would 'page all detailed actions including the final acquisition without converting partial to success' do
    data = snapshot
    data['input']['findEnabled'] = true
    data['find'] = {'status' => 'partial', 'message' => 'Not proven optimal', 'totalDraws' => 300,
      'targetAcquired' => 1, 'targetTotal' => 2, 'actionCats' => {'38' => {'name' => '고양이 홉핑', 'rarity' => 2}},
      'actionContexts' => [{'lang' => 'kr', 'event' => 'fixture', 'scheduleDay' => 0}],
      'actions' => (1..300).map { |n| {'type' => 'roll', 'actionIndex' => n, 'context' => 0, 'catId' => 38, 'resultLabel' => "#{n}A", 'next' => "#{n + 1}A"} },
      'targetsAcquired' => [{'actionIndex' => 300, 'targetIndex' => 0, 'catId' => 38, 'catName' => '고양이 홉핑', 'resultLabel' => '300A', 'drawNumber' => 300}]}
    store = BattleCatsRolls::GptResults.new
    id = store.publish(data)['result_id']
    tail = store.lookup({'result_id' => id, 'view' => 'route', 'offset' => 299, 'limit' => 1})
    expect(tail['findStatus']).eq 'partial'
    expect(tail['message']).eq 'Not proven optimal'
    expect(tail['actions'][0]['resultLabel']).eq '300A'
    expect(tail['targetsAcquired'][0]['drawNumber']).eq 300
    expect(store.lookup({'result_id' => id})['find']['message']).eq 'Not proven optimal'
  end

  would 'bound Unicode pages and keep all branch and plan records available through cursors' do
    data = snapshot
    data['banners'][0]['names']['38'] = '한' * 90
    data['plan']['marks'] = (1..300).map { |n| {'column' => 0, 'position' => "#{n}A", 'kind' => 'regular'} }
    data['banners'][0]['conditional'] = (1..60).map { ['1A', ['regular', nil, 38, '1A', false, false, '2A', '2A', nil, 0]] }
    data['banners'][0].merge!('conditionalTotal' => 60, 'conditionalIncluded' => 60)
    store = BattleCatsRolls::GptResults.new
    id = store.publish(data)['result_id']
    cursor = 1
    count = 0
    loop do
      page = store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 0, 'start' => cursor, 'limit' => 50})
      expect(JSON.generate(page).bytesize <= 32768).eq true
      count += page['rows'].size
      break unless page['nextStart']
      cursor = page['nextStart']
    end
    expect(count).eq 300
    branches = store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 0, 'start' => 1, 'limit' => 1, 'offset' => 59})
    expect(branches['conditionalIncluded']).eq 1
    expect(branches['conditionalOmitted']).eq 0
    plan = store.lookup({'result_id' => id, 'view' => 'plan', 'offset' => 299, 'limit' => 1})
    expect(plan['collections']['marks']['items'][0]['position']).eq '300A'
  end

  would 'rate limit repeated writes without retaining unbounded throttle state' do
    # The production default remains untouched by this isolated class throttle.
    isolated = Class.new(BattleCatsRolls::GptResults)
    60.times { isolated.reserve_publish!(0) }
    expect(invalid? { isolated.reserve_publish!(59) }).eq true
    expect(invalid? { isolated.reserve_publish!(60) }).eq false
  end

  would 'reject malformed snapshots and keep concurrent reads and writes isolated' do
    store = BattleCatsRolls::GptResults.new
    expect(invalid? { store.publish(snapshot.merge('credentials' => {})) }).eq true
    expect(invalid? { store.publish(snapshot.merge('schema_version' => 2)) }).eq true
    malformed = snapshot
    malformed['banners'][0]['rows'][0] = ['bad']
    expect(invalid? { store.publish(malformed) }).eq true
    bad_context = snapshot
    bad_context['find']['actions'] = [{'type' => 'roll', 'context' => 8}]
    expect(invalid? { store.publish(bad_context) }).eq true
    ids = Array.new(4) { Thread.new { store.publish(snapshot(rows: 2))['result_id'] } }.map(&:value)
    expect(ids.uniq.size).eq 4
    pages = ids.each_with_index.map do |id, index|
      Thread.new { store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 0, 'start' => index.even? ? 1 : 2, 'limit' => 1})['rows'][0]['row'] }
    end.map(&:value)
    expect(pages).eq [1, 2, 1, 2]
    expect(invalid? { store.lookup({'result_id' => ids[0], 'view' => 'character'}) }).eq true
    expect(invalid? { store.lookup({'result_id' => ids[0], 'limit' => 51}) }).eq true
    expect(invalid? { store.lookup({'result_id' => ids[0], 'extra' => true}) }).eq true
  end
end
