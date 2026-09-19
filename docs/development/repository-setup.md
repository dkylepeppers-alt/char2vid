# Repository setup and dependency policy

This document distinguishes committed configuration from settings that must be applied through an administrative GitHub connection.

## Development

Use the exact Node version in `.nvmrc` and the package manager recorded in `package.json`. Install with `npm ci` from the repository root. The root lockfile is authoritative for all workspaces.

```sh
npm ci
npm run dev
```

The studio on `main` already includes local library, durable jobs, characters/looks, and C2 Create compile/slot-attach. Production editing (M4) remains in later roadmap tasks. No API key is needed to browse the local library.

`AGENTS.md` lists commands and architecture boundaries. `docs/validation/android-foundation.md` records the native toolchain and actual verification evidence.

TypeScript 7.0.2 is the `tsc` compiler (`@typescript/native`). The `typescript` package name is the TypeScript 6 compatibility API (`@typescript/typescript6`) required by `typescript-eslint` until a release peers TypeScript 7. Keep both aliases; a single `typescript@7` install fails `npm ci` peer resolution and crashes eslint.

## Validation and APK downloads

Pull requests run **Checks**, which validates the web application and calls the reusable Android workflow. The **ci-gate** job runs even after an upstream failure and succeeds only when both web and Android checks succeed. It has no path filter that could leave a required check permanently pending.

The Android build uploads a ZIP artifact containing `char2vid-debug.apk` and `SHA256SUMS.txt`; download it from the workflow run's Artifacts section and extract it on Android. GitHub may require signing in to download artifacts. After `assembleDebug`, CI compares every file in `apps/studio/dist` to `assets/public/` inside the APK so a skipped or stale Capacitor sync cannot ship an older web UI. The standalone **Android** workflow can also be dispatched manually after it exists on the default branch.

Debug APKs use a disposable debug signing key and application data must not be treated as release data. Different hosted runners may produce different debug keys: installing a later debug APK over an earlier one can fail. Stable upgrades require the signed-release path below. Do not uninstall an app containing needed media without first backing it up once storage exists.

Web E2E tests do not certify physical Android back, rotation, keyboard, file-picker, or storage behavior. Keep those device checks open until performed.

## Administrative settings

The payloads in `.github/repository/` were applied to `dkylepeppers-alt/char2vid` with an admin-authenticated `gh` CLI:

- Squash-only merging, PR-title/PR-body squash commits, and automatic merged-branch deletion.
- Active repository ruleset **Main branch protection** (`23398018`) on the default branch: no deletion, no force-push, linear history, pull requests with resolved conversations and zero required approvals, and required GitHub Actions `ci-gate`.
- Milestones `M1: Real local library`, `M2: Reliable generation`, `M3: Character-to-video studio`, and `M4: Complete production`, with the 18 task issues assigned as recorded in `.github/repository/task-tracking.json`.
- Dependency alerts, Dependabot security updates, secret scanning, and push protection.
- The `android-release` environment restricted to `main`. Signing secrets are still added manually; the configure command does not create them.

GitHub rejects `prevent_self_review` unless the environment also has required reviewers. The committed environment payload therefore omits that field (`false` is the default when no reviewers exist). Rerun the commands below after a repository migration or if a GET no longer matches the payloads.

The default invocation prints the proposed configuration and makes no API calls:

```sh
node scripts/configure-repository.mjs
node scripts/configure-repository.mjs --settings
node scripts/configure-repository.mjs --milestones
node scripts/configure-repository.mjs --security
node scripts/configure-repository.mjs --environment
```

After the scaffold PR is merged and **Checks** succeeds on the current `main` commit:

```sh
node scripts/configure-repository.mjs --rules
```

The rules command verifies a successful GitHub Actions `ci-gate` on the exact current default-branch commit, sets the expected check's integration ID from that observed run, and creates or updates only the named foundation ruleset. Other rulesets remain intact. The milestone command reuses exact title matches and refuses to move an issue out of an unrelated milestone. Commands stop on API errors and can be rerun after addressing permissions; earlier successful operations remain applied.

The environment command creates or updates `android-release`, enables custom deployment policies, installs an exact `main` branch policy, and reads both resources back for verification. It omits `prevent_self_review` when that flag is `false`, because GitHub returns HTTP 422 unless required reviewers exist. It fails closed if any existing branch or tag policy would permit another ref and does not delete unexpected user-managed policies. Inspect and resolve those policies manually before rerunning it. The command does not create secrets; add the four secret values manually after it succeeds.

The 18 issue URLs and milestone assignments are recorded in `.github/repository/task-tracking.json`. G1 is closed; remaining physical-device checks are listed in `docs/validation/android-foundation.md`.

Sources: [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [Dependabot configuration](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

## Signed releases

Run `node scripts/configure-repository.mjs --environment` to create the `android-release` environment and restrict it to `main`, then add these environment secrets using GitHub Settings. Keep the same keystore for future updates and retain an independent secure backup:

| Secret                      | Value                           |
| --------------------------- | ------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | Base64-encoded release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password               |
| `ANDROID_KEY_ALIAS`         | Signing key alias               |
| `ANDROID_KEY_PASSWORD`      | Key password                    |

Run **Android release** from `main`, supplying a new `vX.Y.Z` tag and an Android `version_code` greater than every previously recorded code. The workflow reads structured metadata from published and draft releases—signed draft artifacts consume version codes too—and rejects a reused or lower code before signing. It validates the whole scaffold, builds the matching Android version, signs the APK, verifies its signature, and creates a **draft** GitHub release with the APK, checksums, and `android-release.json`. The draft notes show both Android version values and retain a machine-readable metadata marker after publication. The key is decoded only to the temporary runner directory and removed on exit. Review the draft before publishing it.

The workflow does not generate signing credentials or publish a release automatically on a push. Signing cannot be validated until credentials are supplied. Preserve release notes during repository migrations so the monotonic check retains its history; `android-release.json` is also attached to each new draft for an explicit audit record.

## Dependency policy

- Pin direct dependency versions and commit one lockfile. Use the matching Node version across local development and CI.
- Keep React, Vite, and required Android lifecycle integrations in the initial scaffold. Add dependencies in their owning task when real behavior consumes them.
- Add Dexie for browser storage and AndroidX Room behind a Kotlin bridge in G2; add native transfer/share plugins with import/export and transfer tasks.
- Add Fastify and `better-sqlite3` in the service task. Add Zod/provider adapters with their runtime validation contracts.
- Add TanStack Query for remote state, Zustand when transient state warrants it, and TanStack Virtual for the gallery. These never replace durable asset/job storage.
- Add React Flow with S1, Media3 with native editing, and a pinned FFmpeg service image with browser rendering.
- Update Capacitor core/Android/CLI together. Official plugins can have different patch versions; follow their declared compatibility. Review Android Gradle/SDK upgrades as a coordinated toolchain change. Gradle 9.x requires AGP 9.x; do not land a wrapper-only 9.x bump. Keep Capacitor 8 until Capacitor 9 is generally available.
- Dependabot groups routine npm, Actions, and AndroidX changes weekly; major changes remain separate. CI validates updates before landing. Do not ignore TypeScript 7; do not replace `@typescript/native` / `@typescript/typescript6` with a single `typescript@7` while `typescript-eslint` still peers `<6.1.0`.
- Keep small authored media fixtures in Git when needed. Real galleries, generated outputs, database files, APKs, and signing material belong outside source control.

CodeQL currently analyzes JavaScript/TypeScript. Extend coverage to native Java/Kotlin when application-specific native behavior is implemented.
