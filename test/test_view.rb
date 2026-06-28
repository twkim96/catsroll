
require 'pork/auto'
require 'muack'
require 'battle-cats-rolls/view'
require 'battle-cats-rolls/route'
require 'battle-cats-rolls/request'

describe BattleCatsRolls::View do
  BattleCatsRolls::Route.reload_balls

  def view
    @view ||= BattleCatsRolls::View.new(route)
  end

  def route
    @route ||= BattleCatsRolls::Route.new(BattleCatsRolls::Request.new({}))
  end

  describe '#growth_rate' do
    would 'return the concise description' do
      # Gacha Cat
      expect(view.__send__(:growth_rate, [20, 20, 60, 120, 180])).eq \
        'lv2~20: 20%, lv21~30: 60%, lv31~40: 120%, lv41~50: 180%'

      # Pogo Cat
      expect(view.__send__(:growth_rate,
        [20, 20, 20, 20, 20, 20, 20, 10, 10, 5, 5, 5, 5])).eq \
        'lv2~70: 20%, lv71~90: 10%, lv91~130: 5%'

      # Crazed Titan Cat
      expect(view.__send__(:growth_rate, [20, 20, 10, 10, 10])).eq \
        'lv2~20: 20%, lv21~50: 10%'

      # Bahamut Cat
      expect(view.__send__(:growth_rate, [20, 20, 20, 10, 10])).eq \
        'lv2~30: 20%, lv31~50: 10%'
    end
  end

  describe 'with image display' do
    include Muack::API

    before{ Muack.reset }
    after{ Muack.verify }

    def cat
      @cat ||= BattleCatsRolls::Cat.new(id: 148,
        info: {'name' => ['Tin Cat'], 'desc' => []})
    end

    before do
      stub(route).name{ 0 }
      stub(route).lang{ 'en' }
      stub(route).display{ 'image' }
      stub(cat).img_src(0, 'en'){ '/avatar.png' }
    end

    describe '#link_to_roll' do
      would 'render correct avatar' do
        html = view.__send__(:link_to_roll, cat, image: true, text: false)

        expect(html).include?('class="track_avatar_wrap"')
        expect(html).include?('class="track_avatar_clip"')
        expect(html).include?('class="track_avatar"')
        expect(html).include?('src="/avatar.png"')
        expect(html).include?(%Q{alt="#{cat.name}"})
        expect(html).not.include?(">#{cat.name}<")
      end

      would 'call Cat#img_src only once for the same cat' do
        2.times do
          view.__send__(:link_to_roll, cat, image: true, text: false)
        end

        spy(cat).img_src(0, 'en')
        ok
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
    end

    describe '#link_to_next' do
      would 'render the image before the next-position arrow' do
        cat.next = BattleCatsRolls::Cat.new(track: 1, sequence: 11)
        html = view.__send__(:link_to_next, cat, image: true)

        image = html.index('src="/avatar.png"')
        arrow = html.index('-&gt; 11B')

        expect(image).lt arrow
      end
    end
  end

  describe '#td' do
    def cat
      BattleCatsRolls::Cat.new(
        id: 1,
        info: {'name' => ['Cat'], 'desc' => ['Cat']},
        rarity_seed: 123,
        slot_seed: 456)
    end

    would 'render expanded-result seed data for score cells' do
      html = view.__send__(:td, cat, :score, content: 'Cat')

      expect(html).include?('data-expand-kind="roll"')
      expect(html).include?('data-expand-rarity-seed="123"')
      expect(html).include?('data-expand-slot-seed="456"')
    end

    would 'render guaranteed kind for guaranteed score cells' do
      guaranteed = cat.new_with(extra_label: 'G')
      html = view.__send__(:td, guaranteed, :score, content: 'Cat')

      expect(html).include?('data-expand-kind="guaranteed"')
    end
  end

  describe '#found_cat_numbers' do
    def found_view
      request = BattleCatsRolls::Request.new('QUERY_STRING' => 'count=10')
      BattleCatsRolls::View.new(BattleCatsRolls::Route.new(request))
    end

    would 'link displayed positions and leave supplemental positions plain' do
      cat = BattleCatsRolls::FindCat::Found.new(
        cat: BattleCatsRolls::Cat.new(id: 1),
        numbers: %w[3A 4BG 142B])
      html = found_view.__send__(:found_cat_numbers, cat)

      expect(html).include?('<a href="#N3A">3A</a>')
      expect(html).include?('<a href="#N4B">4BG</a>')
      expect(html).include?('142B')
      expect(html).not.include?('#N142B')
    end
  end
end
