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
    end
  end
end
