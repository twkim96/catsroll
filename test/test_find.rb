# frozen_string_literal: true

require 'battle-cats-rolls/test'
require 'nokogiri'

describe BattleCatsRolls::FindCat do
  include BattleCatsRolls::Test

  would 'find 4 Izanagi in found and zero from exclusive' do
    expect_request('/', 'seed=1&event=2026-10-16_1072&find=732') do |body|
      doc = Nokogiri::HTML.parse(body)
      found, exclusive = doc.css('.found_cats ul')
      expect(cleanup_text(found.css('li').text)).eq cleanup_text(<<~TEXT)
        Daybreaker Izanagi 🐾 : 335A
        Daybreaker Izanagi 🐾 : 791B
        Daybreaker Izanagi 🐾 : 913A
        Daybreaker Izanagi 🐾 : 999+
      TEXT

      exclusive_text = cleanup_text(exclusive.text)
      expect(exclusive_text).not.include?('Daybreaker Izanagi')
      expect(exclusive_text).include?('Baby Gao 🐾 : 3B')
      expect(doc.css('select[name="find"]').size).eq 2
    end
  end

  would 'find 5 Pogo Cat and 5 Wheel Cat' do
    expect_request('/',
      'seed=1&event=2026-11-09_926&find=38&find=39') do |body|
      doc = Nokogiri::HTML.parse(body)
      found, exclusive = doc.css('.found_cats ul')
      expect(cleanup_text(found.css('li').text)).eq cleanup_text(<<~TEXT)
        Pogo Cat 🐾 : 29A
        Pogo Cat 🐾 : 78A
        Pogo Cat 🐾 : 91B
        Pogo Cat 🐾 : 104A
        Pogo Cat 🐾 : 108B
        Wheel Cat 🐾 : 4B
        Wheel Cat 🐾 : 12B
        Wheel Cat 🐾 : 25A
        Wheel Cat 🐾 : 26B
        Wheel Cat 🐾 : 67B
      TEXT
      expect(doc.css('select[name="find"]').size).eq 3
    end
  end

  would 'drop find if the cat is not in the event' do
    expect_request('/', 'seed=1&event=2026-11-09_926&find=1',
      status: 302) do |body, header|
      expect(header['location']).not.include? 'find='
    end
  end

  would 'give nothing if there is nothing' do
    expect_request('/', 'seed=1&event=2026-10-26_926') do |body|
      doc = Nokogiri::HTML.parse(body)

      expect(cleanup_text(doc.css('.found_cats').text)).empty?
      expect(doc.css('select[name="find"]').size).eq 1
    end
  end
end
