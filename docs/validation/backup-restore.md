# Backup and restore validation (G4)

Portable library archives use ZIP packages with `manifest.json`, `records.json`,
and `media/<sha256>.<ext>`. Credentials and temporary signed URLs are excluded
from exports. The native plugin streams through `ZipOutputStream` /
`ZipInputStream`; JavaScript never receives whole-archive bytes on Android.

## Proven (web / Node contracts)

Implementation PR for this slice targets web + domain first.

| Check                                                                       | Evidence                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Malicious path rejection (`../`, absolute, nested traversal, Windows drive) | `tests/contract/archive.test.ts`                                                   |
| Library export → inspect → import round trip with at least one media asset  | `tests/contract/archive.test.ts`                                                   |
| Tag and collection membership survive export → import remap                 | `tests/contract/archive.test.ts`                                                   |
| Conflict remap on colliding asset IDs                                       | `tests/contract/archive.test.ts`                                                   |
| Checksum-mismatched media rejected; library unchanged                       | `tests/contract/archive.test.ts`                                                   |
| Mid-import staging fault rolls back temps/physicals; prior assets intact    | `tests/contract/archive.test.ts`                                                   |
| Soft-trashed assets filtered out of portable library export                 | `tests/contract/archive.test.ts`                                                   |
| Reject unsafe archives without mutating the existing library                | `tests/contract/archive.test.ts`                                                   |
| Settings → Backup UI can export/import in the browser                       | `apps/studio/src/features/settings/BackupPage.tsx` (manual / Playwright as needed) |

**Trash policy:** portable library backups intentionally export only live
(`trashedAt == null`) available assets. Soft-trashed items are omitted so a
restore does not revive trash the user already discarded from the working set.

Run:

```sh
npx vitest run tests/contract/archive.test.ts
npm test
npm run typecheck
npm run lint
```

## Proven (emulator, CI run 34893229015)

Native `ArchivePlugin` / `LibraryArchiver` stream library-scope ZIP export,
inspect, and remap import. JVM tests cover path rules, JSON allowlist codec,
and collision remap. Instrumented tests passed on the `android.yml`
`instrumented` job (API 26 + 34) in
[CI run 34893229015](https://github.com/dkylepeppers-alt/char2vid/actions/runs/34893229015):

| Check                                                                                           | Evidence                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Export → inspect → wipe → import preserves SHA-256 set, tags, and collections; idMap identity   | `ArchiveInstrumentedTest`                   |
| Second import remaps colliding IDs; physical objects stay content-addressed                     | `ArchiveInstrumentedTest`                   |
| Tampered media byte rejected; prior library untouched                                           | `ArchiveInstrumentedTest`                   |
| `../evil` member flagged as `invalidPaths`; import refused                                      | `ArchiveInstrumentedTest`                   |
| Soft-trashed assets omitted from native library export                                          | `ArchiveInstrumentedTest`                   |
| Import is bound to one inspected ZIP snapshot (changing source between opens cannot swap bytes) | `ArchiveInstrumentedTest`                   |
| Import scratch ZIP is removed after success and after a rejected archive                        | `ArchiveInstrumentedTest`                   |
| Path / JSON / remap unit parity with the web schema                                             | `ArchivePathsTest` / JSON / Remap JVM tests |

`scope: 'project' | 'character'` returns structured `unsupported_scope` (those
record types do not exist yet).

## UNVERIFIED (do not claim done)

- Physical **Android → fresh Android** archive round trip (real SAF picker UI)
- **Browser → Android** archive restore on device
- **1 GiB** whole-archive transfer without holding the archive in JavaScript / process memory on device
- Full **character / project** record closure beyond today’s library assets, revisions, tags, and collection membership
- `ExportPlugin` / `ArchivePlugin` system picker UI, persistable SAF grants, and activity callbacks (emulator tests drive `MediaExporter` / `LibraryArchiver` plus file:// destination helpers)
