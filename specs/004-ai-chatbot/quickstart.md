# Quickstart: AI Chatbot

## Scope

AI Chatbot V1 adds a web-only, authenticated, guidance-only assistant. It uses approved knowledge and current permitted
business facts to answer support questions. It does not create bookings, change billing, manage participants, grant
tickets, send invitations, or create support tickets.

## Prerequisites

- `docs/ai-chat-proposal.md` remains the technical source for the V1 stack.
- Existing backend, web, and D1 setup is working locally.
- Cloudflare account has Workers AI, AI Gateway, and Vectorize available for the target environment.
- The embedding model shape has been verified in a dev Worker before creating the Vectorize index.
- `reserve-app-knowledge` Vectorize index exists with dimensions matching the adopted embedding model and metric `cosine`.
- Vectorize metadata indexes required for filtering are created before production indexing.

## Expected Backend Configuration

Add to `apps/backend/wrangler.jsonc` after the model shape and index are confirmed:

- AI binding: `AI`
- Vectorize binding: `AI_KNOWLEDGE_INDEX`
- AI Gateway id variable, for example `AI_GATEWAY_ID`
- AI model variables if the implementation chooses configurable model ids:
  - `AI_EMBEDDING_MODEL`
  - `AI_ANSWER_MODEL`

Keep existing bindings:

- `DB`
- `ORG_LOGO_BUCKET`
- `IMAGES`
- Sentry variables
- Stripe/Resend variables used by existing domains

## Implementation Order

1. Add additive D1 migration and Drizzle schema.
   - Add `ai_knowledge_document`, `ai_knowledge_chunk`, `ai_knowledge_index_run`, `ai_conversation`, `ai_message`,
     `ai_feedback`, and `ai_usage_counter`.
   - Keep existing auth, organization, classroom, booking, ticket, invitation, and billing rows untouched.

2. Add Cloudflare AI/Vectorize bindings and env types.
   - Update `apps/backend/wrangler.jsonc`.
   - Update `apps/backend/src/auth-worker.ts` env typing.
   - Run Wrangler type generation if implementation requires generated Worker env types.

3. Build backend AI domain modules.
   - `source-visibility.ts`: role/scope visibility decisions, internal specs rule, owner-only billing guard.
   - `context-resolver.ts`: session, active organization, classroom, role, and effective capability resolution.
   - `rate-limit.ts`: 20 user messages/hour and 200 organization messages/day counters.
   - `embedding.ts`: Workers AI embedding call through Gateway options and provider shape parser.
   - `retriever.ts`: Vectorize query with metadata filter, D1 chunk fetch, D1 post-filter, rerank/trim.
   - `business-facts.ts`: answer-time booking, invitation, ticket, participant, and billing summaries.
   - `prompt.ts`: structured system/user context, no-action instruction, no unsupported assertion instruction.
   - `answer-generator.ts`: Workers AI answer call through AI Gateway, confidence/fallback parsing.
   - `conversation-store.ts`: scoped conversation/message storage, feedback storage, retention metadata.
   - `indexer.ts`: docs/specs/FAQ/db-summary chunking and D1 + Vectorize upsert orchestration.

4. Add backend routes.
   - Register `/api/v1/ai` in `apps/backend/src/app.ts`.
   - Add `POST /api/v1/ai/chat`.
   - Add `POST /api/v1/ai/messages/{messageId}/feedback`.
   - Add internal-operator-only review endpoints for knowledge freshness and feedback themes.

5. Add knowledge indexing script.
   - Add `apps/backend/scripts/index-ai-knowledge.mjs`.
   - Index `apps/docs`, role-permitted `specs`, fixed FAQ content, and safe DB summaries.
   - Record `ai_knowledge_index_run` result and fail safely when Vectorize upsert fails.

6. Add web client and UI.
   - Add `apps/web/src/lib/ai-client.ts`.
   - Add Svelte 5 AI components under `apps/web/src/lib/components/ai`.
   - Add state helper under `apps/web/src/lib/features/ai-chat.svelte.ts`.
   - Mount widget in `apps/web/src/routes/+layout.svelte` for authenticated web users.

7. Add scheduled retention cleanup.
   - Extend `apps/backend/src/worker.ts` scheduled maintenance to delete or anonymize message content after 180 days.
   - Keep aggregate feedback for 1 year.

8. Update documentation if release steps or environment variables change.
   - Update `docs/README.md` or app README only after implementation confirms exact Cloudflare settings.

## Verification Commands

Targeted backend checks:

