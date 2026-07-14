
require 'pork/auto'
require 'battle-cats-rolls/live_events_admin'

describe BattleCatsRolls::LiveEventsAdmin do
  would 'stay disabled without an admin password' do
    previous = ENV.delete('TSV_ADMIN_PASSWORD')

    expect(BattleCatsRolls::LiveEventsAdmin.authorized?('anything')).eq false
  ensure
    ENV['TSV_ADMIN_PASSWORD'] = previous if previous
  end

  would 'compare the configured password without exposing it' do
    previous = ENV['TSV_ADMIN_PASSWORD']
    ENV['TSV_ADMIN_PASSWORD'] = 'configured-password'

    expect(BattleCatsRolls::LiveEventsAdmin.authorized?('configured-password')).eq true
    expect(BattleCatsRolls::LiveEventsAdmin.authorized?('wrong-password')).eq false
  ensure
    ENV['TSV_ADMIN_PASSWORD'] = previous
  end
end
