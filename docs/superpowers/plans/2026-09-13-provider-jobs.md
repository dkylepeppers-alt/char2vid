# Provider and Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the complete Nano-GPT catalog with validated requests, large reference transfers, durable jobs, and honest cost/recovery behavior.

**Architecture:** A typed Nano-GPT package is independent of UI and platform files. The personal service authenticates devices, stages media, stores provider credentials, and executes durable jobs. Clients receive receipts and download verified results into their library.

**Tech Stack:** TypeScript, Zod, Fastify, SQLite, streaming HTTP/files, Vitest; existing domain/storage packages.

**Spec:** [Design](../specs/2026-09-13-char2vid-design.md), especially sections 8–13 and 18. Read the [research findings](../../research/2026-09-13-research.md) before implementation.

## Global Constraints

- Android API 26 is the product support floor.
- Node 22+ and Capacitor 8 are the initial platform baseline.
- Nano-GPT is the sole AI provider.
- Originals and approved outputs are never cache.
- All available model records must remain discoverable by exact ID.
- Potentially accepted media submissions are never retried automatically.
- Credentials and temporary signed URLs are excluded from portable exports and logs.
- Automated fixture tests must not spend provider credits.

## Task P1: Establish catalog and transport contracts from evidence

**Create:** `packages/nanogpt/src/catalog/catalog-schema.ts`, `normalize.ts`, `refresh.ts` in that directory; `packages/nanogpt/src/contracts/route-contract.ts`, `docs/validation/provider-contracts.md`, `tests/fixtures/nanogpt/catalogs.json`, `tests/contract/catalog.test.ts`.

**Interfaces:** `normalizeCatalog(catalog, raw, fetchedAt): { models: ModelDescriptor[]; issues: CapabilityIssue[] }` accepts the four generation catalog names in design §8. `refreshCatalogs(): Promise<Record<string, { state: 'fresh' | 'stale' | 'unavailable'; count: number; fetchedAt?: string }>>` updates modalities independently. `normalizeControls(raw): ParameterControl[]` preserves wire types; `ParameterControl` has `key`, `kind: 'select' | 'boolean' | 'number' | 'text' | 'unsupported'`, optional `options/min/max/default`, and `raw`.

- [x] Retrieve current public catalogs, selected image endpoint metadata, and documentation. Record exact URLs, observation dates, hashes, and differences. Use small authored fixtures for mixed control schemas; label observed fixtures with source/date and remove signed URLs/credentials. Do not save entire documentation or account responses in tests.
  - Evidence: unauthenticated GETs on 2026-09-14 recorded in `tests/fixtures/nanogpt/catalogs.json` `provenance.liveRefresh` and `docs/validation/provider-contracts.md` (text 601, image 234, video 161, audio 87). gpt-image-2 and Seedream endpoint-metadata SHA-256 unchanged from the 2026-09-13 snapshot. Fixtures are labeled `authored` or `sanitized-observed` with source/date; no signed URLs or credentials. Docs were re-read, not dumped into tests.
  - **UNVERIFIED:** authenticated catalog/personalized views; any generation response.
- [x] Write the new-model, duplicate-name, mixed-parameter, unknown-control, and partial-refresh-failure cases. For example:

```ts
import { expect, it } from 'vitest';
import { normalizeCatalog } from '../../packages/nanogpt/src/catalog/normalize';
it('keeps distinct IDs sharing a display name', () => {
  const raw = { data: [
    { id: 'vendor/example', name: 'Example', capabilities: { image_generation: true } },
    { id: 'vendor/example/edit', name: 'Example', capabilities: { image_to_image: true } }
  ] };
  const result = normalizeCatalog('image', raw, '2026-09-13T00:00:00Z');
  expect(result.models.map(m => m.id)).toEqual(['vendor/example', 'vendor/example/edit']);
});
```

  - Evidence: `tests/contract/catalog.test.ts` covers new unknown IDs, the plan's duplicate-name example, mixed flat/nested/enum/range controls, `kind: 'unsupported'`, `max_images` as output count (not an input-reference limit), catalog-vs-endpoint conflicts, independent refresh stale/unavailable, envelope-level blocking refresh failures, and route-registry evidence/verification rules. Focused run: `npx vitest run tests/contract/catalog.test.ts` (48 passed).
- [x] Run `npx vitest run tests/contract/catalog.test.ts`, then implement independent fetch/caches and exact-ID merging. Normalize flat arrays/counts, nested `parameters/defaults`, and enum/range descriptors. `max_images` alone does not define maximum input references. Record conflicts rather than selecting a convenient value.
  - Evidence: `packages/nanogpt/src/catalog/{normalize,refresh}.ts` with injected fetcher/clock. Conflicts become `CapabilityIssue`s; limits stay unknown when sources disagree.
