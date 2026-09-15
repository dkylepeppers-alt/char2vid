import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('service start imports (P2)', () => {
  it('resolves extensioned TypeScript imports under Node type stripping', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '--eval',
        "await import('./apps/service/src/app.ts')",
      ],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
  });
});
