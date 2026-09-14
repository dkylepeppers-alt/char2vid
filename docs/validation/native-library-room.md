# Native Room library (G2) validation

## Implemented (compile / unit)

- Room database: `physical_objects`, `import_journal`, `assets`, `revisions`, plus membership tables.
- Journaled import `pending → written → promoted` with startup reconcile in `MediaStoreRepository`.
- Capacitor `Char2vidLibrary` typed plugin (`LibraryPlugin`) — no unrestricted SQL.
- `packages/native-bridge/src/library.ts` wires `LibraryPort` to the plugin (chunked revision reads).
- JVM unit coverage: path layout + PNG signature / SHA-256 streaming hash (`LibraryPathsTest`).
- Native `ExportPlugin` / `MediaExporter` save transaction (MediaStore `IS_PENDING` on API 29+, legacy public directory on API 26–28 when `WRITE_EXTERNAL_STORAGE` is granted, otherwise SAF `ACTION_CREATE_DOCUMENT`; share via FileProvider scoped to `filesDir/library/share/`). FileProvider is not granted at filesDir root.

Android CI (`android.yml`) `build` job runs `lintDebug`, `testDebugUnitTest`, and `assembleDebug`. The `instrumented` job (API 26 + 34 emulator matrix, `connectedDebugAndroidTest`) is authored.

## Authored, awaiting CI emulator run

Do not treat these as proven until a GitHub Actions `instrumented` job on this branch is observed green.

- Import → close/reopen → hash match (`LibraryImportInstrumentedTest`).
- Gallery export publishes a MediaStore row with `IS_PENDING = 0`, matching byte count and SHA-256 (`ExportInstrumentedTest`).
- SAF cancel path returns `cancelled` without writing (`ExportInstrumentedTest`, driven with a null URI rather than UI automation).

## UNVERIFIED

- Physical Android device: import, Photo Picker / SAF grant copy, MediaStore/SAF save, picker cancel/deny, reopen-in-another-app, TalkBack.
- Large-video import without whole-file base64 through JavaScript (on hardware).
- Format/orientation metadata preservation and orientation-corrected thumbnails.
- Browser OPFS-on-device (web adapter path; separate from this native slice).
- API 26–28 gallery export when `WRITE_EXTERNAL_STORAGE` is **denied** (plugin falls back to SAF; not covered as a permission-denied emulator case beyond the SAF complete/cancel helpers).
