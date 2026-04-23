
require 'pork/auto'
require 'muack'
require 'battle-cats-rolls/cat'

describe BattleCatsRolls::Cat do
  def cat
    @cat ||= BattleCatsRolls::Cat.new(id: 38,
      info: {'name' => ['Pogo Cat'], 'desc' => []})
  end

  describe '#pick_img_src' do
    include Muack::API

    before{ Muack.reset }
    after{ Muack.verify }

    before do
      # Stub first 3 forms having an image, but not the 4th form
      forms = BattleCatsRolls::Provider.forms
      dir = "#{BattleCatsRolls::Root}/extract/asset/en"
      forms.first(3).each do |f|
        stub(File).exist?("#{dir}/uni037_#{f}00.png"){ true }
      end

      stub(File).exist?("#{dir}/uni037_#{forms[3]}00.png"){ false }
    end

    would 'return correct img src' do
      expect(cat.pick_img_src(0, 'en')).eq '/extract/en/uni037_f00.png'
    end

    would 'return fallback img src for non-existing form' do
      expect(cat.pick_img_src(3, 'en')).eq '/extract/en/uni037_s00.png'
    end
  end
end
