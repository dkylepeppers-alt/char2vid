# Repository Foundation Implementation Plan

**Goal:** Apply the accepted repository/dependency recommendations and deliver the first scaffold PR, not the full M1–M4 application.

**Spec:** [Studio design](../specs/2026-09-13-char2vid-design.md) and [G1 foundation task](2026-09-13-storage-gallery.md).

**Global constraints:** Native minimum SDK 26; Node 24 LTS; Capacitor 8; npm workspaces with a single exact-version lockfile; no paid provider calls; no embedded credentials; main stays unchanged until PR landing is authorized. Storage, provider jobs, canvas, audio, and video rendering remain subsequent tasks.

**Evidence:** Scaffold and CI landed in [#19](https://github.com/dkylepeppers-alt/char2vid/pull/19); G1 CI evidence + explicit UNVERIFIED device list closed out in docs via [#27](https://github.com/dkylepeppers-alt/char2vid/pull/27). See `docs/validation/android-foundation.md`.

## Task 1: Application and native scaffold

- [x] Create root/workspace manifests, strict TypeScript, lint/format configuration, and reproducible scripts. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19))
- [x] Implement Library/Characters/Create/Projects navigation plus jobs/settings sheets, selected route persistence, draft preservation, native back handling, and touch-accessible layout. Represent unfinished features honestly, without simulated media or working generation controls. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19); Playwright covers in-web behavior)
- [x] Add the design's shared domain contracts and a small native boundary. Resolve Android using Capacitor, never user-agent sniffing. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19))
- [x] Generate and commit the Android project, wrapper, checksums, and minimum SDK 26; pin the template-compatible Java/Gradle/SDK requirements. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19))
- [x] Validate navigation/draft/back behavior, strict checks, production build, and native sync in CI. Record what still requires real-device testing (`docs/validation/android-foundation.md`, [#27](https://github.com/dkylepeppers-alt/char2vid/pull/27)).
  - **UNVERIFIED:** physical-device system back, rotation, keyboard, TalkBack, lifecycle restoration, signed-release verification.

## Task 2: Repository operations and CI

- [x] Add agent instructions, issue/PR templates, dependency updates, environment documentation, and ignore/line-ending rules. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19))
- [x] Add web checks and Android build workflows with one always-evaluated ci-gate, explicit timeouts, cancellation of superseded PR runs, and pinned external actions. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19))
- [x] Add explicit signed-release workflow and scheduled CodeQL analysis. Release signing requires user-provided secrets; PR jobs never receive them. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19))
  - **UNVERIFIED:** an authorized signed-release run with real secrets.
- [x] Create task-tracking issues from the existing 18-task plans. Apply supported repository settings; record unavailable administrative capabilities accurately and provide exact configuration files/instructions. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19) / follow-on ops)

## Task 3: Review and delivery

- [x] Review the complete diff, repair substantive findings, run applicable verification, and commit. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19))
- [x] Save the branch through GitHub, create the PR, and inspect actual workflow results and review state. ([#19](https://github.com/dkylepeppers-alt/char2vid/pull/19); evidence note [#27](https://github.com/dkylepeppers-alt/char2vid/pull/27))
- [x] Record remaining device/signing/admin requirements. Do not claim a built APK, applied rule, or passed check without evidence. (see `docs/validation/android-foundation.md`)
