
require 'pork/auto'
require 'battle-cats-rolls/find_cat'

describe BattleCatsRolls::FindCat do
  def cat id, number
    sequence = number.to_i
    track = number[/[AB]\z/] == 'B' ? 1 : 0
    BattleCatsRolls::Cat.new(
      id: id, info: {'name' => [id.to_s], 'desc' => ['']},
      sequence: sequence, track: track)
  end

  def gacha *ids, rolls: []
    build_cat = method(:cat)
    pool = Object.new
    pool.define_singleton_method(:dig_cat) do |id|
      {'name' => [id.to_s], 'desc' => ['']}
    end

    Object.new.tap do |object|
      object.define_singleton_method(:rare_cats) do
        ids.map{ |id| build_cat.call(id, '1A') }
      end
      object.define_singleton_method(:supa_cats){ [] }
      object.define_singleton_method(:uber_cats){ [] }
      object.define_singleton_method(:legend_cats){ [] }
      object.define_singleton_method(:pool){ pool }
      object.define_singleton_method(:roll_both!) do |sequence|
        rolls.fetch(sequence) do
          [build_cat.call(0, "#{sequence}A"), build_cat.call(0, "#{sequence}B")]
        end
      end
    end
  end

  would 'retain upstream five-occurrence search when local features are loaded' do
    found = BattleCatsRolls::FindCat.search(gacha(1), 1,
      cats: [
        [cat(1, '1A'), cat(1, '1B')],
        [cat(1, '2A'), cat(1, '2B')],
        [cat(1, '3A'), cat(1, '3B')]
      ],
      max: 3)

    expect(found.keys).eq [1]
    expect(found[1].map(&:number)).eq %w[1A 1B 2A 2B 3A]
  end

  would 'keep upstream exclusive results at their first occurrence' do
    rolls = {
      3 => [cat(270, '3A'), cat(270, '3B')]
    }
    found = BattleCatsRolls::FindCat.search(gacha(270, rolls: rolls), 0,
      cats: [[cat(270, '1A'), cat(270, '1B')]], max: 4)

    expect(found.keys).eq [270]
    expect(found[270].map(&:number)).eq ['1A']
  end
end
