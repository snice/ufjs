// wawoff2 ships no types; only decompress is used (bundler/font-face.ts).
declare module 'wawoff2' {
  export function decompress(woff2: Uint8Array): Promise<Uint8Array>;
  export function compress(sfnt: Uint8Array): Promise<Uint8Array>;
}
