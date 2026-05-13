# Implementation Plan: AI Chatbot

**Branch**: `004-ai-chatbot` | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-ai-chatbot/spec.md`

## Summary

reserve-app の authenticated web users 向けに、根拠付き・権限安全な AI チャット V1 を追加する。
技術方針は `docs/ai-chat-proposal.md` を正として、Cloudflare Workers backend 上に RAG 構成を置く。
Workers AI は embedding と回答生成、Cloudflare Vectorize は embedding 検索、Cloudflare D1 は
knowledge 本文・metadata・会話・feedback・usage counter の正本、AI Gateway は model call の
observability、cache、rate-limit 補助、fallback の入口として扱う。

V1 は案内専用で、予約、課金、参加者、チケット、招待などの業務操作を実行しない。backend は
Better Auth session、organization/classroom scope、effective capability、owner-only billing rule を
解決してから、許可された knowledge と answer-time business facts だけを LLM に渡す。Web は
DESIGN.md に沿った chat widget と source/feedback UI を追加する。Mobile chat entry point は対象外。

## Technical Context

**Language/Version**: TypeScript strict。backend は Cloudflare Workers + Hono + `.js` ESM import、
web は SvelteKit + Svelte 5、monorepo は pnpm/Turborepo の既存構成を維持。  
**Primary Dependencies**: Better Auth、Drizzle ORM、Cloudflare D1、Cloudflare Workers AI、
Cloudflare Vectorize V2 index、Cloudflare AI Gateway、Hono、`@hono/zod-openapi`、Zod、
Sentry、Hono client、Vitest、Vitest browser/Playwright。新規 top-level runtime package は原則不要。  
**Storage**: Cloudflare D1 を正本にする。新規 D1 tables は `ai_knowledge_document`、
`ai_knowledge_chunk`、`ai_knowledge_index_run`、`ai_conversation`、`ai_message`、
`ai_feedback`、`ai_usage_counter`。Vectorize には chunk id、embedding、検索 metadata のみを保存する。  
**Testing**: backend integration/unit tests、AI domain pure-function tests、web server tests、
web browser/component tests、manual Cloudflare AI/Vectorize smoke。通常完了前に `pnpm test`、
`pnpm typecheck`、`pnpm lint`、`pnpm format:check` を対象にする。  
**Target Platform**: Cloudflare Workers backend、Cloudflare Workers web、browser web UI。Expo mobile は
V1 chat entry point なし。  
**Project Type**: Brownfield full-stack SaaS monorepo feature.  
**Performance Goals**: 95% の standard support questions で 10 秒以内に回答または fallback を表示する。
retrieval は topK 8-12 から最終 4-6 chunks に絞り、knowledge update は 1 business day 以内に反映または
failed として検知できる。  
**Constraints**: AI は操作を実行せず案内のみ。currentPage は relevancy hint であり認可根拠にしない。
internal specs は internal/operator role のみ。billing documents/payment details/raw external payloads/secrets は
回答・source snippet・logs に出さない。会話本文は 180 日後に削除または匿名化し、aggregate feedback は 1 年保持。
usage limit は user 20 messages/hour、organization 200 messages/day。Vectorize index dimensions は採用 embedding
model の shape を dev で確認してから固定する。  
**Scale/Scope**: V1 は web authenticated support assistant。対象 knowledge は apps/docs、role-permitted specs、
固定 FAQ、安全な DB summary。対象 domain facts は booking/service/invitation/participant/ticket/billing summary。
MVP は chat answer + source + suggested actions + safe fallback + logging/feedback の web path。

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Existing Architecture**: PASS。既存 pnpm/Turborepo、Cloudflare Workers/Hono backend、SvelteKit web、
  Better Auth、Drizzle/D1、Sentry を拡張する。新 app、別 backend、別 auth、外部 vector DB、全面 rewrite は導入しない。
- **II. Type Safety と API Boundary**: PASS。chat request、AI response、embedding result、Vectorize metadata、
  source references、feedback、business facts は Zod/domain union/type guard で正規化する。AI/Vectorize provider response は
  `unknown` から parse し、`any` で隠さない。
- **III. Authorization と Scope**: PASS。organization/classroom scope と effective capability を正本にし、
  display role や currentPage を判定に使わない。owner-only billing rule と internal-operator-only review を維持する。
- **IV. Risk-Based Verification**: PASS。backend route/integration、source visibility、prompt-injection guard、
  cross-scope conversation、usage limit、retention、web widget state は regression coverage の対象にする。
- **V. Data, Billing, Deployment Safety**: PASS。D1 migration は additive。Vectorize は検索 index のみで本文正本を持たない。
  billing facts は `organization_billing` 由来 summary に限定し、payment details/raw payloads は保存・表示しない。
- **VI. UI と Design System**: PASS。chat UI は DESIGN.md を正本にし、loading、fallback、low confidence、rate limit、
  source visibility、feedback、disabled reasons を色だけに依存せず表示する。

## Project Structure

### Documentation (this feature)

```text
specs/004-ai-chatbot/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ai-api.openapi.yaml
│   └── ai-ui-contract.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
apps/backend/
├── drizzle/
│   └── 0018_ai_chatbot.sql
├── scripts/
│   └── index-ai-knowledge.mjs
└── src/
    ├── ai/
    │   ├── answer-generator.ts
    │   ├── business-facts.ts
    │   ├── context-resolver.ts
    │   ├── conversation-store.ts
    │   ├── embedding.ts
    │   ├── indexer.ts
    │   ├── prompt.ts
    │   ├── rate-limit.ts
    │   ├── retriever.ts
    │   ├── source-visibility.ts
    │   └── *.test.ts
    ├── db/
    │   └── schema.ts
    ├── routes/
    │   └── ai-routes.ts
    ├── app.ts
    ├── app.test.ts
    └── auth-worker.ts