- [x] Define `RouteContract` with base URL, path, operation, auth style, allowed fields, role mapping, limits, response variants, verification state, evidence URL/date, and override expiry. Distinguish generic known contracts from unresolved family-specific parameters. OpenAPI generation must be selective because newer routes are absent and bases can be overridden.
  - Evidence: `packages/nanogpt/src/contracts/route-contract.ts` plus `docs/validation/provider-contracts.md`. Compat image path uses the OpenAPI server override (`https://nano-gpt.com/v1/images/generations`) and records the research-table `/api/v1/…` disagreement. No registry entry is `observed` (no generation fixture).
- [x] Re-run focused tests, retrieve catalogs without generating, and commit: `feat: discover Nano-GPT models and normalize capabilities`.
  - Evidence: focused catalog tests plus `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` on this branch. Catalog retrieval was unauthenticated GET only.
  - **UNVERIFIED:** every paid/authenticated generation, status, and download path listed in `docs/validation/provider-contracts.md` § UNVERIFIED.

## Task P2: Create authenticated service and temporary media transport

**Create:** `apps/service/src/app.ts`, `auth/enrollment.ts`, `auth/sessions.ts`, `auth/credentials.ts`, `transfers/store.ts`, `transfers/routes.ts`, `transfers/signed-inputs.ts`, `network/safe-download.ts`, `db/migrations/001-service.sql`, `apps/studio/src/features/settings/ServiceSettings.tsx`, `packages/native-bridge/src/credentials.ts`, `tests/contract/service-security.test.ts`, `tests/contract/transfers.test.ts`.

**Interfaces:** App-owned routes are:

| Method/path | Contract |
|---|---|
| `POST /studio-api/setup` | One-time deployment bootstrap token establishes owner login; disabled after setup |
| `POST /studio-api/session` | Owner login; browser receives HttpOnly cookie, native receives an enrollment/session credential |
| `DELETE /studio-api/session` | Revoke current device/session |
| `PUT /studio-api/provider-key` | Validate and encrypt a Nano-GPT key; response contains masked metadata only |
| `POST /studio-api/transfers` | `{ sha256, bytes, mime, purpose }` → `{ transferId, chunkBytes: 8388608 }` |
| `PUT /studio-api/transfers/:id/parts/:index` | Idempotent bounded chunk write; same index/different bytes conflicts |
| `POST /studio-api/transfers/:id/finalize` | Validate complete length/hash → finalized transfer receipt |
| `GET /studio-api/transfers/:id` | Authenticated progress/status and expiry |
| `GET /studio-media/:id?signature=...` | Narrow signed GET for provider input; no directory browsing |

`safeDownload(url, destination, limits)` validates every DNS resolution/redirect, rejects private/link-local destinations, enforces MIME/size/time bounds, and never forwards inference headers across origins.

**Evidence (this PR):** Fastify + `node:sqlite` service, AES-256-GCM provider-key vault, HttpOnly cookie vs native bearer, 8 MiB resumable parts, HMAC-signed `GET /studio-media/:id`. Contract tests use fake keys only and never call Nano-GPT. Live `POST /api/check-balance` key validation, HTTPS deployment, and physical Keystore proof remain **UNVERIFIED**. Job-bound input leases wait for P4.

- [x] Add tests proving unauthenticated writes fail, setup cannot be reused, a device cannot access another owner's transfer, repeated identical chunks are accepted, changed chunks conflict, and a truncated upload cannot finalize.
  - Evidence: `tests/contract/service-security.test.ts` and `tests/contract/transfers.test.ts` (`npx vitest run tests/contract/service-security.test.ts tests/contract/transfers.test.ts tests/unit/validate-key.test.ts` — 15 passed).
- [x] Implement owner sessions, device revocation, CSRF/origin checks for browser mutations, login throttling, and encrypted provider-key storage. Cryptography uses authenticated encryption, a unique nonce per write, and an environment-supplied master key. Store native app-service credentials through Keystore; do not put a Nano-GPT key in frontend configuration.
  - Evidence: `apps/service/src/auth/*`, Settings UI posts the key to the service only, `packages/native-bridge/src/credentials.ts` + `CredentialsPlugin` (AndroidKeyStore). **UNVERIFIED:** physical-device Keystore round-trip; live check-balance against a real key.
- [x] Implement transfer state with transactional finalization:

```text
authorized create -> quota reservation -> parts written to temporary directory
finalize -> verify contiguous part sequence, total bytes, and SHA-256
atomic promote -> finalized transfer record -> available for job binding
sign only a finalized object owned by the job owner
retain active job inputs; expire terminal/unclaimed data by the spec policy
```

  - Evidence: `apps/service/src/transfers/*` — quota reservation, contiguous finalize, checksum, restart mid-upload, stale signature, SSRF-safe download. Pending TTL 24h / finalized 7d. Write/finalize reject expired transfers.
