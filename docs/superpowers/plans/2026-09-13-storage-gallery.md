# Storage and Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a usable offline Android/PWA gallery with permanent media, organization, native import/export, and portable restore.

**Architecture:** UI calls a platform-neutral repository. Android implements metadata with Room/SQLite and files through native streams; web implements the same behavior using IndexedDB/OPFS. File/database promotion is journaled to survive interruption.

**Tech Stack:** React/TypeScript/Vite, Capacitor 8, Kotlin/Room, Dexie/OPFS, Zod, Vitest, Playwright, Android instrumentation.

**Spec:** [Design](../specs/2026-09-13-char2vid-design.md), especially sections 3, 6–8, 16–18.

## Global Constraints

- Android API 26 is the product support floor.
- Node 22+ and Capacitor 8 are the initial platform baseline.
- Nano-GPT is the sole AI provider.
- Originals and approved outputs are never cache.
- All available model records must remain discoverable by exact ID.
- Potentially accepted media submissions are never retried automatically.
- Credentials and temporary signed URLs are excluded from portable exports and logs.
- Automated fixture tests must not spend provider credits.

## Task G1: Establish the shared app and real Android shell

**Create:** `package.json`, `apps/studio/package.json`, `apps/studio/vite.config.ts`, `apps/studio/capacitor.config.ts`, `apps/studio/src/app/App.tsx`, `apps/studio/src/app/platform.ts`, `packages/domain/src/contracts.ts`, `packages/native-bridge/src/index.ts`, `.github/workflows/checks.yml`, `.github/workflows/android.yml`.

**Tests:** `tests/e2e/navigation.spec.ts`; manual Android installation/back/rotation check in `docs/validation/android-foundation.md`.

**Interfaces:** Copy the proposed shared contracts from design §8. `resolvePlatform(): 'android' | 'web'` selects adapters using the Capacitor runtime; never user-agent sniffing. `App` renders Library/Characters/Create/Projects, with queue and settings controls.

- [ ] Scaffold the React/TypeScript workspace, add Capacitor Android, and commit the generated Android project. Confirm the template's Node/JDK/SDK/Gradle compatibility, pin dependencies and wrapper, and record exact versions in the foundation validation note. Keep native minimum SDK at 26.
- [ ] Define workspace scripts and path aliases. Enforce boundaries: domain has no UI/platform imports; native modules are imported only by the Android adapter. Add the script contract used throughout the remaining plans:

```json
{
  "scripts": {
    "typecheck": "tsc --build",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "build": "npm run build --workspaces --if-present",
    "lint": "eslint ."
  }
}
```

- [ ] Add a failing navigation test, then implement persistent route/draft state and touch-accessible controls:

```ts
import { test, expect } from '@playwright/test';
test('phone navigation survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('link', { name: 'Characters', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Characters', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open jobs' })).toBeVisible();
});
```

- [ ] Verify with `npm run typecheck`, `npm run build`, and `npx playwright test tests/e2e/navigation.spec.ts`. Build with `npx cap sync android` from `apps/studio`, then `./gradlew assembleDebug` in its `android` directory. CI uploads the debug APK as an artifact; use manual workflow dispatch and download/install on Android. No desktop IDE is required for that validation path.
- [ ] Confirm Android back closes a sheet before navigating, rotation preserves the selected destination, and the keyboard does not hide primary input controls. Commit: `chore: establish web and Android studio foundations`.

## Task G2: Implement crash-safe media storage

**Create:** `packages/domain/src/storage.ts`, `packages/domain/src/asset-schema.ts`, `packages/storage-web/src/library.ts`, `packages/storage-web/src/files.ts`, `packages/native-bridge/src/library.ts`, `apps/studio/android/app/src/main/java/com/char2vid/studio/library/LibraryPlugin.kt`, `LibraryDatabase.kt`, `MediaStoreRepository.kt` in that directory, `tests/contract/storage.contract.test.ts`, `tests/helpers/open-test-library.ts`.

**Interfaces:**

