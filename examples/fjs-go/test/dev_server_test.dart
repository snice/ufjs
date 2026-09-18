// Address parsing is the one piece of fjs go that users hit blind (typing a
// LAN address on a phone), so it carries the tests.
import 'package:flutter_test/flutter_test.dart';
import 'package:fjs_go/src/dev_server.dart';

void main() {
  test('host:port', () {
    final s = DevServer.parse('192.168.1.20:38900');
    expect(s.host, '192.168.1.20');
    expect(s.port, 38900);
  });

  test('bare host takes the default port', () {
    expect(DevServer.parse('10.0.2.2').port, DevServer.defaultPort);
  });

  test('a pasted url from fjs dev works verbatim', () {
    final s = DevServer.parse('http://192.168.1.20:38900/bundle.js');
    expect(s.host, '192.168.1.20');
    expect(s.port, 38900);
    expect(s.bundleUrl.toString(), 'http://192.168.1.20:38900/bundle.js');
  });

  test('trailing path on a host:port form is ignored', () {
    expect(DevServer.parse('192.168.1.20:38900/bundle.js').port, 38900);
  });

  test('surrounding whitespace is trimmed', () {
    expect(DevServer.parse('  10.0.2.2:38900 ').host, '10.0.2.2');
  });

  test('bad input reports instead of throwing something opaque', () {
    expect(() => DevServer.parse(''), throwsFormatException);
    expect(() => DevServer.parse('host:notaport'), throwsFormatException);
  });

  test('equality drives the recent-servers de-dup', () {
    expect(DevServer.parse('a:1'), DevServer.parse('a:1'));
    expect(DevServer.parse('a:1'), isNot(DevServer.parse('a:2')));
  });

  test('an https url keeps its own port instead of the dev port', () {
    final s = DevServer.parse('https://fjs-showcase.zhuzhe.dev/');
    expect(s.secure, isTrue);
    expect(s.port, 443);
    expect(s.label, 'https://fjs-showcase.zhuzhe.dev');
    expect(s.origin.toString(), 'https://fjs-showcase.zhuzhe.dev');
    expect(DevServer.parse(s.label), s); // recents round-trip
  });

  test('a bare public domain is a hosted build over https', () {
    expect(DevServer.parse('fjs-showcase.zhuzhe.dev'), DevServer.showcase);
  });

  test('LAN names and IPs keep the dev port', () {
    expect(DevServer.parse('my-mac.local').port, DevServer.defaultPort);
    expect(DevServer.parse('localhost').port, DevServer.defaultPort);
    expect(DevServer.parse('192.168.1.20').secure, isFalse);
  });

  test('a release manifest marks a hosted build', () {
    final hosted = DevManifest.fromJson(const {
      'name': 'hello-fjs',
      'bundle': 'assets/fjs/bundle.fjsbundle',
      'pages': {'about': 'assets/fjs/pages/about.fjsbundle'},
    });
    expect(hosted.isHosted, isTrue);
    expect(hosted.pages['about'], 'assets/fjs/pages/about.fjsbundle');
    expect(hosted.hashes, isEmpty); // builds before --release wrote hashes
    expect(DevManifest.fromJson(const {'name': 'x', 'split': true}).isHosted, isFalse);
  });

  test('manifest hashes are read by the path they name', () {
    final m = DevManifest.fromJson(const {
      'bundle': 'bundle.fjsbundle.gz',
      'shared': 'shared.fjsbundle.gz',
      'hashes': {'shared.fjsbundle.gz': '0123456789abcdef', 'bad': 1},
    });
    expect(m.hashes, {'shared.fjsbundle.gz': '0123456789abcdef'});
  });
}
