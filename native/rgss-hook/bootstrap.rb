# yakusha runtime bootstrap for RPG Maker XP / VX / VX Ace.
#
# The hook DLL evaluates this file inside the game's Ruby VM right before
# RGSSGameMain starts. At that point the game scripts have not run yet, so the
# bootstrap only installs a Kernel#load_data wrapper; the first load after the
# scripts are up also patches the string constants in Vocab (menu labels such as
# "New Game" live in script source, not in Data/).
#
# dictionary.txt holds one entry per line: base64(source) <TAB> base64(target),
# both UTF-8. Lines with an empty target are not written by install --native.

module Yakusha
  DICT_PATH = File.join(YAKUSHA_ROOT, "yakusha", "native", "dictionary.txt")
  LOG_PATH = File.join(YAKUSHA_ROOT, "yakusha", "native", "rgss-hook.log")
  MAX_DEPTH = 64

  @dictionary = {}
  @loaded = false
  @replacements = 0
  @hooks_installed = false

  def self.log(message)
    File.open(LOG_PATH, "ab") { |file| file.write(message + "
") }
  rescue Exception
  end

  def self.decode(text)
    text.unpack("m")[0].force_encoding("UTF-8")
  rescue Exception
    ""
  end

  def self.dictionary
    return @dictionary if @loaded
    @loaded = true
    unless File.exist?(DICT_PATH)
      log("dictionary missing: #{DICT_PATH}")
      return @dictionary
    end
    File.open(DICT_PATH, "rb") do |file|
      file.each_line do |line|
        line = line.chomp
        next if line.empty?
        parts = line.split("	")
        next if parts.length < 2
        source = decode(parts[0])
        target = decode(parts[1])
        next if source.empty? || target.empty?
        @dictionary[source] = target
      end
    end
    log("dictionary loaded: #{@dictionary.size} entries")
    @dictionary
  end

  def self.translate(value, depth = 0)
    return value if depth > MAX_DEPTH
    case value
    when String
      replacement = dictionary[value]
      if replacement.nil?
        value
      else
        @replacements += 1
        replacement
      end
    when Array
      index = 0
      while index < value.length
        value[index] = translate(value[index], depth + 1)
        index += 1
      end
      value
    when Hash
      value.each_key do |key|
        value[key] = translate(value[key], depth + 1)
      end
      value
    else
      if value.respond_to?(:instance_variables)
        value.instance_variables.each do |name|
          current = value.instance_variable_get(name)
          translated = translate(current, depth + 1)
          value.instance_variable_set(name, translated) unless translated.equal?(current)
        end
      end
      value
    end
  end

  # Patch the zero-argument String methods of Vocab. Argument-taking methods
  # (item_number, etc.) and non-string values are left alone.
  def self.patch_vocab
    return unless defined?(Vocab)
    names = []
    Vocab.singleton_methods.each do |name|
      begin
        value = Vocab.send(name)
        names << name if value.is_a?(String) && dictionary.key?(value)
      rescue Exception
      end
    end
    names.each do |name|
      original = Vocab.method(name)
      Vocab.define_singleton_method(name) do
        translated = Yakusha.dictionary[original.call]
        translated.nil? ? original.call : translated
      end
    end
    log("vocab patched: #{names.size}") unless names.empty?
  end

  def self.install_hooks
    return if @hooks_installed
    @hooks_installed = true
    patch_vocab
  end

  def self.replacements
    @replacements
  end
end

module Kernel
  unless method_defined?(:yakusha_original_load_data) || private_method_defined?(:yakusha_original_load_data)
    alias yakusha_original_load_data load_data
  end

  def load_data(name)
    before = Yakusha.replacements
    data = yakusha_original_load_data(name)
    Yakusha.translate(data)
    Yakusha.log("load_data " + name.to_s + " +" + (Yakusha.replacements - before).to_s)
    Yakusha.install_hooks
    data
  end
end

Yakusha.log("bootstrap ready")
