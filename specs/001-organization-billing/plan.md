# Implementation Plan: Organization Billing

**Branch**: `001-organization-billing` | **Date**: 2026-04-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-organization-billing/spec.md`

## Summary

organization 単位の subscription state を既存 billing baseline 上で拡張し、owner-only
billing workspace、7 日間 premium trial、payment method 登録、trial-to-paid/free
lifecycle、Stripe webhook 同期、premium entitlement gating、trial reminder email、
internal billing support inspection を一貫した業務フローとして成立させる。

技術方針は、既存の monorepo、backend/web/mobile 境界、D1 migration、contracts page、
billing route、Stripe webhook、email/observability 基盤を維持する brownfield 拡張とする。
MVP は spec の User Story 1-4 を対象にし、User Story 5 は将来拡張を阻害しない data と
contract の余地として扱う。

## Technical Context

**Language/Version**: TypeScript strict。backend は Cloudflare Workers/Hono、web は
SvelteKit/Svelte 5、mobile は Expo/React Native の既存構成を維持。  
**Primary Dependencies**: Better Auth、Drizzle ORM、Cloudflare D1、Stripe、Resend、
Sentry、Tailwind CSS、bits-ui、Vitest、Playwright。  
**Storage**: Cloudflare D1。既存 `organization_billing` を主 aggregate とし、
webhook event、notification、audit/signal 系の append-only tables を併用。  
**Testing**: backend integration tests を主安全網にし、web server tests と必要な browser
tests を追加。mobile は entitlement 影響がある場合に manual smoke を記録。  
**Target Platform**: Cloudflare Workers backend/web、browser web UI、Expo mobile client。  
**Project Type**: Brownfield full-stack SaaS monorepo.  
**Performance Goals**: billing status page は通常利用で 3 秒以内、trial/payment handoff は
owner が曖昧な待機状態と感じないこと、Stripe event 起因の entitlement 反映は通常数分以内、
目標 1 分以内。  
**Constraints**: 1 organization = 1 subscription。billing action は owner-only。payment
details は provider-hosted flow に閉じる。MVP の billing provider は Stripe、reminder
channel は email のみ。D1 schema 変更は migration と既存データ互換性を必須とする。  
**Scale/Scope**: MVP は通常の organization 増加に耐える設計とし、enterprise-scale 専用機能、
複数 paid tier、独自 invoice/receipt、email 以外の billing communication は post-MVP。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **既存 brownfield baseline**: PASS。既存 monorepo、backend/web/mobile 境界、billing
  aggregate、contracts page、webhook/email/observability の拡張で進め、新 starter や別
  app host は導入しない。
- **organization 単位の権限**: PASS。subscription と entitlement の正本は organization。
  owner-only billing authority を維持し、operational permission と billing responsibility
  を分離する。
- **billing lifecycle の信頼性**: PASS。product plan state と provider subscription status
  を分離し、webhook は署名検証、normalization、event id 冪等性、順不同耐性、audit と
  reconciliation signal を持つ。
- **リスクに応じた検証**: PASS。lifecycle、webhook、owner-only denial、premium gating、
  D1-backed state は backend integration tests。contracts page と role-based UI は web
  server/browser tests で検証する。
- **運用上の明確さとアクセシビリティ**: PASS。billing/status UI は DESIGN.md を優先し、
  状態、action、結果を色だけに依存せず表示する。
- **data と deployment の安全性**: PASS。D1 migration、既存データ互換性、backend -> web
  deployment order、docs/README.md の運用前提を計画に含める。

## Project Structure

### Documentation (this feature)

```text
specs/001-organization-billing/
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
│   ├── 0012_organization_billing.sql
│   ├── 0013_stripe_webhook_sync.sql
│   ├── 0014_organization_billing_notifications.sql
│   └── 0015_billing_audit_and_signals.sql
└── src/
    ├── billing/
    │   ├── organization-billing.ts
    │   ├── organization-billing-policy.ts
    │   ├── stripe-webhook-sync.ts
    │   ├── organization-billing-notifications.ts
    │   ├── organization-billing-observability.ts
    │   ├── organization-billing-history.ts
    │   ├── internal-billing-inspection.ts
    │   └── internal-operator-access.ts
    ├── payment/
    │   └── stripe.ts
    ├── routes/
    │   ├── auth-routes.ts
    │   └── booking-routes.ts
    ├── booking/
    │   └── authorization.ts
    └── app.test.ts

apps/web/
└── src/
    ├── lib/
    │   ├── rpc-client.ts
    │   └── features/
    │       ├── organization-context.svelte.ts
    │       └── premium-restrictions.ts
    └── routes/
        ├── +page.svelte
        ├── page.svelte.spec.ts
        ├── contracts/+page.svelte
        ├── contracts/page.svelte.spec.ts
        ├── admin/contracts/+page.svelte
        ├── admin/participants/+page.svelte
        ├── admin/schedules/recurring/+page.svelte
        ├── admin/schedules/slots/+page.svelte
        ├── admin/bookings/+page.svelte
        ├── participants/+page.svelte
        └── participant/bookings/+page.svelte

docs/
└── README.md
```

**Structure Decision**: 既存 backend billing slice、auth routes、payment adapter、web
contracts route、organization context feature を拡張する。新しい top-level package、
新しい frontend state library、新しい billing subsystem は作らない。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Phase 0 Research Output

See [research.md](./research.md). All planning decisions are resolved; no unresolved
`NEEDS CLARIFICATION` items remain.

## Phase 1 Design Output

- [data-model.md](./data-model.md)
- [contracts/billing-api.openapi.yaml](./contracts/billing-api.openapi.yaml)
- [contracts/billing-ui-contract.md](./contracts/billing-ui-contract.md)
- [quickstart.md](./quickstart.md)

## Post-Design Constitution Check

- **既存 brownfield baseline**: PASS。design artifacts reference existing backend/web slices
  and D1 migration flow only.
- **organization 単位の権限**: PASS。data model and contracts keep organization as the
  subscription/entitlement owner and owner-only as billing action authority.
- **billing lifecycle の信頼性**: PASS。contracts and data model include idempotency,
  audit, notification, and reconciliation surfaces.
- **リスクに応じた検証**: PASS。quickstart defines backend/web verification targets and
  mobile manual smoke expectation.
- **運用上の明確さとアクセシビリティ**: PASS。UI contract requires role-safe controls,
  non-color-only status, loading/error/read-only states, and DESIGN.md adherence.
- **data と deployment の安全性**: PASS。quickstart includes migration and deploy-order
  checks; data model preserves existing rows and provider-hosted payment details.
