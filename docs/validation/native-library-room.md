# Native Room library (G2) validation

## Implemented (compile / unit)

- Room database: `physical_objects`, `import_journal`, `assets`, `revisions`, plus membership tables.
- Journaled import `pending → written → promoted` with startup reconcile in `MediaStoreRepository`.
- Capacitor `Char2vidLibrary` typed plugin (`LibraryPlugin`) — no unrestricted SQL.
- `packages/native-bridge/src/library.ts` wires `LibraryPort` to the plugin (chunked revision reads).
- JVM unit coverage: path layout + PNG signature / SHA-256 streaming hash (`LibraryPathsTest`).
- Native `ExportPlugin` / `MediaExporter` save transaction (MediaStore `IS_PENDING` on API 29+, legacy public directory on API 26–28 when `WRITE_EXTERNAL_STORAGE` is granted, otherwise SAF `ACTION_CREATE_DOCUMENT`; share via FileProvider scoped to `filesDir/library/share/`). FileProvider is not granted at filesDir root. The app never requests `WRITE_EXTERNAL_STORAGE`, so production API 26–28 gallery always takes the SAF fallback. The API 26 emulator cell is evidence of that SAF routing (`galleryUsesMediaStore` is false without the grant) — not proof of the production gallery MediaStore path.

Android CI (`android.yml`) `build` job runs `lintDebug`, `testDebugUnitTest`, and `assembleDebug`. The `instrumented` job (API 26 + 34 emulator matrix, `:app:connectedDebugAndroidTest`) is **Proven (emulator, CI run 34893229015)**.

## Proven (emulator, CI run 34893229015)

- Import → close/reopen → hash match (`LibraryImportInstrumentedTest`).
- API 29+ gallery export publishes a MediaStore row with `IS_PENDING = 0`, matching byte count and SHA-256 (`ExportInstrumentedTest.galleryExportPublishesVerifiedMediaStoreRow`, API 34 cell).
- API 26–28 without `WRITE_EXTERNAL_STORAGE` reports gallery-not-available / SAF routing (`ExportInstrumentedTest.galleryWithoutWriteExternalStorageRoutesToSaf`, API 26 cell).
- SAF cancel path returns `cancelled` without writing (`ExportInstrumentedTest`, driven with a null URI rather than UI automation).
- Copy/verify failure deletes the incomplete destination and leaves the source revision intact (`ExportInstrumentedTest.copyFailureRemovesIncompleteDestinationAndPreservesSource`).

## UNVERIFIED

- Physical Android device: import, Photo Picker / SAF grant copy, MediaStore/SAF save, picker cancel/deny, reopen-in-another-app, TalkBack.
- Large-video import without whole-file base64 through JavaScript (on hardware).
- Format/orientation metadata preservation and orientation-corrected thumbnails.
- Browser OPFS-on-device (web adapter path; separate from this native slice).
- Physical SAF `ACTION_CREATE_DOCUMENT` picker UI for API 26–28 gallery fallback (emulator asserts `galleryUsesMediaStore` is false without the grant and drives the file:// SAF helper; it does not launch the system picker).
- Optional granted-legacy MediaStore writer on API 26–28 (`legacyGrantedWriteExternalStorageGalleryExportPublishesVerifiedMediaStoreRow`): skipped on the API 26 CI emulator because public `Pictures/char2vid` was not writable after `pm grant`. Production never requests this permission.
