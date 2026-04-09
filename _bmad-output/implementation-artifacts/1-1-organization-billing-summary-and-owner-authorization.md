# Story 1.1: Organization Billing Summary and Owner Authorization

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an organization owner,
I want the system to return my organization's billing summary and enforce billing permissions,
so that only the correct role can view or act on subscription billing.

## Acceptance Criteria

1. 認証済みメンバーが組織の契約情報を要求したとき、組織に所属している場合は、現在の契約サマリーを返し、閲覧権限と課金操作権限を区別できること。
2. organization owner が契約操作または契約サマリーを要求したとき、対象組織に対して課金操作が許可されること。
3. admin / manager / staff が課金操作を試みたとき、backend が owner-only として拒否し、billing state が変更されないこと。
4. 組織の契約状態が `free` / `premium_trial` / `premium_paid` のいずれでも、返却される契約サマリーに明示的な plan state が含まれ、必要に応じて trial timing を表現できること。

## Tasks / Subtasks

- [x] 既存の organization billing summary / authorization 実装を確認し、Story 1.1 の責務境界を確定する (AC: 1, 2, 3, 4)
  - [x] `apps/backend/src/routes/auth-routes.ts` の `getOrganizationBillingRoute`、`selectOrganizationBillingSummary`、checkout / portal ルートを確認する
  - [x] `apps/backend/src/booking/authorization.ts` の `canManageOrganizationByRole` を汎用権限として維持するか、billing 専用判定を追加するかを判断する
  - [x] `apps/web/src/routes/contracts/+page.svelte` と `apps/web/src/lib/features/auth-session.svelte.ts` の portal access 前提を壊さない方針を明確にする

- [x] backend の billing summary 契約を Story 1.1 の要件に合わせて実装する (AC: 1, 2, 4)
  - [x] `organization_billing` を正本として `ensureOrganizationBillingRow` により行が存在しない組織でも `free` を返せるよう維持する
  - [x] summary payload の `planCode` / `subscriptionStatus` / `currentPeriodEnd` / `canManageBilling` を現行契約または最小拡張で整理する
  - [x] 必要であれば trial timing 用フィールドを payload に追加するが、Story 1.1 では既存 consumer を壊さない最小変更にとどめる

- [x] billing action の owner-only 境界を明文化し、summary との役割差をコード上で明確にする (AC: 1, 2, 3)
  - [x] `/api/v1/auth/organizations/billing/checkout` と `/api/v1/auth/organizations/billing/portal` が owner-only のままであることを維持または明示化する
  - [x] summary の閲覧権限と billing action 権限が混線しないよう helper / route 条件を整理する
  - [x] `403` と `422` の返し分けを既存の route contract に合わせて維持する

- [x] 型・共有 client 契約・テストを更新し、回帰を防ぐ (AC: 1, 2, 3, 4)
  - [x] `apps/web/src/lib/rpc-client.ts` の `OrganizationBillingPayload` を backend response shape と整合させる
  - [x] `apps/web/src/lib/features/organization-context.svelte.ts` の payload parsing を必要に応じて更新する
  - [x] `apps/backend/src/app.test.ts` の billing integration test を更新し、owner/admin summary と non-owner action denial を固定する
  - [x] response shape を変更した場合のみ `apps/web/src/routes/contracts/page.svelte.spec.ts` など consumer test を更新する

## Dev Notes

- Story 1.1 は「契約サマリー API と owner-only 課金操作境界」の確立が目的であり、契約画面の文言や導線の調整は Epic 1 の Story 1.2 / 1.4 側で扱う。
- 現在の backend summary route は `canManageOrganizationByRole(role)` を使って owner/admin に `200` を返し、`canManageBilling` で owner-only を区別している。checkout / portal はすでに owner-only (`role !== 'owner'` で `403`)。既存の read-versus-act 分離を壊さず、Story 1.1 の要件に合わせて明確化するのが基本方針。
- 現在の web contracts page は `loadPortalAccess().hasOrganizationAdminAccess` を前提に admin portal 側へ遷移している。Story 1.1 では portal access の拡張は行わず、summary contract と権限境界の整備に集中する。
- `organization_billing` は既存 migration `0012_organization_billing.sql` で全 organization に `free/free` 初期行を作る前提だが、runtime 側でも `ensureOrganizationBillingRow` が free 行を補完する。新しい summary 実装でもこの防御的パターンを維持する。
- current codebase では product plan state が `free | premium`、provider subscription status が `free | trialing | active | past_due | canceled | unpaid | incomplete` になっている。subscription planning artifacts では `premium_trial` / `premium_paid` への拡張が予定されているため、Story 1.1 では「既存契約を壊さない最小前進」を優先し、trial-specific field の導入有無は payload consumer との整合を見て判断する。

### Technical Requirements

