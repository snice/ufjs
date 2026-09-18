// Release manifest paths and hashes: what an embedded host reads from its
// assets, and what a web-hosted build (`--root-path .`) serves as-is.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseBuildArgs,
  RELEASE_ROOT_PATH,
  releaseAssetHashes,
  releasePathPrefix,
} from '../src/bundler/build.js';

describe('--root-path', () => {
  it('defaults to the Flutter asset root', () => {
    expect(parseBuildArgs(['--release']).rootPath).toBe(RELEASE_ROOT_PATH);
  });

  it('accepts both spellings', () => {
    expect(parseBuildArgs(['--release', '--root-path', '.']).rootPath).toBe('.');
    expect(parseBuildArgs(['--release', '--rootPath', 'cdn/app']).rootPath).toBe('cdn/app');
  });

  it('turns into a path prefix', () => {
    expect(releasePathPrefix('assets/fjs/')).toBe('assets/fjs/');
    expect(releasePathPrefix('assets/fjs')).toBe('assets/fjs/');
    expect(releasePathPrefix('.')).toBe('');
    expect(releasePathPrefix('./')).toBe('');
    expect(releasePathPrefix('')).toBe('');
  });
});

describe('releaseAssetHashes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-release-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'shared.fjsbundle.gz'), 'shared');
  fs.writeFileSync(path.join(dir, 'pages', 'about.fjsbundle.gz'), 'about');
  const files = [
    path.join(dir, 'shared.fjsbundle.gz'),
    path.join(dir, 'pages', 'about.fjsbundle.gz'),
  ];
  const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

  it('keys each file by the path the manifest names it by', () => {
    expect(releaseAssetHashes(dir, '', files)).toEqual({
      'shared.fjsbundle.gz': sha('shared'),
      'pages/about.fjsbundle.gz': sha('about'),
    });
    expect(Object.keys(releaseAssetHashes(dir, 'assets/fjs/', files))).toEqual([
      'assets/fjs/shared.fjsbundle.gz',
      'assets/fjs/pages/about.fjsbundle.gz',
    ]);
  });
});
