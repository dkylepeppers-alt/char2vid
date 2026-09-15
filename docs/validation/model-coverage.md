# Model coverage audit (P5)

Reporting-only. This is not a runtime allowlist. Broad
`image_generation` / `video_generation` flags are not treated as proof of a
usable generation route. Automated tests did not spend Nano-GPT credits.

Generated from normalized catalog records. **12** exact IDs.

| Bucket       | Count |
| ------------ | ----: |
| usable       |     7 |
| restricted   |     3 |
| unresolved   |     2 |
| incompatible |     0 |

## Rows

| Catalog | Model ID                      | Status     | Operations                               | Reason                                                                                                                                                       | Evidence                                                                                                                                                                                                           |
| ------- | ----------------------------- | ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| audio   | `elevenlabs/music`            | unresolved | music                                    | Missing operation contract: music.                                                                                                                           | packages/nanogpt/src/contracts/route-contract.ts                                                                                                                                                                   |
| audio   | `Whisper-Large-V3`            | usable     | transcribe                               | Adapter family audio.transcriptions exists. Evidence remains metadata-only; this is not a paid-generation proof.                                             | https://docs.nano-gpt.com/api-reference/endpoint/audio-transcriptions.md https://docs.nano-gpt.com/api-reference/speech-to-text.md https://nano-gpt.com/api/v1/audio-models                                        |
| audio   | `xai-tts`                     | usable     | speech                                   | Adapter family audio.speech exists. Evidence remains metadata-only; this is not a paid-generation proof.                                                     | https://docs.nano-gpt.com/api-reference/endpoint/speech.md https://docs.nano-gpt.com/api-reference/music-generation.md                                                                                             |
| audio   | `yue2-3b/text-to-music`       | unresolved | music                                    | Missing operation contract: music.                                                                                                                           | packages/nanogpt/src/contracts/route-contract.ts                                                                                                                                                                   |
| image   | `birefnet/v2`                 | restricted | image-generate, image-edit               | Edit/utility/transform flags are present without a verified input-reference limit; image_generation/video_generation alone is not a usable generation proof. | image.normalized.generate                                                                                                                                                                                          |
| image   | `bytedance/seedream-v5.0-pro` | usable     | image-generate, image-edit               | Adapter family image.normalized.generate exists. Evidence remains metadata-only; this is not a paid-generation proof.                                        | https://docs.nano-gpt.com/api-reference/endpoint/image-api-generate.md https://docs.nano-gpt.com/api-reference/image-generation.md https://nano-gpt.com/api/v1/images/models/bytedance/seedream-v5.0-pro/endpoints |
| image   | `fixture/enum-range`          | restricted | image-generate, image-edit               | Edit/utility/transform flags are present without a verified input-reference limit; image_generation/video_generation alone is not a usable generation proof. | image.normalized.generate                                                                                                                                                                                          |
| image   | `fixture/unknown-control`     | usable     | image-generate                           | Adapter family image.normalized.generate exists. Evidence remains metadata-only; this is not a paid-generation proof.                                        | https://docs.nano-gpt.com/api-reference/endpoint/image-api-generate.md https://docs.nano-gpt.com/api-reference/image-generation.md https://nano-gpt.com/api/v1/images/models/bytedance/seedream-v5.0-pro/endpoints |
| text    | `fixture/text-a`              | usable     | text                                     | Adapter family text.chat.completions exists. Evidence remains metadata-only; this is not a paid-generation proof.                                            | https://docs.nano-gpt.com/api-reference/text-generation.md https://docs.nano-gpt.com/api-reference/endpoint/chat-completion.md https://docs.nano-gpt.com/api-reference/miscellaneous/video-input.md                |
| text    | `fixture/text-b`              | usable     | text                                     | Adapter family text.chat.completions exists. Evidence remains metadata-only; this is not a paid-generation proof.                                            | https://docs.nano-gpt.com/api-reference/text-generation.md https://docs.nano-gpt.com/api-reference/endpoint/chat-completion.md https://docs.nano-gpt.com/api-reference/miscellaneous/video-input.md                |
| video   | `bytedance/seedance-2.5`      | restricted | video-generate, video-edit, video-extend | Edit/utility/transform flags are present without a verified input-reference limit; image_generation/video_generation alone is not a usable generation proof. | video.generate                                                                                                                                                                                                     |
| video   | `fixture/video-control-zoo`   | usable     | video-generate                           | Adapter family video.generate exists. Evidence remains metadata-only; this is not a paid-generation proof.                                                   | https://docs.nano-gpt.com/api-reference/endpoint/video-generation.md https://docs.nano-gpt.com/api-reference/video-generation.md https://nano-gpt.com/api/v1/video-models?detailed=true                            |

## UNVERIFIED

- Live paid Nano-GPT smoke per route family (no implementation budget/key).
- Complete live catalog census (P1 stores hashes, not full bodies). Re-run
  `npm run audit:coverage -- --live` when network access to nano-gpt.com is
  available and record new hashes without spending credits.
- Physical Android interruption sequence.