apps/web/
└── src/
    ├── lib/
    │   ├── ai-client.ts
    │   ├── components/
    │   │   └── ai/
    │   │       ├── AiChatWidget.svelte
    │   │       ├── AiMessageList.svelte
    │   │       ├── AiSourceList.svelte
    │   │       ├── AiSuggestedActions.svelte
    │   │       └── *.svelte.spec.ts
    │   └── features/
    │       └── ai-chat.svelte.ts
    └── routes/
        ├── +layout.svelte
        └── layout.svelte.spec.ts

docs/
└── ai-chat-proposal.md
```

**Structure Decision**: backend に `/api/v1/ai` route と `src/ai/*` domain slice を追加し、
existing `createApp` route registration、`auth-worker` env typing、Drizzle schema/migration に接続する。
knowledge indexer は既存 `apps/backend/scripts` 配下に置く。web は既存 Hono client/RPC style に合わせて
`ai-client.ts` と Svelte 5 component/state slice を追加し、global layout から web-only widget を提供する。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Phase 0 Research Output

See [research.md](./research.md). All planning decisions are resolved.

## Phase 1 Design Output

- [data-model.md](./data-model.md)
- [contracts/ai-api.openapi.yaml](./contracts/ai-api.openapi.yaml)
- [contracts/ai-ui-contract.md](./contracts/ai-ui-contract.md)
- [quickstart.md](./quickstart.md)

## Post-Design Constitution Check

- **I. Existing Architecture**: PASS。design artifacts reference existing backend/web paths, add only feature-scoped AI modules,
  and keep Cloudflare Workers/Hono/SvelteKit/D1 boundaries.
- **II. Type Safety と API Boundary**: PASS。contracts and data model define explicit request/response unions, visibility values,
  AI output parsing, and provider response normalization points.
- **III. Authorization と Scope**: PASS。contracts require organization/classroom context resolution, role-safe source filtering,
  owner-only billing details, internal-operator-only review, and cross-scope conversation rejection.
- **IV. Risk-Based Verification**: PASS。quickstart defines backend integration, pure AI guard tests, web component/server tests,
  retention/rate-limit checks, and Cloudflare AI/Vectorize smoke evidence.
- **V. Data, Billing, Deployment Safety**: PASS。data model is additive, keeps D1 as source of truth, uses Vectorize as search index,
  and documents retention/anonymization plus deployment order for migration, backend, index, web.
- **VI. UI と Design System**: PASS。UI contract requires DESIGN.md, accessible state labels, no color-only status, feedback controls,
  source list behavior, low-confidence fallback, and mobile-width non-overlap.
