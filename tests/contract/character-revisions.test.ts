import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, describe } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

import { reviseCharacter } from '../../packages/domain/src/characters/revisions';
import {
  acceptReference,
  addCandidateReference,
  createInitialRevision,
  rejectReference,
  selectCover,
} from '../../packages/domain/src/characters/revisions';
import { createLookRevision } from '../../packages/domain/src/characters/looks';
import {
  parseCharacterRecord,
  parseCharacterRevision,
  parseLookRevision,
} from '../../packages/domain/src/characters/schema';
import {
  exportArchive,
  importArchive,
} from '../../packages/storage-web/src/archive';
import { openTestLibrary } from '../helpers/open-test-library';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny.png',
);
const redFixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny-red.png',
);

async function loadPng(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixturePath));
}

async function loadRedPng(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(redFixturePath));
}

it('preserves the original identity revision', () => {
  const original = {
    id: 'cr1',
    characterId: 'c1',
    identityNotes: '',
    references: [
      {
        assetRevisionId: 'portrait1',
        role: 'identity' as const,
        approval: 'approved' as const,
      },
    ],
  };
  const next = reviseCharacter(original, {
    id: 'cr2',
    identityNotes: 'Keep the source identity.',
  });
  expect(original.identityNotes).toBe('');
  expect(next.parentRevisionId).toBe('cr1');
  expect(next.references[0].assetRevisionId).toBe('portrait1');
});

describe('character revision helpers', () => {
  it('does not alias the previous references array', () => {
    const original = createInitialRevision({
      id: 'cr1',
      characterId: 'c1',
      referenceRevisionId: 'portrait1',
    });
    const next = reviseCharacter(original, {
      id: 'cr2',
      identityNotes: 'notes',
    });
    next.references[0] = {
      assetRevisionId: 'other',
      role: 'look',
      approval: 'candidate',
    };
    expect(original.references[0]?.assetRevisionId).toBe('portrait1');
    expect(original.references[0]?.role).toBe('identity');
  });

  it('keeps rejected views out of the following approved set', () => {
    const original = createInitialRevision({
      id: 'cr1',
      characterId: 'c1',
      referenceRevisionId: 'portrait1',
    });
    const withCandidate = addCandidateReference(original, 'cr2', {
      assetRevisionId: 'side1',
      role: 'identity',
      view: 'left',
    });
    const rejected = rejectReference(withCandidate, 'cr3', 'side1');
    expect(
      rejected.references.map((reference) => reference.assetRevisionId),
    ).toEqual(['portrait1']);
    expect(
      withCandidate.references.some(
        (reference) =>
          reference.assetRevisionId === 'side1' &&
          reference.approval === 'candidate',
      ),
    ).toBe(true);
  });

  it('promotes a candidate view only when accepted', () => {
    const original = createInitialRevision({
      id: 'cr1',
      characterId: 'c1',
      referenceRevisionId: 'portrait1',
    });
    const withCandidate = addCandidateReference(original, 'cr2', {
      assetRevisionId: 'back1',
      role: 'body',
      view: 'back',
    });
    expect(withCandidate.references[1]?.approval).toBe('candidate');
    const accepted = acceptReference(withCandidate, 'cr3', 'back1');
    expect(
      accepted.references.find(
        (reference) => reference.assetRevisionId === 'back1',
      )?.approval,
    ).toBe('approved');
    expect(withCandidate.references[1]?.approval).toBe('candidate');
  });

  it('selects cover only from approved references', () => {
    const original = createInitialRevision({
      id: 'cr1',
      characterId: 'c1',
      referenceRevisionId: 'portrait1',
    });
    const withCandidate = addCandidateReference(original, 'cr2', {
      assetRevisionId: 'sheet1',
      role: 'identity',
      view: 'front',
    });
    expect(selectCover(withCandidate, 'portrait1')).toBe('portrait1');
    expect(() => selectCover(withCandidate, 'sheet1')).toThrow(
      /approved character reference/,
    );
  });
});

describe('looks stay independent of base identity', () => {
  it('creates a look without a write path onto character references', () => {
    const character = createInitialRevision({
      id: 'cr1',
      characterId: 'c1',
      referenceRevisionId: 'portrait1',
    });
    const look = createLookRevision({
      id: 'look1',
      characterId: 'c1',
      label: 'Red jacket',
      notes: 'Keep the source identity.',
      referenceRevisionIds: ['outfit1'],
    });
    expect(look.characterId).toBe(character.characterId);
    expect(look.referenceRevisionIds).toEqual(['outfit1']);
    expect(character.references.map((r) => r.assetRevisionId)).toEqual([
      'portrait1',
    ]);
    look.referenceRevisionIds.push('should-not-alias');
    const again = createLookRevision({
      id: 'look1',
      characterId: 'c1',
      label: 'Red jacket',
      notes: 'Keep the source identity.',
      referenceRevisionIds: ['outfit1'],
    });
    expect(again.referenceRevisionIds).toEqual(['outfit1']);
  });
});

