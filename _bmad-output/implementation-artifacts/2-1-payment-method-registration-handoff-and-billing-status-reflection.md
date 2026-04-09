# Story 2.1: Payment Method Registration Handoff and Billing Status Reflection

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an organization owner,
I want to start payment method registration from the billing workspace and see whether it has been completed,
so that I can confidently prepare my organization for trial-to-paid conversion.

## Acceptance Criteria

1. valid な organization billing context を持つ owner が payment method 登録 action を開始したとき、system がその organization に紐づく Stripe-hosted handoff を作成し、正しい organization billing record と結びつけること。
2. non-owner が payment method 登録を開始しようとしたとき、backend が owner-only として拒否し、Stripe billing handoff が作成されないこと。
3. payment method 登録が provider flow で完了したあと billing state を再取得すると、organization billing summary が「登録済みかどうか」を曖昧さなく返し、owner が contracts page 上で判別できること。
4. owner が provider flow から戻った時点で webhook や同期処理がまだ settle していない場合、contracts page が「更新に少し時間がかかる場合がある」という intermediate status を示し、成功・失敗を早まって断定しないこと。

## Tasks / Subtasks

- [x] payment method registration handoff の責務境界を定義し、trial start / paid portal とは別の owner-only billing action として整理する (AC: 1, 2, 4)
  - [x] `apps/backend/src/routes/auth-routes.ts` の既存 `/billing` `/billing/checkout` `/billing/portal` `/billing/trial` を確認し、Story 2.1 の action をどこに追加するかを明確にする
  - [x] paid subscription checkout を「支払い方法登録だけ」の導線に流用するか、Stripe-hosted setup/handoff 用の dedicated action を追加するかを current Stripe helper から判断し、責務が曖昧にならない方を採る
  - [x] contracts page の owner billing workspace に action を集約し、新しい billing page や role 拡張を行わない

- [x] backend に owner-only payment method registration handoff action を追加し、正しい organization billing record と結びつける (AC: 1, 2)
  - [x] route layer で session / active organization / owner-only authz / request validation / provider error mapping を扱い、business denial と provider failure を分ける
  - [x] Stripe handoff 作成時は `organization_billing` の `stripeCustomerId` / `organizationId` / metadata を正本として使い、別 aggregate や classroom 単位課金を導入しない
  - [x] non-owner denial では `403` を返し、Stripe session や portal session が作られないことを integration test で固定する

- [x] payment method registration 状態を billing summary に反映できる source of truth を実装する (AC: 3, 4)
  - [x] current `organization_billing` schema と Stripe 取得情報で「登録済み」を安全に表現できるか確認し、不足している場合だけ summary shape と schema を拡張する
  - [x] redirect query string や local optimistic state だけで「登録済み」と判定しない。backend summary で確認できる状態を UI truth にする
  - [x] payment method completed / pending reflection が current `planState` / `subscriptionStatus` と混線しないよう、専用 field または明確な summary contract を導入する

- [x] contracts page と web helper を payment method registration handoff と status reflection に合わせて更新する (AC: 1, 3, 4)
  - [x] `apps/web/src/lib/rpc-client.ts` と `apps/web/src/lib/features/organization-context.svelte.ts` に owner-only handoff action と必要な summary field を追加する
  - [x] `apps/web/src/routes/contracts/+page.svelte` では free / premium_trial / premium_paid の lifecycle を崩さず、payment method 登録 action は Story 2.1 の対象 state にのみ表示する
  - [x] owner が provider flow から `success` / `cancel` で戻った場合も、summary refresh 前は intermediate message を表示し、summary で登録済みが確認できるまでは断定 copy を出さない
  - [x] read-only admin には payment method registration 状態の閲覧だけを許し、owner-only action button は表示しない

- [x] Stripe helper / backend summary shaping を current architecture に沿って整理する (AC: 1, 3, 4)
  - [x] `apps/backend/src/payment/stripe.ts` の既存 helper 群を再利用または必要最小限拡張し、route handler に Stripe form parameter 構築をべた書きしない
  - [x] billing summary response は contracts page が必要とする状態を返し、UI 側で Stripe status 生文字列や URL param を解釈し続けない
  - [x] payment method handoff と後続 webhook/sync story の境界を保ち、この story では「登録導線」と「現在見えている状態の反映」までに留める

