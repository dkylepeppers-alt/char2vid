# char2vid

An Android-first media creation studio connecting **images → reusable characters → scenes → videos → finished productions**, with an organized library stored on the device and Nano-GPT as the generation provider.

**Status (15 September 2026):** M1 local library (G1–G4) and M2 through the personal generation service (P1–P2) are on `main`. Create can list live catalog models and preview serialized requests (P3). Paid jobs, character pipeline, and studio delivery remain ahead. Physical-device install, live HTTPS service deploy, Keystore round-trip, and paid Nano-GPT calls are **UNVERIFIED**.

## Develop and test

Use the Node version in `.nvmrc` and run from the repository root:

```sh
npm ci
npm run dev
```

The web app can import and organize a local library without an API key. Generation still waits for durable jobs. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` for verification. See [repository setup](docs/development/repository-setup.md) for dependencies, GitHub configuration, APK downloads, and signing; see [Android foundation evidence](docs/validation/android-foundation.md) for toolchain and device-check status.

Pull requests run web and Android validation. Successful Android runs provide a debug APK artifact. Signed builds use the manually dispatched release workflow and user-supplied signing secrets.

## Start here

1. [Product and architecture design](docs/superpowers/specs/2026-09-13-char2vid-design.md)
2. [Implementation roadmap and acceptance gates](docs/superpowers/plans/2026-09-13-char2vid.md)
3. [Nano-GPT, Zeemo, Reallusion, and Android research](docs/research/2026-09-13-research.md)
4. [Complete Nano-GPT resource inventory](docs/research/nanogpt-resource-inventory.md)
5. [Dated discovery evidence](docs/research/discovery-snapshot.json)
6. [Implementation task issues](https://github.com/dkylepeppers-alt/char2vid/issues)
7. [Repository foundation scope](docs/superpowers/plans/2026-09-13-repository-foundation.md)

## Recommended architecture

- React + TypeScript + Vite, delivered as a PWA and a Capacitor Android application.
- Android: SQLite metadata, app-owned media files, native import/export, and portable backups.
- Browser: IndexedDB metadata and OPFS media, with explicit persistence and backup behavior.
- A small self-hostable service handles Nano-GPT credentials, temporary reference transfers, and durable generation jobs while the phone is suspended.
- All model catalogs refresh dynamically. Model identity, parameters, reference limits, and pricing remain tied to their source metadata.
- Gallery, character library, storyboard, canvas, and editor share one asset and revision system.

## Implementation plans

| Order | Deliverable                                                  | Plan                                                                                 |
| ----- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1     | Offline gallery, Android files, portable backup              | [Storage and gallery](docs/superpowers/plans/2026-09-13-storage-gallery.md)          |
| 2     | Catalog discovery, reference transfer, durable generation    | [Provider and jobs](docs/superpowers/plans/2026-09-13-provider-jobs.md)              |
| 3     | Character creation, scene casting, image-to-video continuity | [Character and video pipeline](docs/superpowers/plans/2026-09-13-character-video.md) |
| 4     | Connected canvas, audio, captions, editing, export           | [Studio and delivery](docs/superpowers/plans/2026-09-13-studio-delivery.md)          |

## Current delivery

| Task                                     | State          | Evidence     | Still UNVERIFIED                                           |
| ---------------------------------------- | -------------- | ------------ | ---------------------------------------------------------- |
| G1 Shared app / Android shell            | Closed (#1)    | #19, #27     | Physical APK install, back/rotation/TalkBack               |
| G2 Crash-safe media storage              | Done on `main` | #28, #34     | Physical-device crash journal                              |
| G3 Organization, playback, native export | Done on `main` | #29–#31, #38 | Physical MediaStore export                                 |
| G4 Portable archives                     | Done on `main` | #32, #38     | Physical archive round-trip                                |
| P1 Catalog contracts                     | Done on `main` | #37          | Live catalog drift after 2026-09-14                        |
| P2 Auth service / transfers              | Done on `main` | #39          | HTTPS deploy, staging volume, live check-balance, Keystore |
| P3 Model picker / serializers            | In progress    | This branch  | Paid submission (P4)                                       |
| P4 Durable jobs                          | Not started    | —            | —                                                          |

The model counts and examples in the research are observations, not a model allowlist. No generation requests were made during planning, and no API keys or private media are included.
