# frozen_string_literal: true

rack, = Rack::Builder.parse_file(
  File.expand_path("#{__dir__}/../config.ru"))

app :rack, rack, preload: true do
  listen(BattleCatsRolls::WebBind, reuseport: true)

  if BattleCatsRolls::GptMcp.enabled?
    # Explicit result sharing accepts a bounded snapshot larger than Yahns'
    # default 1 MiB. Keep uploads in memory; ordinary MCP calls retain their
    # smaller adapter limit.
    client_max_body_size(BattleCatsRolls::GptMcp::SHARE_BODY_LIMIT)
    client_body_buffer_size(BattleCatsRolls::GptMcp::SHARE_BODY_LIMIT)
  end

  queue do
    worker_threads BattleCatsRolls::WebThreads
  end
end

app :rack, rack, preload: true do
  listen(BattleCatsRolls::SeekBind, reuseport: true)

  queue do
    worker_threads BattleCatsRolls::SeekThreads
  end
end if BattleCatsRolls::SeekHost