- [x] regression test を追加・更新し、owner-only handoff と status reflection を固定する (AC: 1, 2, 3, 4)
  - [x] `apps/backend/src/app.test.ts` に owner successful handoff 作成、non-owner denial、summary への registration status reflection、return-before-settle intermediate handling に関する回帰ケースを追加する
  - [x] `apps/web/src/routes/contracts/page.svelte.spec.ts` に owner trial 中の payment method CTA、read-only admin の閲覧専用表示、registered / pending / returning intermediate の表示分岐を追加する
  - [x] helper 側に純粋な status mapping を切り出した場合のみ `apps/web/src/lib/features/*.spec.ts` を追加する

## Dev Notes

- Story 2.1 は「payment method を登録するための handoff を開始し、今どの状態かを contracts page に反映する」ことが責務である。trial-to-paid conversion 自体、trial end policy、webhook idempotency、reminder email は後続 story の責務に残す。
- current repo には owner-only premium trial action と paid portal action はあるが、payment method registration 専用の owner action と、その完了状態を summary へ返す contract はまだない。
- current `organization_billing` schema には `stripeCustomerId` / `stripeSubscriptionId` / `subscriptionStatus` / `currentPeriodStart` / `currentPeriodEnd` はあるが、payment method registration completed を直接表す field は存在しない。Story 2.1 では「何をもって登録済みとみなすか」を backend で明示する必要がある。
- contracts page はすでに `planState`, `trialEndsAt`, `canManageBilling`, `routeStatusNotice`, `localStatusNotice` を使って lifecycle と intermediate state を表示している。Story 2.1 ではこの仕組みを再利用し、return-from-provider ambiguity を減らす。
- Story 1.4 で owner-only billing authority と read-only admin wording が整備された。Story 2.1 でもその境界を崩さず、billing action を owner に閉じたまま status visibility だけを共有する。

### Technical Requirements

