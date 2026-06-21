
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

  would 'show all positions already present in displayed cats' do
    found = BattleCatsRolls::FindCat.new(gacha(1), [1]).search(
      cats: [
        [cat(1, '1A'), cat(2, '1B')],
        [cat(2, '2A'), cat(1, '2B')],
        [cat(1, '3A'), cat(2, '3B')]
      ],
      max: 3)

    expect(found.size).eq 1
    expect(found.first.id).eq 1
    expect(found.first.number).eq '1A, 2B, 3A'
  end

  would 'keep supplemental search to the first position beyond displayed cats' do
    rolls = {
      3 => [cat(1, '3A'), cat(2, '3B')],
      4 => [cat(1, '4A'), cat(2, '4B')]
    }
    found = BattleCatsRolls::FindCat.new(gacha(1, 2, rolls: rolls), [1, 2]).
      search(cats: [[cat(1, '1A'), cat(0, '1B')]], max: 4)

    expect(found.map(&:id)).eq [1, 2]
    expect(found[0].number).eq '1A'
    expect(found[1].number).eq '3B'
  end
end
