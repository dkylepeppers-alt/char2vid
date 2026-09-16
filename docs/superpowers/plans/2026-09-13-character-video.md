# Character and Video Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn gallery images into reusable characters, cast them into shots, animate approved frames, and preserve reference continuity across later generations.

**Architecture:** Characters, looks, and shots use immutable revisions over library assets. A role-aware compiler prepares provider-specific references and prompts. Generated candidates and accepted takes remain separate; all transitions use the same job service and storage system.

**Tech Stack:** Shared React/TypeScript UI, Zod/domain contracts, Nano-GPT adapters, native file/media bridge, Vitest and Playwright.

**Spec:** [Design](../specs/2026-09-13-char2vid-design.md), especially sections 4, 7–10, 14, and 16.

## Global Constraints

- Android API 26 is the product support floor.
- Node 22+ and Capacitor 8 are the initial platform baseline.
- Nano-GPT is the sole AI provider.
- Originals and approved outputs are never cache.
- All available model records must remain discoverable by exact ID.
- Potentially accepted media submissions are never retried automatically.
- Credentials and temporary signed URLs are excluded from portable exports and logs.
- Automated fixture tests must not spend provider credits.

## Task C1: Create characters, reference slots, and independent looks

**Create:** `packages/domain/src/characters/schema.ts`, `revisions.ts`, `looks.ts` in that directory, `apps/studio/src/features/characters/CharacterList.tsx`, `CharacterEditor.tsx`, `ReferenceSlots.tsx`, `LookEditor.tsx` in that directory, `tests/contract/character-revisions.test.ts`, `tests/e2e/characters.spec.ts`.

**Interfaces:**

```ts
export interface CharacterReference {
  assetRevisionId: string;
  role: 'identity' | 'body' | 'look' | 'pose' | 'style';
  view?: 'front' | 'left' | 'right' | 'back' | 'three-quarter';
  approval: 'candidate' | 'approved';
}
export interface CharacterRevision {
  id: string;
  characterId: string;
  parentRevisionId?: string;
  references: CharacterReference[];
  identityNotes: string;
}
export interface LookRevision {
  id: string;
  characterId: string;
  label: string;
  notes: string;
  referenceRevisionIds: string[];
}
```

`createCharacter({ name, referenceRevisionId }): Promise<{ characterId, revisionId }>` requires an available image revision. `reviseCharacter(previous, { id, references?, identityNotes? }): CharacterRevision` is pure and leaves `previous` intact. `saveLook(look): Promise<void>` has no write path to base character references.

- [x] Add a failing revision test:

