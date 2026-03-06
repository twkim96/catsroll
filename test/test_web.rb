
require 'pork/auto'
require 'battle-cats-rolls/web'

describe BattleCatsRolls::Web do
  web = BattleCatsRolls::Web.new
  web.call('PATH_INFO' => '/warmup')

  define_method(:expect_status_200) do |path|
    status, headers, body = web.call('PATH_INFO' => path)

    expect(status).eq 200
  end

  %w[/ /cats /help /logs].each do |path|
    would "respond 200 for #{path}" do
      expect_status_200(path)
    end
  end

  would 'respond 200 for am existing cat' do
    expect_status_200('/cats/1')
  end

  would 'respond 200 for a non-existing cat' do
    expect_status_200('/cats/9999')
  end
end
