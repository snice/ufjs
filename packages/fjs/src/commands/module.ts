// fjs create module <name> — scaffolds a module: an API, components, and
// optionally the Flutter side that gets autolinked into the host.
//
//   src/modules/qrcode/
//     package.json           the manifest — also what `npm publish` reads
//     index.ts               the API: import { decode } from 'qrcode'
//     components/QrcodeView.vue    a component: <QrcodeView />, no import
//     components/QrcodeWidgetWeb.vue  --flutter: browser stand-in for the widget
//     flutter/               --flutter: the Dart package, its host module and
//                            the Flutter widget behind <qrcode-widget />
//     README.md
//
// The directory is a package, not a project convention with a second life:
// what works locally (`import { decode } from 'qrcode'`) is what works
// after `npm publish` + `npm i qrcode`, because both are resolved from the
// same package.json. The local copy is resolved by a build alias; the
// installed one by node — see project/modules.ts.
import path from 'node:path';
import { pascal, snake, writeModuleTypes } from '../project/modules.js';

export interface ModuleOptions {
  /** Scaffold the Dart side and wire up the autolink manifest. */
  flutter?: boolean;
  /** Component to scaffold, or false for an API-only module. */
  component?: string | false;
  /** Global component prefix. Default: the module name, PascalCased. */
  prefix?: string;
  /** Tag of the Flutter widget to scaffold, or false for none. Implies
   * --flutter. Default with --flutter: `<name>-widget`. */
  widget?: string | false;
  dryRun?: boolean;
}

type WriteFile = (file: string, source: string) => void;

export function generateModule(
  root: string,
  rawName: string,
  opts: ModuleOptions,
  write: WriteFile,
): void {
  const name = moduleName(rawName);
  const dirName = name.replace(/^@[^/]+\//, '');
  const dir = path.join(root, 'src', 'modules', dirName);
  const prefix = opts.prefix ?? pascal(name);
  // The default component carries the module name: a bare `View.vue` would
  // shadow the <view> tag inside its own template, since Vue lets an SFC
  // reference itself by its filename.
  const componentName =
    opts.component === false ? null : pascal(opts.component || `${pascal(name)}View`);
  const globalName = componentName ? globalComponentName(prefix, componentName) : null;
  const dartPackage = `fjs_${snake(name)}`;
  const dartClass = `Fjs${pascal(name)}`;
  const hostModule = `${name.replace(/^@[^/]+\//, '')}.ping`;
  // a widget is the Dart half of a tag, so it only exists with a Dart side
  const flutter = !!opts.flutter || (opts.widget !== undefined && opts.widget !== false);
  const widgetTag =
    !flutter || opts.widget === false
      ? null
      : widgetTagName(opts.widget || `${name.replace(/^@[^/]+\//, '')}-widget`);
  const widgetWeb = widgetTag ? `${pascal(widgetTag)}Web` : null;

  write(
    path.join(dir, 'package.json'),
    manifest({
      name,
      prefix,
      componentName,
      flutter,
      dartPackage,
      dartClass,
      widgetTag,
      widgetWeb,
    }),
  );
  write(path.join(dir, 'index.ts'), indexSource(name, componentName, globalName, hostModule, flutter));
  if (componentName) {
    write(path.join(dir, 'components', `${componentName}.vue`), componentSource(name, globalName!));
  }
  if (widgetTag && widgetWeb) {
    write(
      path.join(dir, 'components', `${widgetWeb}.vue`),
      widgetWebSource(name, widgetTag),
    );
  }
  if (flutter) {
    write(path.join(dir, 'flutter', 'pubspec.yaml'), dartPubspec(name, dartPackage));
    write(
      path.join(dir, 'flutter', 'lib', `${dartPackage}.dart`),
      dartSource(name, dartClass, hostModule, widgetTag),
    );
  }
  write(
    path.join(dir, 'README.md'),
    readme({ name, globalName, flutter, dartPackage, dartClass, hostModule, widgetTag }),
  );

  if (opts.dryRun) return;
  // the new module's API and components as types, so the editor knows about
  // them before anything is built
  writeModuleTypes(root);
  console.log(`import: import { ping } from '${name}'`);
  if (globalName) console.log(`use it as: <${globalName} />`);
  if (widgetTag) {
    console.log(`widget: <${widgetTag} />  (Flutter widget on the app, ${widgetWeb}.vue on web)`);
  }
  if (flutter) {
    console.log(`autolink: ${dartPackage} (pubspec + ${dartClass}.register(engine))`);
    console.log('           applied the next time the Flutter host is generated');
  }
  console.log(`publish: cd src/modules/${dirName} && npm publish`);
}

/** npm package names: lowercase, optionally scoped. The directory under
 * src/modules is the unscoped half, so `@acme/qrcode` lives in
 * src/modules/qrcode and is still imported as '@acme/qrcode'. */
function moduleName(raw: string): string {
  const name = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!name) throw new Error('module name is empty');
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(name)) {
    throw new Error(
      `bad module name "${raw}": use an npm package name — lowercase letters, ` +
        'digits, - and _, optionally scoped as @scope/name',
    );
  }
  if (name.startsWith('fjs') || name === 'vue') {
    throw new Error(`"${name}" collides with a specifier the toolchain owns`);
  }
  return name;
}

