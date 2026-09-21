#!/usr/bin/env node
// fjs — build toolchain CLI for ufjs.
//
//   fjs build  [--bytecode] [--out dist] [--entry src/main.ts]   app -> dist/app, --web -> dist/web, --mp -> dist/mp
//   fjs dev    [--port 38900] [--entry src/main.ts] [--no-qr]
//   fjs create [dir] [--template vue3-vite]
//   fjs create page|component|module <name>
//   fjs add    <package>...
//   fjs run    <android|ios|ohos>
//   fjs routes / fjs doctor / fjs devices / fjs clean / fjs host / fjs icon
//   fjs splash / fjs preview / fjs upgrade / fjs log / fjs eval
//   fjs lint / fjs types
import { buildCommand } from './bundler/build.js';
import { error } from './terminal/colors.js';
import { devCommand } from './dev/server.js';
import { createCommand } from './commands/create.js';
import { addCommand } from './commands/add.js';
import { generateCommand, isGenerator } from './commands/generate.js';
import { routesCommand } from './commands/routes.js';
import { modulesCommand } from './commands/modules.js';
import { devicesCommand } from './commands/devices.js';
import { cleanCommand } from './commands/clean.js';
import { hostCommand } from './commands/host.js';
import { iconCommand } from './commands/icon.js';
import { splashCommand } from './commands/splash.js';
import { previewCommand } from './commands/preview.js';
import { upgradeCommand } from './commands/upgrade.js';
import { evalCommand, logCommand } from './commands/inspect.js';
import { debugCommand } from './commands/debug.js';
import { doctorCommand } from './commands/doctor.js';
import { lintCommand } from './commands/lint.js';
import { typesCommand } from './commands/types.js';
import { runCommand } from './commands/run.js';

