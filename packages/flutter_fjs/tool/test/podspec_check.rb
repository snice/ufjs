# Loads flutter_fjs's podspecs against a stub Pod::Spec — no CocoaPods needed
# (spec 105). Usage: ruby tool/test/podspec_check.rb [package dir]
require 'tmpdir'
module Pod
  class Config
    class << self; attr_accessor :root; def instance; self; end; def installation_root; root; end; end
  end
  class Spec
    attr_accessor :name, :version, :summary, :description, :homepage, :license, :author, :source,
                  :source_files, :public_header_files, :vendored_frameworks, :pod_target_xcconfig, :libraries
    def initialize; yield self; end
    def dependency(*); end
    def ios; self; end
    def macos; self; end
    def deployment_target=(_); end
  end
end
PKG = ARGV[0] || File.expand_path("../..", __dir__)
fails = 0
check = lambda do |label, cond|
  puts "#{cond ? 'ok  ' : 'FAIL'} #{label}"; fails += 1 unless cond
end
{ 'ios' => 'Flutter/Generated.xcconfig', 'macos' => 'Flutter/ephemeral/Flutter-Generated.xcconfig' }.each do |plat, gen|
  path = File.join(PKG, plat, 'flutter_fjs.podspec')
  load_spec = lambda do |env, defines|
    Dir.mktmpdir do |host|
      Pod::Config.root = host
      if defines
        FileUtils.mkdir_p(File.dirname(File.join(host, gen)))
        enc = defines.map { |d| [d].pack('m0') }.join(',')
        File.write(File.join(host, gen), "FLUTTER_ROOT=/x\nDART_DEFINES=#{enc}\n")
      end
      ENV['FJS_JS_ENGINE'] = env
      Dir.chdir(File.dirname(path)) { return eval(File.read(path, encoding: 'UTF-8'), binding, path) }
    end
  end
  exists = ->(s) { s.vendored_frameworks.all? { |f| File.directory?(File.join(PKG, plat, f)) } }
  s = load_spec.call(nil, nil)
  check.("#{plat}: default primjs + debugger", s.vendored_frameworks == ['abi/primjs/fjs.xcframework', 'abi/primjs/fjs_debugger.xcframework'] && s.pod_target_xcconfig.nil? && exists.(s))
  s = load_spec.call('quickjs', nil)
  check.("#{plat}: env quickjs, macro, no debugger", s.vendored_frameworks == ['abi/quickjs/fjs.xcframework'] && s.pod_target_xcconfig['GCC_PREPROCESSOR_DEFINITIONS'].include?('FJS_ENGINE_QUICKJS=1') && exists.(s))
  s = load_spec.call(nil, ['FJS_DEV=ws://x', 'FJS_JS_ENGINE=quickjs'])
  check.("#{plat}: DART_DEFINES quickjs", s.vendored_frameworks == ['abi/quickjs/fjs.xcframework'])
  s = load_spec.call('primjs', ['FJS_JS_ENGINE=quickjs'])
  check.("#{plat}: env wins over DART_DEFINES", s.vendored_frameworks.first == 'abi/primjs/fjs.xcframework')
  s = load_spec.call(nil, ['FJS_DEV=ws://x'])
  check.("#{plat}: DART_DEFINES without engine -> primjs", s.vendored_frameworks.first == 'abi/primjs/fjs.xcframework')
  begin
    load_spec.call('v8', nil); check.("#{plat}: unknown flavor raises", false)
  rescue RuntimeError => e
    check.("#{plat}: unknown flavor raises (#{e.message[0, 40]}…)", e.message.include?("'v8'"))
  end
end
exit(fails.zero? ? 0 : 1)
