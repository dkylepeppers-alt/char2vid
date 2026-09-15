# Job recovery evidence (P5)

Fake-provider only. Automated tests did not spend Nano-GPT credits and do
not use `VITE_*` secrets.

Service version under test: the P5 branch of this repository. Observation
date: 2026-09-15 (UTC).

## Recovery boundaries

| Boundary                                                                       | Result      | Evidence                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| queued before provider → cancel → no provider call                             | pass (fake) | `tests/contract/jobs.test.ts` cancel case; Playwright `generation-recovery.spec.ts` cancel after double Generate                                             |
| submitted with known run ID → disconnect → resume → same run ID                | pass (fake) | `tests/contract/jobs.test.ts` service restart while video `running`; `providerRunId` stays `video-run-1`                                                     |
| submission response lost → unknown → recovery attempt → no automatic resubmit  | pass (fake) | submitting lease expiry → `submission-unknown`; worker does not claim it again                                                                               |
| provider complete → download interrupted → retry download → one logical result | pass (fake) | acknowledge twice leaves `submits === 1`; Playwright second `/__fake/tick` does not increment submits                                                        |
| provider URL expired → use service copy; else unrecoverable bytes              | pass (fake) | clearing fake CDN map still serves `/outputs/0`; deleting staging files returns `unrecoverable_bytes`                                                        |
| app force-stop → service continues; local save reconciles after restart        | partial     | Service restart proven in contract tests. Emulator: `JobOutputReconcileInstrumentedTest` native hash round-trip. **Physical Android force-stop UNVERIFIED.** |

## Error envelopes (fake provider)

| Case                              | Observed                                                                                 | Notes                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Catalog partial outage            | Playwright: image catalog 503 → “Catalog unavailable”                                    | No provider submit                                                                              |
| Revoked / missing key during poll | `providerState=recovery-required`, approved retry with a new `client_request_id` allowed | Must not be written as terminal `failed`                                                        |
| 402                               | `failed` / `provider_402`                                                                | Fake only; live 402 UNVERIFIED                                                                  |
| Transient 429                     | `failed` / `provider_rate_limited`                                                       | Worker currently treats 429 as terminal. Bounded retry is not implemented.                      |
| Daily 429                         | same as 429                                                                              | Not distinguished from transient 429                                                            |
| Denied model                      | worker `stubModel` advertises the draft operation                                        | Safe for fake CI. Watch when a real key is used: catalog limits are not enforced in the worker. |

## Create idempotency

One user intent reuses a stored `client_request_id` until a receipt is
received. A submit gate ignores a second click while the first POST is in
flight. Duplicate POSTs with that id return the existing receipt.

## Cost producers

| State         | Producer                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| `estimate`    | `estimateJobCost` at enqueue when duration is present                    |
| `reservation` | `reserveJobCost` when the worker claims / `markSubmitting`               |
| `final`       | `applyProviderCost` from a provider amount                               |
| `refund`      | `applyProviderCost(..., true)` from `failJob` after reservation or final |
| `unknown`     | enqueue without a duration                                               |

## UNVERIFIED

- Physical Android interruption / force-stop / suspend
- Physical-device Keystore round-trip
- Live HTTPS service deploy
- Live Nano-GPT check-balance, paid generation, status, or download
- Distinct daily-quota 429 versus transient 429
- Worker catalog-limit enforcement with a real key
