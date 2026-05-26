# Quickstart: AI Chatbot

## Scope

AI Chatbot V1 adds a web-only, authenticated, guidance-only assistant. It uses approved knowledge and current permitted
business facts to answer support questions. It does not create bookings, change billing, manage participants, grant
tickets, send invitations, or create support tickets.

## Prerequisites

- `docs/ai-chat-proposal.md` remains the technical source for the V1 stack.
- `docs/ai-chat-reusable-architecture.md` records the Phase 7 reusable core / backend / infra / web boundary.
- Existing backend, web, and D1 setup is working locally.
- Cloudflare account has Workers AI, AI Gateway, and Vectorize available for the target environment.
- The embedding model shape has been verified in a dev Worker before creating the Vectorize index.
- `reserve-app-knowledge` Vectorize index exists with dimensions matching the adopted embedding model and metric `cosine`.
- Vectorize metadata indexes required for filtering are created before production indexing.

## Current Implementation Structure

- Shared AI contracts and ports: `packages/saas-chatbot-core`.
- Backend feature and usecases: `apps/backend/src/features/ai`.
- Workers AI / AI Gateway providers: `apps/backend/src/infra/ai`.
- D1 knowledge, conversation, and observability adapters: `apps/backend/src/infra/ai-knowledge`.
- Drizzle schema: `apps/backend/src/infra/db/schema.ts`.
- Web API client: `apps/web/src/lib/ai-client.ts`.
- Web widget state: `apps/web/src/lib/features/ai-chat.svelte.ts`.

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
     `ai_usage_event`, `ai_feedback`, and `ai_usage_counter`.
   - Store chat threads with reusable `subject_type = organization` / `subject_id = organizationId` scope plus the
     ReserveApp-specific `classroom_id`.
   - Store provider/model/token/latency/status/error metadata on assistant messages and append one `ai_usage_event` per
     assistant answer. Token usage remains nullable when Workers AI omits it.
   - Keep existing auth, organization, classroom, booking, ticket, invitation, and billing rows untouched.

2. Add Cloudflare AI/Vectorize bindings and env types.
   - Update `apps/backend/wrangler.jsonc`.
   - Update `apps/backend/src/auth-worker.ts` env typing.
   - Run Wrangler type generation if implementation requires generated Worker env types.

3. Build backend AI domain modules.
   - `packages/saas-chatbot-core`: shared UI, conversation, provider, prompt, knowledge, and rate-limit contracts.
   - `apps/backend/src/features/ai/source-visibility.ts`: role/scope visibility decisions, internal specs rule, owner-only billing guard.
   - `apps/backend/src/features/ai/context-resolver.ts`: session, active organization, classroom, role, and effective capability resolution.
   - `apps/backend/src/features/ai/rate-limit.ts`: 20 user messages/hour and 200 organization messages/day counters.
   - `apps/backend/src/infra/ai/cloudflare-ai-embedding-provider.ts`: Workers AI embedding call through Gateway options and provider shape parser.
   - `apps/backend/src/features/ai/retriever.ts`: Vectorize query with metadata filter, D1 chunk fetch, D1 post-filter, rerank/trim.
   - `apps/backend/src/features/ai/business-facts.ts`: answer-time booking, invitation, ticket, participant, and billing summaries.
   - `apps/backend/src/features/ai/prompt.ts`: structured system/user context, no-action instruction, no unsupported assertion instruction.
   - `apps/backend/src/infra/ai/cloudflare-ai-answer-provider.ts`: Workers AI answer call through AI Gateway.
   - `apps/backend/src/features/ai/answer-generator.ts`: confidence/fallback parsing and suggested action normalization.
   - `apps/backend/src/infra/ai-knowledge/drizzle-ai-conversation-store.ts`: scoped conversation/message storage, feedback storage, retention metadata.
   - `apps/backend/src/features/ai/indexer.ts`: docs/specs/FAQ/db-summary chunking and D1 + Vectorize upsert orchestration.

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
   - Keep `AiChatUiStatus = closed | ready | sending | error`.
   - Convert backend errors into `AiChatClientErrorPayload.kind = api | network | parse`.
   - Reset conversation-scoped state when organization/classroom scope changes and ignore stale in-flight responses.

7. Add scheduled retention cleanup.
   - Extend `apps/backend/src/worker.ts` scheduled maintenance to delete or anonymize message content after 180 days.
   - Keep aggregate feedback for 1 year.

8. Update documentation if release steps or environment variables change.
   - Update `docs/README.md` or app README only after implementation confirms exact Cloudflare settings.

## Verification Commands

Current AI route integration checks:

```bash
pnpm --filter @apps/backend exec vitest run src/app.test.ts --maxWorkers=1 -t "AI route integration"
pnpm --filter @apps/backend exec vitest run src/app.test.ts --maxWorkers=1
pnpm --filter @apps/backend exec vitest run src/features/ai/ai-contract.test.ts src/features/ai/ai-chat.usecase.test.ts src/features/ai/ai-feedback.usecase.test.ts src/features/ai/ai-route-context.test.ts --maxWorkers=1
```

Expected output: the focused `AI route integration` subset and the full backend app integration file exit with code 0.
The usecase and contract sanity command exits with code 0 and confirms the route-facing contracts still match the current usecase behavior.

Targeted backend checks:

