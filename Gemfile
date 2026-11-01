
source 'https://rubygems.org'

gem 'base64' # stdlib

gem 'jellyfish'
gem 'tilt'
gem 'rack', ENV['RACK_VERSION']
gem 'promise_pool'

group :server do
  # Pick one for server
  gem 'yahns'
  gem 'raindrops'

  gem 'puma'
end

group :cache do
  # Pick one for caching
  gem 'dalli'
  gem 'lru_redux'
end

group :test do
  gem 'rake'
  gem 'pork'
  gem 'muack'
  gem 'nokogiri'
end
