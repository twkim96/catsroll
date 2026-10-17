#!/usr/bin/env ruby
# frozen_string_literal: true

require 'fileutils'
require 'json'
require 'uri'
require 'tmpdir'

root = File.expand_path('..', __dir__)
origin = ENV.fetch('CATSROLL_PUBLIC_ORIGIN', 'https://twkim96-my-cats-rolls.hf.space').sub(%r{/+\z}, '')
uri = URI(origin)
abort 'CATSROLL_PUBLIC_ORIGIN must be an HTTPS origin' unless uri.is_a?(URI::HTTPS) &&
  uri.host && !uri.userinfo && [nil, '', '/'].include?(uri.path) && !uri.query && !uri.fragment

manifest = JSON.parse(File.read("#{root}/plugins/catsroll/plugin.json"))
destination = File.expand_path(ARGV.first || "temp/catsroll-plugin-#{manifest.fetch('version')}.zip", root)
FileUtils.mkdir_p(File.dirname(destination))
Dir.mktmpdir('catsroll-plugin-') do |stage|
  FileUtils.cp_r("#{root}/plugins/catsroll/.", stage)
  config = JSON.parse(File.read("#{stage}/mcp.json"))
  config.fetch('mcpServers').fetch('catsroll')['url'] = "#{origin}/mcp"
  File.write("#{stage}/mcp.json", JSON.pretty_generate(config) + "\n")
  archive = "#{stage}/package.zip"
  entries = %w[plugin.json mcp.json assets].select { |name| File.exist?("#{stage}/#{name}") }
  abort 'zip failed' unless system('zip', '-q', '-r', archive, *entries, chdir: stage)
  FileUtils.cp(archive, destination)
end
puts destination
