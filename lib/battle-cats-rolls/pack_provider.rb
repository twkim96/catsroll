# frozen_string_literal: true

require_relative 'pack_reader'
require_relative 'provider'

module BattleCatsRolls
  class PackProvider < Struct.new(
    :data_reader, :res_reader,
    :animation_readers, :unit_image_readers)

    def initialize lang, lang_under_en, dir
      suffix = "_#{lang_under_en}" if lang_under_en

      # DataLocal{suffix}.list is empty for lang_under_en anyway
      # However resLocal#{suffix}.list contains the lang_under_en text
      local_readers = %W[DataLocal.list resLocal#{suffix}.list].
        map do |list|
          PackReader.new(lang, "#{dir}/#{list}")
        end

      super(*local_readers,
        new_readers(lang, lang_under_en, dir, 'ImageData'),
        new_readers(lang, lang_under_en, dir, 'Unit'))
    end

    def gacha
      data[:gacha]
    end

    def gacha_option
      data[:gacha_option]
    end

    def unitbuy
      data[:unitbuy]
    end

    def unitlevel
      data[:unitlevel]
    end

    def skill_acquisition
      data[:skill_acquisition]
    end

    def picture_book_data
      data[:picture_book_data]
    end

    def units
      data[:units]
    end

    def attack_maanims
      @attack_maanims ||= animation_readers.reverse_each.
        inject({}) do |result, reader|
          load_maanims(reader, result)
        end
    end

    def load_maanims reader, init={}
      reader.list_lines.
        grep(/\A\d+_[#{Provider.forms.join}]02\.maanim,\d+,\d+$/).
        inject(init) do |result, line|
          filename, maanim_read = reader.read(line)
          id, form_index =
            Provider.extract_id_and_form_from_maanim_path(filename)

          next result if result.dig(id, form_index)

          maanim = maanim_read.call
          (result[id] ||= [])[form_index] = maanim unless maanim.empty?

          result
        end
    end

    def res
      @res ||= res_reader.list_lines.
        grep(/\AUnit_Explanation\d+_\w+\.csv,\d+,\d+$/).
        inject({}) do |result, line|
          result.store(*res_reader.read_eagerly(line))
          result
        end
    end

    def write_unit_images dir
      unit_image_readers.reverse_each do |reader|
        write_unit_images_for(dir, reader)
      end
    end

    private

    def data
      @data ||= data_reader.list_lines.
        grep(/\A
          (?:GatyaData_Option_SetR\.tsv|
          (?:GatyaDataSetR1|
            unitbuy|
            unit\d+|
            unitlevel|
            SkillAcquisition|
            nyankoPictureBookData)\.csv)
          ,\d+,\d+$/x).
        inject({}) do |result, line|
          filename, data = data_reader.read_eagerly(line)

          case filename
          when 'GatyaData_Option_SetR.tsv'
            result[:gacha_option] = data
          when 'GatyaDataSetR1.csv'
            result[:gacha] = data
          when 'unitbuy.csv'
            result[:unitbuy] = data
          when 'unitlevel.csv'
            result[:unitlevel] = data
          when 'SkillAcquisition.csv'
            result[:skill_acquisition] = data
          when 'nyankoPictureBookData.csv'
            result[:picture_book_data] = data
          else # unit\d+
            id = filename[/\Aunit(\d+)/, 1].to_i
            (result[:units] ||= {})[id] = data
          end

          result
        end
    end

    def new_readers lang, lang_under_en, dir, name
      lang_under_en ||= 'en' if lang == 'en'
      glob = "#{dir}/*#{name}{Server,Local}{,*_#{lang_under_en}}.list"
      paths = Dir[glob].sort_by do |path|
        # We sort by lowest priority to highest priority. Local is highest.
        # We reverse traverse and skip when it's already written.
        # Sort as the followings:
        # * VUnitServer.list
        # * UnitServer_100600_00_fr.list
        # * UnitLocal.list
        # * UnitLocal_fr.list
        prefix, side, version = File.basename(path).match(
          /([A-Z]?)#{name}(Server|Local)((?:_#{lang_under_en})?)/
        )[1..]

        # Server = 0, Local = 1
        [(side <=> 'Server') * -1, version, prefix]
      end

      paths.map{ |list| PackReader.new(lang, list) }
    end

    def write_unit_images_for dir, reader
      reader.list_lines.
        grep(/\Auni\d+_[#{Provider.forms.join}]00\.png,\d+,\d+$/).
        each do |line|
          filename, png = reader.read(line)
          path = "#{dir}/#{filename}"
          File.binwrite(path, png.call) unless File.exist?(path)
        end
    end
  end
end
