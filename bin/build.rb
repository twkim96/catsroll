
require_relative '../lib/battle-cats-rolls/runner'

if ARGV.empty?
  BattleCatsRolls::LangAll
else
  ARGV
end.each do |lang|
  puts "Building data for #{lang}..."
  BattleCatsRolls::Runner.build(lang)
end
