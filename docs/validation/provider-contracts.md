# Provider contracts (P1)

Gate document before paid media integration. Source of truth for transport
shapes is `packages/nanogpt/src/contracts/route-contract.ts`. This file
records evidence, conflicts, and what remains UNVERIFIED.

**No generation endpoint was called. No API key was used. No credits were
spent.** Public unauthenticated catalog GETs were used only to refresh
observation metadata.

## Observation dates

| What                                                        | Date (UTC)                              | Notes                                                                       |
| ----------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| Research snapshot (`docs/research/discovery-snapshot.json`) | 2026-09-13                              | 123 docs pages, OpenAPI, seven catalogs, three image endpoint-metadata URLs |
| This P1 live catalog refresh                                | 2026-09-14                              | Unauthenticated GET; hashes/counts only; bodies not stored                  |
| gpt-image-2 and Seedream 5.0 Pro endpoint metadata          | 2026-09-13 and 2026-09-14               | SHA-256 unchanged on refresh                                                |
| Documentation pages used for route fields                   | 2026-09-13 snapshot; re-read 2026-09-14 | Page text, not saved wholesale                                              |

## Live catalog refresh versus 2026-09-13 snapshot

| Catalog                    | URL                                                                               | 2026-09-13 count / sha256 | 2026-09-14 count / sha256                                    |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------: | ------------------------------------------------------------ |
| text                       | `https://nano-gpt.com/api/v1/models?detailed=true`                                |   606 / `07887277…353f7b` | 601 / `873a35c4…11382e600`                                   |
| image                      | `https://nano-gpt.com/api/v1/images/models`                                       |  232 / `faf5701c…e159bb1` | 234 / `e0cca25a…559be0e0`                                    |
| image-legacy               | `https://nano-gpt.com/api/v1/image-models`                                        |  232 / `ac04940b…997a3a7` | 234 / `3d16bfd2…deff9bf`                                     |
| video                      | `https://nano-gpt.com/api/v1/video-models?detailed=true`                          |  161 / `8511afa9…9a69bb3` | 161 / `39028e73…f8ba3542` (same byte length, different hash) |
| audio                      | `https://nano-gpt.com/api/v1/audio-models`                                        |    85 / `35977b9b…a69bb3` | 87 / `f10fdafe…ada727603`                                    |
| gpt-image-2 endpoints      | `https://nano-gpt.com/api/v1/images/models/gpt-image-2/endpoints`                 |         `42ff4542…002f92` | unchanged                                                    |
| Seedream 5.0 Pro endpoints | `https://nano-gpt.com/api/v1/images/models/bytedance/seedream-v5.0-pro/endpoints` |        `c4f074c2…e309cf8` | unchanged                                                    |

Still present on 2026-09-14: `birefnet/v2`, `bytedance/seedream-v5.0-pro`,
`gpt-image-2`, `bytedance/seedance-2.5`, `elevenlabs/music`, `xai-tts`,
`Whisper-Large-V3`. CORS on all GETs: `Access-Control-Allow-Origin: *`.
Authenticated writes, preflight, and downloads were not tested.

Auth for inference routes: `Authorization: Bearer …` (recommended) or
`X-API-Key` / `x-api-key`. Catalog GETs are public without a key. Public
catalog success is not credential validation.

## How to read a row

- **Evidence** is `metadata-only` (docs/OpenAPI), `authored fixture`, or
  `sanitized-observed fixture`. No row is an actual budgeted generation.
- **Roles** are app-side. Nano-GPT does not name identity/look/pose; the
  registry maps roles onto the documented input field family.
- **Limits** that disagree are left unknown. Nothing is silently chosen.
- Registry IDs are `packages/nanogpt` `ROUTE_CONTRACTS[].id`.

## Priority families

### Normalized image generation — `image.normalized.generate`