```bash
pnpm --filter @apps/backend typecheck
pnpm --filter @apps/backend exec vitest run src/ai/source-visibility.test.ts src/ai/rate-limit.test.ts src/ai/embedding.test.ts src/ai/prompt.test.ts src/ai/answer-generator.test.ts src/ai/indexer.test.ts src/ai/business-facts.test.ts src/ai/conversation-store.test.ts
pnpm --filter @apps/backend exec vitest run src/app.test.ts -t "AI|ai|chat|source|feedback|rate"
pnpm --filter @apps/backend test
```

Expected output for the implemented AI unit subset:

- `tsc --noEmit` exits with code 0.
- `8 passed (8)` test files.
- `27 passed (27)` tests.

Note: the full backend suite includes existing Miniflare app tests and may take substantially longer than the AI-only subset.

Targeted web checks:

```bash
pnpm --filter @apps/web typecheck
pnpm --filter @apps/web exec vitest run --project server src/lib/features/ai-chat.spec.ts --maxWorkers=1
pnpm --filter @apps/web exec vitest run --project client src/lib/components/ai/AiChatWidget.svelte.spec.ts src/lib/components/ai/AiSourceList.svelte.spec.ts --maxWorkers=1
pnpm --filter @apps/web test
```

Expected output for the implemented web AI subset:

- `svelte-check found 0 errors and 0 warnings`.
- AI chat state: `1 passed (1)` test file and `3 passed (3)` tests.
- AI components: `2 passed (2)` test files and `4 passed (4)` tests.

Broader checks before completion:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

Manual Cloudflare smoke when credentials are available:

```bash
pnpm --filter @apps/backend run d1:migrate:local
pnpm --filter @apps/backend dev
```

Then verify:

- `env.AI.run()` returns embedding shape for the adopted embedding model.
- Vectorize query returns expected chunk ids with metadata filters.
- AI Gateway records model calls and respects docs-only cache / sensitive-question skip-cache behavior.
- Billing or personal-data questions are not cached.

## Required Backend Test Coverage

- Unauthenticated chat request returns 401.
- Empty and >4,000 character messages are rejected.
- User hourly limit blocks after 20 accepted messages and does not increment blocked attempts.
- Organization daily limit blocks after 200 accepted messages and shows retry guidance.
- Conversation continuation is rejected across organization/classroom scope.
- currentPage improves relevance but is not accepted as authorization proof.
- Participant asking for invoices/receipts/payment method details receives owner-contact guidance without details.
- Owner billing question can use owner-safe `OrganizationBillingPayload` summary fields.
- Internal specs are excluded for organization users.
- Internal specs can inform internal/operator review answers when allowed.
- Vectorize metadata filter and D1 post-filter both enforce visibility and scope.
- No reliable source or business fact produces non-assertive fallback and human-support guidance.
- Prompt injection requesting secrets, authority bypass, or direct operations is refused or safely redirected.
- Feedback can be submitted only for accessible assistant messages.
- Retention cleanup deletes or anonymizes message content older than 180 days.

## Required Web Test Coverage

- Authenticated user can open widget, send a question, see answer/source/action, and submit feedback.
- Unauthenticated user does not see an active chat widget.
- Empty and too-long message validation is visible and accessible.
- Sending state prevents duplicate send.
- Rate limit response keeps typed message and shows retry guidance.
- Low-confidence answer shows support or owner-contact path.
- Source list hides internal spec paths from organization users.
- Suggested actions navigate only to permitted pages and never execute business operations.
- Feedback success/failure is visible and controls are disabled after success.
- Layout remains usable at mobile and desktop widths without text overlap.

## Release Evidence

Record in implementation notes or PR:

- Verified embedding model output shape and resulting Vectorize index dimensions.
- Vectorize metadata indexes created for filtering keys used in production.
- AI Gateway id configured and model calls visible in Gateway logs.
- Cache disabled for billing/personal-data questions.
- D1 migration applied before backend deployment.
- Knowledge indexing run succeeded or failed sources are visible to internal operators.
- Retention cleanup was executed or tested against expired records.

## Rollback Notes

- If web UI fails, hide the widget while backend tables remain additive.
- If AI provider calls fail, keep `/api/v1/ai/chat` returning safe fallback without deleting conversation history.
- If Vectorize index is incorrect, create a new correctly dimensioned index and re-run indexing; do not treat Vectorize as source of truth.
- Do not delete `ai_*` D1 rows during rollback unless a dedicated retention or cleanup task is reviewed.