- payment method registration action は既存 auth routes 配下の billing namespace に置き、billing authority は `member.role === owner` に限定すること。 [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] [Source: apps/backend/src/routes/auth-routes.ts]
- organization billing の正本は `organization_billing` であり、payment method registration state も organization 単位で扱うこと。classroom 単位契約や別 billing aggregate を導入しない。 [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines] [Source: apps/backend/src/db/schema.ts]
- payment method registration completed の判定を `subscription=success` の URL param や local toast だけで確定しないこと。backend summary が返す状態を UI truth にすること。 [Source: _bmad-output/planning-artifacts/architecture.md#Loading State Patterns] [Source: apps/web/src/routes/contracts/+page.svelte]
- provider handoff は Stripe-hosted flow に閉じ、アプリ側でカード情報を保持しないこと。 [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- billing summary の response shape を拡張する場合は `apps/backend/src/routes/auth-routes.ts` の schema と `apps/web/src/lib/rpc-client.ts` / `organization-context.svelte.ts` を同時に更新し、UI と backend で別解釈を作らないこと。 [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]

### Architecture Compliance

- contracts page は owner billing workspace のまま拡張し、新しい billing 専用 page や parallel flow を増やさない。 [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- route layer は request validation / authz / response shaping に集中し、Stripe parameter 構築や billing reflection の詳細は helper/service 側へ寄せる。 [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- owner-only billing authority は backend と web の両方で強制する。UI でボタンを隠すだけにせず、backend denial を必ず実装・テストする。 [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- stale / eventual consistency は許容するが、UI では「反映待ち」と「登録済み」を混同させない。return 後の intermediate messaging を維持または改善する。 [Source: _bmad-output/planning-artifacts/architecture.md#Loading State Patterns]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 の既存構成を維持し、新規 billing framework は導入しない。 [Source: _bmad-output/project-context.md#Backend]
- Web は SvelteKit `2.50.1` + Svelte `5.48.2` の current page/feature helper pattern を維持し、新しい global state library は入れない。 [Source: _bmad-output/project-context.md#Web]
- Stripe integration は既存 `apps/backend/src/payment/stripe.ts` を正本にし、必要最小限の helper 追加で済ませる。 [Source: apps/backend/src/payment/stripe.ts]

### File Structure Requirements

- 主変更候補:
  - `apps/backend/src/routes/auth-routes.ts`
  - `apps/backend/src/payment/stripe.ts`
  - `apps/backend/src/app.test.ts`
  - 必要に応じて `apps/backend/src/db/schema.ts`
  - 必要に応じて `apps/backend/drizzle/00xx_*.sql`
  - `apps/web/src/lib/rpc-client.ts`
  - `apps/web/src/lib/features/organization-context.svelte.ts`
  - `apps/web/src/routes/contracts/+page.svelte`
  - `apps/web/src/routes/contracts/page.svelte.spec.ts`
- schema 拡張が不要なら migration を増やさない。一方で registration completed を安全に表現できないなら、heuristic を UI に押し込まず schema / summary contract を明示的に追加する。
- Web 側は `organization-context.svelte.ts` に fetch/action helper を置き、`contracts/+page.svelte` は presentation と interaction wiring に集中させる。 [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
  - `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`
- route 挙動と owner-only denial が変わるため、backend integration test を最優先にする。hand-off 作成成功、non-owner denial、summary reflection、intermediate return state を `apps/backend/src/app.test.ts` で固定する。 [Source: docs/test-strategy.md#Backend]
- `.svelte` の表示分岐と CTA visibility が変わるため、contracts page の browser test を更新する。owner trial 中 CTA、registered/pending/intermediate、read-only admin の表示差分を固定する。 [Source: docs/test-strategy.md#Web browser]
- helper 側に state mapping を切り出した場合のみ web server/feature test を追加する。UI 主体の分岐は browser test を優先する。 [Source: docs/test-strategy.md#Web server]
- migration / D1 schema 変更が入った場合は migration 前提の回帰ケースを backend integration test に追加する。 [Source: docs/test-strategy.md#Migration / D1 スキーマ変更]

### Previous Story Intelligence

- Story 1.2 で contracts page は `planState` / `trialEndsAt` を UI truth にした。Story 2.1 でも payment method registration 状態を `planCode` や redirect 結果だけで判定しない。
- Story 1.3 で owner-only `/billing/trial` mutation と contracts page の local/intermediate status notice が追加された。Story 2.1 は同じ contracts page status pattern を使って provider return ambiguity を扱う。
- Story 1.4 で owner-only billing authority と read-only admin wording が明確化された。Story 2.1 でも non-owner に billing action を広げず、「閲覧できるが操作できない」境界を維持する。

### Git Intelligence Summary

- 直近の relevant commits:
  - `6545eda chore(config): set Stripe billing catalog IDs`
  - `4d26c58 feat(contracts): add premium trial lifecycle UI`
  - `50e83bc feat(billing): add owner-only premium trials`
  - `2720193 feat(web): add route transition progress bar`
  - `46b99af feat(stripe): add billing catalog bootstrap script`
- guardrail:
  - Stripe billing catalog と existing subscription 基盤があるため、payment method registration も org-scoped billing model の延長で実装する
  - recent contracts page UX では intermediate message と role boundary を明示しているため、Story 2.1 でも redirect success を即時確定扱いしない
  - recent owner-only trial implementation と整合するよう、web affordance と backend denial を両方固定する

### Project Context Reference

- `display` 系フィールドを権限制御の根拠に使わず、`canManageBilling` と backend role policy を正本にする。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- staged migration 中の `authRpc` と Remote Functions の共存を壊さず、この story でも billing action は既存 `authRpc` パターンを維持する。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- `.svelte` の重要分岐を変えるときは browser test を省略しない。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]

### Project Structure Notes

- current `apps/backend/src/routes/auth-routes.ts` には `/billing/checkout` `/billing/portal` `/billing/trial` はあるが、payment method registration 専用 action はまだない。
- current `organization_billing` schema には `stripeCustomerId` と subscription lifecycle field はあるが、payment method registration completed を直接示す field はない。
- current `apps/web/src/routes/contracts/+page.svelte` には free owner の trial CTA、paid owner の portal CTA、read-only admin wording、`routeStatusNotice` / `localStatusNotice` がある。Story 2.1 はこの画面に payment method handoff と reflection を追加するのが自然である。
- current `apps/web/src/routes/contracts/page.svelte.spec.ts` は free / premium_trial / premium_paid / read-only admin / loading をすでにカバーしている。Story 2.1 ではこの suite を拡張し、payment method registration の表示差分を固定するのが最小コストである。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1]
- [Source: _bmad-output/planning-artifacts/prd.md#MVP - Minimum Viable Product]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 1: Owner / Operator - Happy Path]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 5: Billing Integration / Stripe Operational Flow]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Loading State Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]
- [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- [Source: docs/test-strategy.md#Backend]
- [Source: docs/test-strategy.md#Web server]
- [Source: docs/test-strategy.md#Web browser]
- [Source: apps/backend/src/routes/auth-routes.ts]
- [Source: apps/backend/src/payment/stripe.ts]
- [Source: apps/backend/src/db/schema.ts]
- [Source: apps/backend/src/app.test.ts]
- [Source: apps/web/src/lib/rpc-client.ts]
- [Source: apps/web/src/lib/features/organization-context.svelte.ts]
- [Source: apps/web/src/routes/contracts/+page.svelte]
- [Source: apps/web/src/routes/contracts/page.svelte.spec.ts]
- [Source: _bmad-output/implementation-artifacts/1-3-owner-trial-start-flow.md]
- [Source: _bmad-output/implementation-artifacts/1-4-trial-entry-ux-messaging-and-role-safe-access-boundaries.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Reviewed create-story workflow, sprint-status ordering, Epic 2 story definitions, PRD MVP/journey sections, architecture sections for auth/API/frontend/loading/enforcement, current billing route/schema/Stripe helper/contracts page/spec, and Story 1.3 / 1.4 implementation learnings.
- Confirmed current repo lacks a dedicated payment method registration action and a summary field that explicitly reflects registration completion, so Story 2.1 must define that contract clearly.
- Implemented a dedicated owner-only `/api/v1/auth/organizations/billing/payment-method` setup handoff, extended billing summary with `paymentMethodStatus`, and reused Stripe customer reflection instead of adding a schema migration.
- Updated contracts page owner/admin branches for payment-method registration visibility, intermediate provider-return messaging, and registered/pending status display.
- Validation: `pnpm --filter @apps/backend test`, `pnpm --filter @apps/backend typecheck`, `pnpm --filter @apps/web test`, `pnpm --filter @apps/web typecheck`, `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`, targeted backend/web `eslint`, Svelte autofixer on `contracts/+page.svelte`.

### Completion Notes List

- 2026-04-08: create-story workflow により Story 2.1 の包括的な実装コンテキストを作成し、owner-only payment method registration handoff・billing summary reflection・provider return intermediate messaging の guardrail を整理した。
- 2026-04-09: owner-only payment method registration handoff route を追加し、trial organization の Stripe customer 作成と setup checkout session 発行を backend で扱うようにした。
- 2026-04-09: billing summary に `paymentMethodStatus` を追加し、Stripe customer の default payment method から `not_started` / `pending` / `registered` を返すようにした。
- 2026-04-09: contracts page に trial 中の支払い方法登録 CTA、registered/pending status 表示、provider return 後の intermediate message、read-only admin 向け status visibility を追加した。
- 2026-04-09: backend integration test と contracts browser test を更新し、owner-only denial・status reflection・intermediate return messaging を固定した。

### File List

- _bmad-output/implementation-artifacts/2-1-payment-method-registration-handoff-and-billing-status-reflection.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/backend/src/routes/auth-routes.ts
- apps/backend/src/payment/stripe.ts
- apps/backend/src/app.test.ts
- apps/web/src/lib/rpc-client.ts
- apps/web/src/lib/features/organization-context.svelte.ts
- apps/web/src/routes/contracts/+page.svelte
- apps/web/src/routes/contracts/page.svelte.spec.ts

## Change Log

- 2026-04-08: Story 2.1 を新規作成し、payment method registration handoff と billing status reflection を contracts page / auth billing routes 中心で実装するための詳細ガイドを追加。
- 2026-04-09: owner-only payment method setup handoff、billing summary の paymentMethodStatus、contracts page の payment method status UX、対応する backend/browser regression test を実装。
