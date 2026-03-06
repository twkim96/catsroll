
require 'pork/auto'
require 'battle-cats-rolls/stat'
require 'battle-cats-rolls/route'

describe BattleCatsRolls::Attack do
  BattleCatsRolls::Route.reload_balls

  def lang; 'en'; end
  def index; 0; end
  def stat
    @stat ||= BattleCatsRolls::Stat.new(
      id: id, index: index,
      info: BattleCatsRolls::Route.public_send("ball_#{lang}").cats[id])
  end

  describe '#area_type' do
    describe 'Koneko' do
      def id; 784; end

      would 'be Single range for main attack and rest triggered area attack' do
        main, *rest = stat.attacks

        expect(main.area_type).eq 'Single range'

        expect(rest.map do |attack|
          attack.class.name[/[^:]+(?=Attack$)/]
        end).eq %w[
          Wave
          Surge
          Surge
          Explosion
          Explosion
          Explosion
        ]

        rest.each do |attack|
          expect(attack.area_type).eq 'Area'
        end
      end
    end
  end
end
