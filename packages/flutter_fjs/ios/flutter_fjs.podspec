Pod::Spec.new do |s|
  s.name             = 'flutter_fjs'
  s.version          = '0.1.4'
  s.summary          = 'JS/TS runtime for Flutter (QuickJS-ng embedded, JSI-style bridge).'
  s.description      = 'Embeds QuickJS-ng in the Flutter app; JS runs against native C functions directly and renders HTML-like tags as Flutter widgets.'
  s.homepage         = 'https://github.com/snice/ufjs'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'ufjs' => 'dev@flutter-js.dev' }
  s.source           = { :path => '.' }
  # Only the plugin shim compiles here. The engine ships prebuilt as static
  # slices in fjs.xcframework (built from ../native by tool/build-apple.sh) and
  # links into the app binary, where dart:ffi finds it via
  # DynamicLibrary.process().
  s.source_files        = 'Classes/**/*'
  s.public_header_files = 'Classes/FlutterFjsPlugin.h'
  s.vendored_frameworks = 'fjs.xcframework'
  # the prebuilt slices are C++; the plugin shim itself is plain ObjC
  s.libraries = 'c++'
  s.dependency 'Flutter'
  s.ios.deployment_target = '12.0'
end
