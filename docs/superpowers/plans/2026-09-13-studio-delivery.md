# Studio and Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the connected studio with editable canvas, prompt assistance, audio, timed captions, timeline editing, and native/browser delivery.

**Architecture:** Storyboard and canvas edit the same semantic project graph. A shared immutable edit manifest drives native Media3 rendering or the service FFmpeg renderer. All audio/media outputs use the existing jobs, library, and provenance system.

**Tech Stack:** React/React Flow, TypeScript/Zod, Nano-GPT text/audio adapters, Kotlin/Media3, service FFmpeg, Vitest/Playwright/instrumentation.

**Spec:** [Design](../specs/2026-09-13-char2vid-design.md), especially sections 3–4 and 14–18.

## Global Constraints

- Android API 26 is the product support floor.
- Node 22+ and Capacitor 8 are the initial platform baseline.
- Nano-GPT is the sole AI provider.
- Originals and approved outputs are never cache.
- All available model records must remain discoverable by exact ID.
- Potentially accepted media submissions are never retried automatically.
- Credentials and temporary signed URLs are excluded from portable exports and logs.
- Automated fixture tests must not spend provider credits.

## Task S1: Connect storyboard and canvas, then add prompt assistance

**Create:** `packages/domain/src/graph/schema.ts`, `connect.ts`, `invalidate.ts` in that directory, `apps/studio/src/features/projects/Storyboard.tsx`, `ProjectCanvas.tsx`, `NodeInspector.tsx`, `AssistantPanel.tsx` in that directory, `packages/domain/src/assistant/proposals.ts`, `tests/contract/project-graph.test.ts`, `tests/e2e/project-views.spec.ts`.

**Interfaces:** `connectNodes(graph, edge)` returns a new graph or typed `incompatible_port`/`cycle` error. `affectedDescendants(graph, changedNodeId): string[]` finds downstream drafts to mark stale. `proposeScript({ story, cast, projectFormat, modelId }): Promise<ScriptProposal>` uses the text adapter and validates scene/shot/cast IDs; proposal acceptance is a separate local mutation.

- [ ] Write tests for typed edges, cycles, descendant invalidation, and existing output revision preservation. Prove storyboard reordering changes timeline order without rewiring semantic dependencies.
- [ ] Implement graph records separately from canvas positions. Every node keeps draft parameters and immutable run snapshots. Use the existing generation composer in the inspector; do not introduce a second independent generation pipeline.
- [ ] Implement touch selection/connect, undo/redo, move-up/down alternatives, and a guide view that can perform every core action. Preserve selected node/shot on view changes. The mutation rule is:

```text
change input revision -> write new draft binding -> mark descendants stale
keep accepted outputs and their original snapshots
run selected node -> freeze request -> submit existing job API
replace accepted take only by an explicit selection
```

- [ ] Add user-owned prompt presets and a text/vision assistant using compatible catalog models. Return schema-validated draft shots, names tied to cast IDs, and proposed prompt changes. Show/edit the proposal before applying; never automatically trigger paid image/video nodes from assistant text. Optional search/embeddings remain separate opt-in tools, not required for the first release.
- [ ] Run `npx vitest run tests/contract/project-graph.test.ts` and `npx playwright test tests/e2e/project-views.spec.ts`; manually check phone canvas usability and TalkBack access. Commit: `feat: add connected storyboard canvas and creative assistant`.

## Task S2: Add speech, music, sound effects, voice bindings, and captions

**Create:** `packages/domain/src/audio/voice-binding.ts`, `captions.ts` in that directory, `packages/nanogpt/src/adapters/voice-clone.ts`, `transcription.ts` in that directory, `apps/studio/src/features/editor/AudioPanel.tsx`, `CaptionEditor.tsx`, `VoicePanel.tsx` in that directory, `tests/contract/audio-workflows.test.ts`, `tests/contract/captions.test.ts`.

**Interfaces:** `VoiceBinding` contains `characterId`, `modelId`, `voiceId?`, `embeddingRevisionId?`, `sourceAudioRevisionId?`, `verifiedAt?`, and `expiresAt?`. `CaptionCue` contains `id`, `startUs`, `endUs`, `text`, and optional `speakerId`. `parseTranscription(raw): { transcript: string; cues: CaptionCue[]; timing: 'word' | 'segment' | 'none' }` does not invent timings. `exportCaptions(cues, format: 'srt' | 'vtt'): string` serializes validated cue timing.

