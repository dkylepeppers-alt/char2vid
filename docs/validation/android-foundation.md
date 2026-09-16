# Android foundation validation

## Pinned toolchain

- Node 24 LTS and npm 11 from the root manifests.
- Capacitor core, CLI, and Android 8.5.2. Capacitor 9 is still a prerelease; 8.5.2 already ships the AGP 9 `proguard-android-optimize.txt` fix, so this project stays on Capacitor 8 GA.
- Android minimum SDK 26; compile and target SDK 36; build tools 36.0.0 in CI.
- Temurin Java 21, Android Gradle Plugin 9.4.0, Kotlin 2.3.21, KSP 2.3.12, and Gradle 9.7.1.
- The Gradle distribution checksum is pinned in `gradle-wrapper.properties`; `gradle-wrapper.jar.sha256` records the committed wrapper JAR checksum (verify from `apps/studio/android/gradle/wrapper/` with `sha256sum -c gradle-wrapper.jar.sha256`).
- Capacitor 8.5.x library modules still classpath AGP 8.13.0. `apps/studio/android/settings.gradle` rewrites those classpaths to 9.4.0 so Gradle 9.6+ can apply the Android plugin. Do not bump only the wrapper.

Release builds receive `releaseVersionName` and `releaseVersionCode` Gradle properties. Debug builds default to version name `0.1.0` and code `1`.

## AGP 9 / Gradle 9 migration

Closed Dependabot PR [#20](https://github.com/dkylepeppers-alt/char2vid/pull/20) bumped the wrapper to 9.7.1 while AGP was still 8.13.0. That combination fails because AGP 8 is not supported on Gradle 9, and Gradle 9.6+ removed `InternalProblems` APIs AGP 8 still calls (`Failed to apply plugin 'com.android.internal.application'` / `AndroidProblemReporterProvider`). Dependabot ignore PR [#50](https://github.com/dkylepeppers-alt/char2vid/pull/50) was closed as superseded; there is no `gradle-wrapper` ignore.

This toolchain is a coordinated bump:

| Pin                   | Previous     | Current                                                  |
| --------------------- | ------------ | -------------------------------------------------------- |
| Gradle wrapper        | 8.14.3       | 9.7.1                                                    |
| Android Gradle Plugin | 8.13.0       | 9.4.0                                                    |
| Kotlin Gradle Plugin  | 2.1.0        | 2.3.21 (built-in Kotlin; pin above AGP's bundled 2.2.10) |
| KSP                   | 2.1.0-1.0.29 | 2.3.12                                                   |
| Capacitor             | 8.5.2        | 8.5.2 (unchanged)                                        |

App-module follow-ups required by AGP 9:

- Stop applying `kotlin-android`; AGP 9 compiles Kotlin itself. Do not re-add it alongside built-in Kotlin.
- Use `proguard-android-optimize.txt` (`proguard-android.txt` is removed).
- Prefer `minSdk` / `targetSdk` and `androidResources.ignoreAssetsPattern` over the AGP 8 names.

## Evidence and open checks

The repository checks cover formatting, linting, strict TypeScript, unit tests, production web build, Capacitor sync, Android lint/unit tests, and debug APK assembly. The release workflow repeats the scaffold checks, enforces increasing Android version codes, signs an APK, verifies its signature, and records release metadata.

Implementation landed in PR [#19](https://github.com/dkylepeppers-alt/char2vid/pull/19). For review-fix commit `75b8bae3dd8ce9637c2f8f41faae71d51be4f494`, GitHub Actions run [`34798595246`](https://github.com/dkylepeppers-alt/char2vid/actions/runs/34798595246) passed formatting, linting, strict types, 24 unit tests, Playwright navigation and modal-focus scenarios, Android lint and unit tests, debug APK assembly, artifact packaging, and the aggregate `ci-gate`. It produced artifact `char2vid-debug-34798595246-1`, containing the debug APK and its checksum. CodeQL run [`34798594996`](https://github.com/dkylepeppers-alt/char2vid/actions/runs/34798594996) also passed.

AGP 9.4.0 + Gradle 9.7.1 landed in PR [#53](https://github.com/dkylepeppers-alt/char2vid/pull/53) on tip `a15b24da8e8639aa3a6f295a12efaa43ce03cbc6`. Local OpenJDK 21 / Node v24.19.0: `./gradlew --no-daemon lintDebug testDebugUnitTest assembleDebug` after `npx cap sync android` — **BUILD SUCCESSFUL**; `testDebugUnitTest` 32 passed / 0 failed; debug APK `com.char2vid.studio` minSdk 26 / targetSdk 36 / compileSdk 36. GitHub Checks run [`35104526203`](https://github.com/dkylepeppers-alt/char2vid/actions/runs/35104526203) passed `web`, `android / build-debug-apk`, emulator `androidTest` on API 26 default and API 34 google_apis, and `ci-gate`. CodeQL run [`35104525692`](https://github.com/dkylepeppers-alt/char2vid/actions/runs/35104525692) also passed.

### UNVERIFIED (not done — do not check off without evidence)

- Manual download/install of the debug APK onto a physical Android device
- On-device Nano-GPT key + foreground job polling (Keystore / paid generation UNVERIFIED)
- System back: sheet closes before navigate / exit
- System back: sheet closes before navigate / exit
- Rotation preserves the selected destination
- Keyboard does not hide primary input controls
- TalkBack / accessibility
- Lifecycle restoration
- Signed release verification (no signing credentials / authorized release workflow run yet)
