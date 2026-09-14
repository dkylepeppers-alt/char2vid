# Backup and restore validation (G4)

Portable library archives use ZIP packages with `manifest.json`, `records.json`,
and `media/<sha256>.<ext>`. Credentials and temporary signed URLs are excluded
from exports.

## Proven (web / Node contracts)

Implementation PR for this slice targets web + domain first.

| Check                                                                       | Evidence                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Malicious path rejection (`../`, absolute, nested traversal, Windows drive) | `tests/contract/archive.test.ts`                                                   |
| Library export → inspect → import round trip with at least one media asset  | `tests/contract/archive.test.ts`                                                   |
| Conflict remap on colliding asset IDs                                       | `tests/contract/archive.test.ts`                                                   |
| Reject unsafe archives without mutating the existing library                | `tests/contract/archive.test.ts`                                                   |
| Settings → Backup UI can export/import in the browser                       | `apps/studio/src/features/settings/BackupPage.tsx` (manual / Playwright as needed) |

Run:

```sh
npx vitest run tests/contract/archive.test.ts
npm test
npm run typecheck
npm run lint
```

## UNVERIFIED (do not claim done)

- Physical **Android → fresh Android** archive round trip
- **Browser → Android** archive restore on device
- **1 GiB** whole-archive transfer without holding the archive in JavaScript / process memory on device
- Full **character / project** record closure beyond today’s library assets, revisions, tags, and collection membership
- Native `ArchivePlugin` streaming writers/readers beyond the compiling skeleton (labeled `unverified` at runtime)

Native bridge: `packages/native-bridge/src/archive.ts` and
`ArchivePlugin.kt` compile and register, but device round-trips stay UNVERIFIED
until Room/files library streams exist on hardware.
