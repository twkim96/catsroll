require 'pork/auto'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'battle-cats-rolls/local/gpt_guide'

describe 'Catsroll curated GPT guide retrieval' do
  def guide_with(root, body_size: 80)
    docs = [
      {id: 'index', title: '처음 안내', summary: '가이드 목차', keywords: ['도움말'], related: ['seed', 'tracks', 'find', 'guaranteed'], file: 'index.md'},
      {id: 'seed', title: '시드 찾기', summary: '시드 검색과 확인', keywords: ['seed', '시드 찾기', '시드찾', '씨앗 번호', '공통검색'], related: ['tracks'], file: 'seed.md'},
      {id: 'tracks', title: '배열과 트랙', summary: '배열 위치 이동', keywords: ['배열 이동', 'track', 'rg', '공통검색'], related: ['seed'], file: 'tracks.md'},
      {id: 'find', title: '목표 캐릭터 경로', summary: '원하는 캐릭터를 찾는 경로', keywords: ['포노', '먹고싶', '공통검색'], related: ['seed'], file: 'find.md'},
      {id: 'guaranteed', title: '확정 뽑기', summary: '11회 확정 뽑기', keywords: ['확정', '11', '공통검색'], related: ['tracks'], file: 'guaranteed.md'}
    ]
    FileUtils.mkdir_p(root)
    File.write(File.join(root, 'manifest.json'), JSON.generate(version: 1, documents: docs), encoding: 'UTF-8')
    docs.each do |document|
      body = document.fetch(:id) == 'seed' ? ('시드 안내. ' * body_size) : "#{document.fetch(:title)} 본문"
      File.write(File.join(root, document.fetch(:file)), body, encoding: 'UTF-8')
    end
    BattleCatsRolls::GptGuide.new(root: root)
  end

  def raises?(error_class)
    yield
    false
  rescue error_class
    true
  end

  would 'route novice Korean phrases across spacing, particles, and case' do
    Dir.mktmpdir do |root|
      guide = guide_with(root)
      ['시드는 어떻게 찾나요', '시드 찾기', 'SEED   찾는 방법'].each do |query|
        result = guide.lookup('query' => query)
        expect(result.fetch('matched')).eq true
        expect(result.fetch('documents').first.fetch('id')).eq 'seed'
      end
    end
  end

  would 'find compact Korean keyword prefixes without fuzzy English or number fragments' do
    Dir.mktmpdir do |root|
      guide = guide_with(root)
      {'내시드찾아줘' => 'seed', '내 시드찾아줘' => 'seed',
        '대상먹고싶어' => 'find', '대상 먹고싶어' => 'find', 'rg' => 'tracks', '11' => 'guaranteed'}.each do |query, id|
        result = guide.lookup('query' => query)
        expect(result.fetch('documents').first.fetch('id')).eq id
      end
      ['large', '111'].each do |query|
        result = guide.lookup('query' => query)
        expect(result.fetch('documents').first.fetch('id')).eq 'index'
        expect(result.fetch('matched')).eq false
      end
      expect(guide.lookup('query' => '공통검색', 'limit' => 3).fetch('documents').size).eq 3

      File.write(File.join(root, 'find.md'), '대형 우주 비행사', encoding: 'UTF-8')
      body_only = guide.lookup('query' => '대형우주비행사')
      expect(body_only.fetch('documents').first.fetch('id')).eq 'index'
      expect(body_only.fetch('matched')).eq false

      File.write(File.join(root, 'seed.md'), 'xylophone alpha beta gamma; 122 alpha beta gamma', encoding: 'UTF-8')
      ['xy alpha beta gamma', '22 alpha beta gamma'].each do |query|
        result = guide.lookup('query' => query)
        expect(result.fetch('documents').first.fetch('id')).eq 'index'
        expect(result.fetch('matched')).eq false
      end
    end
  end

  would 'return the index for empty and unmatched searches without guessing' do
    Dir.mktmpdir do |root|
      guide = guide_with(root)
      empty = guide.lookup({})
      expect(empty.fetch('documents').first.fetch('id')).eq 'index'
      expect(empty.fetch('status')).eq 'index'
      unknown = guide.lookup('query' => '달나라 고양이 행성')
      expect(unknown.fetch('documents').map { |document| document.fetch('id') }).eq ['index']
      expect(unknown.fetch('matched')).eq false
      expect(unknown.fetch('status')).eq 'fallback'
    end
  end

  would 'allow exact topic retrieval and bound the response content' do
    Dir.mktmpdir do |root|
      guide = guide_with(root, body_size: 3_000)
      topic = guide.lookup('topic' => 'tracks', 'query' => 'irrelevant', 'limit' => 3)
      expect(topic.fetch('matched')).eq true
      expect(topic.fetch('documents').map { |document| document.fetch('id') }).eq ['tracks']
      bounded = guide.lookup('query' => '시드', 'limit' => 1)
      expect(bounded.fetch('documents').first.fetch('id')).eq 'seed'
      expect(bounded.fetch('documents').sum { |document| document.fetch('content').length } <= 16_000).eq true
      expect(bounded.fetch('truncated')).eq true
      expect(bounded.fetch('documents').first.fetch('truncated')).eq true
      expect(bounded.fetch('topics').size <= 9).eq true
    end
  end

  would 'reject invalid arguments and unsafe manifest paths' do
    Dir.mktmpdir do |root|
      guide = guide_with(root)
      [{'query' => 3}, {'query' => 'x' * 301}, {'topic' => 'seed.md'}, {'limit' => 0}, {'limit' => 4}, {query: 'seed'}].each do |args|
        expect(raises?(BattleCatsRolls::GptGuide::InvalidInput) { guide.lookup(args) }).eq true
      end

      bad_root = File.join(root, 'bad')
      FileUtils.mkdir_p(bad_root)
      manifest = JSON.parse(File.read(File.join(root, 'manifest.json'), encoding: 'UTF-8'))
      manifest.fetch('documents').first['file'] = '../outside.md'
      File.write(File.join(bad_root, 'manifest.json'), JSON.generate(manifest), encoding: 'UTF-8')
      expect(raises?(BattleCatsRolls::GptGuide::InvalidManifest) {
        BattleCatsRolls::GptGuide.new(root: bad_root)
      }).eq true
    end
  end

  would 'retrieve website controls and screenshot track-switch guidance from the shipped corpus' do
    guide = BattleCatsRolls::GptGuide.new
    ['OO는 어떻게 써야해?', '이 스크린샷이면 열 넘어가?', '왜 열이 안넘어가지?',
      '멀티 플랜모드 사용법', '앱이 안열려 사이트 링크 줘'].each do |query|
      result = guide.lookup('query' => query)
      expect(result.fetch('documents').first.fetch('id')).eq 'website'
      expect(result.fetch('truncated')).eq false
    end
    website = guide.lookup('topic' => 'website')
    expect(website.fetch('topics').any? { |item| item['id'] == 'website' }).eq true
    expect(guide.lookup('topic' => 'glossary').fetch('documents').first.fetch('id')).eq 'glossary'
  end

  would 'recognize only registered short domain terms and their Korean particles' do
    guide = BattleCatsRolls::GptGuide.new
    {'A/B' => 'tracks', 'A / B 설명' => 'tracks', 'A열' => 'tracks', 'B열은?' => 'tracks',
      '4진' => 'recommendations', '4진 뜻' => 'recommendations', '4진뜻' => 'recommendations',
      '4진이랑' => 'recommendations', '4진이랑 뭐가 달라?' => 'recommendations',
      'D옥' => 'recommendations', 'D옥 설명' => 'recommendations', 'D옥은?' => 'recommendations',
      'D옥에는 뭐가 필요해?' => 'recommendations', 'D옥으로도?' => 'recommendations',
      '색' => 'colors', '색은?' => 'colors', 'F/U' => 'website', 'F / U는?' => 'website',
      'S/G' => 'website', 'S/G와 확뽑 최대 차이' => 'website', 'R' => 'tracks', 'G' => 'guaranteed'}.each do |query, id|
      result = guide.lookup('query' => query)
      expect(result.fetch('matched')).eq true
      expect(result.fetch('documents').first.fetch('id')).eq id
    end
    ['large', '111', 'x4진', 'ad옥', 'A/B/C', 'F/USER', 'GROW', 'q'].each do |query|
      result = guide.lookup('query' => query)
      expect(result.fetch('matched')).eq false
      expect(result.fetch('documents').first.fetch('id')).eq 'index'
    end
  end

  would 'deliver the answer section and required context without unrelated procedures' do
    guide = BattleCatsRolls::GptGuide.new
    cases = [
      ['4진 뜻', 'recommendations', %w[4진 초본능], ['NP와 중복 처리']],
      ['D옥에는 뭐가 필요해?', 'recommendations', ['장착 가능한 슬롯', '합성·교환'], ['캐릭터 비교']],
      ['S/G와 확뽑 최대 차이', 'website', ['배너 기본', '11연', '최대 한 번'], ['사이트로 이어주기', '플랜명 / 저장']],
      ['중복 울슈레 NP로 바꿀까', 'recommendations', %w[플러스 본능 보관], ['성능 후보 추천', '흑슬리', '트릭시']],
      ['레전드 티켓 언제 쓸까', 'banners', ['서로 다른 풀', '현재 시드', '대안 경로'], ['예정 배너 미리보기', 'previewFor']],
      ['이 스샷에서 R 뒤 어디로 가?', 'website', ['직전', '다음 뽑기가 34A', '다시 요구'], ['사이트로 이어주기', '플랜명 / 저장']],
      ['파레토와 탐욕 차이', 'find', ['0.14', '15%', 'partial', '통조림·현금'], ['nextConditionalQuery', '페이지 커서']],
      ['달력 아이콘은 뭐야?', 'find', ['종료일 제외', '기본', '시각'], ['nextConditionalQuery', 'paretoBudget']]
    ]
    cases.each do |query, id, required, excluded|
      result = guide.lookup('query' => query)
      expect(result.fetch('documents').first.fetch('id')).eq id
      expect(result.fetch('truncated')).eq false
      content = result.fetch('documents').map { |document| document.fetch('content') }.join
      required.each { |text| expect(content.include?(text)).eq true }
      excluded.each { |text| expect(content.include?(text)).eq false }
      expect(result.fetch('documents').first.fetch('contentMode')).eq 'sections'
      expect(result.fetch('documents').first.fetch('omittedSections').empty?).eq false
    end

    focused = guide.lookup('topic' => 'recommendations', 'query' => 'NP')
    expect(focused.fetch('documents').first.fetch('sections')).eq ['NP와 중복 처리']
    expect(focused.fetch('topics').size < guide.lookup({}).fetch('topics').size).eq true
    full = guide.lookup('topic' => 'recommendations')
    expect(full.fetch('documents').first.fetch('contentMode')).eq 'full'
    expect(full.fetch('documents').first.fetch('omittedSections')).eq []
    expect(full.fetch('documents').first.fetch('content')).eq File.read('doc/gpt-knowledge/recommendations.md', encoding: 'UTF-8')
  end

  would 'keep authored dependencies and fenced examples intact and validate section references' do
    Dir.mktmpdir do |root|
      guide_with(root)
      path = File.join(root, 'manifest.json')
      manifest = JSON.parse(File.read(path))
      document = manifest.fetch('documents').find { |item| item['id'] == 'tracks' }
      document['sections'] = [{'heading' => 'R 판독', 'keywords' => ['r'], 'include' => ['공통 조건']}]
      body = "# 표\n항상 전달할 조건.\n\n## 공통 조건\n직전 결과 필요.\n\n## R 판독\n```text\n```ruby\n## 가짜 제목\n```\n| R | next |\n\n## 무관한 절\n보내지 않음.\n"
      File.write(File.join(root, 'tracks.md'), body)
      File.write(path, JSON.generate(manifest))
      guide = BattleCatsRolls::GptGuide.new(root: root)
      result = guide.lookup('topic' => 'tracks', 'query' => 'R')
      content = result.fetch('documents').first.fetch('content')
      expect(content.include?('항상 전달할 조건')).eq true
      expect(content.include?('직전 결과 필요')).eq true
      expect(content.include?("```text\n```ruby\n## 가짜 제목\n```\n| R | next |")).eq true
      expect(content.include?('무관한 절')).eq false
      expect(result.fetch('documents').first.fetch('omittedSections')).eq ['무관한 절']
      document.fetch('sections').first['include'] = ['누락된 제목']
      File.write(path, JSON.generate(manifest))
      expect(raises?(BattleCatsRolls::GptGuide::InvalidManifest) { BattleCatsRolls::GptGuide.new(root: root) }).eq true
    end
  end
  would 'route section-only and table-only vocabulary without cross-word false positives' do
    guide = BattleCatsRolls::GptGuide.new
    {'레티 뜻' => ['glossary', '레어 티켓'], '레티 뭐야' => ['glossary', '레어 티켓'],
      '세2마' => ['glossary', '세이버'], '세2마춘은?' => ['glossary', '춘리'],
      '춘블발' => ['glossary', '발로그'], '양딜 뜻' => ['glossary', '양산 딜러'],
      '공무는?' => ['glossary', '공격 무효'], '원범 뜻' => ['glossary', '원거리 범위 공격'],
      '살남' => ['glossary', '살아남는다'], '레제로' => ['glossary', '레전드 제로'],
      '플랜 저장' => ['website', '저장 / 불러오기'], '최근 시드' => ['website', 'Last roll 구분'],
      '최근 seed' => ['website', 'Last roll 구분']}.each do |question, (topic, text)|
      result = guide.lookup('query' => question)
      expect(result.fetch('documents').first.fetch('id')).eq topic
      expect(result.fetch('documents').map { |doc| doc.fetch('content') }.join.include?(text)).eq true
      expect(result.fetch('unansweredSections')).eq []
    end
    Dir.mktmpdir do |root|
      guide_with(root)
      manifest_path = File.join(root, 'manifest.json')
      manifest = JSON.parse(File.read(manifest_path))
      track = manifest.fetch('documents').find { |doc| doc['id'] == 'tracks' }
      track['title'] = '지원 범위 안내문'
      track['keywords'] = []
      track['sections'] = [{'heading' => '약어', 'keywords' => []}]
      File.write(File.join(root, 'tracks.md'), "## 약어\n| 표현 | 의미 |\n| --- | --- |\n| 새약어 / 다른약어 | 검증된 뜻 |\n")
      File.write(manifest_path, JSON.generate(manifest))
      guide = BattleCatsRolls::GptGuide.new(root: root)
      ['원범', '원범위안내'].each do |question|
        expect(guide.lookup('query' => question).fetch('matched')).eq false
      end
      ['새약어', '다른약어 뜻'].each do |question|
        expect(guide.lookup('query' => question).fetch('documents').first.fetch('content').include?('검증된 뜻')).eq true
      end
    end
  end

  would 'preserve comparison facets and negative or progress constraints ahead of relative scores' do
    guide = BattleCatsRolls::GptGuide.new
    {
      'R과 RG 차이' => ['`R`', '`RG`'],
      'S/G와 F/U, 달력 차이' => ['## S/G', '## F/U', '달력'],
      '달력과 파레토, 플랜 저장 차이 알려줘' => ['달력', '파레토', '저장 / 불러오기'],
      '본능 없이 쓸만한 캐릭터' => ['investment="none"'],
      '본능 제외하고 추천해' => ['investment="none"', '성능 후보 추천'],
      '티켓 안 쓰고 올컬' => ['allowTicket', '기본 false', '한도를 0'],
      '특수티켓 없이 얻고싶어' => ['allow_ticket', '한도를 0'],
      '현재 시드가 없어요' => ['관측 기록을 아직 모으지 않았어도', 'mode="seek"'],
      '이미 뽑은 뒤' => ['현재 시드', '관측']
    }.each do |question, required|
      result = guide.lookup('query' => question)
      content = result.fetch('documents').map { |doc| doc.fetch('content') }.join
      required.each { |text| expect(content.include?(text)).eq true }
      expect(result.fetch('unansweredSections')).eq []
    end
    result = guide.lookup('query' => 'S/G와 F/U, 달력 차이')
    expect(result.fetch('documents').any? { |doc| doc.fetch('sections').size >= 3 }).eq true
  end

  would 'identify unanswered requested sections when document limits prevent complete coverage' do
    guide = BattleCatsRolls::GptGuide.new
    result = guide.lookup('query' => 'R G 차이', 'limit' => 1)
    expect(result.fetch('documents').size).eq 1
    pending = result.fetch('unansweredSections')
    expect(pending.empty?).eq false
    pending.each do |args|
      followup = guide.lookup(args).fetch('documents').first
      expect(followup.fetch('sections').include?(args.fetch('query'))).eq true
    end
  end

  would 'avoid unrelated full document fallback and fingerprint the exact guide corpus' do
    guide = BattleCatsRolls::GptGuide.new
    result = guide.lookup('query' => '어떤 캐릭터 추천해')
    expect(result.fetch('documents').map { |doc| doc.fetch('id') }).eq ['recommendations']
    expect(result.fetch('documents').sum { |doc| doc.fetch('content').length } < 2000).eq true
    expect(result.fetch('documents').first.fetch('content').include?('catsroll_recommend')).eq true
    summary = guide.lookup('topic' => 'find', 'query' => '아무관련없는질문').fetch('documents').first
    expect(summary.fetch('contentMode')).eq 'summary'
    expect(summary.fetch('sections')).eq []
    expect(summary.fetch('content').length < 500).eq true
    expect(summary.fetch('content').include?('시드와 게임 지역')).eq false
    expect(result.fetch('guideRevision')).eq BattleCatsRolls::GptGuide.new.lookup({}).fetch('guideRevision')
    Dir.mktmpdir do |root|
      first = guide_with(root).lookup('topic' => 'seed')
      path = File.join(root, 'seed.md')
      expect(first.fetch('documents').first.fetch('contentHash')).eq Digest::SHA256.hexdigest(File.read(path))
      File.write(path, File.read(path) + '새 안내')
      later = BattleCatsRolls::GptGuide.new(root: root).lookup('topic' => 'seed')
      expect(later.fetch('guideRevision') == first.fetch('guideRevision')).eq false
      # Same concatenated bytes, different per-document boundaries.
      before = BattleCatsRolls::GptGuide.new(root: root).lookup({})
      first_path, second_path = %w[index.md seed.md].map { |name| File.join(root, name) }
      first_text, second_text = [first_path, second_path].map { |path| File.read(path) }
      File.write(first_path, first_text[0...-1])
      File.write(second_path, first_text[-1] + second_text)
      after = BattleCatsRolls::GptGuide.new(root: root).lookup({})
      expect(after.fetch('guideRevision') == before.fetch('guideRevision')).eq false
    end
  end

  would 'normalize result-marker lists and bundle notation while keeping atomic controls and boundaries' do
    guide = BattleCatsRolls::GptGuide.new
    ['R과 RG 차이', 'R, G, RG 차이', 'R/G/RG 차이', 'R / G / RG 차이', 'RG/R 차이'].each do |question|
      data = guide.lookup('query' => question)
      text = data.fetch('documents').map { |doc| doc.fetch('content') }.join
      expect(text.include?('표의 `R`은 그 재추첨 결과')).eq true
      expect(text.include?('`RG`는 시작 결과')).eq true
      expect(data.fetch('unansweredSections')).eq []
      expect(data.fetch('query')).eq question
    end
    ['10+1 뜻', '10 + 1은 뭐야?', '１０＋１ 뜻'].each do |question|
      data = guide.lookup('query' => question)
      expect(data.fetch('documents').first.fetch('id')).eq 'guaranteed'
      text = data.fetch('documents').map { |doc| doc.fetch('content') }.join
      expect(text.include?('일반 11연과 확정 11연은 다르다')).eq true
      expect(text.include?('표기만으로 확정 여부를 판단하지')).eq true
      expect(data.fetch('documents').none? { |doc| doc['id'] == 'seed' }).eq true
    end
    question = 'R/G/RG 차이와 Last roll, S/G, F/U 알려줘'
    data = guide.lookup('query' => question)
    all_docs = data.fetch('documents') + data.fetch('unansweredSections').flat_map { |args| guide.lookup(args).fetch('documents') }
    text = all_docs.map { |doc| doc.fetch('content') }.join
    ['표의 `R`', '`RG`는 시작 결과', '## F/U', '## S/G', '직전 캐릭터 ID'].each { |required| expect(text.include?(required)).eq true }
    ['F/USER', 'A/B/C', 'xR/G/RG', 'x_R/G/RG', '한R/G/RG글', '110+1', '10+11', 'large', '111'].each do |question|
      expect(guide.lookup('query' => question).fetch('matched')).eq false
    end
  end

  would 'preserve seed failure and negative constraint families across natural wording' do
    guide = BattleCatsRolls::GptGuide.new
    groups = [
      [['시드 없어', '시드를 몰라요', '시드번호를 모르겠어요', '시드 숫자를 잘 모르겠는데', 'seed 번호가 없어요'],
        ['mode="seek"', '관측 기록을 아직 모으지 않았어도']],
      [['후보가 없어요', '후보가 안 나와요', '후보 0개래', '관측 10개 넣었는데 안 맞아', '시드 검색 실패했어', '관측 열 개 넣었는데 틀려'],
        ['## 검색 실패 분기', '더 뽑게 하지 말고', '지역·당시 배너·ID·순서']],
      [['티켓 없이 경로 찾아줘', '티켓 안 쓰고 경로 찾아줘', '티켓은 사용하지 않고 경로 찾아줘', '티켓을 쓰지 않고 경로 찾아줘', '티켓 제외해서 경로 찾아줘'],
        ['allow_ticket', '한도를 0', 'maxPlatinum']],
      [['본능 없이 추천해', '본능은 사용하지 않고 추천해', '본능을 쓰지 않고 추천해', '본능 투자하지 않고 추천해', '본능 제외하고 추천해'],
        ['investment="none"']]
    ]
    groups.each do |questions, required|
      questions.each do |question|
        data = guide.lookup('query' => question)
        text = data.fetch('documents').map { |doc| doc.fetch('content') }.join
        required.each { |value| expect(text.include?(value)).eq true }
        expect(data.fetch('unansweredSections')).eq []
        expect(data.fetch('query')).eq question
        expect(data.fetch('coverage')).eq 'recognized_guide_terms_only_not_full_language_understanding'
      end
    end
    # The scoped constraint classifier must not turn a positive request into a
    # prohibition or treat a missing character as a failed seed search.
    ['티켓을 사용해서 경로 찾아줘', '본능을 사용하고 추천해', '본능옥 없이 추천해', '후보 캐릭터를 추천해'].each do |question|
      normalized = guide.send(:normalize_query, question)
      expect(normalized.include?('티켓 없이')).eq false
      expect(normalized.include?('본능 없이')).eq false
      expect(normalized.include?('검색실패')).eq false
    end
  end

  would 'supply an actionable default or exact follow-up for summary recovery and keep authored headings reachable' do
    guide = BattleCatsRolls::GptGuide.new
    seed = guide.lookup('topic' => 'seed', 'query' => '아무 관련 없는 표현').fetch('documents').first
    expect(seed.fetch('sections')).eq ['관측 입력과 준비']
    expect(seed.fetch('content').include?('mode="seek"')).eq true
    summary = guide.lookup('topic' => 'find', 'query' => '아무 관련 없는 표현').fetch('documents').first
    expect(summary.fetch('contentMode')).eq 'summary'
    expect(summary.fetch('nextQueries').empty?).eq false
    summary.fetch('nextQueries').each do |args|
      expect(guide.lookup(args).fetch('documents').first.fetch('sections').include?(args.fetch('query'))).eq true
    end
    JSON.parse(File.read('doc/gpt-knowledge/manifest.json')).fetch('documents').each do |document|
      document.fetch('sections', []).each do |section|
        args = {'topic' => document.fetch('id'), 'query' => section.fetch('heading')}
        expect(guide.lookup(args).fetch('documents').first.fetch('sections').include?(section.fetch('heading'))).eq true
      end
    end
    Dir.mktmpdir do |root|
      guide_with(root)
      path = File.join(root, 'manifest.json')
      manifest = JSON.parse(File.read(path))
      manifest.fetch('documents').find { |doc| doc['id'] == 'seed' }['defaultSection'] = 'not registered'
      File.write(path, JSON.generate(manifest))
      expect(raises?(BattleCatsRolls::GptGuide::InvalidManifest) { BattleCatsRolls::GptGuide.new(root: root) }).eq true
    end
  end

end