- [ ] Write tests for TTS bytes versus URL versus async tickets, interrupted audio streams, model-qualified voice IDs, downloadable embedding persistence, and transcript-only responses. Caption regression example:

```ts
import { expect, it } from 'vitest';
import { parseTranscription } from '../../packages/nanogpt/src/adapters/transcription';
it('does not invent word timings from plain text', () => {
  expect(parseTranscription({ text: 'The door opens.' })).toEqual({
    transcript: 'The door opens.', cues: [], timing: 'none'
  });
});
```

- [ ] Implement audio generation through verified operation contracts; add music/SFX selection based on capability metadata, not a hardcoded TTS list. Unknown audio transformations remain discoverable with specific adapter gaps. Save original generated audio as library assets before attaching them to clips.
- [ ] Implement MiniMax/Qwen cloning only after rechecking current Nano-GPT request and retention rules; treat any listed additional clone route as unverified until its contract is established. Persist embeddings locally when provided and stage them for reuse when needed. Session-only provider voice-library endpoints are not dependencies.
- [ ] Implement transcription, cue editing, speaker assignment, SRT/VTT import/export, and remapping after clip trims. Reject negative/reversed intervals; preserve Unicode and multiline text. A transcript without times prompts a timing-capable operation or manual cue editing.
- [ ] Run `npx vitest run tests/contract/audio-workflows.test.ts tests/contract/captions.test.ts`; under the implementation budget inspect audible output and subtitle sync. Commit: `feat: add character audio and editable timed captions`.

## Task S3: Build the edit manifest, preview, and Android renderer

**Create:** `packages/domain/src/editor/manifest.ts`, `timeline.ts`, `validate.ts` in that directory, `apps/studio/src/features/editor/Timeline.tsx`, `PreviewPlayer.tsx`, `ExportSheet.tsx` in that directory, `packages/native-bridge/src/render.ts`, `apps/studio/android/app/src/main/java/com/char2vid/studio/media/RenderPlugin.kt`, `RenderWorker.kt` in that directory, `tests/contract/edit-manifest.test.ts`, native render instrumentation tests.

**Interfaces:**

```ts
export interface EditManifest {
  schemaVersion: 1;
  id: string;
  width: number;
  height: number;
  fps: number;
  clips: Array<{
    assetRevisionId: string;
    sourceInUs: number;
    sourceOutUs: number;
    startUs: number;
    fit: 'contain' | 'cover';
    volume: number;
  }>;
  audio: Array<{
    assetRevisionId: string;
    sourceInUs: number;
    sourceOutUs: number;
    startUs: number;
    volume: number;
  }>;
  captions: Array<{ id: string; startUs: number; endUs: number; text: string }>;
  burnCaptions: boolean;
}
```

`validateEdit(manifest, mediaMetadata): CapabilityIssue[]` checks input existence, durations, timing, framing, and encoder support. `renderEdit(manifest): Promise<{ renderJobId: string }>` persists a render job; progress and output use the existing job/library state pattern. Native render jobs may be interrupted by OS policy and must be restartable; no exact background completion guarantee.

- [ ] Add tests for cuts, non-zero source trim offsets, audio placement, caption shifts, invalid out-points, missing media, and requested output beyond encoder capability. Use mixed-orientation clips with known durations.
- [ ] Implement immutable timeline edits and preview from the same manifest. Keep integer microseconds internally; preview tolerances do not change source timing. Initial controls are reorder, trim, contain/cover, volume/mute, and captions. No unimplemented transition controls appear.
- [ ] Implement Media3 composition/export using file/URI handles. Map source trims to clipping configurations, ordered visual clips to an edited sequence, overlays to supported text effects, and audio to compatible composition tracks. Detect encoder/codec limits on-device; block unsupported combinations or offer the service path rather than silently reducing dimensions.
- [ ] Export to a temporary file, verify decode/duration/dimensions, then import as an output revision. Save the originating edit manifest ID. Cancellation removes incomplete output and preserves sources; native Gallery/Files/share actions reuse G3.
- [ ] Run `npx vitest run tests/contract/edit-manifest.test.ts` and native instrumentation, then inspect a rendered two-shot portrait video with narration/music/captions in another Android player. Record synchronization and orientation results. Commit: `feat: add timeline editing and native video rendering`.

