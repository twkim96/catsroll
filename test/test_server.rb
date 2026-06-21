
require 'pork/auto'
require 'battle-cats-rolls/server'
require 'rack/mock'

describe BattleCatsRolls::Server do
  would 'block meta webindexer before app routing' do
    response = Rack::MockRequest.new(BattleCatsRolls::Server).get(
      '/?seed=1&event=2020-09-11_433',
      'HTTP_USER_AGENT' =>
        'meta-webindexer/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)')

    expect(response.status).eq 404
  end
end
