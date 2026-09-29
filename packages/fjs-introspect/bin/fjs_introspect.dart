// The `dart run fjs_introspect` executable. The library's main() runs; the
// tool lives OUTSIDE the host's dependency graph by design (its analyzer
// would conflict with whatever the Flutter SDK pins), so this package is
// materialized under the project's .fjs/ and run from there.
import 'package:fjs_introspect/fjs_introspect.dart' as tool;

Future<void> main(List<String> args) => tool.main(args);
