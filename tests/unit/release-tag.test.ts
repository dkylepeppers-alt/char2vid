import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

function runTagCheck(response: { output?: string; status: number }) {
  const directory = mkdtempSync(join(tmpdir(), 'char2vid-gh-'));
  temporaryDirectories.push(directory);
  const ghPath = join(directory, 'gh');
  const argumentsPath = join(directory, 'arguments');
  writeFileSync(
    ghPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "$GH_TEST_ARGUMENTS"\nprintf '%s' "$GH_TEST_OUTPUT"\nexit "$GH_TEST_STATUS"\n`,
  );
  chmodSync(ghPath, 0o755);

  const result = spawnSync(
    process.execPath,
    [
      'scripts/require-new-release-tag.mjs',
      'dkylepeppers-alt/char2vid',
      'v1.2.3',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        GH_TEST_ARGUMENTS: argumentsPath,
        GH_TEST_OUTPUT: response.output ?? '',
        GH_TEST_STATUS: String(response.status),
        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
      },
    },
  );
  return { result, arguments: readFileSync(argumentsPath, 'utf8') };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release tag availability', () => {
  it('accepts an authenticated empty matching-ref response', () => {
    const { result, arguments: commandArguments } = runTagCheck({
      output: '0\n',
      status: 0,
    });

    expect(result.status).toBe(0);
    expect(commandArguments).toBe(
      'api\nrepos/dkylepeppers-alt/char2vid/git/matching-refs/tags/v1.2.3\n--jq\n[.[] | select(.ref == "refs/tags/v1.2.3")] | length\n',
    );
  });

  it('rejects an existing matching release tag', () => {
    const { result } = runTagCheck({ output: '1\n', status: 0 });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Release tag v1.2.3 already exists.');
  });

  it('fails closed when the authenticated lookup fails', () => {
    const { result } = runTagCheck({ status: 1 });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Could not verify release tag v1.2.3.');
  });
});