```ts
export interface AssetRecord {
  id: string;
  revisionId: string;
  kind: 'image' | 'video' | 'audio' | 'embedding';
  name: string;
  mime: string;
  sha256: string;
  bytes: number;
  state: 'pending' | 'available' | 'missing';
  createdAt: string;
}
export interface ImportSource {
  kind: 'native-uri' | 'browser-file' | 'stream';
  handle: unknown; // Validated only inside the owning platform adapter.
  name: string;
  mime: string;
}
export interface LibraryPort {
  importMedia(source: ImportSource): Promise<AssetRecord>;
  getAsset(id: string): Promise<AssetRecord | undefined>;
  readRevision(revisionId: string): Promise<ReadableStream<Uint8Array>>;
  reconcileImports(): Promise<{ repaired: number; missing: string[] }>;
  storageUsage(): Promise<{ originals: number; cache: number; available?: number }>;
}
```

`openTestLibrary({ location, fault? })` creates a temporary real browser-storage test environment or service-side test filesystem with the same transaction protocol; it returns `{ library: LibraryPort, close(): Promise<void>, physicalObjectCount(): Promise<number> }`. Native instrumentation independently runs the import/close/reopen checks against Room/files, rather than treating the web adapter's test as native proof. Fault values are `after-write` and `after-promote`.

- [ ] Add a persistence test with a small valid image fixture, import, close/reopen the repository, and compare the re-read content hash. Add fault injection after file promotion and a shared-file test proving removal of one logical asset does not remove a file referenced by another.
- [ ] Run `npx vitest run tests/contract/storage.contract.test.ts` and confirm the initial failure. Implement tables for assets, revisions, physical objects, and import journal. SQLite schema must include these constraints:

```sql
CREATE TABLE physical_objects (
  sha256 TEXT PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0)
);
CREATE TABLE import_journal (
  import_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('pending','written','promoted')),
  temp_path TEXT NOT NULL,
  final_hash TEXT
);
```

- [ ] Stream into a temporary object, verify file signature/size/hash, promote, then transactionally register its revision and clear the journal. Implement restart reconciliation for every stage. Add typed Room commands rather than exposing unrestricted SQL to the UI. Web fallback stores blobs only when OPFS is unavailable, shows the storage mode, and rejects allocations that exceed its configured fallback limit.
- [ ] Run the focused contract tests and native instrumentation. Test storage-full and malformed input failures, picker-URI copying, and an import of a large video without full-file base64 transfer through JavaScript. Preserve format/orientation metadata; generate thumbnails from corrected orientation without modifying originals.
- [ ] Commit: `feat: add crash-safe native and browser media storage`.

## Task G3: Build organization, playback, and native exports

**Create:** `packages/domain/src/library-query.ts`, `packages/domain/src/library-actions.ts`, `apps/studio/src/features/library/LibraryPage.tsx`, `AssetDetail.tsx`, `SelectionBar.tsx` in that directory, `packages/native-bridge/src/media-export.ts`, `apps/studio/android/app/src/main/java/com/char2vid/studio/library/ExportPlugin.kt`, `tests/contract/library-actions.test.ts`, `tests/e2e/library.spec.ts`.

**Interfaces:** `queryAssets({ text?, kind?, folderId?, collectionId?, tags?, favorite?, sort, cursor?, limit }): Promise<{ assets: AssetRecord[]; nextCursor?: string }>` uses stable `(sortValue,id)` ordering. `applyLibraryAction({ assetIds, action, value? }): Promise<void>` supports tag, favorite, rating, collection, folder, trash, and restore. `exportRevision({ revisionId, destination: 'gallery' | 'files' | 'share' }): Promise<{ status: 'saved' | 'cancelled'; displayName?: string }>` is platform-owned.

