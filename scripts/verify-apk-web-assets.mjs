import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

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

function extractApkPublicTree(apkPath) {
  const extractRoot = mkdtempSync(join(tmpdir(), 'char2vid-apk-public-'));
  const result = spawnSync('unzip', ['-qq', '-o', apkPath, '-d', extractRoot], {
    encoding: 'utf8',
  });
  if (result.error) {
    rmSync(extractRoot, { recursive: true, force: true });
    throw new Error(`Could not run unzip: ${result.error.message}`);
  }
  if (result.status !== 0) {
    rmSync(extractRoot, { recursive: true, force: true });
    const detail = String(result.stderr ?? result.stdout ?? '').trim();
    throw new Error(detail || 'unzip failed to extract APK web assets.');
  }
  return extractRoot;
}

function resolvePackagedFile(publicRoot, relativePath) {
  const packaged = join(publicRoot, relativePath);
  const prefix = publicRoot.endsWith(sep) ? publicRoot : `${publicRoot}${sep}`;
  if (packaged !== publicRoot && !packaged.startsWith(prefix)) {
    throw new Error(`${relativePath} escapes the APK public tree.`);
  }
  return packaged;
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

  const extractRoot = extractApkPublicTree(apkPath);
  try {
    const publicRoot = join(extractRoot, 'assets', 'public');
    const problems = [];

    for (const relativePath of distFiles) {
      const packaged = resolvePackagedFile(publicRoot, relativePath);
      if (!existsSync(packaged) || !statSync(packaged).isFile()) {
        problems.push(`${relativePath} missing from APK`);
        continue;
      }

      const distHash = sha256(readFileSync(join(distDir, relativePath)));
      const apkHash = sha256(readFileSync(packaged));
      if (distHash !== apkHash) {
        problems.push(`${relativePath} hash mismatch`);
      }
    }

    if (problems.length > 0) {
      throw new Error(problems.join('\n'));
    }
  } finally {
    rmSync(extractRoot, { recursive: true, force: true });
  }

  process.stderr.write(`Verified ${distFiles.length} web assets in the APK.\n`);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  const [apkPath, distDir] = process.argv.slice(2);
  if (apkPath === undefined || distDir === undefined) {
    throw new Error('Use verify-apk-web-assets <apk> <dist>.');
  }
  verifyApkWebAssets(apkPath, distDir);
}
