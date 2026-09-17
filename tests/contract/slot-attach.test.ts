import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { attachImportedCharacterSlots } from '../../apps/studio/src/features/jobs/attach-generated-slot';
import { openTestLibrary } from '../helpers/open-test-library';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny.png',
);
const redFixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny-red.png',
);

it('attaches a saved generation into a character reference slot', async () => {
  const handle = await openTestLibrary();
  try {
    const portrait = await handle.library.importMedia({
      kind: 'stream',
      handle: new Uint8Array(await readFile(fixturePath)),
      name: 'portrait.png',
      mime: 'image/png',
    });
    const generated = await handle.library.importMedia({
      kind: 'stream',
      handle: new Uint8Array(await readFile(redFixturePath)),
      name: 'generated-left.png',
      mime: 'image/png',
    });
    const created = await handle.library.createCharacter({
      name: 'Mira',
      referenceRevisionId: portrait.revisionId,
    });
    const nextId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const attached = await attachImportedCharacterSlots(
      handle.library,
      { characterId: created.characterId, role: 'identity', view: 'left' },
      [generated.revisionId],
      () => nextId,
    );
    expect(attached).toBe(true);
    const character = await handle.library.getCharacter(created.characterId);
    const revision = await handle.library.getCharacterRevision(
      character!.currentRevisionId,
    );
    expect(revision?.id).toBe(nextId);
    expect(revision?.parentRevisionId).toBe(created.revisionId);
    expect(revision?.references[0]?.assetRevisionId).toBe(portrait.revisionId);
    expect(revision?.references[0]?.approval).toBe('approved');
    expect(revision?.references[1]).toEqual({
      assetRevisionId: generated.revisionId,
      role: 'identity',
      view: 'left',
      approval: 'candidate',
    });
  } finally {
    await handle.close();
  }
});
