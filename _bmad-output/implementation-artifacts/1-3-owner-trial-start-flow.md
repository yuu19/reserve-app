# Story 1.3: Owner Trial Start Flow

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an organization owner,
I want to start a 7-day premium trial from the billing workspace,
so that I can evaluate premium features for my organization.

## Acceptance Criteria

1. free plan の eligible な owner が premium trial を開始したとき、system が organization billing record を作成または更新して 7 日間の premium trial にし、trial start / end timestamp を永続化すること。
2. 組織にすでに active な premium trial または paid lifecycle があり、新しい trial が無効な場合、system が要求を拒否し、clear な lifecycle conflict message を返すこと。
3. trial 開始に成功したあと owner が contracts page に戻ると、新しい `premium_trial` state が反映され、trial end date が曖昧さなく見えること。
4. non-owner が UI または direct request で trial 開始を試みたとき、frontend affordance と backend enforcement の両方で blocking され、trial が作成されないこと。

## Tasks / Subtasks

- [x] trial start の責務境界を確定し、paid checkout と分離した owner-only lifecycle action として実装方針を固定する (AC: 1, 2, 4)
  - [x] `apps/backend/src/routes/auth-routes.ts` の既存 `/api/v1/auth/organizations/billing` / `/checkout` / `/portal` 実装を確認し、trial start を paid checkout に流用しない方針を明記する
  - [x] trial 開始は payment method registration を伴わないこと、billing interval 選択をこの story では要求しないことを guardrail として残す
  - [x] owner-only 判定は Story 1.1 と同じ membership role 境界を使い、admin / member へ trial authority を拡張しない

- [x] backend に owner-only trial start action を追加し、7 日 trial lifecycle を永続化する (AC: 1, 2, 4)
  - [x] 既存 billing routes 配下に trial start action を追加し、request validation / authz / conflict handling を route layer で行う
  - [x] billing aggregate は `organization_billing` を正本として扱い、trial start 成功時に `plan_code = premium`, `subscription_status = trialing`, trial start / end timestamp を更新する
  - [x] 可能なら既存 `currentPeriodStart` / `currentPeriodEnd` を trial start / end 保存に再利用し、追加 schema が不要なら migration を増やさない。明示的な trial timestamp field が不可欠なら D1 migration もセットで扱う
  - [x] すでに `trialing` / `active` / `past_due` / `unpaid` / `incomplete` など active premium lifecycle の場合は `409` もしくは設計済み conflict error で拒否し、state を変更しない

- [x] contracts page と web helper を trial start UX に合わせて更新する (AC: 3, 4)
  - [x] `apps/web/src/routes/contracts/+page.svelte` の free-plan owner action を trial start CTA へ置き換える、または trial start を primary action として明示する
  - [x] success 後は contracts page 再読込で `premium_trial` state と trial end date が表示されるよう、既存 billing summary fetch を再利用する
  - [x] non-owner には trial start CTA を出さず、trial 中または paid state のときは invalid duplicate action を表示しない
  - [x] stale reflection を誤解させない intermediate message を保ちつつ、「trial を開始した」「まだ反映待ち」の区別が崩れない文言にする

- [x] shared client contract / feature helper を story 要件に合わせて更新する (AC: 3, 4)
  - [x] `apps/web/src/lib/rpc-client.ts` に trial start action 用の input / RPC method を追加する
  - [x] `apps/web/src/lib/features/organization-context.svelte.ts` に trial start helper を追加し、既存 `parseResponseBody` / `toErrorMessage` パターンを踏襲する
  - [x] contracts page 側は route/page に表示責務を残し、trial start の fetch/action 詳細は feature helper 側へ寄せる

- [x] regression test を追加・更新し、trial start lifecycle と owner-only 境界を固定する (AC: 1, 2, 3, 4)
  - [x] `apps/backend/src/app.test.ts` に owner successful trial start、duplicate/active lifecycle conflict、admin/member denial を追加する
  - [x] trial start 成功後に billing summary が `premium_trial` と trial end date を返すことを backend integration test で固定する
  - [x] `apps/web/src/routes/contracts/page.svelte.spec.ts` を更新し、free owner の trial CTA、trial state 表示、non-owner CTA 非表示を確認する
  - [x] 必要なら `apps/web/src/lib/features/*.spec.ts` に trial start helper の error-message / response handling を追加する

## Dev Notes

