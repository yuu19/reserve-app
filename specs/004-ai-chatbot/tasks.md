# Tasks: AI Chatbot

**Input**: Design artifacts from `/specs/004-ai-chatbot/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`

**Tests**: Required. This feature touches authentication, authorization boundaries, D1 persistence, Vectorize filtering, and Svelte UI behavior.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Phase 1: Setup

**Purpose**: Add the shared Cloudflare and project structure needed by all stories.

- [x] T001 Configure Workers AI, Vectorize, and AI Gateway-related environment settings in `apps/backend/wrangler.jsonc`.
- [x] T002 [P] Add backend environment types for `AI`, `AI_KNOWLEDGE_INDEX`, embedding model, chat model, and AI Gateway settings in `apps/backend/src/auth-worker.ts`.
- [x] T003 [P] Create shared AI module exports for backend services in `apps/backend/src/ai/index.ts`.
- [x] T004 [P] Create the web AI component barrel export in `apps/web/src/lib/components/ai/index.ts`.

---

## Phase 2: Foundation

**Purpose**: Build the data model, access primitives, and reusable AI infrastructure that block all user stories.

- [x] T005 Add D1 migration for `ai_knowledge_document`, `ai_knowledge_chunk`, `ai_knowledge_index_run`, `ai_conversation`, `ai_message`, `ai_feedback`, and `ai_usage_counter` in `apps/backend/drizzle/0018_ai_chatbot.sql`.
- [x] T006 Add Drizzle schema definitions and relations for AI knowledge, conversation, message, feedback, index run, and usage counter tables in `apps/backend/src/db/schema.ts`.
- [x] T007 [P] Add unit tests for visibility role mapping, organization/classroom scoping, and internal source handling in `apps/backend/src/ai/source-visibility.test.ts`.
- [x] T008 [P] Implement allowed visibility calculation and metadata/D1 visibility predicates in `apps/backend/src/ai/source-visibility.ts`.
- [x] T009 [P] Add unit tests for per-user hourly and per-organization daily usage limits in `apps/backend/src/ai/rate-limit.test.ts`.
- [x] T010 [P] Implement D1-backed usage counting and rate-limit decisions in `apps/backend/src/ai/rate-limit.ts`.
- [x] T011 [P] Add unit tests for conversation ownership checks, message persistence, and retention metadata in `apps/backend/src/ai/conversation-store.test.ts`.
- [x] T012 Implement conversation, message, source, feedback, and retention persistence helpers in `apps/backend/src/ai/conversation-store.ts`.
- [x] T013 [P] Add unit tests for Workers AI embedding response shape parsing and missing-vector errors in `apps/backend/src/ai/embedding.test.ts`.
- [x] T014 [P] Implement embedding generation wrapper and model shape normalization in `apps/backend/src/ai/embedding.ts`.
- [x] T015 [P] Add prompt tests for grounded answers, no action execution, prompt-injection resistance, and sensitive billing redaction in `apps/backend/src/ai/prompt.test.ts`.
- [x] T016 [P] Implement system prompt, context formatting, source formatting, and safety instructions in `apps/backend/src/ai/prompt.ts`.
- [x] T017 Create the AI route module with authenticated route scaffolding for chat, feedback, and internal review endpoints in `apps/backend/src/routes/ai-routes.ts`.
- [x] T018 Register the AI route module under `/api/v1/ai` and `/api/v1/internal/ai` in `apps/backend/src/app.ts`.

**Checkpoint**: D1 schema, env bindings, authorization helpers, prompt helpers, persistence helpers, and route scaffolding exist.

---

## Phase 3: User Story 1 - 根拠付きセルフサポート (Priority: P1)

**Goal**: Authenticated users can ask support questions and receive grounded answers with sources, suggested actions, confidence, and safe fallback behavior.

**Independent Test**: An authenticated user asks a booking/how-to question and receives an answer with relevant sources and suggested navigation, while an unsupported question returns a human-support fallback without executing any operation.

### Tests for User Story 1

- [ ] T019 [P] [US1] Add backend integration tests for authenticated chat success, unauthenticated rejection, request validation, safe fallback, and no operation execution in `apps/backend/src/app.test.ts`.
- [x] T020 [P] [US1] Add answer generation tests for source-grounded output, confidence calculation, suggested actions, and low-confidence fallback in `apps/backend/src/ai/answer-generator.test.ts`.
- [x] T021 [P] [US1] Add web component tests for sending a message, rendering assistant text, showing sources, and showing suggested actions in `apps/web/src/lib/components/ai/AiChatWidget.svelte.spec.ts`.

### Implementation for User Story 1

