# frozen_string_literal: true

require 'date'

require_relative 'gacha_pool'

module BattleCatsRolls
  class TsvReader < Struct.new(:tsv)
    PoolOffset = 9
    PoolFields = 15

    def self.read path
      new(File.read(path))
    end

    def self.event_fields
      @event_fields ||= {
        'start_on' => 0, 'end_on' => 2, 'version' => 4,
        'type' => 8, 'offset' => PoolOffset
      }
    end

    def self.pool_fields
      @pool_fields ||= {
        'id' => 0, 'step_up' => 3,
        'rare' => 6, 'supa' => 8, 'uber' => 10,
        'guaranteed' => 11, 'legend' => 12, 'name' => 14
      }
    end

    def self.voodoo_fields
      @voodoo_fields ||= {
        'end_on' => 2, 'type' => 3, 'offset' => 9
      }
    end

    def == rhs
      gacha == rhs.gacha
    end

    def gacha
      @gacha ||= parsed_data.inject({}) do |result, row|
        data = convert_event(read_event(row, self.class.event_fields))

        if data.delete('type') == 1 # rare gacha
          pool = data.delete('pool')[data.delete('offset') - 1]
          data['name'] = pool['name']

          if pool['id'] > 0
            data.merge!(pool)
            data['step_up'] = true if data.delete('step_up') # reorder

            case GachaPool::Base
            when data['uber']
              data['platinum'] = 'platinum'
            when data['uber'] + data['legend']
              data['platinum'] = if 365 <= (data['end_on'] - data['start_on'])
                'legend'
              else
                'dl-100m'
              end
            end

            data.delete('legend') if data['legend'] == 0

            result["#{data['start_on']}_#{data['id']}"] = data
          end
        end

        result
      end
    end

    def gacha_option
      @gacha_option ||= parsed_data.drop(1).inject({}) do |result, row|
        result[Integer(row.first)] = { 'series_id' => Integer(row[5]) }
        result
      end
    end

    def item_or_sale
      @item_or_sale ||= parsed_data.map.with_index do |row, index|
        { 'index' => index }.merge(
          convert_event(read_row(row, self.class.voodoo_fields))
        )
      end.select do |item|
        item['type'] > 0 && item['offset'] > 0
      end.group_by { |item| item['index'] }.transform_values(&:last)
    end

    private

    def convert_event data
      data.transform_values do |(key, value)|
        case key
        when 'start_on', 'end_on'
          Date.parse(value)
        when 'type', 'offset'
          value.to_i
        when 'pool'
          convert_pool(value)
        else
          value
        end || nil
      end.compact
    end

    def convert_pool data
      data.map do |pool|
        pool.transform_values do |(key, value)|
          case key
          when 'id', 'rare', 'supa', 'uber', 'legend'
            value.to_i
          when 'step_up'
            value.to_i & 4 == 4
          when 'guaranteed'
            value.to_i > 0
          when 'name'
            value.strip
          else
            value
          end || nil
        end.compact
      end
    end

    def read_event row, event_fields
      result = read_row(row, event_fields)

      pool_data = extract_pool(row).map do |pool_row|
        if pool_row.size == PoolFields
          read_row(pool_row, self.class.pool_fields)
        end
      end.compact

      result['pool'] = ['pool', pool_data]
      result
    end

    def read_row row, row_fields
      Hash[
        row_fields.keys.zip(
          row_fields.keys.zip(
            row.values_at(*row_fields.values)))]
    end

    def extract_pool row
      row.drop(PoolOffset + 1).each_slice(PoolFields)
    end

    def parsed_data
      @parsed_data ||= tsv.lines.inject([]) do |result, line|
        if line.start_with?('[') # ignore [start] and [end]
          result
        else
          result << line.split("\t")
        end
      end
    end
  end
end
