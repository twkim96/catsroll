
require 'pork/auto'
require 'battle-cats-rolls/view'

describe BattleCatsRolls::View do
  RouteStub = Struct.new(:lang, :name, :display, keyword_init: true) do
    def uri_to_cat cat
      "/cats/#{cat.id}"
    end

    def uri_to_roll cat
      "/?last=#{cat.id}"
    end
  end

  def view
    @view ||= BattleCatsRolls::View.new
  end

  def build_view lang: 'en', name: 0, display: 'both'
    BattleCatsRolls::View.new(RouteStub.new(lang: lang, name: name, display: display))
  end

  def build_cat id: 148, names: ['Tin Cat'], desc: ['Desc'], **args
    BattleCatsRolls::Cat.new({
      id: id,
      info: {
        'name' => names,
        'desc' => desc
      },
      sequence: 10,
      track: 0
    }.merge(args))
  end

  def stub_image_paths cat, *paths
    cat.define_singleton_method(:img_src) do |index, lang|
      path = format('/extract/%s/uni%03d_%s00.png',
        lang, id - 1, BattleCatsRolls::Provider.forms[index])
      paths.include?(path) ? path : BattleCatsRolls::Stat::EmptyImgSrc
    end
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

  describe '#link_to_roll' do
    would 'render thumbnail markup beside the unit name when an extracted image exists' do
      custom_view = build_view(lang: 'en', display: 'image')
      cat = build_cat

      stub_image_paths(cat, '/extract/en/uni147_f00.png')

      html = custom_view.__send__(:link_to_roll, cat, image: true)

      expect(html.include?('class="cat_link"')).eq true
      expect(html.include?('class="cat_track_thumb_clip"')).eq true
      expect(html.include?('class="cat_track_thumb"')).eq true
      expect(html.include?('/extract/en/uni147_f00.png')).eq true
      expect(html.include?('alt="Tin Cat"')).eq true
      expect(html.include?('>Tin Cat<')).eq true
    end
  end

  describe '#link_to_next' do
    would 'render the thumbnail before the next-position arrow text' do
      custom_view = build_view(lang: 'en')
      cat = build_cat(slot_fruit: Object.new,
        next: build_cat(id: 149, names: ['Rocker Cat'], sequence: 11, track: 1))

      stub_image_paths(cat, '/extract/en/uni147_f00.png')

      html = custom_view.__send__(:link_to_next, cat, image: true)

      expect(html.include?('class="cat_link"')).eq true
      expect(html.include?('-&gt; 11B')).eq true
      expect(html.include?('class="cat_track_thumb"')).eq true
    end
  end
end
