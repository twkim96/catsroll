# frozen_string_literal: true

require_relative 'lib/battle-cats-rolls/server'

warmup(&BattleCatsRolls.method(:warmup_with_local_features))

run BattleCatsRolls::Server
