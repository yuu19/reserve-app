# Implementation Plan: Billing Production Hardening

**Branch**: `002-billing-hardening` | **Date**: 2026-04-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-billing-hardening/spec.md`

## Summary

既存の organization-scoped billing 実装を本番運用向けに強化する。主な対象は、
支払い状態ごとの Premium eligibility、Stripe handoff の冪等性、webhook の永続重複排除と
署名拒否、provider-linked subscription の定期 reconciliation、trial-used/free からの有料導線、
Customer Portal 条件、invoice/payment event 履歴、owner 通知、billing profile readiness、
unknown price の停止方針である。

技術方針は brownfield 拡張とする。既存 `organization_billing` を主 aggregate とし、
`stripe_webhook_event`、notification、audit/signal 系 append-only tables を拡張し、必要な
operation attempt、invoice event、document reference、billing readiness fields を D1 migration で追加する。
Stripe は Billing APIs + Checkout Sessions + Customer Portal の provider-hosted flow を継続し、
raw payment details や raw tax details はアプリに保存しない。

## Technical Context

**Language/Version**: TypeScript strict。backend は Cloudflare Workers + Hono、web は
SvelteKit/Svelte 5、mobile は Expo/React Native の既存構成を維持。  
**Primary Dependencies**: Better Auth、Drizzle ORM、Cloudflare D1、Stripe Billing/Checkout/Customer Portal、
Resend、Sentry、Zod、`@hono/zod-openapi`、Vitest、SvelteKit server tests、Playwright where needed。  
**Storage**: Cloudflare D1。既存 `organization_billing` を主 aggregate とし、webhook event、
operation attempt、invoice event、document reference、notification、audit/signal 系の append-only
tables を併用する。  
**Testing**: backend integration tests と billing policy unit tests を主安全網にし、web contracts page
tests と API contract validation を追加する。mobile は billing controls または document access が露出する
場合のみ manual smoke を記録する。  
**Target Platform**: Cloudflare Workers backend/web、browser web UI、Expo mobile client。  
**Project Type**: Brownfield full-stack SaaS monorepo.  
**Performance Goals**: owner billing summary は通常テスト条件で 3 秒以内。provider webhook は同一処理 flow 内で
invoice/payment history と notification/signal を反映。targeted reconciliation は risky state を 1 時間以内に
解決または signal 化し、full reconciliation は 1 日 1 回全 provider-linked subscription を確認する。  
**Constraints**: 1 organization = 1 subscription。billing actions と payment documents は owner-only。
Premium entitlement は organization-scoped。payment/tax details は provider-hosted flow に閉じる。
refund/credit note lifecycle は v1 out of scope。新 runtime service と新 top-level package は導入しない。  
**Scale/Scope**: 既存 001 organization billing を本番向けに harden する差分。monthly/yearly paid entry、
trial-to-paid/free recovery、internal inspection、payment issue notification、invoice/payment events を対象にする。
multi-provider、multi-subscription per organization、classroom-scoped billing は対象外。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Existing Architecture**: PASS。既存 pnpm/Turborepo、Cloudflare Workers/Hono、SvelteKit、
  Expo、D1、Better Auth、Stripe/Resend/Sentry baseline を拡張する。新 app、新 billing subsystem、
  別 database、全面 rewrite は導入しない。
- **II. Type Safety と API Boundary**: PASS。Stripe webhook payload、provider status、price id、
  invoice/payment event、billing action response、D1 rows は Zod/schema/domain union で正規化する。
  unknown provider values は explicit diagnostic state に落とす。
- **III. Authorization と Scope**: PASS。billing authority、payment document access、billing profile editing、
  checkout/setup/portal は owner-only。non-owner は role-safe status visibility のみ。subscription ownership は
  organization-scoped のまま維持する。
- **IV. Risk-Based Verification**: PASS。payment eligibility、idempotent handoff、webhook duplicate/signature、
  reconciliation、invoice/payment events、unknown price、owner notifications、role boundary は backend tests。
  contracts page と premium restriction messaging は web tests。mobile は影響時のみ smoke。
- **V. Data, Billing, Deployment Safety**: PASS。D1 migration、既存 rows/trial usage/provider identifiers の互換、
  append-only auditability、replay/no-op、reconciliation recovery、docs deployment notes を計画対象に含める。
- **VI. UI と Design System**: PASS。billing UI は DESIGN.md を正本にし、状態、不可理由、checking/missing/failed、
  read-only、action-required を色だけに依存せず表示する。

## Project Structure

### Documentation (this feature)

```text
specs/002-billing-hardening/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── billing-api.openapi.yaml
│   └── billing-ui-contract.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
apps/backend/
├── drizzle/
│   └── 0017_billing_production_hardening.sql
└── src/
    ├── billing/
    │   ├── organization-billing.ts
    │   ├── organization-billing-operations.ts
    │   ├── organization-billing-invoice-events.ts
    │   ├── organization-billing-profile.ts
    │   ├── organization-billing-policy.ts
    │   ├── organization-billing-maintenance.ts
    │   ├── organization-billing-notifications.ts
    │   ├── organization-billing-observability.ts
    │   ├── organization-billing-documents.ts
    │   ├── organization-billing-history.ts
    │   ├── internal-billing-inspection.ts
    │   └── stripe-webhook-sync.ts
    ├── db/
    │   └── schema.ts
    ├── payment/
    │   └── stripe.ts
    ├── routes/
    │   └── auth-routes.ts
    ├── app.ts
    ├── app.test.ts
    └── worker.ts

apps/web/
└── src/
    ├── lib/
    │   ├── rpc-client.ts
    │   └── features/
    │       ├── organization-context.svelte.ts
    │       └── premium-restrictions.ts
    └── routes/
        └── contracts/
            ├── +page.svelte
            └── page.svelte.spec.ts

docs/
├── README.md
└── billing.md
```

**Structure Decision**: 既存 backend billing slice、auth routes、Stripe adapter、web contracts route、
organization context を拡張する。既存 001 artifacts と実装済み migration を前提に、002 は hardening 用の
追加 migration と contract update に限定する。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Phase 0 Research Output

See [research.md](./research.md). All planning decisions are resolved.

## Phase 1 Design Output

- [data-model.md](./data-model.md)
- [contracts/billing-api.openapi.yaml](./contracts/billing-api.openapi.yaml)
- [contracts/billing-ui-contract.md](./contracts/billing-ui-contract.md)
- [quickstart.md](./quickstart.md)

## Post-Design Constitution Check

- **I. Existing Architecture**: PASS。design artifacts reference existing backend/web files and one additive
  D1 migration only.
- **II. Type Safety と API Boundary**: PASS。contracts and data model define explicit unions for provider
  statuses, response envelope, invoice events, readiness, and webhook receipt outcomes.
- **III. Authorization と Scope**: PASS。contracts keep billing actions and documents owner-only, while
  preserving non-owner read-only visibility.
- **IV. Risk-Based Verification**: PASS。quickstart defines backend policy/integration, web route, API contract,
  webhook, reconciliation, and notification verification targets.
- **V. Data, Billing, Deployment Safety**: PASS。data model preserves existing billing rows, trial usage,
  provider identifiers, append-only history, idempotency, and recovery paths.
- **VI. UI と Design System**: PASS。UI contract requires DESIGN.md, text labels, role-safe controls,
  document states, payment issue states, and checking/missing/error handling.
