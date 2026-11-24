
require_relative '../lib/battle-cats-rolls/runner'

balls = if ARGV.empty?
  BattleCatsRolls::LangAll
else
  ARGV
end.map do |lang|
  puts "Building data for #{lang}..."
  BattleCatsRolls::Runner.build(lang)
end

if ARGV.empty?
  puts 'Regenerating sitemap.xml...'
  BattleCatsRolls::Runner.build_sitemap(balls)
end
