# yakusha runtime bootstrap for RPG Maker XP / VX / VX Ace.
#
# The hook DLL evaluates this file inside the game's Ruby VM right before
# RGSSGameMain starts. At that point the game scripts have not run yet, so the
# bootstrap only installs a Kernel#load_data wrapper; the first load after the
# scripts are up also patches the string constants in Vocab (menu labels such
# as "New Game" live in script source, not in Data/).
#
# Two runtime facts shape this file:
#
# 1. RGSSEval hands the source over as ASCII-8BIT, so YAKUSHA_ROOT (a path that
#    may contain Japanese characters) is ASCII-8BIT too. File.* then tries to
#    convert it to UTF-8 and raises Encoding::UndefinedConversionError, which
#    would silently disable the whole dictionary. The bytes are UTF-8, so the
#    fix is to re-tag them.
# 2. The embedded interpreters are old (1.8 for XP and VX, 1.9.2 for VX Ace),
#    so this file avoids method-level rescue, define_singleton_method and
#    unguarded force_encoding. A syntax error here is silent: RGSSEval returns
#    0 and the game simply runs untranslated.
#
# dictionary.txt holds one entry per line: base64(source) <TAB> base64(target),
# both UTF-8. Lines with an empty target are not written by install --native.

YAKUSHA_PATH = YAKUSHA_ROOT.dup
YAKUSHA_PATH.force_encoding("UTF-8") if YAKUSHA_PATH.respond_to?(:force_encoding)

module Yakusha
  DICT_PATH = File.join(YAKUSHA_PATH, "yakusha", "native", "dictionary.txt")
  LOG_PATH = File.join(YAKUSHA_PATH, "yakusha", "native", "rgss-hook.log")
  MAX_DEPTH = 64

  @dictionary = {}
  @loaded = false
  @replacements = 0
  @hooks_installed = false
  @draw_hooked = false
  @draw_hits = 0

  def self.log(message)
    begin
      File.open(LOG_PATH, "ab") { |file| file.write(message + "\n") }
    rescue Exception
    end
  end

  def self.decode(text)
    begin
      value = text.unpack("m")[0]
      value = value.force_encoding("UTF-8") if value.respond_to?(:force_encoding)
      value
    rescue Exception
      ""
    end
  end

  def self.dictionary
    return @dictionary if @loaded
    @loaded = true
    begin
      unless File.exist?(DICT_PATH)
        log("dictionary missing: " + DICT_PATH)
        return @dictionary
      end
      File.open(DICT_PATH, "rb") do |file|
        file.each_line do |line|
          line = line.chomp
          next if line.empty?
          parts = line.split("\t")
          next if parts.length < 2
          source = decode(parts[0])
          target = decode(parts[1])
          next if source.empty? || target.empty?
          @dictionary[source] = target
        end
      end
    rescue Exception => error
      log("dictionary unreadable: " + error.class.to_s)
      return @dictionary
    end
    log("dictionary loaded: " + @dictionary.size.to_s + " entries")
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

  # Text a script draws never passes through load_data: the label is a Ruby
  # string built at draw time (Vocab::File + " 11"), so the only place to catch
  # it is Bitmap#draw_text. Exact matches win; a trailing number is translated
  # by translating the label in front of it, which covers "ファイル 1" through
  # "ファイル 30" with a single dictionary row.
  def self.translate_drawn(text)
    dict = dictionary
    direct = dict[text]
    unless direct.nil?
      @draw_hits = @draw_hits + 1
      log("first drawn string translated: " + text) if @draw_hits == 1
      return direct
    end
    if text =~ /\A(.*?)([ ]*)([0-9]+)\z/
      head = $1
      space = $2
      number = $3
      fixed = dict[head]
      return fixed + space + number unless fixed.nil?
    end
    text
  end

  # Menu labels live in Vocab: VX Ace stores them as constants, VX and XP as
  # zero-argument methods. Both are handled, and only values that are in the
  # dictionary are touched.
  def self.patch_vocab
    return unless defined?(Vocab)
    constants = 0
    begin
      Vocab.constants.each do |name|
        begin
          value = Vocab.const_get(name)
          next unless value.is_a?(String)
          translated = dictionary[value]
          next if translated.nil?
          Vocab.send(:remove_const, name)
          Vocab.const_set(name, translated)
          constants += 1
        rescue Exception
        end
      end
    rescue Exception
    end
    methods = 0
    begin
      Vocab.singleton_methods.each do |name|
        begin
          value = Vocab.send(name)
          next unless value.is_a?(String)
          next if dictionary[value].nil?
          original = Vocab.method(name)
          singleton = class << Vocab; self; end
          singleton.send(:define_method, name) do
            translated = Yakusha.dictionary[original.call]
            translated.nil? ? original.call : translated
          end
          methods += 1
        rescue Exception
        end
      end
    rescue Exception
    end
    log("vocab patched: " + constants.to_s + " constants, " + methods.to_s + " methods")
  end

  # A drawn string is translated where it is drawn. Every draw goes through one
  # hash lookup, and the alias keeps the engine's own implementation in place,
  # so a miss costs nothing and no drawing behaviour changes.
  def self.install_draw_hook
    return if @draw_hooked
    return unless defined?(Bitmap)
    begin
      Bitmap.class_eval do
        unless method_defined?(:yakusha_original_draw_text) || private_method_defined?(:yakusha_original_draw_text)
          alias_method :yakusha_original_draw_text, :draw_text
        end
        def draw_text(*args)
          index = 0
          while index < args.length
            if args[index].is_a?(String)
              args[index] = Yakusha.translate_drawn(args[index])
              break
            end
            index += 1
          end
          yakusha_original_draw_text(*args)
        end
      end
      @draw_hooked = true
      log("draw_text hook installed")
    rescue Exception => error
      log("draw_text hook failed: " + error.class.to_s)
    end
  end

  # Vocab only exists once the game scripts have loaded, so this is retried on
  # every load_data call until it succeeds.
  def self.install_hooks
    install_draw_hook
    return if @hooks_installed
    return unless defined?(Vocab)
    patch_vocab
    @hooks_installed = true
  end

  def self.replacements
    @replacements
  end
end

module Kernel
  begin
    unless method_defined?(:yakusha_original_load_data) || private_method_defined?(:yakusha_original_load_data)
      alias yakusha_original_load_data load_data
    end
  rescue Exception
  end

  def load_data(name)
    before = Yakusha.replacements
    data = yakusha_original_load_data(name)
    begin
      Yakusha.translate(data)
    rescue Exception => error
      Yakusha.log("translate failed: " + error.class.to_s)
    end
    Yakusha.log("load_data " + name.to_s + " +" + (Yakusha.replacements - before).to_s)
    begin
      Yakusha.install_hooks
    rescue Exception => error
      Yakusha.log("hooks failed: " + error.class.to_s)
    end
    data
  end
end

Yakusha.install_draw_hook
Yakusha.log("bootstrap ready")