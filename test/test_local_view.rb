
require 'pork/auto'
require 'battle-cats-rolls/server'
require 'muack'

describe 'local view features' do
  include Muack::API

  BattleCatsRolls::Route.reload_balls

  def route
    @route ||= BattleCatsRolls::Route.new(
      BattleCatsRolls::Request.new('QUERY_STRING' => 'count=10'))
  end

  def view
    @view ||= BattleCatsRolls::View.new(route)
  end

  would 'fall back to text when avatar is unavailable' do
    missing = BattleCatsRolls::Cat.new(id: 149,
      info: {'name' => ['Missing Cat'], 'desc' => []})
    stub(missing).img_src(0, 'en'){ nil }

    html = view.__send__(:link_to_roll, missing, image: true, text: false)

    expect(html).not.include?('class="track_avatar_wrap"')
    expect(html).not.include?('class="track_avatar"')
    expect(html).include?('>Missing Cat<')
  end

  would 'render expanded-result seed data for score cells' do
    cat = local_cat
    html = view.__send__(:td, cat, :score, content: 'Cat')

    expect(html).include?('data-expand-kind="roll"')
    expect(html).include?('data-expand-rarity-seed="123"')
    expect(html).include?('data-expand-slot-seed="456"')
  end

  would 'render guaranteed kind for guaranteed score cells' do
    guaranteed = local_cat.new_with(extra_label: 'G')
    html = view.__send__(:td, guaranteed, :score, content: 'Cat')

    expect(html).include?('data-expand-kind="guaranteed"')
  end

  would 'link displayed positions and leave supplemental positions plain' do
    cat = BattleCatsRolls::FindCat::Found.new(
      cat: BattleCatsRolls::Cat.new(id: 1),
      numbers: %w[3A 4BG 142B])
    html = view.__send__(:found_cat_numbers, cat)

    expect(html).include?('<a href="#N3A">3A</a>')
    expect(html).include?('<a href="#N4B">4BG</a>')
    expect(html).include?('142B')
    expect(html).not.include?('#N142B')
  end

  def local_cat
    BattleCatsRolls::Cat.new(
      id: 1,
      info: {'name' => ['Cat'], 'desc' => ['Cat']},
      rarity_seed: 123,
      slot_seed: 456)
  end
end