- backend route は `apps/backend/src/routes/auth-routes.ts` の既存 `/api/v1/auth/organizations/billing` を起点に実装すること。新しい billing summary endpoint を増やさない。 [Source: _bmad-output/planning-artifacts/architecture.md, API & Communication Patterns]
- billing aggregate の正本は `organization_billing`。classroom 単位の契約状態を導入しない。 [Source: _bmad-output/planning-artifacts/architecture.md, Data Architecture]
- billing action endpoint は session 必須 + organization ownership 必須 + owner-only を維持する。 [Source: _bmad-output/planning-artifacts/architecture.md, Authentication & Security]
- summary response は role-specific permissions を返してよいが、課金操作権限は `canManageBilling` のような明示 field で分離する。 [Source: apps/backend/src/routes/auth-routes.ts]
- `display` 系フィールドを権限判定の正本に使わない。サーバ/クライアントとも `effective` / membership role を基準にする。 [Source: docs/architecture.md, 認可モデル] [Source: _bmad-output/project-context.md, 重要な実装ルール]

### Architecture Compliance

- brownfield 前提: 既存 monorepo baseline を拡張し、新規 starter や parallel architecture を作らない。 [Source: _bmad-output/planning-artifacts/architecture.md, Selected Starter]
- route handler に billing domain logic を埋め込みすぎず、既存 helper / selector の責務分離を維持する。 [Source: _bmad-output/planning-artifacts/architecture.md, Service boundaries]
- `organization_billing` の free 初期化、summary 読み取り、checkout / portal action の流れは既存コードにあるため、Story 1.1 はその上に owner-only / role-specific summary の整理を行う。 [Source: apps/backend/src/routes/auth-routes.ts] [Source: apps/backend/src/app.test.ts]
- future trial-first lifecycle へ進化する前提でも、Story 1.1 の時点では provider state と product plan state を混同しない。 [Source: _bmad-output/planning-artifacts/architecture.md, State model decision]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + `@hono/zod-openapi 1.2.1` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 を前提にする。新規依存は追加しない。 [Source: apps/backend/package.json] [Source: _bmad-output/project-context.md, 技術スタックとバージョン]
- Web の shared contract は SvelteKit `2.50.1` + Svelte `5.48.2` 前提の `rpc-client.ts` / feature helper で維持する。 payload 変更時は最小範囲で反映する。 [Source: apps/web/package.json] [Source: _bmad-output/project-context.md, 技術スタックとバージョン]
- external latest-doc lookup はこの story では必須ではない。実装判断は repo に pin されている version と architecture artifact を正本にする。

### File Structure Requirements

- 主要変更候補:
  - `apps/backend/src/routes/auth-routes.ts`
  - `apps/backend/src/booking/authorization.ts` または billing 専用 helper 追加先
  - `apps/backend/src/db/schema.ts`（payload に必要な field が schema と不整合な場合のみ）
  - `apps/web/src/lib/rpc-client.ts`
  - `apps/web/src/lib/features/organization-context.svelte.ts`
  - `apps/backend/src/app.test.ts`
  - 必要に応じて `apps/web/src/routes/contracts/page.svelte.spec.ts`