## Task S4: Add browser rendering and portable production bundles

**Create:** `apps/service/src/render/manifest-compiler.ts`, `renderer.ts`, `routes.ts` in that directory, `apps/studio/src/features/editor/BrowserExport.tsx`, `packages/domain/src/archive-production.ts`, `tests/contract/render-compiler.test.ts`, `tests/contract/production-bundle.test.ts`, `tests/e2e/production-export.spec.ts`.

**Interfaces:** `compileRenderArgs(manifest, resolvedInputs): string[]` builds a constrained FFmpeg argument array. `resolvedInputs` maps immutable revision IDs to verified staged files; user text is never a shell command or raw filter expression. `POST /studio-api/renders` accepts `{ manifest, transferBindings }` and returns a render receipt. `exportProductionBundle(manifest)` uses the G4 archive writer with selected media, source references, SRT/VTT, and the manifest.

- [ ] Write tests for safe Unicode caption files, quote/newline-containing text, unsupported effects, missing transfer bindings, timestamp alignment, and conflicting output settings. Assert renderer input paths resolve only to job-owned verified files.
- [ ] Implement a restricted renderer using spawned argument arrays, temporary caption files, fixed supported filters, bounded CPU/time/output sizes, and a persistent render queue. Browser assets are staged only for the chosen export; no entire-gallery upload occurs.
- [ ] Use the shared manifest as the semantic source:

```text
validate manifest -> stage dependency closure -> resolve input hashes
compile allowed trim/scale/pad/mix/caption operations -> render temporary output
probe and verify -> expose authenticated download -> save local revision
acknowledge device save -> clean temporary assets according to policy
```

- [ ] Implement source-bundle fallback, progress, cancel/retry, resumable download, and export/import of edit dependencies. Test the same short fixture with native and service renderers: timing/framing/text must agree within declared frame tolerance; bit-for-bit encoding need not match.
- [ ] Run `npx vitest run tests/contract/render-compiler.test.ts tests/contract/production-bundle.test.ts` and `npx playwright test tests/e2e/production-export.spec.ts`; commit: `feat: add browser rendering and portable production bundles`.

## Task S5: Verify and package the complete studio

**Create:** `docs/validation/release-checklist.md`, `docs/deployment.md`, `docs/user-guide.md`, `apps/service/Dockerfile`, `compose.yaml`, `.github/workflows/release.yml`; modify CI/release settings and measured performance issues only.

**Interfaces:** Service `/health` checks process status; `/ready` checks schema, persistent storage, worker lease health, and disk budget. Deployment persists database and staged files across container replacement. Release APKs use a consistent signing identity stored in deployment/CI secrets, not git.

- [ ] Run the complete fixture suite, typecheck, lint, production build, and E2E tests once their subsystem gates have passed. Do not rerun paid generation as routine CI. Build Android debug and signed release variants through GitHub Actions.
- [ ] Execute the final master checklist on physical Android: offline launch, rotation/back, force-stop, denied picker/notification access, revoked key, low disk, 5,000 assets, 1 GiB backup, second-round generation, two-character continuity, and rendered audio/captions. Record failures and fix within the owning subsystem.
- [ ] Verify update from the prior signed APK preserves database and files; exercise a migration failure and rollback. Restore a service database/staging backup into a clean service instance and reconcile client receipts without resubmission.
- [ ] Write deployment and user instructions with actual commands and observed limitations. Include service credential setup, persistent-volume paths, staging expiration/quota behavior, API-key replacement, APK installation/update, backup/restore, model refresh, and recovery of unknown jobs. Include a current per-record model compatibility report and encoder limitations.
- [ ] Commit: `chore: prepare verified Android studio release`. Publish/deploy only within the implementation session's authorization; preserve the completed reviewable build and evidence otherwise.

## Complete-studio acceptance

- [ ] Guided and canvas views operate on the same projects and can regenerate one node without erasing other work.
- [ ] Characters, image generation, video generation, audio, captions, editing, export, and organized storage function as one workflow.
- [ ] Android files and library revisions remain valid across process death, application updates, and portable restore.
- [ ] Real-provider and device results are distinguished from fixture coverage; unverified models/options have precise visible limitations.
- [ ] The delivery documentation lets another developer reproduce the web app, service, and Android APK from the repository.
