# Research: AI Chatbot

## Decision: Implement V1 as Cloudflare Workers RAG, not a standalone AI service

**Rationale**: `docs/ai-chat-proposal.md` matches the current reserve-app architecture: backend already runs on
Cloudflare Workers + Hono + Better Auth + D1, and web already calls backend through the existing client layer. Keeping
RAG in `apps/backend` preserves session handling, organization/classroom scope resolution, Sentry context, deployment
order, and D1 access without adding a new service boundary.

**Alternatives considered**:

- Separate AI backend: rejected because it would duplicate auth/scope resolution and add deployment/secrets surface.
- Client-side LLM/RAG call: rejected because source visibility, billing facts, and owner-only rules must be enforced server-side.

## Decision: Use Workers AI for embeddings and answer generation with AI Gateway options

**Rationale**: The proposal specifies Workers AI as the first V1 path. Cloudflare AI Gateway Workers binding docs show
`env.AI.run()` accepts Gateway options, which supports logs/cache/metadata and keeps model calls in the Worker runtime.
The implementation should centralize all model calls in `apps/backend/src/ai/answer-generator.ts` and
`apps/backend/src/ai/embedding.ts` so Gateway id, cache policy, skip-cache decisions, and log metadata are consistent.

**Alternatives considered**:

- Direct REST calls to third-party LLMs: deferred; allowed later through AI Gateway if Workers AI answer quality is insufficient.
- No AI Gateway: rejected because the spec requires observability, rate limiting support, fallback readiness, and cache control.

## Decision: Use `@cf/baai/bge-m3` as first embedding candidate, but verify shape before index creation

**Rationale**: reserve-app support content is Japanese-first, and the proposal identifies `@cf/baai/bge-m3` as the
multi-lingual first candidate. Vectorize dimensions and metric are fixed at index creation, so implementation must run
a dev shape check for the adopted embedding request format before creating `reserve-app-knowledge`. The plan must not
hard-code dimensions until that check is recorded.

**Alternatives considered**:

- `@cf/baai/bge-base-en-v1.5`: retained as fallback for English-heavy content; current docs list 768 dimensions for this model.
- Create Vectorize index before model verification: rejected because an incorrect dimensions choice requires re-creating the index.

## Decision: Keep D1 as source of truth and Vectorize as search-only index

**Rationale**: Knowledge body, source metadata, visibility, checksums, conversation logs, feedback, retention state, and
usage counters need transactional application state and queryability. Vectorize should store chunk id, vector values,
and filter metadata only. Retrieval uses Vectorize for candidate ids, then D1 fetches chunk bodies and performs
authorization-aware post-filtering before prompt construction.

**Alternatives considered**:

- Store full chunk content in Vectorize metadata: rejected because metadata limits and privacy boundaries make D1 the safer source.
- Search D1 text only: rejected because Japanese support Q&A needs semantic retrieval over docs/specs/FAQ.

## Decision: Enforce source visibility in both Vectorize metadata filtering and backend post-filtering

**Rationale**: Vectorize metadata filtering narrows the candidate set before topK, but backend must still treat D1 as
the source of truth because source visibility, internal specs, organization/classroom scope, and deleted/stale documents
can change. The retriever therefore applies allowed visibility, organization/classroom scope, internal-only, and
freshness checks after loading chunks from D1.

**Alternatives considered**:

- Trust Vectorize filter alone: rejected because metadata can be stale until re-upsert and cannot replace source-of-truth checks.
- Retrieve all then filter only in D1: rejected because it increases unnecessary vector candidates and weakens tenant scoping efficiency.

## Decision: Resolve current permitted business facts at answer time

**Rationale**: Clarification selected answer-time business facts for booking, invitation, ticket, participant, and
billing summaries. This lets the assistant explain current Premium, ticket, service, invitation, and participant
conditions without turning AI into an action executor. Business facts must be summarized through existing domain
queries and capability checks, not copied wholesale into prompts.

**Alternatives considered**:

- Precomputed DB summaries only: rejected because they can be stale for billing/ticket/booking diagnostics.
- Docs/FAQ only: rejected because many reserve-app support questions depend on current organization/classroom state.

## Decision: Add D1 usage counters in addition to AI Gateway observability

**Rationale**: The spec requires deterministic product limits: 20 messages per user per hour and 200 per organization
per day. AI Gateway can support operational rate limiting, but backend D1 counters make the requirement testable in
local integration tests and allow product-specific retry messaging before model calls are made.

**Alternatives considered**:

- AI Gateway limits only: rejected because product-level user/org counters need deterministic app behavior and tests.
- No hard limits in V1: rejected by clarification.

## Decision: Use additive retention fields and scheduled cleanup for conversation content

**Rationale**: Conversation content must be retained for 180 days then deleted or anonymized, while aggregate feedback
is retained for 1 year. The existing Worker has scheduled maintenance, so AI retention can be added as another scheduled
maintenance task after D1 migration. Assistant/user message rows can keep safe metadata after content anonymization for
quality aggregate counts.

**Alternatives considered**:

- Keep content forever: rejected by clarification and privacy risk.
- Store no conversation content: rejected because V1 requires conversation continuity and quality review context.

## Decision: Provide a web-only chat widget in V1

**Rationale**: The spec scopes V1 to authenticated web users. Web has existing SvelteKit routes, shared UI components,
and Hono client types. The chat widget can be mounted from layout and stay guidance-only. Mobile is documented as
out-of-scope unless planning later expands scope.

**Alternatives considered**:

- Add Expo mobile chat in V1: rejected because mobile automated tests are not established and the feature already has backend/web risk.
- Standalone AI page only: rejected because current page context is part of V1 relevance.

## References

- Local proposal: [docs/ai-chat-proposal.md](../../docs/ai-chat-proposal.md)
- Cloudflare AI Gateway Workers binding methods: https://developers.cloudflare.com/ai-gateway/integrations/worker-binding-methods/
- Cloudflare Workers AI binding: https://developers.cloudflare.com/workers-ai/configuration/bindings/
- Cloudflare Vectorize metadata filtering: https://developers.cloudflare.com/vectorize/reference/metadata-filtering/
- Cloudflare Workers AI bge-m3 model page: https://developers.cloudflare.com/workers-ai/models/bge-m3/
