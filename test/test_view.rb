
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

    describe '.generate_list' do
      def generate *sequence
        BattleCatsRolls::View.generate_list(
          sequence.map.with_index{ [_1.to_s, ('A'.ord + _2).chr] }
        )
      end

      would 'return an empty list for empty input' do
        expect(generate).eq []
      end

      would 'render a flat list with 1, 1' do
        list = generate(1, 1)

        expect(list).eq <<~HTML.lines.map(&:chomp)
          <ol><li><a href="#a">A</a>
          </li><li><a href="#b">B</a>
          </li></ol>
        HTML
      end

      would 'render a nested list with 1, 2, 3, 2, 1' do
        list = generate(1, 2, 3, 2, 1)

        expect(list).eq <<~HTML.lines.map(&:chomp)
          <ol><li><a href="#a">A</a>
          <ol><li><a href="#b">B</a>
          <ol><li><a href="#c">C</a>
          </li></ol></li><li><a href="#d">D</a>
          </li></ol></li><li><a href="#e">E</a>
          </li></ol>
        HTML
      end

      would 'wrap with a missing leading header with 2, 2' do
        list = generate(2, 2)

        expect(list).eq <<~HTML.lines.map(&:chomp)
          <ol><li>&nbsp;
          <ol><li><a href="#a">A</a>
          </li><li><a href="#b">B</a>
          </li></ol></li></ol>
        HTML
      end

      would 'fill a missing leading header with 2, 1' do
        list = generate(2, 1)

        expect(list).eq <<~HTML.lines.map(&:chomp)
          <ol><li>&nbsp;
          <ol><li><a href="#a">A</a>
          </li></ol></li><li><a href="#b">B</a>
          </li></ol>
        HTML
      end

      would 'fill a skipped header with 1, 3, 2, 2' do
        list = generate(1, 3, 2, 2)

        expect(list).eq <<~HTML.lines.map(&:chomp)
          <ol><li><a href="#a">A</a>
          <ol><li>&nbsp;
          <ol><li><a href="#b">B</a>
          </li></ol></li><li><a href="#c">C</a>
          </li><li><a href="#d">D</a>
          </li></ol></li></ol>
        HTML
      end

      would 'fill 2 missing headers with 3, 1, 2' do
        list = generate(3, 1, 2)

        expect(list).eq <<~HTML.lines.map(&:chomp)
          <ol><li>&nbsp;
          <ol><li>&nbsp;
          <ol><li><a href="#a">A</a>
          </li></ol></li></ol></li><li><a href="#b">B</a>
          <ol><li><a href="#c">C</a>
          </li></ol></li></ol>
        HTML
      end
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
end