- [x] T022 [US1] Implement Vectorize query, D1 chunk lookup, score handling, and top-context trimming in `apps/backend/src/ai/retriever.ts`.
- [x] T023 [US1] Implement LLM invocation, response parsing, confidence calculation, fallback detection, and source extraction in `apps/backend/src/ai/answer-generator.ts`.
- [x] T024 [US1] Implement `POST /api/v1/ai/chat` validation, session checks, retrieval, answer generation, and message persistence in `apps/backend/src/routes/ai-routes.ts`.
- [x] T025 [US1] Implement typed chat client request/response helpers in `apps/web/src/lib/ai-client.ts`.
- [x] T026 [US1] Implement client-side AI chat state for messages, pending state, errors, conversation id, and feedback status in `apps/web/src/lib/features/ai-chat.svelte.ts`.
- [x] T027 [P] [US1] Implement assistant/user message rendering and loading/error states in `apps/web/src/lib/components/ai/AiMessageList.svelte`.
- [x] T028 [P] [US1] Implement source list rendering with title, source kind, and safe source path display in `apps/web/src/lib/components/ai/AiSourceList.svelte`.
- [x] T029 [P] [US1] Implement suggested action rendering for `open_page`, `contact_owner`, and `contact_support` in `apps/web/src/lib/components/ai/AiSuggestedActions.svelte`.
- [x] T030 [US1] Implement the chat widget shell, message input, submit handling, disabled states, and component composition in `apps/web/src/lib/components/ai/AiChatWidget.svelte`.
- [x] T031 [US1] Mount the AI chat widget in the authenticated web layout without exposing it on public routes in `apps/web/src/routes/+layout.svelte`.

**Checkpoint**: US1 is independently usable as an MVP support chat for authenticated users.

---

## Phase 4: User Story 2 - 権限に応じた安全な回答 (Priority: P1)

**Goal**: Answers and sources respect role, organization, classroom, billing, and internal-document boundaries.

**Independent Test**: The same billing/internal-spec question returns owner-only details to an owner, but returns a safe owner-contact instruction to a participant and never leaks internal-only source snippets or paths.

### Tests for User Story 2

- [x] T032 [P] [US2] Extend visibility tests for owner/admin/manager/staff/participant roles, owner-only billing, and internal specs in `apps/backend/src/ai/source-visibility.test.ts`.
- [ ] T033 [P] [US2] Add backend integration tests for cross-organization denial, classroom scoping, participant billing redaction, and internal source filtering in `apps/backend/src/app.test.ts`.
- [x] T034 [P] [US2] Add UI tests for hiding restricted source paths and showing safe owner-contact guidance in `apps/web/src/lib/components/ai/AiSourceList.svelte.spec.ts`.

### Implementation for User Story 2

- [x] T035 [US2] Implement session, active organization, classroom, participant, and member role resolution in `apps/backend/src/ai/context-resolver.ts`.
- [x] T036 [US2] Enforce Vectorize metadata filters and D1 post-filtering for visibility, organization, and classroom scope in `apps/backend/src/ai/retriever.ts`.
- [x] T037 [US2] Implement owner-only billing detail guards and participant-safe billing summaries in `apps/backend/src/ai/business-facts.ts`.
- [x] T038 [US2] Enforce conversation ownership, requested organization/classroom scope checks, and safe source serialization in `apps/backend/src/routes/ai-routes.ts`.
- [x] T039 [US2] Render restricted-source fallbacks and suppress unsafe internal paths in `apps/web/src/lib/components/ai/AiSourceList.svelte`.

**Checkpoint**: Role and tenant boundaries are enforced in retrieval, business facts, API response serialization, and UI rendering.

---

## Phase 5: User Story 3 - 業務文脈を踏まえた案内 (Priority: P2)

**Goal**: Answers incorporate current permitted booking, service, invitation, participant, ticket, and billing facts at answer time.

**Independent Test**: A manager asking why a participant cannot book gets an answer grounded in current permitted service/ticket/participant facts and docs, while stale conversation history does not override current database state.

### Tests for User Story 3

- [x] T040 [P] [US3] Add business-fact resolver tests for booking, service, invitation, participant, ticket, and billing summaries in `apps/backend/src/ai/business-facts.test.ts`.
- [x] T041 [P] [US3] Add prompt tests verifying DB facts are structured separately from retrieved docs and excluded when not permitted in `apps/backend/src/ai/prompt.test.ts`.
- [ ] T042 [P] [US3] Add backend integration tests for answer-time fact refresh and currentPage-as-hint-only behavior in `apps/backend/src/app.test.ts`.

### Implementation for User Story 3

