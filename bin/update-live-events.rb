#!/usr/bin/env ruby
# frozen_string_literal: true

require 'date'
require 'fileutils'
require 'open-uri'
require 'open3'
require 'optparse'
require 'shellwords'
require 'tempfile'
require 'yaml'

require_relative '../lib/battle-cats-rolls/crystal_ball'
require_relative '../lib/battle-cats-rolls/tsv_reader'

module BattleCatsRolls
  class LiveEventsUpdater
    DEFAULT_LANG = 'kr'
    DEFAULT_REPO = File.expand_path('..', __dir__)
    USER_AGENT = 'catsroll-live-events-updater/1.0'

    Options = Struct.new(:repo, :lang, :url, :dry_run, :commit, :push_remotes, keyword_init: true)

    def self.main argv
      options = parse_options(argv)
      new(options).run
    end

    def self.parse_options argv
      options = Options.new(
        repo: ENV.fetch('CATSROLL_REPO', DEFAULT_REPO),
        lang: ENV.fetch('CATSROLL_LANG', DEFAULT_LANG),
        url: ENV['CATSROLL_TSV_URL'],
        dry_run: false,
        commit: false,
        push_remotes: []
      )

      parser = OptionParser.new do |opts|
        opts.banner = 'Usage: ruby bin/update-live-events.rb [lang] [options]'
        opts.on('--repo PATH', 'catsroll repository path') do |path|
          options.repo = path
        end
        opts.on('--url URL', 'live gatya.tsv URL') do |url|
          options.url = url
        end
        opts.on('--dry-run', 'download and parse without writing files') do
          options.dry_run = true
        end
        opts.on('--commit', 'commit updated live event files') do
          options.commit = true
        end
        opts.on('--push REMOTE', 'push main to a remote after update') do |remote|
          options.push_remotes << remote
        end
      end

      rest = parser.parse(argv)
      options.lang = rest.fetch(0, options.lang)
      options
    end

    def initialize options
      @repo = File.expand_path(options.repo)
      @lang = options.lang
      @url = options.url || "https://bc-seek.godfat.org/seek/#{@lang}/gatya.tsv"
      @dry_run = options.dry_run
      @commit = options.commit
      @push_remotes = options.push_remotes
      @written_paths = []
    end

    def run
      validate_repo!

      puts "[info] repo: #{@repo}"
      puts "[info] lang: #{@lang}"
      puts "[info] url: #{@url}"

      tsv = download_tsv
      reader = TsvReader.new(tsv)
      live_events = reader.gacha
      fail!('downloaded TSV has no rare gacha events') if live_events.empty?

      tsv_path = event_tsv_path(live_events)
      puts "[info] live events: #{live_events.size}"
      write_text(tsv_path, tsv)

      build_path = File.join(@repo, 'build', "bc-#{@lang}.yaml")
      data = load_build_yaml(build_path)
      merge_events(build_path, data, live_events)
      commit_and_push

      0
    rescue StandardError => e
      warn "[error] #{e.message}"
      1
    end

    private

    def validate_repo!
      fail!("repo not found: #{@repo}") unless Dir.exist?(@repo)
      fail!("not a catsroll repo: #{@repo}") unless File.exist?(File.join(@repo, 'lib', 'battle-cats-rolls', 'tsv_reader.rb'))
    end

    def download_tsv
      data = URI.open(@url, 'User-Agent' => USER_AGENT, &:read)
      unless data.include?("[start]\n") && data.include?("[end]\n")
        fail!('downloaded data does not look like gatya.tsv')
      end
      data
    end

    def event_tsv_path live_events
      dated_events = live_events.reject{ |_, event| event['platinum'] }
      dated_events = live_events if dated_events.empty?
      latest = dated_events.max_by{ |_, event| event.fetch('end_on') }
      date = latest.fetch(1).fetch('end_on').strftime('%Y%m%d')
      File.join(@repo, 'data', @lang, 'events', "#{date}.tsv")
    end

    def load_build_yaml path
      fail!("build YAML not found: #{path}") unless File.file?(path)

      YAML.safe_load_file(path, permitted_classes: [Date])
    end

    def merge_events build_path, data, live_events
      events = data.fetch('events')
      gacha = data.fetch('gacha')
      old_size = events.size
      added = live_events.keys.count{ |key| !events.key?(key) }
      changed = live_events.count{ |key, event| events[key] != event }
      missing_gacha = live_events.values.
        map{ |event| event.fetch('id') }.
        uniq.
        reject{ |id| gacha.key?(id) }.
        sort

      data['events'] = Hash[events.merge(live_events).sort]
      write_text(build_path, BattleCatsRolls::CrystalBall.new(data).dump_yaml)

      puts "[info] build events: #{old_size} -> #{data['events'].size}"
      puts "[info] added events: #{added}, changed events: #{changed - added}"
      if missing_gacha.any?
        warn "[warn] missing gacha pools for ids: #{missing_gacha.join(', ')}"
        warn '[warn] those events can appear in the list but cannot roll until app data is updated'
      end
    end

    def write_text path, text
      if @dry_run
        puts "[dry-run] would write #{relative(path)}"
        return
      end

      FileUtils.mkdir_p(File.dirname(path))
      Tempfile.create(File.basename(path), File.dirname(path)) do |tmp|
        tmp.write(text)
        tmp.flush
        FileUtils.mv(tmp.path, path)
      end
      @written_paths << path
      puts "[write] #{relative(path)}"
    end

    def commit_and_push
      return if @dry_run
      return unless @commit || @push_remotes.any?

      assert_git_main!
      tracked_paths = @written_paths.map(&method(:relative))

      if @commit
        run_git(['add', '--', *tracked_paths])
        if git_success?(['diff', '--cached', '--quiet', '--', *tracked_paths])
          puts '[info] no TSV/build changes to commit'
        else
          run_git(['commit', '-m', "data: update #{@lang} live events"])
        end
      end

      @push_remotes.each do |remote|
        run_git(['remote', 'get-url', remote], quiet: true)
        run_git(['push', remote, 'main'])
      end
    end

    def assert_git_main!
      fail!("not a git repo: #{@repo}") unless File.directory?(File.join(@repo, '.git'))

      current = capture_git(['branch', '--show-current']).strip
      fail!("expected branch main, got #{current.inspect}") unless current == 'main'
    end

    def run_git args, quiet: false
      command = ['git', *args]
      puts "\n$ #{Shellwords.join(command)}" unless quiet
      output, status = Open3.capture2e(git_env, *command, chdir: @repo)
      print output unless quiet || output.empty?
      fail!("git #{args.first} failed with exit code #{status.exitstatus}") unless status.success?
      output
    end

    def capture_git args
      run_git(args, quiet: true)
    end

    def git_success? args
      _output, status = Open3.capture2e(git_env, 'git', *args, chdir: @repo)
      status.success?
    end

    def git_env
      ENV.to_h.merge('GIT_TERMINAL_PROMPT' => '0')
    end

    def relative path
      path.delete_prefix("#{@repo}/")
    end

    def fail! message
      raise RuntimeError, message
    end
  end
end

exit(BattleCatsRolls::LiveEventsUpdater.main(ARGV))