- [ ] Bind finalized objects to job-bound input leases (deferred to P4).
- [x] Run `npx vitest run tests/contract/service-security.test.ts tests/contract/transfers.test.ts`. Include redirect-to-private-network, stale signature, wrong checksum, service restart during upload, and quota exhaustion. Use fake credentials only.
  - Evidence: focused vitest on those files; Playwright cannot prove a live HTTPS deploy from CI.
- [ ] Verify real HTTPS availability and staging persistence when deploying the service. **UNVERIFIED.**
- [x] Commit: `feat: add private generation service and resumable media staging`.

## Task P3: Build the model picker and request serializers

**Create:** `apps/studio/src/features/create/ModelPicker.tsx`, `ModelControls.tsx`, `ReferenceTray.tsx`, `packages/nanogpt/src/adapters/image.ts`, `video.ts`, `audio.ts`, `text.ts` in that directory, `packages/nanogpt/src/validation.ts`, `tests/contract/request-serialization.test.ts`, `tests/e2e/model-picker.spec.ts`.

**Interfaces:** Each adapter implements `ProviderAdapter` from design §8. `buildRequest(draft, model, preparedInputs): { request?: ReturnType<ProviderAdapter['serialize']>; issues: CapabilityIssue[] }` returns no request if a blocking issue exists. `getCompatibleModels(operation, references, catalog)` returns all records with eligibility and reasons; it never deletes unknown records.

- [x] Write cases for a model appearing without app changes, a text-only model in an image workflow, count/byte limit overflow, contradictory audio flags, and string-valued durations. Test that image serialization emits only `input_references` on the normalized route:

```ts
import { expect, it } from 'vitest';
import { serializeImageBody } from '../../packages/nanogpt/src/adapters/image';
it('uses one normalized image input family', () => {
  const body = serializeImageBody({
    modelId: 'fixture/image', prompt: 'Change the lighting.',
    urls: ['https://studio.example/input/1'], parameters: { n: 1 }
  });
  expect(body).toEqual({
    model: 'fixture/image', prompt: 'Change the lighting.', n: 1,
    input_references: [{ type: 'image_url', image_url: { url: 'https://studio.example/input/1' } }]
  });
  expect(body).not.toHaveProperty('imageDataUrls');
});
```

`serializeImageBody({ modelId, prompt, urls, parameters }): Record<string,unknown>` is this task's pure helper, not a second transport. Parameters have already passed route validation and cannot overwrite model/prompt/input fields.

  - Evidence: `tests/contract/request-serialization.test.ts` (13 passed).
- [x] Run `npx vitest run tests/contract/request-serialization.test.ts`, then implement normalized image JSON, compatibility edits, video ticket submission, and binary/JSON audio transports. Use exact Nano-GPT base/path mappings from the contract registry; do not let a generic OpenAI client append `/v1` to video endpoints.
  - Evidence: image `https://nano-gpt.com/api/v1/images`; video `https://nano-gpt.com/api/generate-video` (no extra `/v1`); speech `/api/v1/audio/speech`; text adapter returns `unresolved_text_contract` only.
- [x] Implement searchable/paginated model selection, all/compatible/favorite/recent views, stale timestamp, supported controls, conflicting-control explanation, and a final request/reference preview. On a model switch preserve the draft and report invalidated settings before Generate.
  - Evidence: `apps/studio/src/features/create/*`. Generate stays disabled (`Generation waits for jobs`). Page size 20.
- [x] Verify image endpoint metadata URLs are origin-validated; output count differs from input count; no unsupported provider options or image streaming flags are sent. Unknown controls remain inspectable; editable generic advanced fields are allowed only through an adapter with a verified field contract.
  - Evidence: `endpoint_origin_rejected` in `validateDraft`; `max_images` remains an output count from P1; serializers strip `stream` / legacy image fields; unsupported controls render as inspect-only.
- [x] Run the focused tests and `npx playwright test tests/e2e/model-picker.spec.ts`; commit: `feat: add capability-driven generation controls and serializers`.
  - Evidence: focused vitest 13 passed; full `npm test` 140 passed; Playwright 8 passed including model-picker. No provider credits spent.

## Task P4: Execute durable jobs and download outputs

**Create:** `apps/service/src/jobs/repository.ts`, `worker.ts`, `routes.ts`, `recovery.ts`, `costs.ts` in that directory, `packages/nanogpt/src/results/video-status.ts`, `image-output.ts`, `audio-output.ts` in that directory, `apps/studio/src/features/jobs/QueueSheet.tsx`, `job-sync.ts` in that directory, `tests/contract/jobs.test.ts`, `tests/contract/provider-results.test.ts`.

