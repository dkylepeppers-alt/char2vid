import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { reviseCharacter } from '../../packages/domain/src/characters/revisions';
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

it('retries generated-slot attach instead of overwriting a concurrent editor revision', async () => {
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
    const editorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const attachId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    let attachSaves = 0;
    let minted = 0;
    const library = {
      getCharacter: handle.library.getCharacter.bind(handle.library),
      getCharacterRevision: handle.library.getCharacterRevision.bind(
        handle.library,
      ),
      async saveCharacterRevision(
        revision: Parameters<typeof handle.library.saveCharacterRevision>[0],
      ) {
        if (attachSaves === 0) {
          const current = await handle.library.getCharacterRevision(
            created.revisionId,
          );
          await handle.library.saveCharacterRevision(
            reviseCharacter(current!, {
              id: editorId,
              identityNotes: 'Keep the source identity.',
            }),
          );
        }
        attachSaves += 1;
        return handle.library.saveCharacterRevision(revision);
      },
    };
    const attached = await attachImportedCharacterSlots(
      library,
      { characterId: created.characterId, role: 'identity', view: 'left' },
      [generated.revisionId],
      () => {
        minted += 1;
        return minted === 1 ? 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' : attachId;
      },
    );
    expect(attached).toBe(true);
    const character = await handle.library.getCharacter(created.characterId);
    const revision = await handle.library.getCharacterRevision(
      character!.currentRevisionId,
    );
    expect(revision?.id).toBe(attachId);
    expect(revision?.parentRevisionId).toBe(editorId);
    expect(revision?.identityNotes).toBe('Keep the source identity.');
    expect(revision?.references[0]?.assetRevisionId).toBe(portrait.revisionId);
    expect(revision?.references[1]?.assetRevisionId).toBe(generated.revisionId);
  } finally {
    await handle.close();
  }
});
