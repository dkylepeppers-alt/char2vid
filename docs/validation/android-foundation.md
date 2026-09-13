# Android foundation validation

## Pinned toolchain

- Node 24 LTS and npm 11 from the root manifests.
- Capacitor core, CLI, and Android 8.5.2.
- Android minimum SDK 26; compile and target SDK 36; build tools 36.0.0 in CI.
- Temurin Java 21, Android Gradle Plugin 8.13.0, and Gradle 8.14.3.
- The Gradle distribution checksum is pinned in `gradle-wrapper.properties`; `gradle-wrapper.jar.sha256` records the committed wrapper JAR checksum.

Release builds receive `releaseVersionName` and `releaseVersionCode` Gradle properties. Debug builds default to version name `0.1.0` and code `1`.

## Evidence and open checks

The repository checks cover formatting, linting, strict TypeScript, unit tests, production web build, Capacitor sync, Android lint/unit tests, and debug APK assembly. The release workflow repeats the scaffold checks, enforces increasing Android version codes, signs an APK, verifies its signature, and records release metadata.

This workspace has no Android SDK, emulator, physical device, or browser binary. Android compilation and the Playwright navigation scenarios therefore remain pending CI. Physical-device checks remain open for system back behavior, rotation, keyboard layout, and lifecycle restoration. No signing credentials were available, so signed release verification also remains pending an authorized workflow run.
