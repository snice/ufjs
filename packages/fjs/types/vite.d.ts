export interface FjsVitePlugin {
  name: string;
  enforce: 'pre';
}

export function fjs(): FjsVitePlugin;

/** The app-build hook a Vite plugin can carry (`plugin.fjs.app`). `fjs dev`
 * / `fjs build` load the project's vite.config and run these inside the
 * app bundle (esbuild); plugins without one stay web-only. UI-library
 * adapters (a project-local plugin per library) use it for source patches. */
export interface FjsAppHook {
  /** Files the hook sees: absolute path, `/` separators, Go RegExp syntax
   * (esbuild onLoad filter — no lookarounds or backreferences). */
  filter: RegExp;
  /** New source, or null/undefined to leave the file unchanged. */
  transform(code: string, id: string): string | null | undefined | Promise<string | null | undefined>;
}

export interface FjsPluginExtension {
  fjs?: { app?: FjsAppHook };
}