function usage(): never {
  console.log(`fjs — ufjs toolchain

commands:
  fjs build  [entry]        bundle the app (default entry: src/main.ts)
      --bytecode            also emit <name>.fjsbundle via the fjsc compiler
      --out <dir>           output root (default: dist); app builds write
                            <dir>/app, --web writes <dir>/web
      --no-minify           keep the bundle readable (minify is on by
                            default, like vite build; fjs dev never minifies)
      --gz                  with --release: gzip copied .fjsbundle assets
      --root-path <path>    with --release: prefix of the file paths in
                            manifest.json (default: assets/fjs/); use "."
                            to serve assets/fjs from a web server, e.g.
                            fjs go's online showcase
      --web                browser build (DOM tags + vue-router)
                            into dist/web, one chunk per page + index.html
      --mp                  WeChat mini-program build (skyline +
                            glass-easel) into dist/mp — open it in
                            WeChat DevTools
      --analyze             print a size report: per-artifact js/gzip/
                            bytecode sizes and the packages inside them
      --pages               split build: <out>/app/shared.js (prelude) +
                            <out>/app/bundle.js + <out>/app/pages/<id>.js
      --release             emit bytecode and copy release assets to
                            .fjs/flutter/assets/fjs
      --profile             same assets, but flutter build --profile
      --apk                 with --release/--profile: also flutter build apk
      --hap                 with --release/--profile: also flutter build hap
                            (needs the OpenHarmony flutter fork)
      --ipa                 with --release/--profile: also flutter build ipa
                            (macOS + Xcode; a failed export leaves the
                            .xcarchive — pass -- --export-options-plist
                            <file> for a signed .ipa)
      --aab                 with --release/--profile: also flutter build
                            appbundle (the .aab Play publishes)
                            one of --apk/--hap/--ipa/--aab per build
      --flutter-dir <dir>    Flutter host dir for --release/--apk
                            (default: .fjs/flutter, or package.json
                            fjs.flutterDir once ejected)
      builds warn when a page exceeds fjs.performance.nodeBudget
  fjs dev    [entry]        dev server: HTTP bundle + WebSocket reload
      --port <n>            port (default: 38900, or 5173 with --web)
      --host <addr>          bind address (default: 0.0.0.0)
      --mp                  mini-program dev: watch src/, re-emit dist/mp
                            (WeChat DevTools applies changes itself)
      --web                 serve the browser build as a static site
      --pages               serve shared.js + bundle.js + pages/<id>.js
      --no-qr               don't draw the QR code of the LAN address
      --no-discovery        don't broadcast this server on the LAN
                            (fjs go's "附近的服务器" list goes quiet)
      keys, while it runs: r reload · l toggle app logs · d who is
                            connected · c addresses + QR · o open the web
                            build · p perf overlay · ? the list · q quit
  fjs create [dir]          scaffold a new fjs app
      --template <name>      template name (default: vue3-vite)
      --list-templates       print available templates
  fjs create page <name>     add src/pages/<name>.vue (also: fjs g page)
                            name may nest and be dynamic: user/[id]
      --title <text>         page title, written to the <route> block
      --tab <n>              tab index, written to the <route> block
      --path <route>         override the derived route path
      --route-name <name>    override the derived route name
      --platform <app|web>   restrict the page to one target (default: both)
      --dry-run / --force    print instead of writing / overwrite
  fjs create component <Name>  add src/components/<Name>.vue
      --dry-run / --force
  fjs create module <name>   add src/modules/<name>: an npm-shaped package
                            with an API (index.ts) and components, imported
                            by its name — import { ping } from '<name>' —
                            and usable as <NameView /> without an import
      --component <Name>     component to scaffold (default: View)
      --no-component         API only
      --prefix <P>           global component prefix (default: the module
                            name, PascalCased)
      --flutter              also scaffold the Dart side, autolinked into
                            the generated Flutter host (pubspec dependency
                            + register call), RN-style — including a Flutter
                            widget behind <name-widget /> and its web stand-in
      --widget <tag>         name that widget's tag (implies --flutter)
      --no-widget            Dart host module only, no widget
      --dry-run / --force
  fjs modules                the modules this project resolves, their tags
                            and their Flutter autolink. A module's prepare
                            hook, if it has one, runs on every build
      --json                 machine-readable output
  fjs add <package>...       add a JS library and wire it up
      --list                 what fjs add knows about
      --dry-run              print the changes instead of writing them
      --force                overwrite an existing src/plugins/<name>.ts
      --no-install           edit package.json but don't run the installer
      --entry <file>         app entry to patch (default: src/main.ts)
                            libraries that need app.use() also get a file in
                            src/plugins/, which builds collect into the
                            generated module 'fjs/plugins'
  fjs routes                 print the route table derived from src/pages
      --platform <app|web>   only routes that target this platform
      --json                 machine-readable output
  fjs lint [paths...]        report CSS the engine will not honor (unknown
                            properties/units, #id selectors, @import…)
                            across src/**/*.vue and src/**/*.css
      --strict               exit 1 on warnings too, not just drops
  fjs types                  (re)write src/fjs-routes/-assets/-modules/
                            -components.d.ts without a build
      --check                read-only: exit 1 when a file is stale (CI)
  fjs doctor                 check toolchain and project setup
  fjs devices                android/ios/ohos devices fjs run can see
      --json                 machine-readable output
  fjs host [status]          the Flutter host: where it is, who owns it
      create                 create it without running the app
      open <android|ios|ohos>  open it in Android Studio / Xcode / DevEco Studio
      eject [dir]            move it into the repo (default: flutter/) and
                            stop regenerating its Dart and pubspec
      sync [--force]         re-apply the generated host files
      id [<app.id>]          print or set applicationId / bundle identifier
  fjs icon <file.png>        regenerate the app icons from one square PNG
      --platform <android|ios>  only that platform (default: both)
      --dry-run              list the files and sizes instead
  fjs splash <file.png>      regenerate the launch screens from one PNG
      --color <#rrggbb>      splash background colour (default: keep the
                             template's white)
      --size <px>            logo logical size (default: 192)
      --platform <android|ios>  only that platform (default: both)
      --dry-run              list the files and sizes instead
  fjs preview                serve dist/web statically (like vite preview):
                             verify the release web build, read-only — no
                             rebuild, no reload snippet
      --out <dir>            build output root (default: dist; serves
                             <dir>/web)
      --port <n>             port (default: 4173)
      --host <addr>          bind address (default: 127.0.0.1)
  fjs upgrade                move @ufjs/cli, @ufjs/runtime and the host's
                             flutter_fjs to the newest matching versions
                             (one system, one minor — doctor warns, this fixes)
      --check                print the from → to plan, change nothing
  fjs log                    stream the app's console output
      --port <n>             dev server port (default: 38900)
      --host <addr>          dev server address (default: 127.0.0.1)
  fjs eval <expression>      evaluate an expression in the running VM
      --timeout <ms>         how long to wait for the answer (default: 5000)
  fjs debug                  Chrome DevTools for the running VM: breakpoints,
                             stepping, scopes, console (spec 088)
      --cdp-port <n>         CDP port for chrome://inspect (default: 38902)
      --vm-port <n>          debug channel the app dials (default: 38903)
      --port <n>             dev server port to talk to (default: 38900)
      --host <addr>          dev server address (default: 127.0.0.1)
  fjs clean                  remove generated output
      --out <dir>            build output directory (default: dist)
      --flutter-dir <dir>    Flutter host dir (default: .fjs/flutter)
      --all                  also remove the Flutter host itself
      --dry-run              print what would be removed
  fjs run <android|ios|ohos> create/reuse .fjs/flutter and run on device
                            (default: debug + dev server, live JS)
      --release              build release assets, then flutter run --release
      --profile              same, but flutter run --profile (for measuring)
      --no-minify            with --release/--profile: skip minification
                             before the bytecode step
      --gz                   with --release/--profile: gzip copied assets
      --no-pages             with --release/--profile: build a single bundle
      --device <id>          Flutter device id (default: the first device
                            on that platform; 'flutter devices' lists them)
      --port <n>             fjs dev port (default: 38900)
      --flutter-dir <dir>    host project dir (default: .fjs/flutter)

env:
  FJSC_PATH                 path to the fjsc bytecode compiler binary
                            (default: the @ufjs/fjsc-<platform> package npm
                            installs alongside this one)
`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  switch (cmd) {
    case 'build':
      await buildCommand(argv);
      break;
    case 'dev':
      await devCommand(argv);
      break;
    case 'create':
    case 'generate':
    case 'g': {
      // `fjs create page about` generates a file; `fjs create my-app` still
      // scaffolds a project. `g` is the generator-only alias.
      const kind = argv[0];
      if (kind && isGenerator(kind)) {
        generateCommand(kind, argv.slice(1));
      } else if (cmd === 'create') {
        await createCommand(argv);
      } else {
        throw new Error(`fjs ${cmd} takes one of: page, component, module`);
      }
      break;
    }
    case 'add':
      addCommand(argv);
      break;
    case 'routes':
      routesCommand(argv);
      break;
    case 'lint':
      lintCommand(argv);
      break;
    case 'types':
      typesCommand(argv);
      break;
    case 'modules':
      modulesCommand(argv);
      break;
    case 'doctor':
      await doctorCommand(argv);
      break;
    case 'devices':
      devicesCommand(argv);
      break;
    case 'clean':
      cleanCommand(argv);
      break;
    case 'host':
      hostCommand(argv);
      break;
    case 'icon':
      iconCommand(argv);
      break;
    case 'splash':
      splashCommand(argv);
      break;
    case 'preview':
      await previewCommand(argv);
      break;
    case 'upgrade':
      await upgradeCommand(argv);
      break;
    case 'log':
      await logCommand(argv);
      break;
    case 'eval':
      await evalCommand(argv);
      break;
    case 'debug':
      await debugCommand(argv);
      break;
    case 'run':
      await runCommand(argv);
      break;
    default:
      usage();
  }
}

main().catch((e) => {
  error(`fjs: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
