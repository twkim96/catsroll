# frozen_string_literal: true

require 'json'

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
    PARTICLES = %w[으로부터 에게서 에서부터 으로부터 으로는 에서는 에게 한테 까지 부터 으로 은 는 이 가 을 를 와 과 도 만 로 의 에 랑 하고].sort_by { |word| -word.length }.freeze
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
    rescue JSON::ParserError, KeyError, TypeError => error
      raise InvalidManifest, "Invalid GPT guide manifest: #{error.message}"
    end

    def lookup(args)
      validate_args!(args)
      query = args['query']
      topic = args['topic']
      limit = args.fetch('limit', DEFAULT_LIMIT)

      if topic
        document = @documents.fetch(topic)
        return result(query, [document], true, 'topic')
      end

      terms = query_terms(query)
      compact = compact_query(query)
      ranked = @manifest.fetch('documents').reject { |document| document.fetch('id') == 'index' }.
        filter_map { |document| [document, score(document, terms, compact, query)] }.
        select { |_document, score_value| score_value >= 4 }.
        sort_by { |document, score_value| [-score_value, document.fetch('id')] }
      # limit is an upper bound, not a request to pad a precise answer with weak
      # matches (e.g. duplicate-rares guidance for an NP disposal question).
      best_score = ranked.first&.last || 0
      ranked = ranked.select { |_document, value| value >= best_score * 0.75 }.first(limit).map(&:first)
      return result(query, [@documents.fetch('index')], false, query.to_s.strip.empty? ? 'index' : 'fallback') if ranked.empty?

      result(query, ranked, true, 'matched')
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
              section.fetch('include', []).is_a?(Array) && section.fetch('include', []).all? { |heading| heading.is_a?(String) }
          }
          raise InvalidManifest, 'Sections need a heading, keywords, and optional included headings'
        end
        headings = sections.map { |section| section.fetch('heading') }
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
        missing = configured - headings
        raise InvalidManifest, "Missing section heading in #{file}: #{missing.first}" unless missing.empty?
      end
    end

    def result(query, selected, matched, status)
      remaining = MAX_CONTENT_LENGTH
      truncated = false
      documents = []
      selected.each do |document|
        if remaining.zero?
          truncated = true
          break
        end

        content, sections, omitted = focused_content(document, query)
        clipped = content.length > remaining
        content = content[0, remaining] if clipped
        remaining -= content.length
        truncated ||= clipped
        documents << {'id' => document.fetch('id'), 'title' => document.fetch('title'), 'content' => content,
          'related' => document.fetch('related'), 'truncated' => clipped,
          'contentMode' => omitted.empty? ? 'full' : 'sections', 'sections' => sections, 'omittedSections' => omitted}
        break if clipped
      end
      topic_ids = selected.flat_map { |document| [document.fetch('id')] + document.fetch('related') }.uniq
      topic_documents = selected.any? { |document| document.fetch('id') == 'index' } ? @manifest.fetch('documents') :
        topic_ids.map { |id| @documents.fetch(id) }
      topics = topic_documents.first(MAX_TOPICS).map do |document|
        {'id' => document.fetch('id'), 'title' => document.fetch('title'), 'summary' => document.fetch('summary')}
      end
      {'version' => @manifest.fetch('version'), 'query' => query, 'matched' => matched, 'status' => status,
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

    def focused_content(document, query)
      content = File.read(File.join(@root, document.fetch('file')), encoding: 'UTF-8')
      preamble, sections = split_sections(content)
      definitions = document.fetch('sections', [])
      return [content, sections.keys, []] if query.to_s.strip.empty? || definitions.empty? || document.fetch('id') == 'index'

      terms = query_terms(query)
      compact = compact_query(query)
      ranked = definitions.each_with_index.map do |section, index|
        record = {'id' => '', 'title' => section.fetch('heading'), 'summary' => '', 'keywords' => section.fetch('keywords')}
        [section, index, score(record, terms, compact, query, body_source: sections.fetch(section.fetch('heading')))]
      end.select { |_section, _index, value| value >= 4 }.
        sort_by { |_section, index, value| [-value, index] }
      best_score = ranked.first&.last || 0
      ranked = ranked.select { |_section, _index, value| value >= best_score * 0.5 }.first(MAX_SECTIONS).map(&:first)
      return [content, sections.keys, []] if ranked.empty?

      headings = ranked.flat_map { |section| [section.fetch('heading')] + section.fetch('include', []) }
      chosen = sections.keys.select { |heading| headings.include?(heading) }
      [preamble + chosen.map { |heading| sections.fetch(heading) }.join, chosen, sections.keys - chosen]
    end

    def query_terms(query)
      words = query.to_s.downcase.scan(/[가-힣]+|[a-z0-9]+/)
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
      body_source ||= File.read(File.join(@root, document.fetch('file')), encoding: 'UTF-8')
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
      primary = [title, id] + keywords
      score_value += 5 if phrase.length >= 4 && primary.any? { |value| value.include?(phrase) }
      score_value += 5 * keywords.count { |keyword| compact_keyword_match?(keyword, compact) }
      score_value += 12 * keyword_sources.count { |keyword|
        (searchable_tokens(keyword) & terms).empty? && registered_term_match?(keyword, query)
      }
      score_value
    end

    # Only registered short/mixed terms bypass ordinary token filtering. Require
    # word boundaries (including / and +), so rg in large and 11 in 111 stay false.
    def registered_term_match?(keyword, query)
      normalized = keyword.unicode_normalize(:nfkc).downcase.delete(' ')
      return false unless normalized.match?(/\A[가-힣a-z0-9\/+]+\z/) &&
        (normalized.length == 1 || normalized.match?(/\A[a-z0-9]{1,2}\z/) ||
          normalized.match?(/[가-힣]/) && normalized.match?(/[a-z0-9]/) || normalized.include?('/'))

      pattern = Regexp.escape(normalized).gsub('/', '\\s*/\\s*')
      suffixes = (PARTICLES + %w[이랑 이나 란 이란 뜻]).uniq.sort_by { |word| -word.length }.map { |word| Regexp.escape(word) }.join('|')
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

      field.include?(term)
    end
  end
end
