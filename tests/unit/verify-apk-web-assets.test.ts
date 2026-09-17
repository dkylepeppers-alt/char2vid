import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function workspaceRoot() {
  return process.cwd();
}

function makeTempDir() {
  const directory = mkdtempSync(join(tmpdir(), 'char2vid-apk-web-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeTree(root: string, files: Record<string, string>) {
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}

function writeApk(files: Record<string, string>) {
  const root = makeTempDir();
  const staging = join(root, 'apk-tree');
  const apkPath = join(root, 'app-debug.apk');
  writeTree(staging, files);
  const zipped = spawnSync(
    'python3',
    [
      '-c',
      'import os, sys, zipfile\nroot, out = sys.argv[1], sys.argv[2]\nwith zipfile.ZipFile(out, "w") as archive:\n    for dirpath, _, names in os.walk(root):\n        for name in names:\n            full = os.path.join(dirpath, name)\n            archive.write(full, os.path.relpath(full, root).replace(os.sep, "/"))\n',
      staging,
      apkPath,
    ],
    { encoding: 'utf8' },
  );
  expect(zipped.status, zipped.stderr).toBe(0);
  return apkPath;
}

function runVerify(apkPath: string, distDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/verify-apk-web-assets.mjs', apkPath, distDir],
    {
      cwd: workspaceRoot(),
      encoding: 'utf8',
    },
  );
}

describe('APK web asset packaging', () => {
  it('accepts an APK whose public assets match the studio dist byte-for-byte', () => {
    const distDir = join(makeTempDir(), 'dist');
    writeTree(distDir, {
      'index.html': '<title>char2vid studio</title>',
      'assets/index.js': 'Make character',
    });
    const apkPath = writeApk({
      'assets/public/index.html': '<title>char2vid studio</title>',
      'assets/public/assets/index.js': 'Make character',
      'assets/public/cordova.js': '/* capacitor */',
    });

    const result = runVerify(apkPath, distDir);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('Verified 2 web assets in the APK');
  });

  it('rejects an APK that still packages a previous web bundle', () => {
    const distDir = join(makeTempDir(), 'dist');
    writeTree(distDir, {
      'index.html': '<script src="/assets/index-new.js"></script>',
      'assets/index-new.js': 'Make character',
    });
    const apkPath = writeApk({
      'assets/public/index.html':
        '<script src="/assets/index-old.js"></script>',
      'assets/public/assets/index-old.js': 'legacy shell',
    });

    const result = runVerify(apkPath, distDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('assets/index-new.js');
    expect(result.stderr).toContain('missing from APK');
  });

  it('rejects an APK whose copied index.html does not match dist', () => {
    const distDir = join(makeTempDir(), 'dist');
    writeTree(distDir, {
      'index.html': '<title>char2vid studio</title>',
    });
    const apkPath = writeApk({
      'assets/public/index.html': '<title>stale studio</title>',
    });

    const result = runVerify(apkPath, distDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('index.html');
    expect(result.stderr).toContain('hash mismatch');
  });

  it('compares large bundled assets without truncating unzip output', () => {
    const distDir = join(makeTempDir(), 'dist');
    const payload = `Make character\n${'x'.repeat(1.5 * 1024 * 1024)}`;
    writeTree(distDir, {
      'index.html': '<title>char2vid studio</title>',
      'assets/index.js': payload,
    });
    const apkPath = writeApk({
      'assets/public/index.html': '<title>char2vid studio</title>',
      'assets/public/assets/index.js': payload,
    });

    const result = runVerify(apkPath, distDir);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('Verified 2 web assets in the APK');
  });

  it('fails closed when the studio dist has no index.html', () => {
    const distDir = join(makeTempDir(), 'dist');
    mkdirSync(distDir);
    const apkPath = writeApk({
      'assets/public/cordova.js': '/* capacitor */',
    });

    const result = runVerify(apkPath, distDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing index.html');
  });
});