| Item                   | Recorded contract                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base / method / path   | `https://nano-gpt.com` `POST /api/v1/images`                                                                                                                                                                                                                                                                             |
| Auth                   | Bearer or x-api-key                                                                                                                                                                                                                                                                                                      |
| Encoding               | `application/json` only                                                                                                                                                                                                                                                                                                  |
| Allowed fields         | `model`, `prompt`, `n`, `nImages`, `resolution`, `aspect_ratio`, `quality`, `output_format`, `seed`, `input_references`                                                                                                                                                                                                  |
| Input family           | `input_references` only (URL string, data URL, or `{type:image_url,image_url:{url}}`). Mixing with `imageDataUrl(s)` / `image_url` / `images` is documented as `conflicting_image_inputs`.                                                                                                                               |
| Roles                  | identity/body/look/pose/composition/style → `input_references`. No distinct mask slot on this route.                                                                                                                                                                                                                     |
| Limits                 | Per-model. Route preflight (gpt-image-2 / Seedream): 8–16384 px, formats png/jpeg/webp, `max_bytes` 31457280. Seedream provider cap 10485760. Item cap from `max_input_images` when it agrees with `input_image_constraints.max_items` (Seedream 10, gpt-image-2 4). `max_images` is output count, not input references. |
| Encoded size           | UNVERIFIED whether data-URL encoding counts against `max_bytes`.                                                                                                                                                                                                                                                         |
| Advertised vs accepted | `stream:true` and provider passthrough documented unsupported. `nImages` takes precedence over `n` if both are sent (docs; untested).                                                                                                                                                                                    |
| Result                 | Documented as inline JSON. Exact url vs b64 envelope **not captured**.                                                                                                                                                                                                                                                   |
| Evidence               | metadata-only. Sources: [Generate Images](https://docs.nano-gpt.com/api-reference/endpoint/image-api-generate), live catalogs 2026-09-13/14.                                                                                                                                                                             |

### Image edits / masks — `image.compat.edits` and alias `image.compat.edit`

| Item                 | Recorded contract                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Base / method / path | `https://nano-gpt.com` `POST /api/v1/images/edits` and alias `POST /api/v1/images/edit`     |
| Auth                 | Bearer or x-api-key                                                                         |
| Encoding             | multipart/form-data **or** JSON                                                             |
| Multipart fields     | `prompt`, `image` or repeated `image[]`, optional `mask`, `model`, `size`, `n`              |
| JSON fields          | `imageDataUrl` / `imageDataUrls` / `maskDataUrl` plus prompt/model                          |
| Roles                | identity → `image`/`imageDataUrl`; extra refs → `image[]`/`imageDataUrls`; mask untyped     |
| Limits               | Multipart size "strict" but not quantified. Generated URLs temporary.                       |
| Result               | url or b64_json, same conventions as compat generations                                     |
| Evidence             | metadata-only. [Image Edits](https://docs.nano-gpt.com/api-reference/endpoint/image-edits). |

Normalized image-to-image also uses `POST /api/v1/images` with
`input_references` (preferred for new work). Masks are **not** documented on
the normalized route.

### Common image reference route (OpenAI-compat) — `image.compat.generations`

| Item                 | Recorded contract                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base / method / path | `https://nano-gpt.com` `POST /v1/images/generations`                                                                                                                                                                                                                                    |
| Auth                 | Bearer only. Endpoint page Auth line is `Authorization: Bearer`; embedded OpenAPI `security` is `bearerAuth` (`http`/`bearer`) with no `x-api-key` scheme on this path. [OpenAI-compatible image generation](https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai). |
| Encoding             | JSON                                                                                                                                                                                                                                                                                    |
| Fields               | `prompt` required; `model`, `n`, `size`, `response_format`, `user`, `imageDataUrl(s)`, `maskDataUrl`, `strength`, `guidance_scale`, `num_inference_steps`, `seed`, `kontext_max_mode`                                                                                                   |
| Roles                | single ref → `imageDataUrl`; multi → `imageDataUrls`; mask → `maskDataUrl`. Remote URLs not accepted; convert to data URLs.                                                                                                                                                             |
| Encoded size         | Docs: uploads should be **4 MB or smaller after encoding**.                                                                                                                                                                                                                             |
| Result               | `b64_json` default or `url` (~1 hour signed; may fall back to b64).                                                                                                                                                                                                                     |
| Evidence             | metadata-only. [OpenAI-compatible image generation](https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai).                                                                                                                                                          |
| Path conflict        | Research summary table listed `/api/v1/images/generations`. The endpoint page and OpenAPI **server override** (`https://nano-gpt.com`, not `/api`) document `/v1/images/generations`. The registry follows the page+OpenAPI path and records an override expiring 2026-12-13.           |

### Seedream / Seedance records present at observation

These are **models on generic routes**, not separate endpoints.

**`bytedance/seedream-v5.0-pro`** (image catalog + endpoint metadata,
unchanged 2026-09-14):

- Capabilities: `image_generation`, `image_to_image`, `nsfw: true`,
  `inpainting: false`.
- Resolutions mix ratios (`1:1`, `16:9`, `9:16`, …) with `1k` / `2k` — not
  pixel sizes.
- Input cap 10 (`max_input_images` agrees with `max_items`). Output cap 4.
- Route 30 MiB vs provider 10 MiB — use the tighter verified limit when
  serializing (P3); both values kept on the descriptor.

**`bytedance/seedance-2.5`** (video catalog, present 2026-09-13 and
2026-09-14):

- Nested `supported_parameters.parameters` / `defaults`.
- `audio_generation: false` while `generate_audio` switch defaults **true**.
  Recorded as `capability_control_conflict`; do not enable audio from either
  boolean alone.
- Duration options are strings (`"5"`), not numbers.

Authored fixtures: `imageMixed`, `videoNested`. Sanitized-observed:
`imageCatalogGptImage2`, `imageEndpointMetadataGptImage2`.

### Common video reference route — `video.generate` + `video.status`

| Item            | Recorded contract                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submit          | `https://nano-gpt.com` `POST /api/generate-video`                                                                                                                                                                                                                                                       |
| Status          | `GET /api/video/status?requestId=` (alias `runId`)                                                                                                                                                                                                                                                      |
| Auth            | Bearer or x-api-key (status page examples use x-api-key)                                                                                                                                                                                                                                                |
| Generic fields  | `model`, `prompt`, `negative_prompt`, `duration`, `seconds`, `aspect_ratio`, `orientation`, `resolution`, `size`, `mode`, `generateAudio`, `seed`, `imageUrl` / `imageDataUrl` / `imageAttachmentId`, `referenceImages`, `audioUrl` / `audioDataUrl`, `videoUrl` / `videoDataUrl` / `videoAttachmentId` |
| Roles           | start-frame → `imageUrl`; motion/continuity → `videoUrl`; voice → `audioUrl`. Extra family fields (LongStories, Kling lipsync, Pixverse, camera_fix aliases) are **unresolved**, not in `allowedFields`.                                                                                                |
| Encoded size    | **Conflict:** video guide caps inline uploads at 4 MB; endpoint prose recommends base64 for larger/private assets. Not resolved. Stage large inputs as HTTPS URLs (P2).                                                                                                                                 |
| Submit result   | 202 ticket `{ runId, id, model, status: pending, cost? }`. Persist ID before polling.                                                                                                                                                                                                                   |
| Status variants | Prose: nested uppercase `data.status` (`COMPLETED`) + `data.output.video.url`. OpenAPI: flat lowercase `status` + `videoUrl`. Both recorded; neither chosen.                                                                                                                                            |
| Expiry          | Output URL expiry **not documented** on the unified status page.                                                                                                                                                                                                                                        |
| Evidence        | metadata-only. [Video generation](https://docs.nano-gpt.com/api-reference/endpoint/video-generation), [unified status](https://docs.nano-gpt.com/api-reference/endpoint/video-status-unified).                                                                                                          |

Related: `video.recover` (`GET /api/generate-video/recover`, limit default 10
max 50, bounded recent runs), `video.extend` (Midjourney task-based
`runId`/`taskId` + `index` 0–3; other extend models stay on
`video.generate`), `video.content` (Sora 2 only; response schema open).

### Async image special case — `image.midjourney.status`

`POST /api/check-midjourney-status` with `{ task_id }`. Status enum includes
SUCCESS/FAILED/PENDING/RUNNING/IN_PROGRESS/submitted/NOT_START/unknown;
optional `imageUrl`. **Which image submit responses return a Midjourney
task_id is unobserved.** metadata-only.

### TTS / music — `audio.speech` and `audio.tts` + `audio.tts.status`

| Item     | `audio.speech`                                                                                                                                                                                                    | `audio.tts`                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Path     | `POST /api/v1/audio/speech`                                                                                                                                                                                       | `POST /api/tts`                                                                                                         |
| Fields   | `model`, `input`, `voice`, `response_format`, `speed`, `instructions`, `stream`                                                                                                                                   | `text`, `model`, `voice`, `speed`, plus clone fields `speaker_voice_embedding_file_url` / `reference_text` / `language` |
| Music    | Same speech path; `input` is a creative prompt; `voice` ignored                                                                                                                                                   | Not the music path                                                                                                      |
| Result   | 200 raw audio bytes; optional chunked `stream:true` on listed models                                                                                                                                              | Inline bytes **or** JSON `audioUrl` **or** 202 ticket                                                                   |
| Polling  | none                                                                                                                                                                                                              | `GET /api/tts/status?runId=&model=` plus ticket `cost`/`paymentSource`/`isApiRequest` for refunds                       |
| Evidence | metadata-only. [Speech](https://docs.nano-gpt.com/api-reference/endpoint/speech), [music](https://docs.nano-gpt.com/api-reference/music-generation), [TTS](https://docs.nano-gpt.com/api-reference/endpoint/tts). |

Catalog `elevenlabs/music` duration 5–300s and `xai-tts` `max_chars` 5000 are
metadata, not generation-tested.

### Timestamped STT — `audio.transcriptions`, `audio.transcribe`, `audio.transcribe.status`

| Item          | Recorded contract                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compat        | `POST /api/v1/audio/transcriptions` multipart `file` or JSON `file_url`/`audio_url`                                                                                                                                                                                                                                 |
| Workflow      | `POST /api/transcribe` multipart `audio` (≤3 MB) or JSON `audioUrl` (≤500 MB)                                                                                                                                                                                                                                       |
| Status        | `POST /api/transcribe/status` JSON `runId` (+ ticket billing fields)                                                                                                                                                                                                                                                |
| Formats       | MP3, WAV, M4A, OGG, AAC; video formats model-dependent                                                                                                                                                                                                                                                              |
| Timestamps    | Whisper-Large-V3 catalog: `word_timestamps: true`, `timestamp_granularities: [segment, word]`. Compat example envelope is `{ text, language, duration }` **without** words. Elevenlabs-STT async completion documents `words[]` and `diarization`. A transcript without timings is not timed captions (design §15). |
| Size conflict | Transcribe docs 3 MB multipart vs catalog `max_request_body_mb: 4` vs `max_file_size_mb: 500` for URL. Unresolved.                                                                                                                                                                                                  |
| Evidence      | metadata-only plus authored `audioMixed` fixture. [transcriptions](https://docs.nano-gpt.com/api-reference/endpoint/audio-transcriptions), [transcribe](https://docs.nano-gpt.com/api-reference/endpoint/transcribe).                                                                                               |

### Media utilities

Utility **models** (for example `birefnet/v2`) appear in the normalized image
catalog with `image_generation` + `image_to_image`, `max_images: 1`, and **no
input-reference cap**. They share `image.normalized.generate`; they are not a
separate utility endpoint. Broad flags do not prove a usable generation
contract (P5 audit).

`video.content` is a Sora-2 content proxy. NSFW classification, moderation,
and website attachment routes are inventoried as out of the initial creation
path and are **not** in the P1 registry.

Voice cloning (`audio.voice-clone.minimax` / `.qwen` and status POSTs) is
family-specific, asynchronous, and retention-sensitive (provider docs last
dated 2026-02-21). Web-app `GET/POST /api/user/voice-ids` is session-only.

## Catalog discovery routes

`catalog.text`, `catalog.image`, `catalog.video`, `catalog.audio` are public
GETs. `catalog.image.legacy` overlaps the normalized image catalog by exact
ID and must not be merged into it. `image.endpoint-metadata` is
origin-checked (`resolveEndpointMetadataUrl`); non-Nano-GPT origins are
rejected before credentials.

Verification: fixture (authored or sanitized-observed subsets in
`tests/fixtures/nanogpt/catalogs.json`). Not a generation test.

## Documented conflicts (recorded, not resolved)

1. Compat image path `/v1/images/generations` vs research table
   `/api/v1/images/generations`.
2. Video inline 4 MB vs base64-for-larger recommendation.
3. Video status nested-uppercase vs flat-lowercase schemas.
4. Seedance `audio_generation: false` vs `generate_audio` default true.
5. `max_images` is not an input-reference limit.
6. Transcribe upload 3 MB vs catalog `max_request_body_mb` 4.
7. OpenAPI is incomplete (60 paths) and omits newer normalized image
   surfaces; do not generate a client from it without corrections.
8. Video-extend OpenAPI requires `taskId`; prose prefers `runId`.

## UNVERIFIED

Everything that needs a real key and a spending budget. Do not check these
off from fixtures.

- Any `POST` to image, video, audio, TTS, STT, or voice-clone routes
- Actual accepted-vs-advertised field behavior per model family
- Normalized image success envelope (url vs b64 vs other)
- Video status envelope actually returned for a live `vid_…` job
- Output URL expiry, recoverability after expiry, and late-arriving results
- Encoded data-URL size vs route `max_bytes` / 4 MB guidance
- Seedream 1k/2k output pixels; Seedance audio actually billed/returned
- Mask/inpainting on any image route
- Midjourney image tickets and `/check-midjourney-status`
- Streaming TTS (`stream:true`) and music duration/bytes
- Whisper word timestamps on either STT route
- Voice-clone retention, MiniMax ID return shape, Qwen embedding download
- Credential validation (authenticated non-generating read)
- 401/402/403/413/429 (transient vs daily) against live keys
- CORS/preflight on authenticated writes
- Origin-restricted API keys from a browser
- Account eligibility vs public catalog visibility
- Provider passthrough / `provider` objects
- Batch, embeddings, and other non-media surfaces

P3 serializers and P5 coverage/recovery consume this document. They must not
treat metadata-only rows as generation-tested.
