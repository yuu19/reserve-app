# Story 1.2: Contracts Page Plan Visibility and Premium Value Comparison

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an organization owner,
I want to see the current plan state, trial timing, and premium-vs-free differences on the contracts page,
so that I can decide whether to start or continue a premium workflow.

## Acceptance Criteria

1. owner が contracts page を開いたとき、billing data の取得に成功した場合、組織の現在の plan state が表示され、組織が trial 中なら trial end 情報も表示されること。
2. owner が free plan のとき、contracts page 上で free で利用できる機能と premium が必要な機能の違いが明確に表示されること。
3. non-owner が contracts page を開いたとき、owner-only billing control は表示されず、見える billing status は read-only かつ role に応じた表現であること。
4. billing data の取得中または反映遅延がありうる状態で contracts page が表示されるとき、理解可能な loading / intermediate state を提供し、状態伝達を色だけに依存しないこと。

## Tasks / Subtasks

- [x] 既存 contracts page と billing contract の責務境界を再確認し、Story 1.2 の UI スコープを固定する (AC: 1, 2, 3, 4)
  - [x] `apps/web/src/routes/contracts/+page.svelte` の現在の表示内容、`planCode` / `planState` / `trialEndsAt` / `canManageBilling` 利用状況を確認する
  - [x] `apps/web/src/lib/features/organization-context.svelte.ts` と `apps/web/src/lib/rpc-client.ts` の billing payload を確認し、Story 1.1 で追加された `planState` / `trialEndsAt` / `canViewBilling` を UI 正本として使う方針を明確にする
  - [x] Story 1.2 では trial 開始 mutation や payment method registration 導線を追加せず、表示改善と role-safe UI に集中することを明記する

- [x] contracts page の plan summary を現在の billing state に沿って再設計する (AC: 1, 4)
  - [x] `planCode` ではなく `planState` を基準に `free` / `premium_trial` / `premium_paid` の owner 向け表示ラベルと補助説明文を整理する
  - [x] `premium_trial` のときのみ `trialEndsAt` を明示表示し、`premium_paid` のときは renewal/current period 系の情報を混同なく表示する
  - [x] loading・empty・delayed reflection の各状態に対して、色以外のテキスト説明やステータス文言を用意する

- [x] free vs premium の価値比較セクションを contracts page に追加または再構成する (AC: 2)
  - [x] PRD / epics にある MVP 対象機能だけを使い、free でできることと premium で解放されることを比較表・カード・リストのいずれかで明確化する
  - [x] 複数教室管理、スタッフ招待/権限管理、定期スケジュール、承認制予約、回数券、契約管理、分析などの premium 価値を current scope に沿って表現する
  - [x] future-phase 専用の invoice / receipt / multi-tier など Epic 5 領域は「今すぐ使える premium 価値」として誤表示しない

- [x] non-owner に対する read-only / role-appropriate UI を contracts page で明確化する (AC: 3)
  - [x] `canManageBilling` が `false` の場合、owner-only action button は disabled 表示で残すのではなく、非表示または read-only 専用表現へ切り替える
  - [x] admin には契約状態の閲覧を許可しつつ、課金操作は owner-only であることを明示する
  - [x] manager / staff / participant の portal access 境界は既存 `loadPortalAccess` / `resolvePortalHomePath` 方針を維持し、この story で access widening をしない

- [x] UI regression test を更新し、plan visibility・comparison・read-only 分岐を固定する (AC: 1, 2, 3, 4)
  - [x] `apps/web/src/routes/contracts/page.svelte.spec.ts` を更新し、owner free / owner premium_trial(or paid) / admin read-only の主要分岐を確認する
  - [x] loading or intermediate state の文言が存在し、状態表示が色だけに依存していないことを browser test で確認する
  - [x] もし表示導出ロジックを helper へ切り出した場合のみ、近接する feature/server test を追加して `planState` ごとの文言分岐を固定する

## Dev Notes

- Story 1.2 の責務は contracts page の「見え方」と「説明責務」の改善であり、trial 作成や payment method registration の実行フロー自体は Story 1.3 / 2.1 に委ねる。
- Story 1.1 で backend summary は `planState`, `trialEndsAt`, `canViewBilling`, `canManageBilling` を返せるようになっている。Story 1.2 では既存 API contract を消費して UI を改善し、新しい billing endpoint は追加しない。
- 現在の contracts page は `planCode === 'premium'` ベースの単純表示で、free / premium の比較や `premium_trial` の明示が不足している。Story 1.2 では `planState` を UI 上の正本にして trial 表示を先に整える。
- 現在の non-owner 表示は「disabled な owner action button + 補足文」に近く、AC 3 の「owner-only billing controls を露出しない」とはズレる。admin 向け read-only view に寄せ、owner controls は露出しない方針を優先する。
- `loadPortalAccess()` の `hasOrganizationAdminAccess` は owner/admin を admin portal に通し、それ以外を別 portal へ分岐させる。Story 1.2 では manager/staff/participant を contracts page に新規流入させない。

