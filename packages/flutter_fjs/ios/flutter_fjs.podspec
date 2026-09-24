Pod::Spec.new do |s|
  s.name             = 'flutter_fjs'
  s.version          = '0.1.6'
  s.summary          = 'JS/TS runtime for Flutter (QuickJS-ng embedded, JSI-style bridge).'
  s.description      = 'Embeds QuickJS-ng in the Flutter app; JS runs against native C functions directly and renders HTML-like tags as Flutter widgets.'
  s.homepage         = 'https://github.com/snice/ufjs'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'ufjs' => 'dev@flutter-js.dev' }
  s.source           = { :path => '.' }
  # Only the plugin shim compiles here. The engine ships prebuilt as static
  # slices in abi/<flavor>/fjs.xcframework (built from ../native by
  # tool/build-apple.sh) and links into the app binary, where dart:ffi finds
  # it via DynamicLibrary.process().
  #
  # Engine flavor (spec 105): chosen HERE, at pod install, by pointing
  # vendored_frameworks at abi/<flavor>/ — never by copying files over this
  # directory, which lives in the shared pub cache for every host that
  # depends on the package. The frameworks sit inside the pod root because
  # CocoaPods only matches file patterns under it (`../abi` matches nothing).
  # Flavor, first match wins:
  #   1. FJS_JS_ENGINE in the environment (@ufjs/cli sets it for flutter)
  #   2. FJS_JS_ENGINE in the host's DART_DEFINES (--dart-define), read from
  #      the Generated xcconfig flutter writes next to the Podfile
  #   3. primjs
  # A flavor change needs a fresh pod install; the engine runner touches the
  # host Podfile when it sees one, and the app warns at startup when the
  # linked engine id differs from the dart-define (lib/src/engine.dart).
  #
  # fjs_debugger.xcframework (spec 090) carries the CDP inspector + transport
  # and exists only for primjs. A static archive contributes only the members
  # something references, and only Classes/FlutterFjsPlugin.m's `#if DEBUG`
  # keep-alive table does, so Release and Profile binaries contain none of it.
  # quickjs has no debugger ABI at all: FJS_ENGINE_QUICKJS keeps the shim
  # from declaring it.
  fjs_engine = lambda do
    from_env = ENV['FJS_JS_ENGINE'].to_s
    return from_env unless from_env.empty?
    root = defined?(Pod::Config) ? Pod::Config.instance.installation_root : nil
    xcconfig = root && File.join(root.to_s, 'Flutter/Generated.xcconfig')
    if xcconfig && File.exist?(xcconfig)
      line = File.readlines(xcconfig).find { |l| l.start_with?('DART_DEFINES=') }
      defines = line.to_s.strip.sub('DART_DEFINES=', '').split(',')
      defines.map { |d| d.unpack1('m').to_s }.each do |d|
        return d.split('=', 2)[1].to_s if d.start_with?('FJS_JS_ENGINE=')
      end
    end
    'primjs'
  end.call
  unless %w[primjs quickjs].include?(fjs_engine)
    raise "flutter_fjs: unknown FJS_JS_ENGINE '#{fjs_engine}' - expected primjs or quickjs"
  end

  s.source_files        = 'Classes/**/*'
  s.public_header_files = 'Classes/FlutterFjsPlugin.h'
  s.vendored_frameworks = ["abi/#{fjs_engine}/fjs.xcframework"] +
      (fjs_engine == 'primjs' ? ['abi/primjs/fjs_debugger.xcframework'] : [])
  if fjs_engine == 'quickjs'
    s.pod_target_xcconfig = {
      'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) FJS_ENGINE_QUICKJS=1',
    }
  end
  # the prebuilt slices are C++; the plugin shim itself is plain ObjC
  s.libraries = 'c++'
  s.dependency 'Flutter'
  s.ios.deployment_target = '12.0'
end