```bash
pnpm --filter @apps/backend typecheck
pnpm --filter @repo/saas-chatbot-core typecheck
pnpm --filter @repo/saas-chatbot-core test
pnpm --filter @apps/backend exec vitest run src/features/ai/ai-contract.test.ts --maxWorkers=1
pnpm --filter @apps/backend exec vitest run src/features/ai src/infra/ai src/infra/ai-knowledge src/routes/ai-routes.ts --maxWorkers=1
pnpm --filter @apps/backend test
```

Expected output for the implemented AI unit subset:

- `tsc --noEmit` exits with code 0.
- `@repo/saas-chatbot-core` typecheck exits with code 0.
- AI feature, provider, and knowledge infra test files exit with code 0.
- `ai-contract.test.ts` confirms the backend contract includes `rateLimit` and the current error payload shapes.

Note: the full backend suite includes existing Miniflare app tests and may take substantially longer than the AI-only subset.

Knowledge indexing script checks:

```bash
pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs
pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --dry-run
pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --dry-run --source-root app-docs
pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --dry-run --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --dry-run --source-root app-docs --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
```

Expected output:

- All discovery commands run discovery only. They do not call Workers AI, D1, or Vectorize.
- The default mode is dry-run when neither `--dry-run` nor `--apply` is provided.
- `--source-root` limits discovery to one stable root id: `app-docs`, `internal-docs`, or `specs`.
- `--source-path` must match a repository-relative Markdown source. A non-matching path exits with a usage failure.
- Combining `--source-root` and `--source-path` indexes only a matching source under the selected root.

Remote indexing when credentials and production rollout approval are available:

```bash
CF_AI_GATEWAY_TOKEN=... WRANGLER_CLOUDFLARE_API_TOKEN=... pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --apply
CF_AI_GATEWAY_TOKEN=... WRANGLER_CLOUDFLARE_API_TOKEN=... pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --apply --source-root app-docs
CF_AI_GATEWAY_TOKEN=... WRANGLER_CLOUDFLARE_API_TOKEN=... pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --apply --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
CF_AI_GATEWAY_TOKEN=... WRANGLER_CLOUDFLARE_API_TOKEN=... pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --apply --source-root app-docs --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
```

Expected behavior:

- `--apply` writes remote D1 rows and upserts Vectorize records.
- Full apply marks global documents and chunks that disappeared from the current discovery as stale.
- Source-root apply marks only disappeared documents and chunks under the selected root prefix as stale.
- Source-path apply only refreshes the selected document and marks old chunks for that document as stale.

Targeted web checks:

```bash
pnpm --filter @apps/web typecheck
pnpm --filter @apps/web exec vitest run --project server src/lib/ai-client.spec.ts src/lib/features/ai-chat.spec.ts --maxWorkers=1
pnpm --filter @apps/web exec vitest run --project client src/lib/components/ai/AiChatWidget.svelte.spec.ts src/lib/components/ai/AiSourceList.svelte.spec.ts --maxWorkers=1
pnpm --filter @apps/web test
```

Expected output for the implemented web AI subset:

- `svelte-check found 0 errors and 0 warnings`.
- AI client/state tests confirm typed API, network, parse errors, scope reset, stale response ignore, input restoration, and feedback state transitions.
- AI component tests exit with code 0.

Docs and contract sync checks:

```bash
pnpm --filter @apps/backend run typecheck
pnpm --filter @apps/docs build
pnpm exec prettier --check docs/README.md docs/ai-chat-reusable-architecture.md specs/004-ai-chatbot/quickstart.md apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
pnpm exec prettier --check docs/ai-chat-proposal.md docs/ai-chat-reusable-architecture.md specs/004-ai-chatbot apps/docs/src/routes/manuals/common/ai-chatbot
git diff --check
```

For AI-chatbot-only documentation releases, stage only AI chatbot files. Leave unrelated billing, CI, `apps/backend/tmp/`, and `docs/reserve-app-ai-chatbot-reusable-plan.md` changes out of the PR unless the release scope explicitly includes them.

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
- Conversation rows store `actor_user_id`, `subject_type`, `subject_id`, `channel`, `status`, and `last_message_at`.
- Assistant messages store provider/model/token/latency/status/error observability metadata.
- Assistant answer generation inserts an append-only `ai_usage_event`, including retrieval-failure fallbacks.
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
- `open_page` suggested actions with `href: null` render as text instead of links.
- Feedback success/failure is visible and controls are disabled after success.
- Layout remains usable at mobile and desktop widths without text overlap.

## Production Promotion for AI Chatbot Docs/Test Updates

Use the PR and CI path for production promotion. Do not deploy this release directly with local `wrangler deploy` commands.

1. Push the AI chatbot branch and open a pull request.
2. Confirm PR checks pass.
3. Squash merge into `main`.
4. Confirm `.github/workflows/deploy-workers.yml` completes backend, web, and docs deployment from the `main` push.
5. Run the production smoke checks:

```bash
curl -sS https://api.wakureserve.com/api/health
curl -I -s https://docs.wakureserve.com/manuals/common/ai-chatbot
curl -I -s https://web.wakureserve.com
```

Expected output:

- Backend health returns `{ "ok": true }`.
- Docs manual returns HTTP 200.
- Web app returns HTTP 200.

After the Worker deployment is complete, refresh only the public AI chatbot manual in the production knowledge index:

```bash
pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --dry-run --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
CF_AI_GATEWAY_TOKEN=... WRANGLER_CLOUDFLARE_API_TOKEN=... pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --apply --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
```

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