- [ ] Write a contract case for one asset belonging to two collections, being removed from one, then being trashed/restored without changing its file hash. Add a pagination case with identical timestamps to prevent duplicate/missing grid items.
- [ ] Implement relational membership tables and indexes; use soft deletion for Trash and reference-counted physical deletion only on explicit permanent removal. Build a virtualized gallery, batch selection, search/filter, fit-to-screen detail, video/audio playback, and provenance display.
- [ ] Implement native picker and export actions. The native save transaction is:

```text
resolve immutable revision -> open source stream
create pending MediaStore destination or user-selected SAF destination
copy and verify byte count -> publish destination -> return saved
if user cancels picker -> return cancelled
if copy fails -> remove incomplete destination -> preserve source -> return error
```

Use `FileProvider`/temporary content-URI grants for sharing. Never report a share chooser opening as proof the recipient received a file.

- [ ] Run `npx vitest run tests/contract/library-actions.test.ts` and `npx playwright test tests/e2e/library.spec.ts`. On Android, save PNG/MP4/audio into system-visible destinations, cancel a picker, deny access, and reopen the exported files in another app. Check 48-pixel controls and TalkBack labels.
- [ ] Commit: `feat: add organized gallery and native media export`.

## Task G4: Implement portable archives and migration recovery

**Create:** `packages/domain/src/archive-schema.ts`, `packages/domain/src/archive-remap.ts`, `packages/storage-web/src/archive.ts`, `packages/native-bridge/src/archive.ts`, `apps/studio/android/app/src/main/java/com/char2vid/studio/library/ArchivePlugin.kt`, `apps/studio/src/features/settings/BackupPage.tsx`, `tests/contract/archive.test.ts`, `docs/validation/backup-restore.md`.

**Interfaces:** `exportArchive({ scope: 'library' | 'project' | 'character', id?: string }): Promise<{ transferId: string }>` streams through the platform writer. `inspectArchive(source): Promise<ArchiveReport>` validates before mutation. `importArchive(source, { conflict: 'remap' }): Promise<{ idMap: Record<string,string> }>` commits only after verification. `ArchiveReport` contains `schemaVersion`, `fileCount`, `expandedBytes`, `missingFiles`, `invalidPaths`, and `unsupportedVersion`.

Archive version 1 includes `manifest.json`, `records.json`, and `media/<sha256>.<extension>`. Record serializers export only allowlisted durable fields; UI prompts and character records can contain arbitrary Unicode text.

- [ ] Add actual archive round-trip tests and malicious-path tests before implementing import. Use these assertions in the archive test:

```ts
import { expect, it } from 'vitest';
import { validateArchivePath } from '../../packages/domain/src/archive-schema';
it.each(['../secret', '/absolute', 'media/../../secret', 'C:\\secret'])
  ('rejects an unsafe member path: %s', path => {
    expect(validateArchivePath(path)).toBe(false);
  });
it('accepts a relative media member', () => {
  expect(validateArchivePath('media/abc123.png')).toBe(true);
});
```

- [ ] Implement path normalization, count/expanded-size limits, checksum verification, a collision map, and a dependency-closure exporter. Remap every ID reference in characters, looks, shots, graph edges, and timeline records. Keep this traversal schema-owned so future record types cannot silently lose links.
- [ ] Implement staging import with rollback, schema-version dispatch, and migration backups. Exclude credentials and signed URLs. Interrupted exports leave no apparently complete archive; interrupted imports leave the existing library intact.
- [ ] Run `npx vitest run tests/contract/archive.test.ts`. Perform Android → fresh Android and browser → Android round trips. After later milestones add character/project records to the same tests. Measure a 1 GiB archive without whole-archive memory allocation.
- [ ] Commit: `feat: add portable library and project archives`.

## Milestone acceptance

- [ ] A real Android installation can import, organize, play, export, restart, and restore media offline.
- [ ] Originals survive cache cleanup and failed imports; shared files retain all remaining references.
- [ ] Browser quota/denied persistence states have usable backup and error behavior.
- [ ] Gallery performance is measured at 5,000 records; large native transfers do not pass whole files through JavaScript.

Continue with [Provider and jobs](2026-09-13-provider-jobs.md).
