# Working in char2vid

char2vid is an Android-first React/TypeScript media studio with Nano-GPT as its AI provider. Read the current task and the linked design before editing. The roadmap describes future work; implement only the scope authorized in the current request.

## Sources of truth

- Product and domain design: `docs/superpowers/specs/2026-09-13-char2vid-design.md`.
- Roadmap: `docs/superpowers/plans/2026-09-13-char2vid.md` and its subsystem plans.
- Repository setup: `docs/development/repository-setup.md`.
- Actual source, tests, dependency lockfile, and captured provider responses take precedence over stale examples. Record material deviations.

## Commands and environment

Use the exact Node version in `.nvmrc`, npm workspaces, and the committed root `package-lock.json`.

```sh
npm ci
npm run dev
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run android:sync
npm run android:debug
```

Read `docs/validation/android-foundation.md` for the pinned Android toolchain. Run native commands from the documented directory. Never commit local SDK paths, build output, `.env` secrets, signing keys, generated media, or databases. Commit source-controlled Android project changes and the Gradle wrapper together.

The Nano-GPT MCP server is declared in `.cursor/mcp.json` (`npx -y @nanogpt/mcp`). Enable it with `NANOGPT_API_KEY` in the process environment or a gitignored `.env` — never `VITE_*` or the studio bundle. Paid MCP calls spend provider credits; do not use them in CI. See `docs/development/repository-setup.md`.

`npm run typecheck` (`tsc --build`) uses TypeScript **7.0.2** from `@typescript/native`. The package named `typescript` is `@typescript/typescript6` so `typescript-eslint@8.70.0` can import a compiler API (TypeScript 7.0 does not ship one; published eslint peers remain `typescript <6.1.0`). Do not flatten those aliases to `typescript@7`, and do not use `--legacy-peer-deps` / `--force` to paper over the peer range. Drop the shim only after a typescript-eslint release peers TypeScript 7.

## Architectural boundaries

- `packages/domain`: platform-independent types and behavior; no React, DOM storage, Capacitor, Android, or database drivers.
- `packages/native-bridge`: narrow Android integration contracts. UI uses platform adapters; never sniff user agents or import native drivers into shared domain code.
- Browser persistence belongs behind an IndexedDB/OPFS adapter. Native persistence belongs behind Room/files. UI state and query caches are not the permanent library.
- Future `packages/nanogpt` owns catalog normalization and provider serialization. Credentials and paid submissions belong in the service, never `VITE_*` variables or the frontend bundle.
- Preserve immutable asset/reference revisions, exact model IDs, original media, and accepted prompt text. Never silently drop references or retry a potentially accepted paid submission.

## Verification and delivery

- Use meaningful behavioral tests for changes to persistence, routing/back behavior, jobs, migrations, and request serialization. Do not add tests that only repeat static configuration or generated files.
- Automated tests and CI use authored or sanitized fixtures and never spend provider credits.
- Run focused checks while developing and the required CI checks before PR readiness. A mocked test does not prove real-device or real-provider behavior.
- Work on a feature branch; make coherent commits. PR descriptions explain the problem, resulting behavior, evidence, and concrete limitations.
- Preserve unrelated changes. Do not mark plan tasks complete without their required evidence, or claim an APK was built or installed unless that happened.
- Keep secrets and temporary signed URLs out of logs, fixtures, issue bodies, exports, and screenshots.
- When a change adds a dependency, explain its purpose and keep it in the owning workspace. Pin versions and update the lockfile. Do not preinstall dependencies for unimplemented milestones.

## Cursor Cloud specific instructions

- Run every workspace command on the Node version in `.nvmrc` (currently 24.19.0), matching `engines.node` (`24.x`). A Cloud Agent's default `node` on `PATH` can be an older runtime that masks engine mismatches, so verify `node --version` reports `v24.x` first; if it does not, activate the pinned version from the repository root with `nvm use` (run `nvm install` beforehand if the version is missing).
- The E2E suite requires the Playwright Chromium browser. Install it once per environment with `npx playwright install --with-deps chromium` before running `npm run test:e2e`.
