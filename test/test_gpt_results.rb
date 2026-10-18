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

  would 'retain optional rarity metadata for existing-array reasoning and reject unbound metadata' do
    data = snapshot(rows: 2)
    data['banners'][0]['rarities'] = {'38' => 2, '870' => 4}
    data['banners'][0]['rows'][1][0][4] = [870, '2AG', '12B']
    store = BattleCatsRolls::GptResults.new
    id = store.publish(data)['result_id']
    expect(store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 0})['rarities']).eq({'38' => 2, '870' => 4})
    expect(store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 0, 'limit' => 1})['rarities']).eq({'38' => 2})
    data['banners'][0]['rarities']['870'] = 'uber'
    expect(invalid? { store.publish(data) }).eq true
    data['banners'][0]['rarities'] = {'999' => 4}
    expect(invalid? { store.publish(data) }).eq true
  end

  would 'retain effective guarantee settings without requiring them in older snapshots' do
    data = snapshot(rows: 2)
    guarantee = {'requested_override' => 0, 'effective_rolls' => 11, 'source' => 'banner_default'}
    data['banners'][0]['guarantee'] = guarantee
    store = BattleCatsRolls::GptResults.new
    id = store.publish(data)['result_id']
    expect(store.lookup({'result_id' => id})['banners'][0]['guarantee']).eq guarantee
    expect(store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 0})['guarantee']).eq guarantee
    data['banners'][0]['guarantee']['effective_rolls'] = 10
    expect(invalid? { store.publish(data) }).eq true
    expect(invalid? { store.publish(snapshot(rows: 2)) }).eq false
  end

  would 'page all detailed actions including the final acquisition without converting partial to success' do
    data = snapshot
    data['input']['findEnabled'] = true
    data['find'] = {'status' => 'partial', 'message' => 'Not proven optimal', 'totalDraws' => 300,
      'nextOffset' => 600, 'targetAcquired' => 1, 'targetTotal' => 2, 'actionCats' => {'38' => {'name' => '고양이 홉핑', 'rarity' => 2}},
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
    expect(store.lookup({'result_id' => id})['find']['engine_position']['next_track_offset']).eq 600
    expect(store.lookup({'result_id' => id})['find'].key?('nextOffset')).eq false
    expect(tail['nextTrackOffset']).eq 600
    expect(tail['nextOffset']).eq nil
    seen = []
    offset = 0
    8.times do
      page = store.lookup({'result_id' => id, 'view' => 'route', 'offset' => offset, 'limit' => 50})
      seen.concat(page['actions'].map { |item| item['actionIndex'] })
      offset = page['nextOffset']
      break unless offset
    end
    expect(seen).eq (1..300).to_a
    expect(offset).eq nil
    beyond = store.lookup({'result_id' => id, 'view' => 'route', 'offset' => 600})
    expect(beyond['nextOffset']).eq nil
    expect(beyond['actions']).eq []
  end

  would 'preserve every conditional identity while following size-limited continuation queries' do
    data = snapshot(rows: 50)
    banner = data['banners'][0]
    banner['names'].merge!('38' => 'Cat', '77' => '한' * 100, '870' => '한' * 100)
    banner['rows'].each { |pair| pair.each { |cell| cell[0] = 77 } }
    branches = (1..50).map { |n| "#{n}A" }.sort.flat_map do |position|
      2.times.map { |i| [position, ['regular', nil, 38, position, false, false, "#{position.to_i + 1}A", "#{position.to_i + 1}A", nil, i]] }
    end
    branches.drop(20).each do |item|
      item[1][2] = 870
      item[1][8] = [0, item[0], banner['names']['870'], 'regular']
    end
    banner.merge!('conditional' => branches, 'conditionalTotal' => branches.size, 'conditionalIncluded' => branches.size)
    store = BattleCatsRolls::GptResults.new
    id = store.publish(data)['result_id']
    seen, rows = [], []
    start = 1
    50.times do
      page = store.lookup({'result_id' => id, 'view' => 'array', 'banner' => 0, 'start' => start, 'limit' => 50})
      rows.concat(page['rows'].map { |item| item['row'] })
      window = page.values_at('conditionalStart', 'conditionalEnd', 'nextStart')
      100.times do
        expect(JSON.generate(page).bytesize <= 32768).eq true
        expect(page.values_at('conditionalStart', 'conditionalEnd', 'nextStart')).eq window
        seen.concat(page['conditional'].map { |item| item.values_at('position', 'lastRareId') })
        break unless page['nextConditionalQuery']
        expect(page['nextConditionalQuery']['result_id']).eq id
        page = store.lookup(page['nextConditionalQuery'].merge('result_id' => id))
      end
      start = page['nextStart']
      break unless start
    end
    expect(start).eq nil
    expect(rows).eq (1..50).to_a
    expect(seen.tally).eq branches.map { |item| [item[0], item[1][9]] }.tally
  end

  would 'reject malformed linked cells as input errors for every JSON scalar type' do
    [0, true, false, 'x', {}, [], [38], [38, '1A'], [38, '1A', '2A', nil, nil]].each do |value|
      [3, 4].each do |index|
        data = snapshot(rows: 1)
        data['banners'][0]['rows'][0][0][index] = value
        expect(invalid? { BattleCatsRolls::GptResults.new.publish(data) }).eq true
      end
    end
    expect(invalid? { BattleCatsRolls::GptResults.new.publish(snapshot(rows: 1)) }).eq false
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

  would 'deduplicate only within a session and keep retry expiration fixed' do
    now = 0
    store = BattleCatsRolls::GptResults.new(clock: -> { now }, ttl: 10)
    data = snapshot(rows: 1)
    options = {session_id: 'a' * 64, idempotency_key: 'b' * 64}
    first = store.publish(data, **options)
    now = 9
    5.times do
      retry_result = store.publish(data, **options)
      expect(retry_result['result_id']).eq first['result_id']
      expect(retry_result['expires_at']).eq first['expires_at']
      expect(retry_result['ttl_seconds']).eq 1
    end
    changed = snapshot(rows: 2)
    begin
      store.publish(changed, **options)
      raise 'expected conflict'
    rescue BattleCatsRolls::GptResults::PublishError => error
      expect(error.code).eq 'idempotency_conflict'
      expect(error.retryable).eq false
    end
    other = store.publish(data, session_id: 'c' * 64, idempotency_key: 'b' * 64)
    expect(other['result_id'] != first['result_id']).eq true
    claude = store.publish(data, host: :claude, **options)
    expect(claude['result_id'] != first['result_id']).eq true
    now = 10
    expect(store.lookup({'result_id' => first['result_id']})['status']).eq 'expired_or_unavailable'
    expect(store.publish(data, **options)['result_id'] != first['result_id']).eq true
    expect(invalid? { store.publish(data, session_id: 'a' * 64) }).eq true
  end

  would 'enforce per-session quotas without consuming another sessions allocation' do
    store = BattleCatsRolls::GptResults.new(max_entries: 6, max_session_entries: 2)
    data = snapshot(rows: 1)
    first = store.publish(data, session_id: 'a' * 64, idempotency_key: '1' * 64)
    store.publish(data, session_id: 'a' * 64, idempotency_key: '2' * 64)
    begin
      store.publish(data, session_id: 'a' * 64, idempotency_key: '3' * 64)
      raise 'expected session limit'
    rescue BattleCatsRolls::GptResults::PublishError => error
      expect(error.code).eq 'session_full'
    end
    expect(store.publish(data, session_id: 'a' * 64, idempotency_key: '1' * 64)['result_id']).eq first['result_id']
    other = store.publish(data, session_id: 'b' * 64, idempotency_key: '1' * 64)
    expect(store.lookup({'result_id' => other['result_id']})['status']).eq 'ok'
    tight = BattleCatsRolls::GptResults.new(max_session_bytes: JSON.generate(data).bytesize)
    tight.publish(data)
    begin
      tight.publish(data)
      raise 'expected byte budget'
    rescue BattleCatsRolls::GptResults::PublishError => error
      expect(error.code).eq 'session_full'
    end
    full = BattleCatsRolls::GptResults.new(max_entries: 1)
    full.publish(data, session_id: 'a' * 64, idempotency_key: '1' * 64)
    begin
      full.publish(data, session_id: 'b' * 64, idempotency_key: '1' * 64)
      raise 'expected global limit'
    rescue BattleCatsRolls::GptResults::PublishError => error
      expect(error.code).eq 'storage_full'
      expect(error.retryable).eq true
    end
  end

  would 'reject further malformed writes before repeated snapshot normalization' do
    isolated = Class.new(BattleCatsRolls::GptResults)
    store = isolated.new
    6.times { expect(invalid? { store.publish({}) }).eq true }
    begin
      store.publish({})
      raise 'expected throttle'
    rescue BattleCatsRolls::GptResults::PublishError => error
      expect(error.code).eq 'rate_limited'
      expect(error.retry_after_seconds).eq 60
    end
  end

  would 'bound simultaneous normalization and release reservations after errors' do
    gate, entered = Queue.new, Queue.new
    limited = Class.new(BattleCatsRolls::GptResults) do
      define_method(:normalize_snapshot) do |snapshot|
        entered << true
        gate.pop
        super(snapshot)
      end
    end.new
    gate << true
    existing_id = limited.publish(snapshot(rows: 1))['result_id']
    entered.pop
    workers = 2.times.map { Thread.new { limited.publish(snapshot(rows: 1)) } }
    2.times { entered.pop }
    begin
      limited.publish(snapshot(rows: 1))
      raise 'expected busy'
    rescue BattleCatsRolls::GptResults::PublishError => error
      expect(error.code).eq 'busy'
      begin
        limited.lookup({'result_id' => existing_id})
        raise 'expected read admission limit'
      rescue BattleCatsRolls::GptResults::PublishError => read_error
        expect(read_error.code).eq 'busy'
      end
    ensure
      2.times { gate << true }
    end
    ids = workers.map { |worker| worker.value['result_id'] }
    expect(ids.uniq.length).eq 2
    expect(limited.lookup({'result_id' => ids.first})['status']).eq 'ok'
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
    store = BattleCatsRolls::GptResults.new
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