- [x] T043 [US3] Implement permitted booking, service, invitation, participant, ticket, and billing fact summaries in `apps/backend/src/ai/business-facts.ts`.
- [x] T044 [US3] Add structured `User context`, `Retrieved docs`, and `DB facts` prompt assembly in `apps/backend/src/ai/prompt.ts`.
- [x] T045 [US3] Persist retrieved chunk ids, fact keys, source metadata, and confidence for assistant messages in `apps/backend/src/ai/conversation-store.ts`.
- [x] T046 [US3] Integrate fact resolution into `POST /api/v1/ai/chat` before answer generation in `apps/backend/src/routes/ai-routes.ts`.
- [x] T047 [US3] Map fact-aware next steps into suggested actions in `apps/web/src/lib/components/ai/AiSuggestedActions.svelte`.

**Checkpoint**: The assistant uses current permitted business facts without treating page context or conversation history as authorization.

---

## Phase 6: User Story 4 - フィードバックと人への引き継ぎ (Priority: P3)

**Goal**: Users can rate AI answers, low-confidence answers request human support, and internal operators can review feedback themes with conversation context.

**Independent Test**: A user marks an answer unhelpful with a comment; the feedback is stored against the message, the UI reflects the submitted state, and low-confidence answers include human-support guidance.

### Tests for User Story 4

- [ ] T048 [P] [US4] Add backend integration tests for `POST /api/v1/ai/messages/{messageId}/feedback`, ownership checks, duplicate handling, and validation in `apps/backend/src/app.test.ts`.
- [x] T049 [P] [US4] Add widget tests for helpful/unhelpful feedback, optional comment, submitted state, and low-confidence human-support display in `apps/web/src/lib/components/ai/AiChatWidget.svelte.spec.ts`.

### Implementation for User Story 4

- [x] T050 [US4] Implement `POST /api/v1/ai/messages/{messageId}/feedback` in `apps/backend/src/routes/ai-routes.ts`.
- [x] T051 [US4] Implement feedback persistence, message ownership validation, and aggregate feedback helper queries in `apps/backend/src/ai/conversation-store.ts`.
- [x] T052 [US4] Implement feedback controls, comment submission, optimistic disabled state, and error handling in `apps/web/src/lib/components/ai/AiChatWidget.svelte`.
- [x] T053 [US4] Render `needsHumanSupport` and low-confidence guidance in `apps/web/src/lib/components/ai/AiMessageList.svelte`.

**Checkpoint**: Feedback and handoff behavior work without exposing unrelated conversation data.

---

## Phase 7: User Story 5 - 知識鮮度と運用品質の確認 (Priority: P3)

**Goal**: Internal operators can inspect indexed knowledge freshness, failed indexing status, and aggregate feedback themes.

**Independent Test**: An internal operator sees knowledge source freshness and aggregate feedback themes, while a normal authenticated user receives a forbidden response for the same internal endpoints.

### Tests for User Story 5

- [ ] T054 [P] [US5] Add indexer tests for markdown/spec chunking, checksum reuse, visibility metadata, and failed-run recording in `apps/backend/src/ai/indexer.test.ts`.
- [ ] T055 [P] [US5] Add internal endpoint tests for operator access, normal-user denial, knowledge freshness response, and feedback themes response in `apps/backend/src/app.test.ts`.

### Implementation for User Story 5

- [x] T056 [US5] Implement markdown/spec/FAQ discovery, frontmatter parsing, chunking, checksums, D1 writes, and Vectorize upserts in `apps/backend/src/ai/indexer.ts`.
- [x] T057 [US5] Add the executable indexing script for docs, specs, FAQ, and safe DB summaries in `apps/backend/scripts/index-ai-knowledge.mjs`.
- [x] T058 [US5] Implement `GET /api/v1/internal/ai/knowledge` with freshness, source count, chunk count, and last error summaries in `apps/backend/src/routes/ai-routes.ts`.
- [x] T059 [US5] Implement `GET /api/v1/internal/ai/feedback-themes` with aggregate themes and permitted conversation context in `apps/backend/src/routes/ai-routes.ts`.
- [ ] T060 [US5] Implement index run and feedback theme helper queries in `apps/backend/src/ai/conversation-store.ts`.

**Checkpoint**: Internal operational review is available through protected API endpoints.

---

## Phase 8: Polish & Cross-Cutting

**Purpose**: Complete retention, observability, documentation, and full verification.

