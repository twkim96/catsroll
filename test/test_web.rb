
require 'pork/auto'
require 'battle-cats-rolls/web'
require 'battle-cats-rolls/route'

describe BattleCatsRolls::Web do
  web = BattleCatsRolls::Web.new
  web.call('PATH_INFO' => '/warmup')

  BattleCatsRolls::Route.reload_balls

  define_method(:expect_status_200) do |path, query=''|
    status, _headers, _body = web.call(
      'PATH_INFO' => path, 'QUERY_STRING' => query)

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

  BattleCatsRolls::Route.ball_jp.cats.each_key do |id|
    would "respond 200 for /cats/#{id}?lang=jp" do
      expect_status_200("/cats/#{id}", 'lang=jp')
    end
  end
end
