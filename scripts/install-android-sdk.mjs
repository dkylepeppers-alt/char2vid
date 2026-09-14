import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;

if (!sdkRoot) {
  throw new Error(
    'ANDROID_HOME or ANDROID_SDK_ROOT must identify the Android SDK.',
  );
}

const sdkManager = join(
  sdkRoot,
  'cmdline-tools',
  'latest',
  'bin',
  'sdkmanager',
);

accessSync(sdkManager, constants.X_OK);

const result = spawnSync(
  sdkManager,
  ['platforms;android-36', 'build-tools;36.0.0'],
  { stdio: 'inherit' },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
