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
end