describe('persisted characters', () => {
  it('creates a usable character from one available image revision', async () => {
    const png = await loadPng();
    const handle = await openTestLibrary();
    try {
      const asset = await handle.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'portrait.png',
        mime: 'image/png',
      });
      const created = await handle.library.createCharacter({
        name: 'Mira',
        referenceRevisionId: asset.revisionId,
      });
      const character = await handle.library.getCharacter(created.characterId);
      expect(character?.name).toBe('Mira');
      expect(character?.currentRevisionId).toBe(created.revisionId);
      expect(character?.coverAssetRevisionId).toBe(asset.revisionId);
      const revision = await handle.library.getCharacterRevision(
        created.revisionId,
      );
      expect(revision?.references).toEqual([
        {
          assetRevisionId: asset.revisionId,
          role: 'identity',
          view: 'front',
          approval: 'approved',
        },
      ]);
      parseCharacterRecord(character);
      parseCharacterRevision(revision);
    } finally {
      await handle.close();
    }
  });

  it('rejects createCharacter without an available local image', async () => {
    const handle = await openTestLibrary();
    try {
      await expect(
        handle.library.createCharacter({
          name: 'Ghost',
          referenceRevisionId: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/available image revision/);
    } finally {
      await handle.close();
    }
  });

  it('keeps the character when the local source file later goes missing', async () => {
    const png = await loadPng();
    const handle = await openTestLibrary();
    try {
      const asset = await handle.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'portrait.png',
        mime: 'image/png',
      });
      const created = await handle.library.createCharacter({
        name: 'Mira',
        referenceRevisionId: asset.revisionId,
      });
      await handle.markAssetMissing(asset.id);
      const availability = await handle.library.referenceAvailability(
        asset.revisionId,
      );
      expect(availability).toBe('missing');
      const character = await handle.library.getCharacter(created.characterId);
      expect(character?.id).toBe(created.characterId);
      const revision = await handle.library.getCharacterRevision(
        created.revisionId,
      );
      expect(revision?.references[0]?.assetRevisionId).toBe(asset.revisionId);
    } finally {
      await handle.close();
    }
  });

  it('saves independent looks without rewriting base character references', async () => {
    const png = await loadPng();
    const red = await loadRedPng();
    const handle = await openTestLibrary();
    try {
      const portrait = await handle.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'portrait.png',
        mime: 'image/png',
      });
      const jacket = await handle.library.importMedia({
        kind: 'browser-file',
        handle: red,
        name: 'jacket.png',
        mime: 'image/png',
      });
      const created = await handle.library.createCharacter({
        name: 'Mira',
        referenceRevisionId: portrait.revisionId,
      });
      const before = await handle.library.getCharacterRevision(
        created.revisionId,
      );
      const look = createLookRevision({
        id: crypto.randomUUID(),
        characterId: created.characterId,
        label: 'Red jacket',
        notes: 'Wardrobe only.',
        referenceRevisionIds: [jacket.revisionId],
      });
      await handle.library.saveLook(look);
      const after = await handle.library.getCharacterRevision(
        created.revisionId,
      );
      expect(after).toEqual(before);
      const stored = await handle.library.listLooks(created.characterId);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.label).toBe('Red jacket');
      expect(stored[0]?.referenceRevisionIds).toEqual([jacket.revisionId]);
      parseLookRevision(stored[0]);
    } finally {
      await handle.close();
    }
  });

  it('round-trips a character package through G4 export/import', async () => {
    const png = await loadPng();
    const red = await loadRedPng();
    const source = await openTestLibrary();
    const target = await openTestLibrary();
    try {
      const portrait = await source.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'portrait.png',
        mime: 'image/png',
      });
      const jacket = await source.library.importMedia({
        kind: 'browser-file',
        handle: red,
        name: 'jacket.png',
        mime: 'image/png',
      });
      const created = await source.library.createCharacter({
        name: 'Mira',
        referenceRevisionId: portrait.revisionId,
      });
      await source.library.saveLook(
        createLookRevision({
          id: crypto.randomUUID(),
          characterId: created.characterId,
          label: 'Red jacket',
          notes: '',
          referenceRevisionIds: [jacket.revisionId],
        }),
      );
      const exported = await exportArchive(source.getArchiveHost(), {
        scope: 'character',
        id: created.characterId,
      });
      const zip = unzipSync(exported.bytes);
      const manifest = JSON.parse(strFromU8(zip['manifest.json']!)) as {
        scope: string;
        scopeId: string;
      };
      expect(manifest.scope).toBe('character');
      expect(manifest.scopeId).toBe(created.characterId);
      const records = JSON.parse(strFromU8(zip['records.json']!)) as {
        characters: unknown[];
        looks: unknown[];
      };
      expect(records.characters).toHaveLength(1);
      expect(records.looks).toHaveLength(1);

      const imported = await importArchive(
        target.getArchiveHost(),
        { bytes: exported.bytes },
        { conflict: 'remap' },
      );
      expect(imported.importedAssets).toBe(2);
      const characters = await target.library.listCharacters();
      expect(characters).toHaveLength(1);
      expect(characters[0]?.name).toBe('Mira');
      const looks = await target.library.listLooks(characters[0]!.id);
      expect(looks[0]?.label).toBe('Red jacket');
      const revision = await target.library.getCharacterRevision(
        characters[0]!.currentRevisionId,
      );
      expect(revision?.references[0]?.role).toBe('identity');
      expect(revision?.references[0]?.approval).toBe('approved');
    } finally {
      await source.close();
      await target.close();
    }
  });
});
