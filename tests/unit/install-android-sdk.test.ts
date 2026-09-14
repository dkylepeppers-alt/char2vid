import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Android SDK package installation', () => {
  it('runs sdkmanager from ANDROID_HOME when it is absent from PATH', () => {
    const sdkRoot = mkdtempSync(join(tmpdir(), 'char2vid-android-sdk-'));
    temporaryDirectories.push(sdkRoot);

    const sdkManagerDirectory = join(sdkRoot, 'cmdline-tools', 'latest', 'bin');
    const sdkManager = join(sdkManagerDirectory, 'sdkmanager');
    const argumentsFile = join(sdkRoot, 'sdkmanager-arguments.txt');

    mkdirSync(sdkManagerDirectory, { recursive: true });
    writeFileSync(
      sdkManager,
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$SDK_ARGS_FILE"\n',
    );
    chmodSync(sdkManager, 0o755);

    const result = spawnSync(
      process.execPath,
      ['scripts/install-android-sdk.mjs'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          ANDROID_HOME: sdkRoot,
          ANDROID_SDK_ROOT: '',
          PATH: '/usr/bin:/bin',
          SDK_ARGS_FILE: argumentsFile,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(argumentsFile, 'utf8')).toBe(
      'platforms;android-36\nbuild-tools;36.0.0\n',
    );
  });
});
