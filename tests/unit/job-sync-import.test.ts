import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveImportedOutput } from '../../apps/studio/src/features/jobs/job-output-imports';
import { reviseCharacter } from '../../packages/domain/src/characters/revisions';
import {
  JOB_OUTPUT_IMPORT_MAP_KEY,
  reconcileJobOutputs,
  type JobView,
} from '../../apps/studio/src/features/jobs/job-sync';
import { openTestLibrary } from '../helpers/open-test-library';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny.png',
);
const redFixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny-red.png',
);

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function memoryStorage(
  initial: Record<string, string> = {},
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const data = { ...initial };
  return {
    getItem(key) {
      return data[key] ?? null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('job output reconcile', () => {
  it('reuses one imported revision across overlapping syncs instead of minting duplicate slots', async () => {
    const png = new Uint8Array(await readFile(redFixturePath));
    const portraitBytes = new Uint8Array(await readFile(fixturePath));
    const handle = await openTestLibrary();
    const storage = memoryStorage();
    try {
      const portrait = await handle.library.importMedia({
        kind: 'stream',
        handle: portraitBytes,
        name: 'portrait.png',
        mime: 'image/png',
      });
      const created = await handle.library.createCharacter({
        name: 'Mira',
        referenceRevisionId: portrait.revisionId,
      });
      const job: JobView = {
        id: '11111111-1111-4111-8111-111111111111',
        clientRequestId: 'client-1',
        providerState: 'completed',
        saveState: 'pending',
        outputRevisionIds: [],
        characterSlot: {
          characterId: created.characterId,
          role: 'identity',
          view: 'left',
        },
        outputs: [
          {
            ordinal: 0,
            sha256: digest(png),
            mime: 'image/png',
            bytes: png.byteLength,
          },
        ],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes('/outputs/0')) {
            return new Response(png, { status: 200 });
          }
          if (url.includes('/save-progress')) {
            return new Response('{}', { status: 200 });
          }
          if (url.includes('/acknowledge') && init?.method === 'POST') {
            return new Response(
              JSON.stringify({ ...job, saveState: 'saved' }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
          return new Response('missing', { status: 404 });
        }),
      );

      let importCount = 0;
      const library = {
        queryAssets: handle.library.queryAssets.bind(handle.library),
        getCharacter: handle.library.getCharacter.bind(handle.library),
        getCharacterRevision: handle.library.getCharacterRevision.bind(
          handle.library,
        ),
        saveCharacterRevision: handle.library.saveCharacterRevision.bind(
          handle.library,
        ),
        async importMedia(
          source: Parameters<typeof handle.library.importMedia>[0],
        ) {
          importCount += 1;
          return handle.library.importMedia(source);
        },
      };

      const session = { origin: 'http://studio.test' };
      await Promise.all([
        reconcileJobOutputs(session, library as never, job, { storage }),
        reconcileJobOutputs(session, library as never, job, { storage }),
      ]);
      expect(importCount).toBe(1);
      expect(storage.getItem(JOB_OUTPUT_IMPORT_MAP_KEY)).toContain(job.id);
      const character = await handle.library.getCharacter(created.characterId);
      const revision = await handle.library.getCharacterRevision(
        character!.currentRevisionId,
      );
      const generatedSlots = revision?.references.filter(
        (item) => item.approval === 'candidate',
      );
      expect(generatedSlots).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it('does not treat an unrelated same-hash library import as this job output', async () => {
    const png = new Uint8Array(await readFile(redFixturePath));
    const handle = await openTestLibrary();
    try {
      await handle.library.importMedia({
        kind: 'stream',
        handle: png,
        name: 'user-photo.png',
        mime: 'image/png',
      });
      const reused = await resolveImportedOutput(
        handle.library,
        memoryStorage(),
        '11111111-1111-4111-8111-111111111111',
        0,
        digest(png),
      );
      expect(reused).toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  it('rejects a character revision whose parent is no longer current', async () => {
    const handle = await openTestLibrary();
    try {
      const portrait = await handle.library.importMedia({
        kind: 'stream',
        handle: new Uint8Array(await readFile(fixturePath)),
        name: 'portrait.png',
        mime: 'image/png',
      });
      const created = await handle.library.createCharacter({
        name: 'Mira',
        referenceRevisionId: portrait.revisionId,
      });
      const current = await handle.library.getCharacterRevision(
        created.revisionId,
      );
      await handle.library.saveCharacterRevision(
        reviseCharacter(current!, {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          identityNotes: 'editor',
        }),
      );
      await expect(
        handle.library.saveCharacterRevision(
          reviseCharacter(current!, {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            identityNotes: 'stale',
          }),
        ),
      ).rejects.toThrow(/character_revision_conflict/);
    } finally {
      await handle.close();
    }
  });
});
