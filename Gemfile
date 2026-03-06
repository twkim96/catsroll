
source 'https://rubygems.org'

gem 'base64' # stdlib

gem 'jellyfish'
gem 'tilt'
gem 'rack', ENV['RACK_VERSION']
gem 'promise_pool'

platforms :ruby do
  gem 'yahns'
  gem 'raindrops'
end

group :build do
  gem 'nokogiri' # For downloading apk
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
end
