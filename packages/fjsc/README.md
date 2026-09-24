# fjsc distribution

`fjsc` compiles a JS bundle to engine bytecode for `fjs build --bytecode` and
`fjs build --release`. It is a **host** tool, so it cannot ride along with the
`flutter_fjs` pub package — it ships as five per-platform npm packages that
`@ufjs/cli` declares in `optionalDependencies`:

```
@ufjs/fjsc-darwin-arm64   @ufjs/fjsc-darwin-x64
@ufjs/fjsc-linux-x64      @ufjs/fjsc-linux-arm64
@ufjs/fjsc-win32-x64
```

Each carries `os`/`cpu` in its manifest, so npm installs exactly the one that
matches and skips the rest. A platform with no published package is not fatal:
npm and pnpm both treat an unresolvable optional dependency as a warning, and
`fjs build --bytecode` then fails with a message pointing at `FJSC_PATH`.

`fjsc` has to come from the same engine sources `flutter_fjs` embeds — a
bundle compiled by a mismatched `fjsc` is rejected at load time by the engine id
check in `fjs_bundle_check`. `build.mjs` therefore builds from
`packages/flutter_fjs/native`.

The engine is linked into the binary, so each engine flavor is its own binary,
and every package carries both (spec 114):

| File | Engine |
| --- | --- |
| `bin/fjsc` (`fjsc.exe`) | `primjs-4.1.1` — the default |
| `bin/fjsc-quickjs` (`fjsc-quickjs.exe`) | `quickjs-ng-0.9.0` — `--js-engine quickjs` |

`build.mjs` configures one CMake tree per flavor (`build/<target>-<flavor>`,
`-DFJS_JS_ENGINE=<flavor>`) and, for the host target, runs each binary to check
the engine id it reports. `@ufjs/cli` likewise picks a binary by that reported
id, never by file name: 0.1.4 shipped a quickjs-ng build as `bin/fjsc`.

## Layout

| Path | Tracked | What |
| --- | --- | --- |
| `build.mjs` | yes | builds a target and emits its npm package |
| `prebuilt/<target>/` | no | `fjsc` + `fjsc-quickjs` CI produced, dropped in at release time |
| `npm/fjsc-<target>/` | no | generated npm packages, the publish inputs |
| `build/` | no | CMake scratch |

`build.mjs` packages `prebuilt/<target>/` when it exists and compiles from
source otherwise, so `--all` produces the same five packages on any machine
once CI's binaries are unzipped in. Nothing binary is committed.

## Building

```bash
node packages/fjsc/build.mjs                # host platform
node packages/fjsc/build.mjs darwin-x64     # one target
node packages/fjsc/build.mjs --all-darwin   # both macOS targets
node packages/fjsc/build.mjs --all          # everything @ufjs/cli declares
```

Linux and Windows binaries cannot be produced on macOS. The
`Build fjsc binaries` GitHub Actions workflow builds them on native runners and
emits a `fjsc-prebuilt` artifact that unzips straight into this directory. It
deliberately does not publish: npm requires an OTP for write actions on this
account, and trusted publishing is configured per package, so it cannot cover a
package's first release.

The full release flow is in [docs/publishing.md](../../docs/publishing.md).