/** Widget tags need a hyphen: that is what keeps them out of HTML's
 * namespace and out of the fjs tag set the renderer resolves first. */
function widgetTagName(raw: string): string {
  const tag = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag)) {
    throw new Error(
      `bad widget tag "${raw}": lowercase and hyphenated, like "qrcode-scanner"`,
    );
  }
  return tag;
}

/** `Qrcode` + `View` -> `QrcodeView`, but `Qrcode` + `QrcodeView` stays
 * `QrcodeView` — the same rule scanComponents applies when it reads the
 * directory back. */
function globalComponentName(prefix: string, componentName: string): string {
  return componentName.startsWith(prefix) ? componentName : prefix + componentName;
}

interface ManifestOptions {
  name: string;
  prefix: string;
  componentName: string | null;
  flutter: boolean;
  dartPackage: string;
  dartClass: string;
  widgetTag: string | null;
  widgetWeb: string | null;
}

function manifest(opts: ManifestOptions): string {
  const fjs: Record<string, unknown> = { module: true };
  if (opts.componentName) {
    fjs.components = 'components';
    fjs.componentPrefix = opts.prefix;
  } else {
    fjs.components = false;
  }
  if (opts.widgetTag && opts.widgetWeb) {
    fjs.widgets = {
      [opts.widgetTag]: {
        // the browser has no Flutter widget: this SFC stands in for it, and
        // its props are what the editor completes on both targets
        web: `./components/${opts.widgetWeb}.vue`,
      },
    };
  }
  if (opts.flutter) {
    fjs.flutter = {
      package: opts.dartPackage,
      path: './flutter',
      import: `package:${opts.dartPackage}/${opts.dartPackage}.dart`,
      register: `${opts.dartClass}.register(engine)`,
    };
  }
  const pkg: Record<string, unknown> = {
    name: opts.name,
    version: '0.0.1',
    description: `fjs module ${opts.name}`,
    license: 'MIT',
    type: 'module',
    // Published as source: fjs builds compile TS and SFCs themselves, so
    // there is no build step between this directory and a consumer.
    types: './index.ts',
    exports: {
      '.': './index.ts',
      './components/*': './components/*',
      './package.json': './package.json',
    },
    // `flutter` is enumerated instead of listed as a directory: the `files`
    // allowlist overrides .gitignore, so a bare 'flutter' entry would ship
    // flutter tool residue (.dart_tool/, build/, .flutter-plugins*) to npm
    // the first time someone runs `flutter test` inside the module.
    files: [
      'index.ts',
      'components',
      ...(opts.flutter ? ['flutter/lib', 'flutter/pubspec.yaml'] : []),
      'README.md',
    ],
    peerDependencies: {
      '@ufjs/runtime': '>=0.1.0',
      vue: '^3.4.0',
    },
    publishConfig: { access: 'public' },
    fjs,
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

function indexSource(
  name: string,
  componentName: string | null,
  globalName: string | null,
  hostModule: string,
  flutter: boolean,
): string {
  const lines: string[] = [
    `// The API of the "${name}" module — everything app code imports by name:`,
    '//',
    `//   import { ping } from '${name}';`,
    '',
    "import { hasNativeHost, invokeHost } from 'fjs';",
    '',
  ];
  if (componentName) {
    lines.push(
      '// Components are registered globally by the toolchain; exporting them',
      '// here as well is what lets an app import one explicitly.',
      `export { default as ${globalName} } from './components/${componentName}.vue';`,
      '',
    );
  }
  lines.push(
    'export interface PingResult {',
    '  /** Where the answer came from. */',
    "  from: 'native' | 'js';",
    '  value: string;',
    '}',
    '',
    '/** Calls the Dart host module when there is one, and answers in JS when',
    ' * there is not — so the same code runs in the browser build. */',
    'export function ping(message = "hello"): PingResult {',
    '  // no engine (the browser build) — answer in JS instead',
    '  if (!hasNativeHost) return { from: "js", value: message };',
    `  return { from: "native", value: String(invokeHost(${JSON.stringify(hostModule)}, message)) };`,
    '}',
    '',
  );
  if (flutter) {
    lines.push(
      `// The Dart side lives in ./flutter and registers "${hostModule}".`,
      '// fjs autolinks it into the generated Flutter host — no manual',
      '// pubspec edit, no registration call in main.dart.',
      '',
    );
  }
  return lines.join('\n');
}

function componentSource(name: string, globalName: string): string {
  const cls = globalName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
  return `<script setup lang="ts">
// Part of the "${name}" module: usable as <${globalName} /> in any page,
// with no import — the toolchain registers it on every Vue app.
defineProps<{
  label?: string;
}>();

defineEmits<{
  (e: 'tap'): void;
}>();
</script>

<template>
  <view class="${cls}" @click="$emit('tap')">
    <text class="${cls}__label">{{ label ?? '${name}' }}</text>
    <slot />
  </view>
</template>

<style scoped>
.${cls} {
  padding: 12px;
  border-radius: 8px;
  background-color: #f2f2f7;
}
.${cls}__label {
  font-size: 16px;
  color: #111827;
}
</style>
`;
}

function widgetWebSource(name: string, tag: string): string {
  const cls = tag;
  return `<script setup lang="ts">
// Browser stand-in for the Flutter widget <${tag} /> of the "${name}"
// module. The app build renders the real widget; this file is what the web
// build registers under the same tag, so pages are written once.
defineProps<{
  label?: string;
}>();
</script>

<template>
  <view class="${cls}">
    <text class="${cls}__label">{{ label ?? '${tag}' }}</text>
    <slot />
  </view>
</template>

<style scoped>
.${cls} {
  padding: 12px;
  border-radius: 8px;
  border: 1px dashed #c7c7cc;
}
.${cls}__label {
  font-size: 14px;
  color: #6b7280;
}
</style>
`;
}

function dartPubspec(name: string, dartPackage: string): string {
  return `name: ${dartPackage}
description: "Flutter side of the fjs module ${name}."
version: 0.0.1
publish_to: 'none'

environment:
  sdk: ^3.5.4
  flutter: ">=3.22.0"

dependencies:
  flutter:
    sdk: flutter
  flutter_fjs: ^0.1.7
`;
}

function dartSource(
  name: string,
  dartClass: string,
  hostModule: string,
  widgetTag: string | null,
): string {
  const widgetImport = widgetTag ? "import 'package:flutter/material.dart';\n" : '';
  const widgetRegister = widgetTag
    ? `\n    // <${widgetTag} /> in a template renders _build below\n` +
      `    engine.components.register('${widgetTag}', _build);\n`
    : '';
  const widgetBuilder = widgetTag
    ? `
  /// The widget behind <${widgetTag} />. Declared as a ComponentBuilder so
  /// the parameters are typed by inference: \`node\` carries the tag's props
  /// (the flat JSON object JS sent), \`children\` the already-built children,
  /// and \`dispatch\` reports events back to JS.
  static final ComponentBuilder _build = (context, node, children, dispatch) {
    final label = node.props['label'] as String? ?? '${widgetTag}';
    return GestureDetector(
      onTap: () => dispatch(node.id, FjsEvent.tap),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFC7C7CC)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [Text(label), ...children],
        ),
      ),
    );
  };
`
    : '';
  return `// Flutter side of the fjs module "${name}".
//
// fjs autolinks this: the generated host depends on this package and calls
// ${dartClass}.register(engine) before runApp, because the module's
// package.json says so in its "fjs.flutter" field.
import 'dart:io' show Platform;

${widgetImport}import 'package:flutter_fjs/flutter_fjs.dart';

class ${dartClass} {
  /// Registers what this module adds to the engine: host functions JS calls
  /// with invokeHost${widgetTag ? ', and the widget behind its tag' : ''}.
  static void register(FjsEngine engine) {
    engine.host.register('${hostModule}', (args) {
      final message = args.isEmpty ? null : args.first;
      return '\$message from \${Platform.operatingSystem}';
    });
${widgetRegister}  }
${widgetBuilder}}
`;
}

interface ReadmeOptions {
  name: string;
  globalName: string | null;
  flutter: boolean;
  dartPackage: string;
  dartClass: string;
  hostModule: string;
  widgetTag: string | null;
}

function readme(opts: ReadmeOptions): string {
  const use = opts.globalName
    ? `\n组件不用 import，页面里直接写：\n\n\`\`\`vue\n<template>\n  <${opts.globalName} label="hi" />\n</template>\n\`\`\`\n`
    : '';
  const widget = opts.widgetTag
    ? `\n## Flutter widget

\`<${opts.widgetTag} />\` 由 Dart 侧的 \`${opts.dartClass}._build\` 渲染成真正的
Flutter widget（\`engine.components.register\`）。模板里直接写这个标签就行：

\`\`\`vue
<template>
  <${opts.widgetTag} label="hi" />
</template>
\`\`\`

Web 构建没有 Flutter，所以同名标签会渲染 \`components/\` 里的替身 SFC——页面
只写一次，两端都能跑。props 的类型以替身 SFC 的 \`defineProps\` 为准。
`
    : '';
  const flutter = opts.flutter
    ? `\n## Flutter 侧（autolink）

\`flutter/\` 是一个 Flutter package（\`${opts.dartPackage}\`）。项目里装了这个模块之后，
\`fjs run\` / \`fjs build --release\` 生成 Flutter 宿主时会自动：

- 往宿主 \`pubspec.yaml\` 加上对 \`${opts.dartPackage}\` 的依赖；
- 往 \`lib/main.dart\` 加上 import 和 \`${opts.dartClass}.register(engine);\`。

对应的 JS 侧就是 \`invokeHost('${opts.hostModule}', …)\`。已经 \`fjs host eject\` 的宿主
不会被改写，\`fjs modules\` 会打印需要手动补的两行。
`
    : '';
  return `# ${opts.name}

一个 fjs 模块：API 在 \`index.ts\`，组件在 \`components/\`${opts.flutter ? '，Dart 侧在 `flutter/`' : ''}。

## 用法

\`\`\`ts
import { ping } from '${opts.name}';

ping('hi');
\`\`\`
${use}${widget}${flutter}
## 发布到 npm

模块以源码发布（fjs 自己编译 TS 和 SFC），所以没有构建步骤：

\`\`\`bash
npm publish
\`\`\`

别的项目 \`npm i ${opts.name}\` 之后什么都不用配——package.json 里的
\`"fjs": { "module": true }\` 就是 autolink 的开关：裸导入、全局组件、类型提示
${opts.flutter ? '和 Flutter 依赖' : ''}都会自动生效。
`;
}
