# frozen_string_literal: true

require 'json'
require 'digest'

module BattleCatsRolls
  # Small deterministic retrieval over the curated, local GPT guide corpus.
  class GptGuide
    MAX_QUERY_LENGTH = 300
    MAX_CONTENT_LENGTH = 16_000
    DEFAULT_LIMIT = 2
    MAX_LIMIT = 3
    MAX_TOPICS = 20
    MAX_SECTIONS = 2
    STOP_WORDS = %w[어떻게 무엇 어디 언제 방법 알려줘 알려주세요 부탁 설명 질문 뭐가 뭐야].freeze
    PARTICLES = %w[으로부터 에게서 에서부터 으로부터 으로는 에서는 에게 에서 한테 까지 부터 으로 은 는 이 가 을 를 와 과 도 만 로 의 에 랑 하고].sort_by { |word| -word.length }.freeze
    VERB_ENDINGS = %w[으려면 려면 으려고 려고 나요 니까 어요 아요 어서 아서 아줘 어줘 는].sort_by { |word| -word.length }.freeze

    class InvalidInput < ArgumentError; end
    class InvalidManifest < StandardError; end

    def initialize(root: File.expand_path('../../../doc/gpt-knowledge', __dir__))
      @root = File.expand_path(root)
      @manifest = JSON.parse(File.read(File.join(@root, 'manifest.json'), encoding: 'UTF-8'))
      validate_manifest!
      @documents = @manifest.fetch('documents').to_h { |document| [document.fetch('id'), document] }
      @root_realpath = File.realpath(@root)
      validate_document_paths!
      @corpus = @documents.transform_values { |document| build_document(document) }
      @revision = Digest::SHA256.hexdigest(JSON.generate([@manifest, @corpus.map { |id, entry| [id, entry[:content]] }]))
    rescue JSON::ParserError, KeyError, TypeError => error
      raise InvalidManifest, "Invalid GPT guide manifest: #{error.message}"
    end

    def lookup(args)
      validate_args!(args)
      query = normalize_query(args['query'])
      topic = args['topic']
      limit = args.fetch('limit', DEFAULT_LIMIT)

      task = task_sections(query)
      if task.any? && (!topic || task.any? { |id, _heading| id == topic })
        task += comparison_sections(query) if !topic && query.match?(/차이|비교|다르/)
        task += independent_clause_sections(query) unless topic
        task.uniq!
        task.select! { |id, _heading| id == topic } if topic
        required = task.filter_map do |id, heading|
          document = @documents[id]
          next unless document && @corpus.fetch(id)[:sections].key?(heading)

          {document: document, heading: heading}
        end
        unless required.empty?
          selected = required.map { |section| section[:document] }.uniq.first(limit)
          return result(args['query'], selected, true, topic ? 'topic' : 'matched', required, focused: true)
        end
      end

      if topic
        document = @documents.fetch(topic)
        required = section_matches(document, query).select { |section| !section[:hits].empty? }.map { |section| section.merge(document: document) }
        return result(args['query'], [document], true, 'topic', required)
      end

      candidates = @documents.values.reject { |document| document.fetch('id') == 'index' }
      terms = query_terms(query)
      compact = compact_query(query)
      document_scores = candidates.to_h { |document| [document.fetch('id'), score(document, terms, compact, query)] }
      ranked_sections = candidates.flat_map do |document|
        section_matches(document, query).map { |section| section.merge(document: document) }
      end
      # Preserve each explicitly named facet, even when its document/section is
      # weaker than the best match. Synonymous hits owned by multiple topics
      # choose one best explanation, rather than duplicating every definition.
      hits = ranked_sections.flat_map { |section| section[:hits] }.uniq
      # Keep the longest registered phrase at each query location. A separate R
      # remains covered beside RG, while 본능 is not a second facet inside 본능 없이.
      hits = hits.reject { |hit| hits.any? { |other| other != hit && other[0] <= hit[0] && other[1] >= hit[1] } }
      required = hits.filter_map do |hit|
        ranked_sections.select { |section| section[:hits].include?(hit) }.
          max_by { |section| [section[:definitions].include?(hit) ? 1 : 0, section[:score] + 2 * document_scores.fetch(section[:document]['id']), section[:score]] }
      end.uniq { |section| [section[:document]['id'], section[:heading]] }
      ranked = candidates.filter_map do |document|
        sections = ranked_sections.select { |section| section[:document] == document }
        value = 2 * document_scores.fetch(document['id']) + (sections.first&.fetch(:score) || 0)
        [document, value] if value >= 4
      end.sort_by { |document, value| [-value, document.fetch('id')] }
      return result(args['query'], [@documents.fetch('index')], false, query.to_s.strip.empty? ? 'index' : 'fallback') if ranked.empty?

      best = ranked.first.last
      required_ids = required.map { |section| section[:document]['id'] }.uniq
      eligible = ranked.select { |document, value| required_ids.include?(document['id']) || value >= best * 0.75 }
      # Coverage wins over a weak filler match; limit remains a hard upper bound.
      protected, fillers = eligible.partition { |document, _value| required_ids.include?(document['id']) }
      selected = (protected + fillers).first(limit).sort_by { |document, _value| ranked.index { |entry| entry.first == document } }.map(&:first)
      result(args['query'], selected, true, 'matched', required)
    end

    # Recovery for hosts that send a concept word to the character catalog.
    # Only authored definition terms or exact section names qualify; unknown
    # character names must remain ordinary empty catalog results.
    def definition(term)
      normalized = term.to_s.unicode_normalize(:nfkc).downcase.gsub(/\s+/, '')
      return nil if normalized.empty?

      owner = @corpus.find { |_id, entry|
        entry[:definition_terms].any? { |word| word.unicode_normalize(:nfkc).downcase.gsub(/\s+/, '') == normalized }
      }
      owner && lookup('topic' => owner.first, 'query' => term)
    end

    private

    def validate_args!(args)
      raise InvalidInput, 'arguments must be a string-keyed object' unless args.is_a?(Hash) && args.keys.all? { |key| key.is_a?(String) }
      unknown = args.keys - %w[query topic limit]
      raise InvalidInput, "unknown argument: #{unknown.first}" unless unknown.empty?

      query = args['query']
      if args.key?('query') && (!query.is_a?(String) || query.length > MAX_QUERY_LENGTH)
        raise InvalidInput, 'query must be a string of at most 300 characters'
      end
      if args.key?('topic') && (!args['topic'].is_a?(String) || !@documents.key?(args['topic']))
        raise InvalidInput, 'topic must be an exact manifest document id'
      end
      limit = args.fetch('limit', DEFAULT_LIMIT)
      raise InvalidInput, 'limit must be an integer from 1 to 3' unless limit.is_a?(Integer) && (1..MAX_LIMIT).cover?(limit)
    end

    def validate_manifest!
      unless @manifest.is_a?(Hash) && @manifest['version'] == 1 && @manifest['documents'].is_a?(Array)
        raise InvalidManifest, 'Manifest must have version 1 and a documents array'
      end

      docs = @manifest.fetch('documents')
      ids = docs.map do |document|
        unless document.is_a?(Hash) && %w[id title summary file].all? { |key| document[key].is_a?(String) } &&
            %w[keywords related].all? { |key| document[key].is_a?(Array) && document[key].all? { |item| item.is_a?(String) } }
          raise InvalidManifest, 'Each document needs id, title, summary, file, keywords, and related values'
        end
        document.fetch('id')
      end
      raise InvalidManifest, 'Manifest must contain one index document and unique ids' unless ids.count('index') == 1 && ids.uniq == ids
      docs.each do |document|
        missing = document.fetch('related') - ids
        raise InvalidManifest, "Unknown related document id: #{missing.first}" unless missing.empty?
        sections = document.fetch('sections', [])
        unless sections.is_a?(Array) && sections.all? { |section|
            section.is_a?(Hash) && section['heading'].is_a?(String) &&
              section['keywords'].is_a?(Array) && section['keywords'].all? { |word| word.is_a?(String) } &&
              section.fetch('include', []).is_a?(Array) && section.fetch('include', []).all? { |heading| heading.is_a?(String) } &&
              section.fetch('defines', []).is_a?(Array) && section.fetch('defines', []).all? { |word| word.is_a?(String) }
          }
          raise InvalidManifest, 'Sections need a heading, keywords, and optional included headings'
        end
        if document.key?('defaultSection') && !document['defaultSection'].is_a?(String)
          raise InvalidManifest, 'defaultSection must be an authored heading'
        end
        headings = sections.map { |section| section.fetch('heading') }
        if document.key?('defaultSection') && !headings.include?(document['defaultSection'])
          raise InvalidManifest, 'defaultSection must be a registered section'
        end
        raise InvalidManifest, 'Section headings must be unique' unless headings.uniq == headings
      end
    end

    def validate_document_paths!
      @manifest.fetch('documents').each do |document|
        file = document.fetch('file')
        unless file.match?(/\A[a-zA-Z0-9][a-zA-Z0-9._-]*\.md\z/)
          raise InvalidManifest, "Document file must be a Markdown filename: #{file}"
        end

        path = File.expand_path(file, @root)
        unless File.dirname(path) == @root && File.file?(path) && File.dirname(File.realpath(path)) == @root_realpath
          raise InvalidManifest, "Document file must resolve under the guide root: #{file}"
        end
        headings = split_sections(File.read(path, encoding: 'UTF-8')).last.keys
        configured = document.fetch('sections', []).flat_map { |section| [section.fetch('heading')] + section.fetch('include', []) }
        configured += [document.fetch('defaultSection')] if document.key?('defaultSection')
        missing = configured - headings
        raise InvalidManifest, "Missing section heading in #{file}: #{missing.first}" unless missing.empty?
      end
    end

    def result(query, selected, matched, status, required = [], focused: false)
      remaining = MAX_CONTENT_LENGTH
      truncated = false
      documents = []
      selected.each do |document|
        if remaining.zero?
          truncated = true
          break
        end

        wanted = required.select { |section| section[:document] == document }.map { |section| section[:heading] }
        content, sections, omitted, mode = focused_content(document, query, wanted, focused: focused)
        clipped = content.length > remaining
        content = content[0, remaining] if clipped
        remaining -= content.length
        truncated ||= clipped
        documents << {'id' => document.fetch('id'), 'title' => document.fetch('title'), 'content' => content,
          'related' => document.fetch('related'), 'truncated' => clipped,
          'contentMode' => mode, 'sections' => sections, 'omittedSections' => omitted,
          'contentHash' => Digest::SHA256.hexdigest(@corpus.fetch(document.fetch('id'))[:content]),
          'nextQueries' => mode == 'summary' ? document.fetch('sections', []).first(1).map { |section|
            {'topic' => document.fetch('id'), 'query' => section.fetch('heading')}
          } : []}
        break if clipped
      end
      topic_ids = selected.flat_map { |document| [document.fetch('id')] + document.fetch('related') }.uniq
      topic_documents = selected.any? { |document| document.fetch('id') == 'index' } ? @manifest.fetch('documents') :
        topic_ids.map { |id| @documents.fetch(id) }
      topics = topic_documents.first(MAX_TOPICS).map do |document|
        {'id' => document.fetch('id'), 'title' => document.fetch('title'), 'summary' => document.fetch('summary')}
      end
      pending = required.reject { |section| documents.any? { |document|
        document['id'] == section[:document]['id'] && !document['truncated'] && document['sections'].include?(section[:heading])
      } }.map { |section| {'topic' => section[:document]['id'], 'query' => section[:heading]} }.uniq
      {'guideRevision' => @revision, 'unansweredSections' => pending,
       'version' => @manifest.fetch('version'), 'query' => query, 'matched' => matched, 'status' => status,
       'coverage' => 'recognized_guide_terms_only_not_full_language_understanding',
       'documents' => documents, 'topics' => topics, 'truncated' => truncated}
    end

    # ## is the authored retrieval boundary. Keep tables, lists and ### examples
    # intact; a heading inside a fenced code block is ordinary content.
    def split_sections(content)
      preamble = +''
      sections = {}
      current = preamble
      fence = nil
      content.each_line do |line|
        if line =~ /^\s{0,3}(`{3,}|~{3,})/
          marker = Regexp.last_match(1)
          if fence
            fence = nil if marker[0] == fence[0] && marker.length >= fence.length &&
              line.match?(/^\s{0,3}[`~]+[\t ]*$/)
          else
            fence = marker
          end
        end
        if !fence && line =~ /^## (.+?)\s*$/
          heading = Regexp.last_match(1)
          raise InvalidManifest, "Duplicate section heading: #{heading}" if sections.key?(heading)
          current = sections[heading] = +''
        end
        current << line
      end
      [preamble, sections]
    end

    def build_document(document)
      content = File.read(File.join(@root, document.fetch('file')), encoding: 'UTF-8')
      preamble, sections = split_sections(content)
      definition_terms = sections.keys.select { |heading| heading.match?(/\A[가-힣a-zA-Z0-9_\/ ]{1,30}\z/) }
      records = document.fetch('sections', []).map do |definition|
        heading = definition.fetch('heading')
        body = sections.fetch(heading)
        # A glossary table's authored first column registers its terms. This
        # avoids maintaining the same term list in a second manifest location.
        table_terms = body.lines.filter_map { |line| line[/^\| ([^|]+) \|/, 1] }.
          reject { |cell| cell.match?(/\A[- :]+\z/) || cell == '표현' }.
          flat_map { |cell| cell.delete('`*').split(/\s+\/\s+/) }
        definition_terms.concat(table_terms)
        definition.merge('keywords' => (definition.fetch('keywords') + table_terms).uniq { |word| word.unicode_normalize(:nfkc).downcase.delete(' ') })
      end
      {content: content, preamble: preamble, sections: sections, records: records, definition_terms: definition_terms.uniq}
    end

    def section_matches(document, query)
      query = normalize_query(query)
      return [] if query.to_s.strip.empty?

      entry = @corpus.fetch(document.fetch('id'))
      terms = query_terms(query)
      compact = compact_query(query)
      entry[:records].map do |section|
        heading = section.fetch('heading')
        record = {'id' => '', 'title' => heading, 'summary' => '', 'keywords' => section.fetch('keywords')}
        hits = section.fetch('keywords').flat_map { |keyword| exact_keyword_matches(keyword, query) }.uniq
        value = score(record, terms, compact, query, body_source: entry[:sections].fetch(heading)) + hits.length * (document.fetch('id') == 'glossary' ? 4 : 8)
        definitions = section.fetch('defines', []).flat_map { |keyword| exact_keyword_matches(keyword, query) }
        {heading: heading, score: value, hits: hits, definitions: definitions, include: section.fetch('include', [])}
      end.select { |section| section[:score] >= 4 }.sort_by { |section| -section[:score] }
    end

    def focused_content(document, query, required, focused: false)
      entry = @corpus.fetch(document.fetch('id'))
      content, sections = entry.values_at(:content, :sections)
      return [content, sections.keys, [], 'full'] if query.to_s.strip.empty? || entry[:records].empty? || document.fetch('id') == 'index'

      ranked = section_matches(document, query)
      best = ranked.first&.fetch(:score) || 0
      chosen = focused ? [] : ranked.select { |section| section[:score] >= best * 0.5 }.first(MAX_SECTIONS).map { |section| section[:heading] }
      headings = (chosen + required).uniq
      headings += entry[:records].select { |section| headings.include?(section['heading']) }.flat_map { |section| section.fetch('include', []) }
      chosen = sections.keys.select { |heading| headings.include?(heading) }
      if chosen.empty? && document['defaultSection']
        chosen = [document.fetch('defaultSection')]
        chosen += entry[:records].find { |section| section['heading'] == chosen.first }.fetch('include', [])
        chosen = sections.keys.select { |heading| chosen.include?(heading) }
      end
      if chosen.empty?
        summary = "# #{document.fetch('title')}\n\n#{document.fetch('summary')}\n"
        return [summary, [], sections.keys, 'summary']
      end
      [entry[:preamble] + chosen.map { |heading| sections.fetch(heading) }.join, chosen, sections.keys - chosen, 'sections']
    end

    # Exact registered phrases allow spacing and Korean particles but cannot
    # start halfway through a word (원범 must not match 지원 범위).
    def exact_keyword_matches(keyword, query)
      normalized = keyword.unicode_normalize(:nfkc).downcase.delete(' ')
      return [] unless normalized.match?(/\A[가-힣a-z0-9_\/+]+\z/)

      pattern = Regexp.escape(normalized).gsub('/', '\\s*/\\s*').gsub('\\+') { '\\s*\\+\\s*' }
      # Compact registered Korean phrases accept optional spacing. Pure ASCII
      # identifiers stay intact: R G denotes two facets, not RG.
      pattern = normalized.chars.map { |char| Regexp.escape(char) }.join('\\s*') if normalized.match?(/[가-힣]/)
      suffixes = (PARTICLES + %w[이랑 이나 란 이란 뜻 이면 인지]).uniq.sort_by { |word| -word.length }.map { |word| Regexp.escape(word) }.join('|')
      text = query.to_s.unicode_normalize(:nfkc).downcase
      text.enum_for(:scan, /(?<![가-힣a-z0-9_\/+])(#{pattern})(?:(?:#{suffixes})(?:은|는|도|만)?)?(?![가-힣a-z0-9_\/+])/).map {
        match = Regexp.last_match
        [match.begin(1), match.end(1)]
      }
    end

    # Normalize domain notation and constraint families before ranking, rather
    # than registering complete user sentences. Keep the original query in replies.
    def normalize_query(query)
      return query if query.nil?

      text = query.unicode_normalize(:nfkc).downcase.gsub(/\blast\s+roll\b/, 'lastroll')
      # These are a list of result markers, unlike the atomic controls F/U, S/G.
      text = text.gsub(/(?<![가-힣a-z0-9_\/+])(?:rg|r|g)(?:\s*\/\s*(?:rg|r|g))+(?=(?:은|는|와|과|이|가|을|를)?(?:[^가-힣a-z0-9_\/+]|$))/) { |markers| markers.tr('/', ' ') }
      # Normalize the subject noun separately so particles and wording changes
      # do not hide a missing seed or a failure after observation input.
      text = text.gsub(/(?:시드|seed)\s*(?:번호|숫자)/, '시드')
      additions = []
      additions << '시드없' if text.match?(/(?:시드|seed)(?:은|는|이|가|을|를|도)?\s*(?:(?:아직|잘)\s*)?(?:몰라|모르|없)/)
      if text.match?(/시드|seed|관측|후보/) && text.match?(/후보(?:은|는|이|가)?\s*(?:없|0\s*개)|안\s*(?:맞|돼|되|나오|나와)|틀리|틀려|실패|못\s*찾/)
        additions << '검색실패'
      end
      negative = /(?:없이|제외|빼고|금지|못\s*(?:쓰|써|사용)|(?:사용|투자|포함|소모)\s*하지\s*(?:않|말)|쓰지\s*(?:않|말)|안\s*(?:쓰|사용|넣))/
      {'티켓' => '티켓 없이', '본능' => '본능 없이'}.each do |noun, canonical|
        additions << canonical if text.match?(/#{noun}(?:은|는|을|를|도)?\s*#{negative}/)
      end
      additions << '티켓 없이' if text.match?(/(?:플티|블티)(?:\s*\/\s*(?:플티|블티))?(?:은|는|을|를|도)?\s*(?:이제\s*)?#{negative}/)
      ([text] + additions.reject { |addition| text.include?(addition) }).join(' ')
    end

    # Route only recognizable task/constraint combinations. Ordinary terms and
    # comparisons still use the authored facet ranking above.
    def task_sections(query)
      text = query.to_s
      return [] if @corpus.values.any? { |entry| entry[:sections].key?(text.strip) }

      tasks = []
      find = 'find'
      details = [find, '결과 상세 조회와 페이지 커서']
      fields = [find, '결과 필드·총 뽑기 수·생략 범위']
      recovery = ['troubleshooting', '계산·보관·전달·추가 조회 실패']
      constraint = [find, '입력으로 강제하는 조건과 결과에서 확인할 조건']
      if text.match?(/(?:필터|깔때기)/) && text.match?(/(?:배너|시리즈)/) && text.match?(/목표/) && text.match?(/차이|다르|비교/)
        tasks.concat([['website', '배너 추가·삭제·시리즈 필터·Custom name'], ['website', '목표 선택 깔때기·선택한 캐릭터']])
      end
      if text.match?(/(?:평가|티어|등급|추천)/) && text.match?(/(?:출처|링크|나머지|나머진|미평가|d급|전체|전부|5\s*(?:종|마리))/i)
        tasks.concat([['recommendations', '티어와 투자 조건'], ['recommendations', '실제 배너에서 획득']])
      end
      if text.match?(/(?:울슈레|울레)/) && text.match?(/(?:고유|서로\s*다른|종류|중복.*싫)/)
        tasks.concat([[find, '기존 배열에서 울슈레 수확 비교'], constraint])
      end
      if text.match?(/(?:추가\s*단뽑|단뽑.*(?:금지|없이|안\s*돼|못))/) ||
          (text.match?(/(?:못\s*(?:쓰|써|사용)|금지|철회)/) && text.match?(/(?:티켓|플티|블티|확뽑)/))
        tasks.concat([constraint, [find, '초심자에게 물을 것']])
      end
      if text.match?(/(?:만료|저장.*(?:성공|됐|되었)|공유.*성공|전달.*실패|메시지.*실패|result.*(?:없|불가|미공개)|mcp.*(?:없|불가))/i)
        tasks.concat([recovery, details])
      end
      if text.match?(/(?:partial|탐색\s*한도)/i) && text.match?(/(?:목표|최적|결과|완료)/)
        tasks << [find, '결과의 한계']
      end
      if text.match?(/(?:조건부|분기|conditional)/i) && text.match?(/(?:생략|누락|전부|확인)/)
        tasks.concat([fields, details])
      end
      screenshot_id_question = text.match?(/(?:스크린샷|스샷|화면).*(?:결과\s*(?:id|아이디)).*(?:필요|있어야)/i)
      if !screenshot_id_question && text.match?(/(?:공유|기존|이전|아까|같은|현재).{0,20}(?:결과|배열)|결과\s*(?:id|아이디)/i) &&
          text.match?(/(?:보|조회|찾|골라|어디|줄|행|캐릭터|고양이|말고|만|추가|비교)/)
        tasks << details
        if text.match?(/(?:이번|새|변경|추가)/) && text.match?(/(?:추가|바꿔|변경|늘려)/) && text.match?(/(?:플티|블티|티켓|배너|예산)/) && !text.match?(/(?:추가\s*단뽑\s*(?:금지|없이))/)
          tasks << [find, '준비와 설명']
        end
      end
      tasks.uniq
    end

    def comparison_sections(query)
      terms = query_terms(query)
      compact = compact_query(query)
      document_scores = @documents.transform_values { |document| score(document, terms, compact, query) }
      sections = @documents.values.flat_map do |document|
        section_matches(document, query).map { |section| section.merge(document: document) }
      end
      ambiguous = /\A(?:배너|링크|중복|전부|공유|시드|seed|목표|추가|티켓|플티|블티|확뽑|생략|조건부|추천|평가)\z/i
      hits = sections.flat_map { |section| section[:hits] }.uniq.reject do |start_pos, end_pos|
        query[start_pos...end_pos].delete(' ').match?(ambiguous)
      end
      hits = hits.reject { |hit| hits.any? { |other| other != hit && other[0] <= hit[0] && other[1] >= hit[1] } }
      hits.filter_map do |hit|
        owner = sections.select { |section| section[:hits].include?(hit) }.
          max_by { |section| [section[:definitions].include?(hit) ? 1 : 0, section[:score] + 2 * document_scores.fetch(section[:document]['id']), section[:score]] }
        [owner[:document]['id'], owner[:heading]] if owner
      end.uniq
    end

    # A separate question may name an independent facet without saying
    # "compare". Do not re-score nouns belonging to the recognized task.
    def independent_clause_sections(query)
      clauses = query.split(/[.!?;\n]+|(?<=[가-힣])고\s+(?=[가-힣a-z])/i).map(&:strip).reject(&:empty?)
      return [] if clauses.size < 2

      clauses.select { |clause| task_sections(clause).empty? }.
        flat_map { |clause| comparison_sections(clause) }.uniq
    end

    def query_terms(query)
      words = query.to_s.downcase.scan(/[a-z0-9]+(?:\s*[\/+]\s*[a-z0-9]+)+|[가-힣]+|[a-z0-9]+/).map { |word| word.delete(' ') }
      words.filter_map do |word|
        normalized = strip_particle(word)
        normalized = normalize_verb(normalized)
        next if normalized.length < 2 || STOP_WORDS.include?(normalized)

        normalized
      end.uniq
    end

    def strip_particle(word)
      PARTICLES.each do |particle|
        next unless word.end_with?(particle) && word.length - particle.length >= 2

        return word[0, word.length - particle.length]
      end
      word
    end

    def normalize_verb(word)
      VERB_ENDINGS.each do |ending|
        next unless word.end_with?(ending) && word.length - ending.length >= 1

        return "#{word[0, word.length - ending.length]}기"
      end
      word
    end

    def score(document, terms, compact, query, body_source: nil)
      title_source = document.fetch('title')
      id_source = document.fetch('id').tr('_-', ' ')
      keyword_sources = document.fetch('keywords')
      summary_source = document.fetch('summary')
      body_source ||= @corpus.fetch(document.fetch('id'))[:content]
      title = searchable(title_source)
      id = searchable(id_source)
      keywords = keyword_sources.map { |value| searchable(value) }
      summary = searchable(summary_source)
      body = searchable(body_source)
      title_words = searchable_tokens(title_source)
      id_words = searchable_tokens(id_source)
      keyword_words = keyword_sources.map { |value| searchable_tokens(value) }
      summary_words = searchable_tokens(summary_source)
      body_words = searchable_tokens(body_source)
      score_value = terms.sum do |term|
        if includes_term?(title, term, title_words) || includes_term?(id, term, id_words)
          6
        elsif keywords.each_with_index.any? { |value, index| includes_term?(value, term, keyword_words[index]) }
          5
        elsif includes_term?(summary, term, summary_words)
          3
        elsif includes_term?(body, term, body_words)
          1
        else
          0
        end
      end

      phrase = terms.join
      # Compact matching is intentional for registered keywords, but ordinary
      # titles/IDs must not synthesize phrases across word boundaries.
      primary = title_words + id_words + keywords
      score_value += 5 if phrase.length >= 4 && primary.any? { |value| value.include?(phrase) }
      score_value += 5 * keywords.count { |keyword| compact_keyword_match?(keyword, compact) }
      score_value += 12 * keyword_sources.count { |keyword|
        (searchable_tokens(keyword) & terms).empty? && registered_term_match?(keyword, query)
      }
      score_value += 20 if document.key?('file') && exact_keyword_matches(title_source, query).any?
      # Authored title tokens identify concept owners (R in tracks), while a
      # passing mention in a broad screenshot document does not redefine it.
      score_value += 6 if document.key?('file') && title_source.split(/[ ,·]+/).any? { |word| word.match?(/\A[a-z]{1,2}\z/i) && exact_keyword_matches(word, query).any? }
      score_value
    end

    # Only registered short/mixed terms bypass ordinary token filtering. Require
    # word boundaries (including / and +), so rg in large and 11 in 111 stay false.
    def registered_term_match?(keyword, query)
      normalized = keyword.unicode_normalize(:nfkc).downcase.delete(' ')
      return false unless normalized.match?(/\A[가-힣a-z0-9\/+]+\z/) &&
        (normalized.length == 1 || normalized.match?(/\A[a-z0-9]{1,2}\z/) ||
          normalized.match?(/[가-힣]/) && normalized.match?(/[a-z0-9]/) || normalized.include?('/') || normalized.include?('+'))

      pattern = Regexp.escape(normalized).gsub('/', '\\s*/\\s*').gsub('\\+') { '\\s*\\+\\s*' }
      suffixes = (PARTICLES + %w[이랑 이나 란 이란 뜻 이면 인지]).uniq.sort_by { |word| -word.length }.map { |word| Regexp.escape(word) }.join('|')
      query.to_s.unicode_normalize(:nfkc).downcase.match?(/(?<![가-힣a-z0-9\/+])#{pattern}(?:(?:#{suffixes})(?:은|는|도|만)?)?(?![가-힣a-z0-9\/+])/)
    end

    def compact_query(query)
      query.to_s.downcase.scan(/[가-힣]+|[a-z0-9]+/).join
    end

    def compact_keyword_match?(keyword, compact)
      return false if keyword.empty?
      return compact == keyword if keyword.match?(/\A[a-z0-9]+\z/)
      return false unless keyword.match?(/[가-힣]/) && keyword.scan(/[가-힣]/).length >= 2

      compact.include?(keyword)
    end

    def searchable(value)
      searchable_tokens(value).join
    end

    def searchable_tokens(value)
      value.downcase.scan(/[가-힣]+|[a-z0-9]+/).map { |word| strip_particle(word) }
    end

    def includes_term?(field, term, words)
      return false if term.length < 2
      return words.include?(term) if term.match?(/\A(?:[a-z]{1,2}|[0-9]+)\z/)

      words.any? { |word| word.include?(term) }
    end
  end
end