**Interfaces:** `submitJob(ownerId, draft): Promise<JobReceipt>` returns an existing matching request receipt on duplicate submission. `GET /studio-api/jobs/:id` reads a receipt; `GET /studio-api/jobs?cursor=...` reconciles changed jobs; `POST /studio-api/jobs/:id/cancel` cancels only when allowed; `POST /studio-api/jobs/:id/acknowledge` confirms verified local output hashes. `normalizeVideoStatus(body)` returns `{ state: ProviderState; outputUrl?: string; cost?: unknown; error?: string }` or a structured unsupported-envelope error.

- [ ] Add failing tests for duplicate client request IDs, conflicting payload reuse, two workers claiming one job, process death after possible provider dispatch, nested/flat status variants, empty successful images, URL/base64 fallback, audio binary responses, and all output items preserved.
- [ ] Implement job reservation and worker leasing. A durable schema needs uniqueness and lease ownership:

```sql
CREATE UNIQUE INDEX jobs_owner_client_id ON jobs(owner_id, client_request_id);
CREATE INDEX jobs_due ON jobs(provider_state, next_attempt_at);
```

Claim work in a transaction; save `submitting` before dispatch. Never requeue an expired submitting lease automatically. Persist provider tickets including model, cost/payment fields, and status adapter version before polling.

- [ ] Implement separate provider/staging/local-save transitions, bounded polling, immediate service output capture, file validation, and client reconciliation into `LibraryPort`. Sample expected status parsing:

```ts
import { expect, it } from 'vitest';
import { normalizeVideoStatus } from '../../packages/nanogpt/src/results/video-status';
it('reads the documented nested completion envelope', () => {
  expect(normalizeVideoStatus({ data: {
    status: 'COMPLETED', output: { video: { url: 'https://media.example/clip.mp4' } }
  } })).toMatchObject({ state: 'completed', outputUrl: 'https://media.example/clip.mp4' });
});
it('does not invent output for an empty completion', () => {
  expect(() => normalizeVideoStatus({ data: { status: 'COMPLETED' } }))
    .toThrow('missing_video_output');
});
```

- [ ] Implement estimate/reservation/final/refund/unknown cost states; account for input-duration billing when applicable. A user-approved retry of an ambiguous request receives a new client request ID with a link to the original. Repeated local downloads do not create a new paid generation.
- [ ] Run `npx vitest run tests/contract/jobs.test.ts tests/contract/provider-results.test.ts`. Restart the actual service while the fake provider has running jobs, suspend the app, then verify existing IDs and identical saved hashes. Commit: `feat: persist generation jobs and verified local results`.

## Task P5: Audit catalog coverage and exercise recovery on Android

**Create:** `scripts/audit-provider-coverage.ts`, `docs/validation/model-coverage.md`, `docs/validation/job-recovery.md`, `tests/e2e/generation-recovery.spec.ts`; modify adapters only for documented issues found.

**Interfaces:** `auditCatalogCoverage(models, contracts)` returns `{ total, usable, incompatible, restricted, unresolved, rows }`, with each exact catalog ID appearing once per relevant catalog and a reason/evidence reference. This is reporting, not a runtime allowlist.

- [ ] Generate the audit from current catalogs. Every unresolved row names a missing operation/input/response contract. Do not equate broad `image_generation`/`video_generation` flags with usable generation; utilities and transformations may need input requirements absent from flags.
- [ ] Exercise small known input/reference families using the fake service first. When real credentials and a spending budget have been provided for implementation, capture a minimal paid smoke test per materially different selected route family; keep remaining rows honestly marked metadata-only.
- [ ] Test these recovery boundaries explicitly:

```text
queued before provider -> cancel -> no provider call
submitted with known run ID -> disconnect -> resume -> same run ID
submission response lost -> unknown -> recovery attempt -> no automatic resubmit
provider complete -> download interrupted -> retry download -> one logical result
provider URL expired -> use service copy; if unavailable, report unrecoverable bytes
app force-stop -> service continues; local save reconciles after app restart
```

- [ ] Run `npx playwright test tests/e2e/generation-recovery.spec.ts`; repeat the interruption sequence on physical Android. Test catalog partial outage, revoked key, denied model, 402, transient 429, and daily 429. Record device, service version, timestamps, and exact pass/fail observations.
- [ ] Commit: `test: verify model coverage and generation recovery`.

## Milestone acceptance

- [ ] All current media catalog records appear in the audit and picker; unknown contracts have explicit reasons.
- [ ] At least one validated image and video workflow produces a verified local asset under the implementation test budget.
- [ ] Interrupted transfers and known jobs recover without duplicate paid requests.
- [ ] Ambiguous submissions remain visible and require an intentional new generation to incur a repeat charge.

Continue with [Character and video pipeline](2026-09-13-character-video.md).