```ts
import { expect, it } from 'vitest';
import { reviseCharacter } from '../../packages/domain/src/characters/revisions';
it('preserves the original identity revision', () => {
  const original = { id: 'cr1', characterId: 'c1', identityNotes: '', references: [
    { assetRevisionId: 'portrait1', role: 'identity' as const, approval: 'approved' as const }
  ] };
  const next = reviseCharacter(original, { id: 'cr2', identityNotes: 'Keep the source identity.' });
  expect(original.identityNotes).toBe('');
  expect(next.parentRevisionId).toBe('cr1');
  expect(next.references[0].assetRevisionId).toBe('portrait1');
});
```

  Evidence: `npx vitest run tests/contract/character-revisions.test.ts` — 11 passed on tip `5bf2b7e` ([#48](https://github.com/dkylepeppers-alt/char2vid/pull/48)).
- [x] Implement schema validation, immutable revision writes, look separation, cover selection, and the Library → Make character action. Quick mode produces a usable character from one approved source; detailed mode adds role/view slots. A new generated view is a candidate until accepted. ([#48](https://github.com/dkylepeppers-alt/char2vid/pull/48))
- [x] Add optional character-sheet/view generation using the existing composer and jobs. Expose the selected model, references, and requested outputs; let users replace one slot or an entire sheet. Do not label this as model training or claim compatibility with proprietary iModel files. ([#48](https://github.com/dkylepeppers-alt/char2vid/pull/48); Generate `disabled` without a service session; pre-gen cost UI rejected for C1; Generate→slot attach deferred to C2; Playwright empty-state HTML rejects iModel/LoRA/`VITE_*KEY`)
- [x] Run `npx vitest run tests/contract/character-revisions.test.ts` and `npx playwright test tests/e2e/characters.spec.ts`. Test separate outfits, rejected views, missing local source files, and character export/import using G4. Evidence on merge tip `379d3fe` / PR tip `4da7738` (Node from `.nvmrc`): `character-revisions` 14/14; suite 196/196; Playwright characters + CI web/APK/emulators green on the Ready tip. Missing local source covered in contracts. Physical-device package restore remains **UNVERIFIED**; [#10](https://github.com/dkylepeppers-alt/char2vid/issues/10) stays open.
- [x] Commit: `feat: add reusable characters and independent looks` (`c5cdd33`; follow-ups on [#48](https://github.com/dkylepeppers-alt/char2vid/pull/48) for Vite aliases, Playwright locators, and a single Characters heading).

## Task C2: Compile references and preserve accepted prompt text

**Create:** `packages/domain/src/generation/reference-plan.ts`, `prompt-compiler.ts`, `request-snapshot.ts` in that directory, `apps/studio/src/features/create/ReferenceAssignmentSheet.tsx`, `PromptPreview.tsx` in that directory, `tests/contract/reference-plan.test.ts`, `tests/contract/prompt-compiler.test.ts`.

**Interfaces:** `planReferences({ requested: ReferenceBinding[], maxItems?: number, supportedRoles: ReferenceRole[] }): { selected: ReferenceBinding[]; omitted: ReferenceBinding[]; issues: CapabilityIssue[] }`. A capacity conflict is blocking until the user resolves it; missing limits remain unknown rather than unlimited. `compilePrompt({ acceptedText, bindings, adapterSyntax? }): { finalText: string; bindings: ReferenceBinding[] }` adds only explicit binding syntax required by a verified adapter. `freezeRequest(draft, modelSnapshot, bindings): { canonicalJson: string; requestHash: string }` excludes expiring transfer URLs from semantic identity.

- [ ] Write a capacity test that makes silent reference dropping impossible:

```ts
import { expect, it } from 'vitest';
import { planReferences } from '../../packages/domain/src/generation/reference-plan';
it('reports unresolved capacity instead of silently losing a character', () => {
  const requested = [
    { assetRevisionId: 'a', role: 'identity' as const, characterRevisionId: 'c1', ordinal: 0 },
    { assetRevisionId: 'b', role: 'identity' as const, characterRevisionId: 'c2', ordinal: 1 }
  ];
  const result = planReferences({ requested, maxItems: 1, supportedRoles: ['identity'] });
  expect(result.issues.some(i => i.code === 'reference_capacity' && i.severity === 'blocking')).toBe(true);
  expect([...result.selected, ...result.omitted].map(r => r.assetRevisionId).sort()).toEqual(['a', 'b']);
});
```

- [ ] Add tests for stable ordering, same-name characters, one-image-only video routes, input/output counts, format limits, and accepted prompt text with Unicode. Verify identity notes and outfit notes are not automatically injected as repeated appearance descriptions.
- [ ] Implement deterministic role assignment and user-resolvable omissions. The role plan precedes media staging; prepared inputs retain revision hash/ordinal. Resolve references from library files afresh for every generation; never store a provider URL as an identity reference.
- [ ] Implement prompt modules for subject bindings, requested change/action, scene, camera, lighting, style, and output intent. Let users expand/edit/remove modules. Persist raw text, accepted compiled text, and module versions. Prompt assistance cannot silently replace text at Generate time.
- [ ] Run `npx vitest run tests/contract/reference-plan.test.ts tests/contract/prompt-compiler.test.ts`; commit: `feat: compile stable character references and generation prompts`.

## Task C3: Connect projects, shot images, and video generation

**Create:** `packages/domain/src/projects/schema.ts`, `shot-revisions.ts`, `takes.ts` in that directory, `apps/studio/src/features/projects/ProjectPage.tsx`, `CastSheet.tsx`, `ShotEditor.tsx`, `TakeComparison.tsx` in that directory, `apps/studio/src/features/create/AnimateAction.tsx`, `tests/contract/shot-handoff.test.ts`, `tests/e2e/character-video.spec.ts`.

**Interfaces:** `createShotRevision({ projectId, sceneId, previousRevisionId?, cast, prompt, references }): Promise<{ id: string }>` freezes cast character/look revision IDs. `acceptTake({ shotRevisionId, outputRevisionId, kind: 'image' | 'video' }): Promise<void>` stores a selection without deleting alternatives. `makeAnimationDraft({ shotRevisionId, imageRevisionId, modelId, clientRequestId }): Promise<GenerationDraft>` carries the approved start-frame binding and compatible cast references.

- [ ] Add a handoff test proving the selected start-frame revision, two cast identities, look revisions, and input order survive image → Animate. Also test that changing the current character later does not mutate an existing shot revision.
- [ ] Implement cast/scene/shot records, portrait-format project defaults, and shot creation from any asset. The flow is concrete:

```text
project cast revisions -> shot draft -> reference plan -> image job
image outputs -> compare -> selected image take -> animation draft
animation draft -> reference/parameter validation -> video job
verified local video outputs -> alternatives -> selected video take
```

Keep gallery and character IDs stable; this is a handoff of references, not a re-import of files.

- [ ] Implement image editing/utility actions through P3 adapters where verified, preserving a new derived revision. For a video route with only one image input, offer shot composition first and clearly show which extra identity/motion references cannot be passed.
- [ ] Run `npx vitest run tests/contract/shot-handoff.test.ts` and `npx playwright test tests/e2e/character-video.spec.ts`. In fake-provider tests inspect serialized inputs, not just UI success text. Under the implementation budget, visually inspect actual likeness, outfit, scale, and cast separation; do not infer visual continuity from valid JSON.
- [ ] Commit: `feat: connect characters and shot images to video generation`.

## Task C4: Add frame capture, second-round continuity, and package proof

**Create:** `packages/native-bridge/src/frame-capture.ts`, `apps/studio/android/app/src/main/java/com/char2vid/studio/media/FrameCapturePlugin.kt`, `apps/studio/src/features/projects/ContinuitySheet.tsx`, `packages/domain/src/projects/continuity.ts`, `tests/contract/continuity.test.ts`, `tests/e2e/multi-round.spec.ts`; extend archive schemas/tests.

**Interfaces:** `captureFrame({ videoRevisionId, requestedTimeUs }): Promise<{ imageRevisionId, actualTimeUs }>` creates an image asset with source/time provenance. `continueShot({ previousShotRevisionId, continuityImageRevisionId, retainOriginalCharacterReferences: true }): Promise<{ shotRevisionId }>` proposes the next shot while retaining original identity bindings.

- [ ] Write tests with expired former provider URLs and deleted thumbnails: the second round must still resolve original and selected continuity files from local storage. Capture actual frame timestamps rather than labelling a nearby keyframe as an exact requested time.
- [ ] Implement frame extraction using native decoding on Android and browser decoding when supported. Preserve orientation/color metadata and record the actual frame time. For an unsupported browser codec, use a staged service extraction or expose the limitation without creating a false frame.
- [ ] Implement continuity as a selected role, never replacement of every character anchor. Include this regression sequence:

```text
import originals A and B -> character revisions A1/B1 -> looks L1/L2
create shot 1 -> accept image I1 -> video V1 -> capture frame F1
create shot 2 from F1 + A1/B1 + L1/L2 -> image I2 -> video V2
expire all old remote URLs -> repeat selected operation from local files
export project -> restore fresh library -> verify all revision bindings/hashes
```

- [ ] Run `npx vitest run tests/contract/continuity.test.ts tests/contract/archive.test.ts` and `npx playwright test tests/e2e/multi-round.spec.ts`. Repeat on Android with app process death between rounds and compare actual images/videos under the implementation budget.
- [ ] Commit: `feat: preserve continuity across shots and portable projects`.

## Milestone acceptance

- [ ] One- and two-character productions complete image → character → shot → video without external file handoffs.
- [ ] Identity, look, pose, style, start/end frame, voice, and motion references remain distinct where supported.
- [ ] A second generation round and a restored project reuse local originals successfully.
- [ ] Generated candidates, rejected takes, and accepted outputs preserve useful lineage.

Continue with [Studio and delivery](2026-09-13-studio-delivery.md).
