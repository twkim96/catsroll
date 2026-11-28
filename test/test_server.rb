
require 'pork/auto'
require 'battle-cats-rolls/server'
require 'rack/mock'

describe BattleCatsRolls::Server do
  would 'publish the fork sitemap and retain the crawler rule' do
    request = Rack::MockRequest.new(BattleCatsRolls::Server)
    origin = BattleCatsRolls::GptMcp.public_origin
    robots = request.get('/robots.txt')
    sitemap = request.get('/sitemap.xml')

    expect(robots.status).eq 200
    expect(robots.body).include? "Sitemap: #{origin}/sitemap.xml"
    expect(robots.body).include? "User-agent: meta-externalagent\nDisallow: /"
    expect(sitemap.status).eq 200
    expect(sitemap['content-type']).include? 'application/xml'
    locations = sitemap.body.scan(%r{<loc>(.*?)</loc>}).flatten
    expect(locations).include? "#{origin}/cats?lang=kr"
    expect(locations).include? "#{origin}/cats/1?lang=kr"
    expect(locations).include? "#{origin}/cats/1?lang=jp"
    expect(locations.all?{ |url| url.start_with?("#{origin}/") }).eq true
    expect(request.head('/sitemap.xml').body).eq ''
  end

  would 'block meta webindexer before app routing' do
    response = Rack::MockRequest.new(BattleCatsRolls::Server).get(
      '/?seed=1&event=2020-09-11_433',
      'HTTP_USER_AGENT' =>
        'meta-webindexer/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)')

    expect(response.status).eq 404
  end
end
