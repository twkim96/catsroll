require 'pork/auto'
require 'battle-cats-rolls/local/gpt_input_transfer'
require 'base64'
require 'json'

describe BattleCatsRolls::GptInputTransfer do
  def raises?(error_class, message = nil)
    yield
    false
  rescue error_class => error
    message.nil? || error.message.match?(message)
  end

  would 'transfer the complete normalized multi request in a UTF-8 URL fragment' do
    request = {
      mode: 'multi', seed: 4_294_967_295, last: 27, count: 999,
      optimization: 'pareto', maxGuaranteed: 20, maxPlatinum: 2,
      maxLegendTicket: 3, scheduleAware: false, findEnabled: true,
      planMode: true, planName: '픽시즈 계획 🐈',
      rows: [
        {lang: 'kr', event: '2026-02-13_1042', ubers: 12,
         forceGuaranteed: 11, previewFor: 'jp'},
        {lang: 'kr', event: '2026-02-13_1043', ubers: 4,
         forceGuaranteed: 7}
      ],
      targets: [
        {cat_id: 160, cat_name: '칼리파 α', allow_ticket: true},
        {cat_id: 870, cat_name: '変身少女', allow_ticket: false}
      ]
    }

    url = BattleCatsRolls::GptInputTransfer.url('https://example.test/', request)
    expect(url.start_with?('https://example.test/gpt#catsroll-input=')).eq true
    expect(url.include?('?')).eq false
    token = url.split('=', 2).last
    expect(token.match?(/\A[A-Za-z0-9_-]+\z/)).eq true
    expect(token.include?('=')).eq false
    envelope = JSON.parse(Base64.urlsafe_decode64(token + ('=' * ((4 - token.size % 4) % 4))))
    expect(envelope).eq({'version' => 1, 'arguments' => JSON.parse(JSON.generate(request))})
    expect(JSON.generate(envelope).include?('🐈')).eq true

    scheduled = request.merge(scheduleAware: true, rows: request[:rows].map { |row|
      row.reject { |key, _value| key == :previewFor }
    })
    scheduled_envelope = JSON.parse(Base64.urlsafe_decode64(
      BattleCatsRolls::GptInputTransfer.url('https://example.test', scheduled).
        split('=', 2).last.then { |token| token + ('=' * ((4 - token.size % 4) % 4)) }))
    expect(scheduled_envelope.dig('arguments', 'scheduleAware')).eq true
  end

  would 'preserve seek observations and omit a missing seed' do
    request = {
      mode: 'seek', last: 0, count: 300, optimization: 'cost',
      maxGuaranteed: 0, maxPlatinum: 0, maxLegendTicket: 0,
      scheduleAware: false, findEnabled: false, planMode: false,
      planName: '', rows: [{lang: 'kr', event: '2019-01-23_348',
        ubers: 0, forceGuaranteed: 0}], targets: [], rolls: [38, 160, 870]
    }

    url = BattleCatsRolls::GptInputTransfer.url('https://example.test', request)
    envelope = JSON.parse(Base64.urlsafe_decode64(
      url.split('=', 2).last + ('=' * ((4 - url.split('=', 2).last.size % 4) % 4))))
    expect(envelope.dig('arguments', 'mode')).eq 'seek'
    expect(envelope.dig('arguments', 'rolls')).eq [38, 160, 870]
    expect(envelope.dig('arguments').key?('seed')).eq false
  end

  would 'bound UTF-8 JSON bytes and reject prototype-sensitive keys without exposing values' do
    expect(raises?(ArgumentError, /maximum 64 KiB/) {
      BattleCatsRolls::GptInputTransfer.url('https://example.test', {'note' => 'é' * 32_769})
    }).eq true
    error = nil
    begin
      BattleCatsRolls::GptInputTransfer.url('https://example.test', {'__proto__' => 'private payload'})
    rescue ArgumentError => exception
      error = exception
    end
    expect(error.message).eq 'GPT input contains an unsupported object key.'
    expect(error.message.include?('private payload')).eq false
    expect(raises?(ArgumentError, /must be an object/) {
      BattleCatsRolls::GptInputTransfer.url('https://example.test', [])
    }).eq true
  end
end