- backend の billing 固有ロジックは `routes` / `payment` / `db` の既存責務分離を保つ。 UI ロジックを backend に持ち込まない。 [Source: _bmad-output/project-context.md, コード品質・スタイルルール]
- Web 側は `organization-context.svelte.ts` に fetch/action helper を寄せ、`contracts/+page.svelte` は表示責務を維持する。 [Source: _bmad-output/planning-artifacts/architecture.md, Frontend Architecture]

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`（response shape を変えた場合）
  - `pnpm --filter @apps/web typecheck`（shared payload / feature helper を変えた場合）
- backend integration test を最優先にする。Story 1.1 は認可可否と API response shape の境界変更なので、`apps/backend/src/app.test.ts` に回帰ケースを追加または更新する。 [Source: docs/test-strategy.md, 認可・招待・セッション] [Source: _bmad-output/project-context.md, テストルール]
- 変更内容に応じた追加確認:
  - owner summary: `200` + `canManageBilling: true`
  - admin summary: `200` + `canManageBilling: false` を維持するか、仕様変更するならその理由を明示する
  - admin checkout/portal: `403`
  - free organization summary row auto-create: `planCode = free`, `subscriptionStatus = free`
- contracts page consumer に shape 変更があるなら `apps/web/src/routes/contracts/page.svelte.spec.ts` を更新し、UI が `canManageBilling` / status fields を正しく扱うことを守る。

### Previous Story Intelligence

- Epic 1 の最初の story なので、同一 epic 内の previous story learnings は存在しない。
- その代わり、既存 billing 実装と test 群が「previous implementation intelligence」として機能する。既存パターンを置換せず拡張すること。

### Git Intelligence Summary

- 直近の relevant commits:
  - `4b8ac61 feat(billing): add organization Stripe subscriptions`
  - `46b99af feat(stripe): add billing catalog bootstrap script`
  - `43b3be5 権限システムと招待管理の強化`
- これらからの guardrail:
  - billing は既に organization-scoped Stripe subscription として導入済みなので、Story 1.1 で別モデルを増やさない
  - authz は最近強化された領域なので、role 判定を簡略化したり `display` ベースへ戻したりしない
  - billing summary / action route と webhook / subscription 実装の整合を壊さない

### Project Context Reference

- Backend: Cloudflare Workers + Hono + Better Auth + D1。`module: "NodeNext"` と `verbatimModuleSyntax: true` を壊さない。 [Source: _bmad-output/project-context.md, 技術スタックとバージョン]
- 権限モデルは `facts -> effective -> sources -> display` の 4 層で、`display` は表示専用。 [Source: docs/architecture.md, 認可モデル]
- staged migration / brownfield 変更のため、理想形への全面リファクタを混ぜない。 [Source: _bmad-output/project-context.md, 重要な見落とし禁止ルール]

### Project Structure Notes

- `apps/backend/src/routes/auth-routes.ts` の `getOrganizationBillingRoute` は現在 `canManageOrganizationByRole(role)` を使って owner/admin の閲覧を許可している一方、checkout / portal は owner-only。Story 1.1 ではこの非対称性を意図として明文化するか、billing 専用 helper で整理する必要がある。
- `apps/web/src/lib/features/auth-session.svelte.ts` の `hasOrganizationAdminAccess` は `effective.canManageOrganization` に基づくため、admin portal へのアクセスは owner/admin 前提になっている。Story 1.1 の範囲では non-admin portal access を増やさない。
- `apps/web/src/routes/contracts/+page.svelte` は現在 `loadOrganizationBilling` の response shapeを前提にしている。payload を変更する場合、Story 1.2 以降の contracts UI story に影響を出さないよう最小変更で行う。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1]
- [Source: _bmad-output/planning-artifacts/prd.md#Functional Requirements]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- [Source: _bmad-output/project-context.md#重要な実装ルール]
- [Source: docs/architecture.md#認可モデル]
- [Source: docs/test-strategy.md#認可・招待・セッション]
- [Source: apps/backend/src/routes/auth-routes.ts]
- [Source: apps/backend/src/booking/authorization.ts]
- [Source: apps/backend/src/db/schema.ts]
- [Source: apps/backend/drizzle/0012_organization_billing.sql]
- [Source: apps/backend/src/app.test.ts]
- [Source: apps/web/src/lib/rpc-client.ts]
- [Source: apps/web/src/lib/features/organization-context.svelte.ts]
- [Source: apps/web/src/lib/features/auth-session.svelte.ts]
- [Source: apps/web/src/routes/contracts/+page.svelte]
- [Source: apps/web/src/routes/contracts/page.svelte.spec.ts]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Existing billing implementation inspected in backend routes, schema, web feature helpers, and tests.
- Verification:
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web typecheck`
  - `pnpm --filter @apps/web test -- src/routes/contracts/page.svelte.spec.ts`
  - `pnpm --filter @apps/backend test -- src/app.test.ts`
  - `pnpm --filter @apps/backend exec eslint src/routes/auth-routes.ts src/booking/authorization.ts src/app.test.ts`
  - `pnpm --filter @apps/web exec prettier --check src/lib/rpc-client.ts src/lib/features/organization-context.svelte.ts`
  - `pnpm --filter @apps/web exec eslint src/lib/rpc-client.ts src/lib/features/organization-context.svelte.ts`
- Repo baseline notes:
  - `pnpm --filter @apps/backend lint` fails on pre-existing `apps/backend/src/routes/booking-routes.ts` `no-explicit-any` violations.
  - `pnpm --filter @apps/web lint` fails on pre-existing repo-wide Prettier drift in unrelated files.

### Completion Notes List

- Added an explicit `canViewOrganizationBillingByRole` helper so billing-summary access is separated from owner-only billing actions.
- Expanded the billing summary contract with `planState`, `trialEndsAt`, and `canViewBilling` while preserving existing `planCode` / `subscriptionStatus` fields for current consumers.
- Kept checkout and billing-portal routes owner-only; org admins and org members can now read billing summary but cannot perform billing actions.
- Updated the shared web billing payload/parser to accept the expanded backend response without widening portal access.
- Extended backend integration coverage for owner/admin/member billing summary access, owner-only checkout denial for non-owners, and trial-state summary mapping.

### File List

- _bmad-output/implementation-artifacts/1-1-organization-billing-summary-and-owner-authorization.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/backend/src/app.test.ts
- apps/backend/src/booking/authorization.ts
- apps/backend/src/routes/auth-routes.ts
- apps/web/src/lib/features/organization-context.svelte.ts
- apps/web/src/lib/rpc-client.ts

## Change Log

- 2026-04-08: Implemented Story 1.1 by separating billing-summary visibility from owner-only billing actions, extending the billing summary response with explicit viewing/plan-state fields, and adding regression coverage for owner/admin/member access plus trial-state mapping.
