# Native Room library (G2) validation

## Implemented (compile / unit)

- Room database: `physical_objects`, `import_journal`, `assets`, `revisions`, plus membership tables.
- Journaled import `pending → written → promoted` with startup reconcile in `MediaStoreRepository`.
- Capacitor `Char2vidLibrary` typed plugin (`LibraryPlugin`) — no unrestricted SQL.
- `packages/native-bridge/src/library.ts` wires `LibraryPort` to the plugin (chunked revision reads).
- JVM unit coverage: path layout + PNG signature / SHA-256 streaming hash (`LibraryPathsTest`).

Android CI (`android.yml`) runs `lintDebug`, `testDebugUnitTest`, and `assembleDebug`.

## UNVERIFIED

- Physical Android device or CI emulator: import → close/reopen → hash match (`LibraryImportInstrumentedTest` is authored but not executed by GH Actions).
- Photo Picker / SAF grant copy on hardware.
- Large-video import without whole-file base64 through JavaScript.
- Format/orientation metadata preservation and orientation-corrected thumbnails.
- Browser OPFS-on-device (web adapter path; separate from this native slice).
