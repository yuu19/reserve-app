# Implementation Plan: Stripe Payment Failure Handling

**Branch**: `003-stripe-payment-failure` | **Date**: 2026-05-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-stripe-payment-failure/spec.md`

## Summary

既存の organization-scoped Premium billing に対して、Stripe 支払い失敗時の残課題を安全に補強する。
主な対象は、`past_due` 猶予開始時刻の確定、verified owner ごとの通知再試行、復旧済み後に遅延到着した
支払い失敗通知の扱い、owner/non-owner 表示、履歴・内部調査の一貫性である。

技術方針は brownfield patch とする。既存 `organization_billing`、Stripe webhook receipt、
invoice/payment event、notification、audit/signal tables を使い、新しい provider、top-level package、
payment detail storage、classroom-scoped billing は導入しない。Stripe Billing と provider-hosted payment
management を継続し、raw payload やカード詳細は保存しない。

## Technical Context

**Language/Version**: TypeScript strict。backend は Cloudflare Workers + Hono、web は SvelteKit/Svelte 5、
mobile は Expo/React Native の既存構成を維持。  
**Primary Dependencies**: Better Auth、Drizzle ORM、Cloudflare D1、Stripe Billing/Checkout/Customer Portal、
Resend、Sentry、Zod、`@hono/zod-openapi`、Vitest、SvelteKit browser/server tests、Playwright billing E2E。  
**Storage**: Cloudflare D1。既存 `organization_billing` を主 aggregate とし、`stripe_webhook_event`、
`stripe_webhook_failure`、`organization_billing_invoice_event`、`organization_billing_notification`、
`organization_billing_audit_event`、`organization_billing_signal` を併用する。新規 migration は原則不要。  
**Testing**: backend integration tests と billing policy tests を主安全網にし、web contracts page tests、
Stripe Test Clock E2E、changed-file type/lint/format checks を追加する。  
**Target Platform**: Cloudflare Workers backend/web、browser web UI、Expo mobile client。  
**Project Type**: Brownfield full-stack SaaS monorepo.  
**Performance Goals**: owner billing summary は通常テスト条件で 3 秒以内。支払い失敗 webhook は同一処理 flow
内で safe history と notification/signal を反映する。risky payment states は 60 分以内に再確認対象になる。  
**Constraints**: Premium entitlement は organization-scoped。billing controls、payment update、document/history
details は owner-only。non-owner は role-safe status visibility のみ。payment/tax details と raw Stripe payload は
保存・表示しない。refund、credit note、複数 provider、複数 paid plan は対象外。  
**Scale/Scope**: 002 billing hardening の上に乗る支払い失敗 focused patch。対象は `past_due` grace、
`payment_failed`、`payment_action_required`、`payment_succeeded` recovery、recipient-level notification retry、
stale failure handling、owner/internal read models。

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Existing Architecture**: PASS。既存 pnpm/Turborepo、Cloudflare Workers/Hono、SvelteKit、D1、
  Better Auth、Stripe/Resend/Sentry baseline を拡張する。新 app、新 billing provider、全面 rewrite は導入しない。
- **II. Type Safety と API Boundary**: PASS。Stripe event、subscription/invoice fields、notification outcome、
  billing summary DTO は既存 parser、domain union、Zod schema で正規化する。未知値は diagnostic state に落とす。
- **III. Authorization と Scope**: PASS。支払い更新、契約管理、履歴詳細、document access は owner-only。
  non-owner は課金操作や payment details に到達できない。billing lifecycle は organization-scoped のまま維持する。
- **IV. Risk-Based Verification**: PASS。payment eligibility、grace start、notification retry、stale event、
  duplicate/out-of-order webhook、owner/non-owner UI は regression coverage の対象にする。
- **V. Data, Billing, Deployment Safety**: PASS。既存 append-only tables を維持し、冪等性、順不同耐性、
  notification retry、audit/signal、reconciliation recovery を計画対象に含める。原則 migration 不要。
- **VI. UI と Design System**: PASS。契約画面は DESIGN.md を正本にし、状態、不可理由、確認中、失敗、
  action-required、read-only を色だけに依存せず表示する。

## Project Structure

### Documentation (this feature)

```text
specs/003-stripe-payment-failure/
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
└── src/
    ├── billing/
    │   ├── organization-billing.ts
    │   ├── organization-billing-policy.ts
    │   ├── organization-billing-notifications.ts
    │   ├── organization-billing-invoice-events.ts
    │   ├── organization-billing-history.ts
    │   ├── organization-billing-observability.ts
    │   ├── organization-billing-maintenance.ts
    │   ├── internal-billing-inspection.ts
    │   └── stripe-webhook-sync.ts
    ├── payment/
    │   └── stripe.ts
    ├── routes/
    │   └── auth-routes.ts
    ├── app.test.ts
    └── billing/
        └── organization-billing-policy.test.ts

apps/web/
└── src/
    ├── lib/
    │   ├── rpc-client.ts
    │   └── features/
    │       └── premium-restrictions.ts
    └── routes/
        └── contracts/
            ├── +page.svelte
            └── page.svelte.spec.ts

apps/web/tests/e2e/billing/
├── stripe-test-clock.spec.ts
└── stripe-test-clock-helpers.ts
```

**Structure Decision**: 既存 backend billing slice、Stripe adapter、auth routes、web contracts route、
Stripe billing E2E を拡張する。003 は既存 002 実装の focused follow-up であり、新規 D1 table や
新 package は追加しない方針にする。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| None      | N/A        | N/A                                  |

## Phase 0 Research Output

See [research.md](./research.md). All planning decisions are resolved.

## Phase 1 Design Output

- [data-model.md](./data-model.md)
- [contracts/billing-api.openapi.yaml](./contracts/billing-api.openapi.yaml)
- [contracts/billing-ui-contract.md](./contracts/billing-ui-contract.md)
- [quickstart.md](./quickstart.md)

## Post-Design Constitution Check

- **I. Existing Architecture**: PASS。design artifacts reference existing backend/web files and reuse existing D1
  billing tables.
- **II. Type Safety と API Boundary**: PASS。contracts and data model define explicit unions and timestamp rules for
  payment issue state, notification recipient outcomes, and stale provider events.
- **III. Authorization と Scope**: PASS。contracts keep billing actions and detailed history owner-only while
  preserving role-safe read-only status for permitted non-owner users.
- **IV. Risk-Based Verification**: PASS。quickstart defines backend policy/integration, web route, duplicate/stale
  webhook, notification retry, and Stripe Test Clock verification targets.
- **V. Data, Billing, Deployment Safety**: PASS。data model preserves append-only receipt/history and documents no
  required migration unless implementation discovers a missing index or field.
- **VI. UI と Design System**: PASS。UI contract requires DESIGN.md, accessible state labels, owner-only controls,
  and separate checking/failed/action-required/recovered/read-only states.
