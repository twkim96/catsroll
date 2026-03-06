# frozen_string_literal: true

require_relative 'root'
require_relative 'route'

require 'promise_pool'

module BattleCatsRolls
  class SeekSeed < Struct.new(
    :source, :key, :logger, :cache, :done_callback,
    :promise, :seed, :previous_count)
    Pool = PromisePool::ThreadPool.new(1)
    Mutex = Mutex.new

    def self.processed
      @processed ||= 0
    end

    def self.finishing key
      Mutex.synchronize do
        yield
        queue.delete(key)
        @processed += 1
      end
    end

    def self.enqueue source, key, logger, cache, done_callback
      Mutex.synchronize do
        queue[key] ||= new(source, key, logger, cache, done_callback).start
      end
    end

    def self.queue
      @queue ||= {}
    end

    def start
      enqueue

      self
    end

    def started?
      promise.started?
    end

    def ended?
      promise.resolved?
    end

    def yield
      promise.yield
    end

    def position
      previous_count - self.class.processed + 1
    end

    private

    def enqueue
      self.previous_count = Pool.queue_size + self.class.processed
      self.promise = PromisePool::Promise.new.defer(Pool) do
        self.seed = cache[key] || seek

        self.class.finishing(key) do
          cache[key] = seed if $?.success?
          done_callback.call
        end
      end
    end

    def seek
      # logger.info("Seeking seed with #{source}")

      case seeker = source[/\A\S+/]
      when 'forgothowtoreddid', 'VampireFlower'
        suffix =
          case seeker
          when 'forgothowtoreddid'
            '8.6'
          else
            'VampireFlower'
          end

        IO.popen([
          "#{Root}/Seeker/Seeker-#{suffix}",
          *ENV['SEEKER_OPT'].to_s.split(' '), *source.split(' ').drop(1),
          err: %i[child out]], 'r+') do |io|
          io.close_write
          io.read.scan(/\d+/).map(&:to_i)
        end
      when 'godfat'
        IO.popen([
          "#{Root}/Seeker/Seeker",
          *ENV['SEEKER_OPT'].to_s.split(' '),
          err: %i[child out]], 'r+') do |io|
          io.puts source.sub(/\A\S+ /, '')
          io.close_write
          io.read.scan(/\d+/).map(&:to_i)
        end
      else
        []
      end
    rescue => error
      logger.warn(
        "Seeking seed failed with" \
        " #{error.class}:#{error.message} with #{source}")
      []
    end
  end
end
