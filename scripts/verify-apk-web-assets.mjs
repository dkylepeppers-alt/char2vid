import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { unzipSync } from 'fflate';

function listDistFiles(distDir) {
  const files = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(relative(distDir, fullPath).split('\\').join('/'));
      }
    }
  }

  walk(distDir);
  return files.sort();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readApkPublicEntries(apkPath) {
  const entries = unzipSync(readFileSync(apkPath));
  const publicEntries = new Map();
  for (const [entryPath, bytes] of Object.entries(entries)) {
    const normalized = entryPath.replaceAll('\\', '/');
    if (!normalized.startsWith('assets/public/')) {
      continue;
    }
    const relativePath = normalized.slice('assets/public/'.length);
    if (relativePath.length === 0) {
      continue;
    }
    publicEntries.set(relativePath, bytes);
  }
  return publicEntries;
}

export function verifyApkWebAssets(apkPath, distDir) {
  if (!existsSync(apkPath) || !statSync(apkPath).isFile()) {
    throw new Error(`APK not found: ${apkPath}`);
  }
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error(`Studio dist is not a directory: ${distDir}`);
  }

  const distFiles = listDistFiles(distDir);
  if (!distFiles.includes('index.html')) {
    throw new Error('Studio dist is missing index.html.');
  }

  const publicEntries = readApkPublicEntries(apkPath);
  const problems = [];

  for (const relativePath of distFiles) {
    const packaged = publicEntries.get(relativePath);
    if (packaged === undefined) {
      problems.push(`${relativePath} missing from APK`);
      continue;
    }

    const distHash = sha256(readFileSync(join(distDir, relativePath)));
    const apkHash = sha256(packaged);
    if (distHash !== apkHash) {
      problems.push(`${relativePath} hash mismatch`);
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }

  process.stderr.write(`Verified ${distFiles.length} web assets in the APK.\n`);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  try {
    const [apkPath, distDir] = process.argv.slice(2);
    if (apkPath === undefined || distDir === undefined) {
      throw new Error('Use verify-apk-web-assets <apk> <dist>.');
    }
    verifyApkWebAssets(apkPath, distDir);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'APK web asset verification failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
