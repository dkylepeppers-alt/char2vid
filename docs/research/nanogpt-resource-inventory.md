# Nano-GPT resource inventory

**Snapshot date:** 2026-09-13 UTC. All 123 indexed documentation pages were retrieved successfully. This inventory includes every page from the index and the separate OpenAPI resource. It is not a claim that all APIs were executed.

Core contract research covers the media/auth/job concerns used in the design. Supporting and separate-scope pages were screened for purpose and relevant headings; their detailed contracts must be checked before use. See the [research report](2026-09-13-research.md) for findings and the [snapshot](discovery-snapshot.json) for retrieval hashes.

## Core contract research (40)

| Resource | Planned use |
|---|---|
| [Authentication](https://docs.nano-gpt.com/authentication) | Use the current page for its matching provider adapter. |
| [Models](https://docs.nano-gpt.com/api-reference/endpoint/models) | Use the current page for its matching provider adapter. |
| [List Image Models](https://docs.nano-gpt.com/api-reference/endpoint/image-api-models) | Primary image catalog for the new app. |
| [Get Image Model Endpoints](https://docs.nano-gpt.com/api-reference/endpoint/image-api-model-endpoints) | Per-model parameters, prices, and reference constraints. |
| [Image Models](https://docs.nano-gpt.com/api-reference/endpoint/image-models) | Compatibility catalog; deduplicate by exact model ID. |
| [Video Models](https://docs.nano-gpt.com/api-reference/endpoint/video-models) | Use the current page for its matching provider adapter. |
| [Audio Models](https://docs.nano-gpt.com/api-reference/endpoint/audio-models) | Use the current page for its matching provider adapter. |
| [Personalized Models](https://docs.nano-gpt.com/api-reference/endpoint/personalized-models) | Optional personalized text-model view; not full discovery. |
| [Characters](https://docs.nano-gpt.com/api-reference/endpoint/characters) | Chat personas; separate from the visual character library. |
| [Character Models](https://docs.nano-gpt.com/api-reference/endpoint/character-models) | Discoverable chat personas; not image/video identity registration. |
| [v1/audio/transcriptions (STT)](https://docs.nano-gpt.com/api-reference/endpoint/audio-transcriptions) | Use the current page for its matching provider adapter. |
| [Generate Images](https://docs.nano-gpt.com/api-reference/endpoint/image-api-generate) | Preferred normalized image submit route. |
| [Image Generation (OpenAI-Compatible)](https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai) | Use the current page for its matching provider adapter. |
| [Image Edits](https://docs.nano-gpt.com/api-reference/endpoint/image-edits) | Use the current page for its matching provider adapter. |
| [Speech-to-Text Transcription](https://docs.nano-gpt.com/api-reference/endpoint/transcribe) | Use the current page for its matching provider adapter. |
| [Speech-to-Text Status](https://docs.nano-gpt.com/api-reference/endpoint/transcribe-status) | Use the current page for its matching provider adapter. |
| [v1/audio/speech (TTS + Music)](https://docs.nano-gpt.com/api-reference/endpoint/speech) | Use the current page for its matching provider adapter. |
| [Text-to-Speech](https://docs.nano-gpt.com/api-reference/endpoint/tts) | Use the current page for its matching provider adapter. |
| [TTS Status](https://docs.nano-gpt.com/api-reference/endpoint/tts-status) | Use the current page for its matching provider adapter. |
| [Voice Cloning](https://docs.nano-gpt.com/api-reference/endpoint/voice-cloning) | Model-qualified IDs/embeddings; recheck retention. |
| [Retrieve Midjourney Generation Status](https://docs.nano-gpt.com/api-reference/endpoint/check-midjourney-status) | Use the current page for its matching provider adapter. |
| [Video Generation](https://docs.nano-gpt.com/api-reference/endpoint/video-generation) | Use the current page for its matching provider adapter. |
| [Video Status (Unified)](https://docs.nano-gpt.com/api-reference/endpoint/video-status-unified) | Reconcile schema variants before certifying adapter. |
| [Video Recover](https://docs.nano-gpt.com/api-reference/endpoint/video-recover) | Bounded missing-job recovery; not complete history. |
| [Video Extend](https://docs.nano-gpt.com/api-reference/endpoint/video-extend) | Use the current page for its matching provider adapter. |
| [Video Content](https://docs.nano-gpt.com/api-reference/endpoint/video-content) | Use the current page for its matching provider adapter. |
| [Check Balance](https://docs.nano-gpt.com/api-reference/endpoint/check-balance) | Use the current page for its matching provider adapter. |
| [Usage](https://docs.nano-gpt.com/api-reference/endpoint/usage) | Aggregate current-key usage, not per-job output recovery. |
| [Text Generation](https://docs.nano-gpt.com/api-reference/text-generation) | Use the current page for its matching provider adapter. |
| [Image API](https://docs.nano-gpt.com/api-reference/image-generation) | Use the current page for its matching provider adapter. |
| [Video Generation](https://docs.nano-gpt.com/api-reference/video-generation) | Use the current page for its matching provider adapter. |
| [Speech-to-Text (STT)](https://docs.nano-gpt.com/api-reference/speech-to-text) | Use the current page for its matching provider adapter. |
| [Text-to-Speech (TTS)](https://docs.nano-gpt.com/api-reference/text-to-speech) | Use the current page for its matching provider adapter. |
| [Music Generation](https://docs.nano-gpt.com/api-reference/music-generation) | Use the current page for its matching provider adapter. |
| [Rate Limits](https://docs.nano-gpt.com/api-reference/miscellaneous/rate-limits) | Use the current page for its matching provider adapter. |
| [Error Handling](https://docs.nano-gpt.com/api-reference/miscellaneous/error-handling) | Use the current page for its matching provider adapter. |
| [Pricing and Fees](https://docs.nano-gpt.com/api-reference/miscellaneous/pricing) | Use the current page for its matching provider adapter. |
| [OAuth PKCE](https://docs.nano-gpt.com/api-reference/miscellaneous/oauth-pkce) | Optional future app-key sign-in; verify redirects/origins. |
| [JavaScript Library](https://docs.nano-gpt.com/api-reference/miscellaneous/javascript) | External SDK option; verify media coverage. |
| [TypeScript Library](https://docs.nano-gpt.com/api-reference/miscellaneous/typescript) | Unofficial client; inspect coverage before adopting. |

## Supporting resource (20)

| Resource | Planned use |
|---|---|
| [Introduction](https://docs.nano-gpt.com/introduction) | Consult when implementing the matching assistant/transport feature. |
| [Quickstart](https://docs.nano-gpt.com/quickstart) | Consult when implementing the matching assistant/transport feature. |
| [Chat Completion](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion) | Consult when implementing the matching assistant/transport feature. |
| [Batch API](https://docs.nano-gpt.com/api-reference/endpoint/batches) | Text/Responses batch work; not media generation batching. |
| [List Inline Batches](https://docs.nano-gpt.com/api-reference/endpoint/inline-batches-list) | Consult when implementing the matching assistant/transport feature. |
| [List All Batches](https://docs.nano-gpt.com/api-reference/endpoint/batches-list) | Consult when implementing the matching assistant/transport feature. |
| [Responses](https://docs.nano-gpt.com/api-reference/endpoint/responses) | Consult when implementing the matching assistant/transport feature. |
| [Messages](https://docs.nano-gpt.com/api-reference/endpoint/messages) | Consult when implementing the matching assistant/transport feature. |
| [Messages Count Tokens](https://docs.nano-gpt.com/api-reference/endpoint/messages-count-tokens) | Consult when implementing the matching assistant/transport feature. |
| [Embeddings](https://docs.nano-gpt.com/api-reference/endpoint/embeddings) | Consult when implementing the matching assistant/transport feature. |
| [Embedding Models](https://docs.nano-gpt.com/api-reference/endpoint/embedding-models) | Consult when implementing the matching assistant/transport feature. |
| [Subscription Usage](https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage) | Consult when implementing the matching assistant/transport feature. |
| [Embeddings](https://docs.nano-gpt.com/api-reference/embeddings) | Consult when implementing the matching assistant/transport feature. |
| [Streaming Protocol (SSE)](https://docs.nano-gpt.com/api-reference/miscellaneous/streaming-protocol) | Consult when implementing the matching assistant/transport feature. |
| [Compressed Request Bodies](https://docs.nano-gpt.com/api-reference/miscellaneous/request-compression) | Consult when implementing the matching assistant/transport feature. |
| [Video Input](https://docs.nano-gpt.com/api-reference/miscellaneous/video-input) | Consult when implementing the matching assistant/transport feature. |
| [Prompt Caching](https://docs.nano-gpt.com/api-reference/miscellaneous/prompt-caching) | Consult when implementing the matching assistant/transport feature. |
| [Pay-As-You-Go Billing Override](https://docs.nano-gpt.com/api-reference/miscellaneous/billing-override) | Consult when implementing the matching assistant/transport feature. |
| [Provider Selection](https://docs.nano-gpt.com/api-reference/miscellaneous/provider-selection) | Consult when implementing the matching assistant/transport feature. |
| [Model Suffixes](https://docs.nano-gpt.com/api-reference/miscellaneous/model-suffixes) | Consult when implementing the matching assistant/transport feature. |

## Optional or separate-scope resource (39)

| Resource | Planned use |
|---|---|
| [Direct Web Search API](https://docs.nano-gpt.com/api-reference/endpoint/web-search) | Inventoried for future use; not required for core creation. |
| [Data API](https://docs.nano-gpt.com/api-reference/endpoint/data-api) | Optional searchable research-tool catalog. |
| [Completions](https://docs.nano-gpt.com/api-reference/endpoint/completion) | Inventoried for future use; not required for core creation. |
| [NSFW Image Classification](https://docs.nano-gpt.com/api-reference/endpoint/nsfw-image) | Optional classification capability; no automatic paid preflight. |
| [Moderation Models](https://docs.nano-gpt.com/api-reference/endpoint/moderation-models) | Discovery for optional classification features. |
| [Moderations](https://docs.nano-gpt.com/api-reference/endpoint/moderations) | Optional provider classification integration. |
| [AI Detection](https://docs.nano-gpt.com/api-reference/endpoint/ai-detection) | Inventoried for future use; not required for core creation. |
| [YouTube Transcription](https://docs.nano-gpt.com/api-reference/endpoint/youtube-transcribe) | Inventoried for future use; not required for core creation. |
| [Context Memory (Standalone)](https://docs.nano-gpt.com/api-reference/endpoint/memory) | Inventoried for future use; not required for core creation. |
| [Web Scraping](https://docs.nano-gpt.com/api-reference/endpoint/scrape-urls) | Inventoried for future use; not required for core creation. |
| [Data Extraction APIs](https://docs.nano-gpt.com/api-reference/endpoint/data-extraction) | Inventoried for future use; not required for core creation. |
| [TEE Attestation](https://docs.nano-gpt.com/api-reference/endpoint/tee-attestation) | Inventoried for future use; not required for core creation. |
| [TEE Signature](https://docs.nano-gpt.com/api-reference/endpoint/tee-signature) | Inventoried for future use; not required for core creation. |
| [Create Invitation](https://docs.nano-gpt.com/api-reference/endpoint/invitations-create) | Inventoried for future use; not required for core creation. |
| [Receive Nano](https://docs.nano-gpt.com/api-reference/endpoint/receive-nano) | Inventoried for future use; not required for core creation. |
| [Deposits (Crypto + Fiat)](https://docs.nano-gpt.com/api-reference/endpoint/crypto-deposits) | Inventoried for future use; not required for core creation. |
| [TEE Verification](https://docs.nano-gpt.com/api-reference/tee-verification) | Inventoried for future use; not required for core creation. |
| [Evals and Observability](https://docs.nano-gpt.com/api-reference/evals) | Inventoried for future use; not required for core creation. |
| [Teams](https://docs.nano-gpt.com/api-reference/teams) | Team/account administration; beyond personal-studio release. |
| [Management API](https://docs.nano-gpt.com/api-reference/management-api) | Separate scoped management credentials; not inference auth. |
| [Inline Moderation](https://docs.nano-gpt.com/api-reference/miscellaneous/inline-moderation) | Optional paid provider preflight; not an implicit studio step. |
| [Accountless x402 API Payments](https://docs.nano-gpt.com/api-reference/miscellaneous/x402) | Inventoried for future use; not required for core creation. |
| [Extended Thinking (Reasoning)](https://docs.nano-gpt.com/api-reference/miscellaneous/extended-thinking) | Inventoried for future use; not required for core creation. |
| [Change Reasoning Effort Within a Conversation](https://docs.nano-gpt.com/api-reference/miscellaneous/inline-reasoning-effort) | Inventoried for future use; not required for core creation. |
| [Tool Calling Diagnostics](https://docs.nano-gpt.com/api-reference/miscellaneous/tool-calling-diagnostics) | Inventoried for future use; not required for core creation. |
| [Hosted tool search](https://docs.nano-gpt.com/api-reference/miscellaneous/hosted-tool-search) | Inventoried for future use; not required for core creation. |
| [Advisor](https://docs.nano-gpt.com/api-reference/miscellaneous/advisor) | Inventoried for future use; not required for core creation. |
| [Distillation Policy](https://docs.nano-gpt.com/api-reference/miscellaneous/distillation-policy) | Inventoried for future use; not required for core creation. |
| [PII Redaction](https://docs.nano-gpt.com/api-reference/miscellaneous/pii-redaction) | Inventoried for future use; not required for core creation. |
| [Brave](https://docs.nano-gpt.com/api-reference/miscellaneous/brave) | Inventoried for future use; not required for core creation. |
| [Bring Your Own Key (BYOK)](https://docs.nano-gpt.com/api-reference/miscellaneous/byok) | Inventoried for future use; not required for core creation. |
| [For Providers](https://docs.nano-gpt.com/api-reference/miscellaneous/for-providers) | Inventoried for future use; not required for core creation. |
| [Auto Recharge](https://docs.nano-gpt.com/api-reference/miscellaneous/auto-recharge) | Inventoried for future use; not required for core creation. |
| [Chrome Extension](https://docs.nano-gpt.com/api-reference/miscellaneous/chrome-extension) | Inventoried for future use; not required for core creation. |
| [URL Parameters (Web App)](https://docs.nano-gpt.com/web-app/url-parameters) | Inventoried for future use; not required for core creation. |
| [Context Memory](https://docs.nano-gpt.com/api-reference/miscellaneous/context-memory) | Inventoried for future use; not required for core creation. |
| [Model Context Protocol (MCP)](https://docs.nano-gpt.com/api-reference/miscellaneous/mcp-server) | Inventoried for future use; not required for core creation. |
| [Partner Program](https://docs.nano-gpt.com/partner/overview) | Inventoried for future use; not required for core creation. |
| [Partner Auth](https://docs.nano-gpt.com/api-reference/miscellaneous/partner-auth) | Partner-managed accounts; beyond personal-studio release. |

## External-client integration guide (24)

| Resource | Planned use |
|---|---|
| [Integrations](https://docs.nano-gpt.com/integrations) | Reference for external clients; no studio runtime dependency. |
| [CLI Device Login](https://docs.nano-gpt.com/integrations/cli-login) | Reference for external clients; no studio runtime dependency. |
| [Cline](https://docs.nano-gpt.com/integrations/cline) | Reference for external clients; no studio runtime dependency. |
| [Codex CLI](https://docs.nano-gpt.com/integrations/codex-cli) | Reference for external clients; no studio runtime dependency. |
| [Grok CLI](https://docs.nano-gpt.com/integrations/grok-cli) | Reference for external clients; no studio runtime dependency. |
| [Gemini CLI](https://docs.nano-gpt.com/integrations/gemini-cli) | Reference for external clients; no studio runtime dependency. |
| [Claude Code](https://docs.nano-gpt.com/integrations/claude-code) | Reference for external clients; no studio runtime dependency. |
| [Roo Code](https://docs.nano-gpt.com/integrations/roocode) | Reference for external clients; no studio runtime dependency. |
| [Kilo Code](https://docs.nano-gpt.com/integrations/kilocode) | Reference for external clients; no studio runtime dependency. |
| [Cursor](https://docs.nano-gpt.com/integrations/cursor) | Reference for external clients; no studio runtime dependency. |
| [Fluent](https://docs.nano-gpt.com/integrations/fluent) | Reference for external clients; no studio runtime dependency. |
| [MCP](https://docs.nano-gpt.com/integrations/mcp) | Reference for external clients; no studio runtime dependency. |
| [n8n](https://docs.nano-gpt.com/integrations/n8n) | Reference for external clients; no studio runtime dependency. |
| [SillyTavern](https://docs.nano-gpt.com/integrations/sillytavern) | Reference for external clients; no studio runtime dependency. |
| [RisuAI](https://docs.nano-gpt.com/integrations/risuai) | Reference for external clients; no studio runtime dependency. |
| [OpenWebUI](https://docs.nano-gpt.com/integrations/openwebui) | Reference for external clients; no studio runtime dependency. |
| [Otaku](https://docs.nano-gpt.com/integrations/otaku) | Reference for external clients; no studio runtime dependency. |
| [TypingMind](https://docs.nano-gpt.com/integrations/typingmind) | Reference for external clients; no studio runtime dependency. |
| [LibreChat](https://docs.nano-gpt.com/integrations/librechat) | Reference for external clients; no studio runtime dependency. |
| [OpenHands](https://docs.nano-gpt.com/integrations/openhands) | Reference for external clients; no studio runtime dependency. |
| [OpenClaw (ClawdBot)](https://docs.nano-gpt.com/integrations/openclaw) | Reference for external clients; no studio runtime dependency. |
| [OpenCode](https://docs.nano-gpt.com/integrations/opencode) | Reference for external clients; no studio runtime dependency. |
| [JanitorAI](https://docs.nano-gpt.com/integrations/janitorai) | Reference for external clients; no studio runtime dependency. |
| [Droid](https://docs.nano-gpt.com/integrations/droid) | Reference for external clients; no studio runtime dependency. |

## OpenAPI and coverage notes

- [OpenAPI JSON](https://docs.nano-gpt.com/api-reference/openapi.json): 60 path entries in the retrieved document. It is additional evidence, not a complete replacement for the indexed guides.
- [Documentation index](https://docs.nano-gpt.com/llms.txt): source of the 123-page inventory.
- Endpoint-specific server overrides, compatibility routes, session-only routes, and incomplete schemas require explicit adapter decisions.
- No inference endpoints were called during this research.