- Story 1.3 は「trial を始める」ことだけを担当する。payment method registration、paid conversion、reminder email、trial end downgrade は後続 story に委ねる。
- current codebase には owner-only paid checkout route はあるが、trial start 専用 action は存在しない。Story 1.3 では trial を paid checkout に偽装せず、organization billing lifecycle の明示的な state transition として実装する。
- Story 1.2 までで contracts page は `planState` と `trialEndsAt` を表示できる。Story 1.3 はその表示基盤を利用して、trial start 後の UI 反映を最小変更で実現する。
- 既存 schema の `currentPeriodStart` / `currentPeriodEnd` は trial 開始・終了の timestamp 保持に流用できる可能性が高い。Story 1.3 ではまず既存カラム再利用を優先し、不要な migration を避ける。
- active premium lifecycle の conflict 判定は既存 `hasActivePremiumSubscription(...)` と整合させる。trial 中・paid 中の両方で duplicate trial を拒否し、owner に lifecycle conflict を明示する。

### Technical Requirements

- trial start action は既存 auth routes 配下の billing namespace に追加し、新しい app host や別 module を増やさない。 [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- billing aggregate の正本は `organization_billing`。classroom 単位 trial や別 billing aggregate を導入しない。 [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines] [Source: apps/backend/src/db/schema.ts]
- owner-only billing authority は backend と web の両方で維持し、`member.role === owner` 以外に trial start を開放しない。 [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- trial start 実行時の persisted timestamps は既存 `currentPeriodStart` / `currentPeriodEnd` の再利用を第一候補とする。 [Source: apps/backend/src/db/schema.ts]
- contracts page 側の UI 反映は既存 `loadOrganizationBilling()` の summary を再利用し、trial state 表示は `planState === 'premium_trial'` と `trialEndsAt` で判断する。 [Source: apps/web/src/routes/contracts/+page.svelte] [Source: apps/web/src/lib/features/organization-context.svelte.ts]

### Architecture Compliance

- brownfield 原則: 既存 premium subscription 実装を trial-first lifecycle へ安全に進化させる。trial 用に parallel route set や別 billing aggregate を作らない。 [Source: _bmad-output/planning-artifacts/architecture.md]
- route layer で authz / validation / response shaping、billing lifecycle 更新は helper/service 側へ寄せる。route handler に trial policy をべた書きしすぎない。 [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- trial 開始は provider status の単純な文字列比較だけで entitlement を決めるのではなく、organization billing lifecycle の明示 state transition として扱う。 [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- contracts page は owner billing workspace のまま拡張し、trial CTA 表示・非表示・中間メッセージの責務に集中する。 [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 を前提にする。新規依存追加は不要。 [Source: _bmad-output/project-context.md#Backend]
- Web は SvelteKit `2.50.1` + Svelte `5.48.2` + existing feature helper / RPC client パターンを維持する。新規 global state library は導入しない。 [Source: _bmad-output/project-context.md#Web]
- Stripe helper は既存 `apps/backend/src/payment/stripe.ts` を正本にし、trial start が Stripe-hosted flow を使わないなら helper の責務を広げすぎない。 [Source: apps/backend/src/payment/stripe.ts]

### File Structure Requirements

- 主変更候補:
  - `apps/backend/src/routes/auth-routes.ts`
  - 必要に応じて `apps/backend/src/db/schema.ts`
  - 必要に応じて `apps/backend/drizzle/00xx_*.sql`
  - `apps/backend/src/app.test.ts`
  - `apps/web/src/lib/rpc-client.ts`
  - `apps/web/src/lib/features/organization-context.svelte.ts`
  - `apps/web/src/routes/contracts/+page.svelte`
  - `apps/web/src/routes/contracts/page.svelte.spec.ts`
- backend billing lifecycle ロジックが大きくなる場合でも、`routes` / `payment` / `db` の既存責務分離を崩さない。 [Source: _bmad-output/project-context.md#コード品質・スタイルルール]
- Web 側は fetch/action helper を `organization-context.svelte.ts` に寄せ、`contracts/+page.svelte` は UI 表示と interaction wiring に留める。 [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
  - `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`
- backend integration test を最優先にする。trial start は lifecycle state transition と owner-only 境界を同時に変えるため、`apps/backend/src/app.test.ts` で成功・拒否・conflict を固定する。 [Source: docs/test-strategy.md#Backend]
- `.svelte` の CTA と trial state 表示を変えるため、browser test で owner CTA / non-owner hidden / trial state visible を固定する。 [Source: docs/test-strategy.md#Web browser]
- schema 変更が発生した場合は migration 前提の回帰ケースを必ず追加する。 [Source: docs/test-strategy.md#Migration / D1 スキーマ変更]

### Previous Story Intelligence

- Story 1.1 で billing summary と owner-only billing action の境界が整理された。trial start でもこの権限境界を崩さず、summary は read-only、mutation は owner-only の原則を維持する。
- Story 1.2 で contracts page は `planState` / `trialEndsAt` 表示と role-safe action visibility に対応した。Story 1.3 はその page を trial CTA と成功後の `premium_trial` 表示へ進化させるだけに留め、大規模 UI 再編を避ける。
- Story 1.2 の browser test はすでに owner free / trial state / admin read-only の表示分岐を持つため、trial CTA と success refresh のケースをそこへ追加するのが自然。

### Git Intelligence Summary

- 直近の relevant commits:
  - `2720193 feat(web): add route transition progress bar`
  - `46b99af feat(stripe): add billing catalog bootstrap script`
  - `4b8ac61 feat(billing): add organization Stripe subscriptions`
  - `43b3be5 権限システムと招待管理の強化`
- guardrail:
  - Stripe subscription 基盤は既にあるため、trial start でも org-scoped billing model を再利用する
  - recent authz refactor があるので、UI ボタン表示だけでなく backend owner-only denial を必ず固定する
  - web 側は 최근 route transition UI が入っているため、trial start 中の busy / redirect 表現は既存 UX を壊さない

### Project Context Reference

- `display` 系フィールドを権限制御の根拠に使わず、backend role / explicit permission field を正本にする。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- staged migration 中の `authRpc` と Remote Functions の共存を壊さず、この story でも billing action は既存 `authRpc` パターンを維持する。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- 実装完了の基準はコード追加ではなく、backend/web test・typecheck・lint が揃うこと。 [Source: _bmad-output/project-context.md#開発ワークフロールール]

### Project Structure Notes

- 現在の `/api/v1/auth/organizations/billing/checkout` は `billingInterval` 必須の paid subscription checkout を作る route で、trial start の責務とは一致しない。Story 1.3 では専用 owner-only mutation を追加する方が責務が明確。
- 現在の `organization_billing` schema には `currentPeriodStart` / `currentPeriodEnd` があり、trial start / end の persistence にそのまま使える余地がある。
- `contracts/+page.svelte` は free owner に月額/年額 upgrade ボタンを出している。Story 1.3 では free owner の primary CTA を 7-day trial 開始に置き換えるか、それを最初の action として優先表示する必要がある。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3]
- [Source: _bmad-output/planning-artifacts/prd.md#MVP - Minimum Viable Product]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 1: Owner / Operator - Happy Path]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 5: Billing Integration / Stripe Operational Flow]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Loading State Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- [Source: _bmad-output/project-context.md#コード品質・スタイルルール]
- [Source: docs/test-strategy.md#Backend]
- [Source: docs/test-strategy.md#Web browser]
- [Source: apps/backend/src/routes/auth-routes.ts]
- [Source: apps/backend/src/db/schema.ts]
- [Source: apps/backend/src/payment/stripe.ts]
- [Source: apps/backend/src/app.test.ts]
- [Source: apps/web/src/lib/rpc-client.ts]
- [Source: apps/web/src/lib/features/organization-context.svelte.ts]
- [Source: apps/web/src/routes/contracts/+page.svelte]
- [Source: apps/web/src/routes/contracts/page.svelte.spec.ts]
- [Source: _bmad-output/implementation-artifacts/1-2-contracts-page-plan-visibility-and-premium-value-comparison.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Reviewed create-story workflow, sprint-status ordering, Epic 1 story definitions, PRD MVP and journey sections, architecture sections for auth/API/frontend/loading/enforcement, current billing route/schema/tests, and Story 1.2 implementation notes.
- Confirmed current repo only has owner-only paid checkout under `/api/v1/auth/organizations/billing/checkout`; no dedicated trial-start mutation exists yet.
- Validation: `pnpm --filter @apps/backend test`, `pnpm --filter @apps/backend typecheck`, `pnpm --filter @apps/web test`, `pnpm --filter @apps/web typecheck`, `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`, targeted backend/web `eslint`.

### Completion Notes List

- 2026-04-08: create-story workflow により Story 1.3 の包括的な実装コンテキストを作成し、trial start を paid checkout から分離する guardrail と test expectation を整理した。
- 2026-04-08: `/api/v1/auth/organizations/billing/trial` を追加し、owner-only の 7 日 trial 開始・active premium lifecycle conflict 409・`currentPeriodStart` / `currentPeriodEnd` 再利用を実装した。
- 2026-04-08: contracts page の free-plan owner CTA を trial start に切り替え、成功時の再読込反映と「開始済み / 反映待ち」を分けた status message を追加した。
- 2026-04-08: backend integration test、web browser test、backend/web typecheck、targeted eslint を通して Story 1.3 の回帰を確認した。

### File List

- apps/backend/src/routes/auth-routes.ts
- apps/backend/src/app.test.ts
- apps/web/src/lib/rpc-client.ts
- apps/web/src/lib/features/organization-context.svelte.ts
- apps/web/src/routes/contracts/+page.svelte
- apps/web/src/routes/contracts/page.svelte.spec.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-04-08: Story 1.3 を新規作成し、owner trial start の backend lifecycle action・contracts page CTA・owner-only guardrail に関する実装ガイドを追加。
- 2026-04-08: owner-only premium trial start route と contracts page の trial CTA / status reflection を実装し、trial lifecycle / role boundary regression test を追加。
