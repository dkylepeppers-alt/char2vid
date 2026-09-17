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

Implementation landed in PR [#19](https://github.com/dkylepeppers-alt/char2vid/pull/19). For review-fix commit `75b8bae3dd8ce9637c2f8f41faae71d51be4f494`, GitHub Actions run [`34798595246`](https://github.com/dkylepeppers-alt/char2vid/actions/runs/34798595246) passed formatting, linting, strict types, 24 unit tests, Playwright navigation and modal-focus scenarios, Android lint and unit tests, debug APK assembly, artifact packaging, and the aggregate `ci-gate`. It produced artifact `char2vid-debug-34798595246-1`, containing the debug APK and its checksum. CodeQL run [`34798594996`](https://github.com/dkylepeppers-alt/char2vid/actions/runs/34798594996) also passed.

Phone layout (Playwright Chromium viewports, not a physical Android IME): at 390×844 the Create prompt already cleared the fixed bottom nav; at keyboard-sized 390×480 the same prompt previously overlapped it (prompt ~301–481, nav ~405–480). After the content-inset / `dvh` / `scroll-padding` change, Create prompt, Library search, Make character name, and Settings origin/API-key fields stay above the bottom nav at 390×480, and a 900×800 viewport keeps the column side nav. `tests/e2e/phone-keyboard-layout.spec.ts` records that behavior. Physical Android keyboard occlusion remains UNVERIFIED.

### UNVERIFIED (not done — do not check off without evidence)

- Manual download/install of the debug APK onto a physical Android device
- System back: sheet closes before navigate / exit
- Rotation preserves the selected destination
- Keyboard does not hide primary input controls (physical Android IME / WebView `adjustResize` vs overlay)
- TalkBack / accessibility
- Lifecycle restoration
- Signed release verification (no signing credentials / authorized release workflow run yet)