### Technical Requirements

- contracts page の UI 実装は既存 `apps/web/src/routes/contracts/+page.svelte` を拡張し、新規グローバル state や別画面を導入しない。 [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- billing 表示の入力値は `apps/web/src/lib/features/organization-context.svelte.ts` と `apps/web/src/lib/rpc-client.ts` の `OrganizationBillingPayload` を正本にする。 [Source: apps/web/src/lib/features/organization-context.svelte.ts] [Source: apps/web/src/lib/rpc-client.ts]
- trial 表示は `planState === 'premium_trial'` と `trialEndsAt` の組み合わせで扱い、`subscriptionStatus` の文字列だけで product lifecycle を表現しない。 [Source: apps/backend/src/routes/auth-routes.ts] [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- owner-only billing action の backend 強制は既存 route 側にあるため、web は「操作を見せない / 誤解させない」責務に集中する。 [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] [Source: apps/backend/src/routes/auth-routes.ts]

### Architecture Compliance

- brownfield 原則: 既存 contracts UI・feature helper・auth portal 導線の上に表示改善を積み上げ、別ホスト・別画面・別 state 管理を導入しない。 [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] [Source: _bmad-output/project-context.md#コード品質・スタイルルール]
- route/page は表示と interaction に集中し、billing fetch/action helper は既存 `organization-context.svelte.ts` 側へ寄せる。 [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]
- manager/staff への access widening はこの story の範囲外。read-only billing status は owner/admin 前提の admin portal で整理する。 [Source: apps/web/src/lib/features/auth-session.svelte.ts] [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- `display` 系 role 表示を権限判定の正本に使わず、`canManageBilling` や `effective.canManageOrganization` を基準に UI 分岐する。 [Source: docs/architecture.md] [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]

### Library / Framework Requirements

- Web 実装は SvelteKit `2.50.1` + Svelte `5.48.2` + Vite `7.3.1` + Tailwind CSS `4.1.18` 前提で既存 UI コンポーネントを利用する。新規依存追加は不要。 [Source: _bmad-output/project-context.md#Web]
- 既存 UI 部品 (`Badge`, `Button`, `Card`) と `svelte-sonner` toast を維持し、Story 1.2 のためだけに新規 UI framework や icon dependency を入れない。 [Source: apps/web/src/routes/contracts/+page.svelte]
- latest external documentation lookup は必須ではない。repo に pin された version と architecture artifact を正本にする。

### File Structure Requirements

- 主変更候補:
  - `apps/web/src/routes/contracts/+page.svelte`
  - `apps/web/src/routes/contracts/page.svelte.spec.ts`
  - 必要に応じて `apps/web/src/lib/features/organization-context.svelte.ts`
  - 必要に応じて `apps/web/src/lib/rpc-client.ts`
- 表示文言や状態整形のために helper を追加する場合でも、`routes/contracts` または `lib/features` の既存責務から外れない。 [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] [Source: _bmad-output/project-context.md#コード品質・スタイルルール]
- backend route / schema 変更は原則不要。UI 実装だけでは満たせない欠落が判明した場合のみ最小変更で扱い、その理由を story 実装ログに残す。

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/web test -- src/routes/contracts/page.svelte.spec.ts`
  - `pnpm --filter @apps/web typecheck`
  - `pnpm --filter @apps/web exec eslint src/routes/contracts/+page.svelte src/routes/contracts/page.svelte.spec.ts`
- `.svelte` の表示分岐変更なので browser test を優先する。feature helper 抽出がある場合だけ server/feature test を追加する。 [Source: docs/test-strategy.md#Web browser] [Source: docs/test-strategy.md#Svelte コンポーネント / ページ]
- 少なくとも次を検証対象に含める:
  - owner free: plan summary + free vs premium comparison + owner action
  - owner premium_trial: trial end 表示 + intermediate messaging
  - admin read-only: current status visible / owner action controls non-visible
  - loading state: 文章で状態が伝わる

### Previous Story Intelligence

- Story 1.1 で billing summary API はすでに view/action 権限を分離し、`planState` / `trialEndsAt` / `canViewBilling` / `canManageBilling` を返す。Story 1.2 ではこの contract を UI 側で活用し、再度 backend 権限境界を掘り返しすぎない。
- Story 1.1 の実装では admin と member も billing summary 自体は読めるように整理されたが、web portal access は `hasOrganizationAdminAccess` ベースのまま維持されている。contracts page の表示改善はこの差分を理解したうえで、UI 側の access policy を無理に拡張しない。
- Story 1.1 では disabled button よりも explicit permission field を重視する流れになっているため、Story 1.2 でも `canManageBilling` に基づく非表示 / read-only 表現を優先する。

### Git Intelligence Summary

- 直近の relevant commits:
  - `2720193 feat(web): add route transition progress bar`
  - `46b99af feat(stripe): add billing catalog bootstrap script`
  - `4b8ac61 feat(billing): add organization Stripe subscriptions`
  - `43b3be5 権限システムと招待管理の強化`
- guardrail:
  - web 側は最近 route transition 系の UI 変更が入っているため、contracts page の loading/intermediate state 追加で既存ナビゲーション挙動を壊さない
  - billing は organization-scoped Stripe subscription を前提にしているため、Story 1.2 で classroom/site 単位の比較表現を state model と切り離さない
  - 権限周りは recent refactor 済みなので、UI 側 shortcut で role 判定を簡略化しない

### Project Context Reference

- `display` は表示専用、権限判定は `effective` や explicit permission field を正本にする。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- staged migration 中の `authRpc` と Remote Functions の共存を壊さず、contracts page は既存 `authRpc` ベース helper を維持する。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- UI の重要分岐変更では browser test を未検証のまま終えない。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール] [Source: docs/test-strategy.md#6. テスト追加の判断基準]

### Project Structure Notes

- 現在の `contracts/+page.svelte` は current plan card と action card の2段構成で、free/premium 比較の説明領域がない。Story 1.2 では比較セクションを追加しても page 責務内に収まる。
- `subscriptionStatusLabel` は provider state を owner 向け product explanation にそのまま使っているため、`planState` を中心に据えた label/description 再設計が必要。
- `subscription=success` / `subscription=cancel` query toast はすでに存在し、「反映まで数秒かかる場合があります」という intermediate messaging の足場として再利用できる。ただし Story 2.1 より先に payment-method-registration 成功を断定する文言へ広げない。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2]
- [Source: _bmad-output/planning-artifacts/prd.md#MVP - Minimum Viable Product]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey Requirements Summary]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Loading State Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- [Source: _bmad-output/project-context.md#Web]
- [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- [Source: _bmad-output/project-context.md#テストルール]
- [Source: docs/test-strategy.md#Web browser]
- [Source: docs/test-strategy.md#Svelte コンポーネント / ページ]
- [Source: apps/web/src/routes/contracts/+page.svelte]
- [Source: apps/web/src/routes/contracts/page.svelte.spec.ts]
- [Source: apps/web/src/lib/features/organization-context.svelte.ts]
- [Source: apps/web/src/lib/features/auth-session.svelte.ts]
- [Source: apps/web/src/lib/rpc-client.ts]
- [Source: apps/backend/src/routes/auth-routes.ts]
- [Source: _bmad-output/implementation-artifacts/1-1-organization-billing-summary-and-owner-authorization.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Reviewed create-story workflow, sprint-status ordering, Epic 1 story definitions, PRD journeys/scope, architecture sections for auth/API/frontend/loading/testing, project-context guardrails, current contracts page implementation, current billing payload contract, and Story 1.1 outputs.
- Verified the current repo patterns around `loadPortalAccess`, `loadOrganizationBilling`, `OrganizationBillingPayload`, and contracts page browser tests before writing this story context.
- Implementation verification:
  - `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
  - `pnpm --filter @apps/web exec eslint src/routes/contracts/+page.svelte src/routes/contracts/page.svelte.spec.ts`
- Svelte validation:
  - `mcp__svelte__svelte_autofixer` で `apps/web/src/routes/contracts/+page.svelte` を検証し、`#each` に key を追加して再確認した。

### Completion Notes List

- 2026-04-08: create-story workflow により Story 1.2 の包括的な実装コンテキストを作成し、Story 1.1 の learnings と current contracts UI の guardrail を反映した。
- 2026-04-08: contracts page を `planState` / `trialEndsAt` ベースの表示へ更新し、free / premium 比較セクションと trial 用の明示的な説明文を追加した。
- 2026-04-08: owner-only action を read-only view から外し、admin には契約状態のみを確認できる role-safe UI に整理した。
- 2026-04-08: loading / intermediate state をテキストで伝える UI と browser regression test を追加し、主要分岐を固定した。

### File List

- _bmad-output/implementation-artifacts/1-2-contracts-page-plan-visibility-and-premium-value-comparison.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/web/src/routes/contracts/+page.svelte
- apps/web/src/routes/contracts/page.svelte.spec.ts

## Change Log

- 2026-04-08: Story 1.2 を新規作成し、contracts page の plan visibility / premium comparison / read-only UI に関する実装ガイドを追加。
- 2026-04-08: Story 1.2 を実装し、contracts page の plan state 表示、free / premium 比較、read-only admin 表現、loading / intermediate state を更新した。
