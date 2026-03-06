# frozen_string_literal: true

require_relative 'unpacker'

module BattleCatsRolls
  class PackReader < Struct.new(:list_path, :pack_path, :name)
    include Enumerable

    def initialize lang, new_list_path
      pathname = new_list_path[0...new_list_path.rindex('.')]

      super(
        new_list_path,
        "#{pathname}.pack",
        File.basename(pathname))

      @list_unpacker = Unpacker.for_list
      @pack_unpacker = Unpacker.for_pack(lang)
    end

    def each
      if block_given?
        list_lines.each do |line|
          yield(*read(line))
        end
      else
        to_enum(__method__)
      end
    end

    def list_lines
      # Drop first line for number of files
      @list_lines ||= list_unpacker.decrypt(list_data).lines.drop(1)
    end

    def read line
      filename, offset, size = line.split(',')
      png = filename.end_with?('.png')
      data = lambda do
        result = pack_unpacker.decrypt(
          pack_data[offset.to_i, size.to_i], png: png)

        if error = pack_unpacker.bad_data
          warn "! [#{error.class}:#{error.message}]" \
            " Failed decrypting #{filename} from #{pack_path}"
          exit(1)
        end

        result
      end

      [filename, data]
    end

    def read_eagerly line
      filename, data = read(line)

      [filename, data.call]
    end

    private

    attr_reader :list_unpacker, :pack_unpacker

    def list_data
      @list_data ||= File.binread(list_path)
    end

    def pack_data
      @pack_data ||= File.binread(pack_path)
    end
  end
end