- [x] T061 Add retention cleanup tests for 180-day conversation content and 1-year aggregate feedback retention in `apps/backend/src/ai/conversation-store.test.ts`.
- [x] T062 Implement retention cleanup helpers and scheduled worker entry integration in `apps/backend/src/ai/conversation-store.ts` and `apps/backend/src/worker.ts`.
- [x] T063 Add Sentry breadcrumbs/metrics-safe logging for AI request ids, latency, fallback state, and rate-limit decisions in `apps/backend/src/routes/ai-routes.ts`.
- [x] T064 Document AI bindings, Vectorize index creation, AI Gateway cache policy, and indexing operations in `docs/ai-chat-proposal.md`.
- [x] T065 Record local verification commands and expected outputs for API, indexing, and web UI smoke tests in `specs/004-ai-chatbot/quickstart.md`.
- [x] T066 Verify OpenAPI contract alignment between the implementation and `specs/004-ai-chatbot/contracts/ai-api.openapi.yaml` in `apps/backend/src/routes/ai-routes.ts`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundation (Phase 2)**: Depends on Setup; blocks all user stories.
- **US1 (Phase 3)**: Depends on Foundation; this is the MVP path.
- **US2 (Phase 4)**: Depends on Foundation; backend authorization work can proceed in parallel with US1, while UI source rendering depends on US1 source components.
- **US3 (Phase 5)**: Depends on Foundation; route integration depends on the US1 chat route.
- **US4 (Phase 6)**: Depends on US1 message persistence.
- **US5 (Phase 7)**: Depends on Foundation; internal endpoint work can proceed independently from web UI tasks.
- **Polish (Phase 8)**: Depends on relevant story implementations.

### Story Dependencies

- **US1 (P1)**: Independent MVP after Foundation.
- **US2 (P1)**: Required before production exposure; shares retrieval and route surfaces with US1.
- **US3 (P2)**: Enhances US1 with current business facts.
- **US4 (P3)**: Requires assistant messages from US1.
- **US5 (P3)**: Uses foundation data model and indexing state.

### Within Each Story

- Tests must be written before implementation tasks for the same story.
- Backend service implementation should precede route integration.
- Web client state should precede component composition.
- Story checkpoint must pass before moving to lower-priority stories for release scope decisions.

### Parallel Opportunities

- `T002`, `T003`, and `T004` can run in parallel after `T001`.
- `T007`, `T009`, `T011`, `T013`, and `T015` can run in parallel after `T006`.
- `T019`, `T020`, and `T021` can run in parallel at the start of US1.
- `T027`, `T028`, and `T029` can run in parallel after `T026`.
- `T032`, `T033`, and `T034` can run in parallel at the start of US2.
- `T040`, `T041`, and `T042` can run in parallel at the start of US3.
- `T048` and `T049` can run in parallel at the start of US4.
- `T054` and `T055` can run in parallel at the start of US5.

---

## Parallel Example: User Story 1

```bash
# Independent tests
Task: "Add backend integration tests for authenticated chat success, unauthenticated rejection, request validation, safe fallback, and no operation execution in apps/backend/src/app.test.ts"
Task: "Add answer generation tests for source-grounded output, confidence calculation, suggested actions, and low-confidence fallback in apps/backend/src/ai/answer-generator.test.ts"
Task: "Add web component tests for sending a message, rendering assistant text, showing sources, and showing suggested actions in apps/web/src/lib/components/ai/AiChatWidget.svelte.spec.ts"

# Independent UI components after chat state exists
Task: "Implement assistant/user message rendering and loading/error states in apps/web/src/lib/components/ai/AiMessageList.svelte"
Task: "Implement source list rendering with title, source kind, and safe source path display in apps/web/src/lib/components/ai/AiSourceList.svelte"
Task: "Implement suggested action rendering for open_page, contact_owner, and contact_support in apps/web/src/lib/components/ai/AiSuggestedActions.svelte"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Validate authenticated chat, retrieval, source display, fallback behavior, and no operation execution.
4. Release only after Phase 4 (US2) authorization boundaries are complete for production exposure.

### Incremental Delivery

1. US1: Grounded self-support chat.
2. US2: Role-safe and tenant-safe answer boundaries.
3. US3: Current business facts in answers.
4. US4: Feedback and human-support handoff.
5. US5: Internal knowledge freshness and feedback review.

### Team Parallelism

- Backend retrieval/LLM work: `apps/backend/src/ai/retriever.ts`, `apps/backend/src/ai/answer-generator.ts`, `apps/backend/src/routes/ai-routes.ts`.
- Backend safety/data work: `apps/backend/src/ai/source-visibility.ts`, `apps/backend/src/ai/context-resolver.ts`, `apps/backend/src/ai/business-facts.ts`.
- Indexing/operations work: `apps/backend/src/ai/indexer.ts`, `apps/backend/scripts/index-ai-knowledge.mjs`, internal API sections in `apps/backend/src/routes/ai-routes.ts`.
- Frontend work: `apps/web/src/lib/ai-client.ts`, `apps/web/src/lib/features/ai-chat.svelte.ts`, `apps/web/src/lib/components/ai/*`.
