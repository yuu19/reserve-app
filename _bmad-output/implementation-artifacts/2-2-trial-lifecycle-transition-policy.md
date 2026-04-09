# Story 2.2: Trial Lifecycle Transition Policy

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an organization owner,
I want the system to apply correct trial completion rules,
so that my organization moves cleanly to paid or back to free at trial end.

## Acceptance Criteria

1. `premium_trial` の organization で trial completion 条件が満たされるとき、system が organization を `premium_paid` に遷移させ、Premium access が途切れず継続すること。
2. `premium_trial` の organization で trial end 時点の billing 条件が満たされないとき、system が organization を `free` に戻し、premium entitlement が一貫して外れること。
3. organization が `free` / `premium_trial` / `premium_paid` を行き来しても、organization data と既存の operational setup は保持され、plan/billing/entitlement 関連 field のみが更新されること。
4. current lifecycle に対して無効な transition request を行ったとき、system が clear な conflict または validation error を返し、既存 billing state を変更しないこと。

## Tasks / Subtasks

- [x] trial completion policy の責務境界を定義し、後続 webhook story でも再利用できる lifecycle evaluator として整理する (AC: 1, 2, 4)
  - [x] `apps/backend/src/routes/auth-routes.ts` の current billing flow と Story 2.1 の `paymentMethodStatus` 反映を確認し、trial 完了判定を ad hoc route logic に埋め込まない方針を明記する
  - [x] transition 条件を「current state」「payment method registration state」「trial timing」の組み合わせで定義し、Stripe provider status の単純文字列分岐だけに依存しない
  - [x] Story 2.3 の webhook normalization から再利用できるよう、transition rule を helper/service 相当の一箇所へ集約する

- [x] backend に trial lifecycle transition evaluator / applier を追加し、paid 継続と free fallback の両方を扱う (AC: 1, 2, 3, 4)
  - [x] `premium_trial` かつ paid 継続条件を満たす場合は `premium_paid` へ遷移し、必要な billing field を paid lifecycle と整合する形で更新する
  - [x] `premium_trial` かつ billing 条件未達の場合は `free` へ戻し、premium entitlement に関連する field を安全にクリアまたは downgrade 後の正しい state に更新する
  - [x] `organization_billing` 以外の org/classroom/service/booking データを変更しないことを regression test で固定する

- [x] invalid lifecycle transition を拒否し、clear な conflict/validation response を返す (AC: 4)
  - [x] free または premium_paid state に対する trial completion request を `409` もしくは設計済み conflict error で拒否する
  - [x] 既に確定した state へ重複遷移しようとした場合も state を変更せず、既存値を保持する
  - [x] future webhook story のために error message と response shape を backend/web/tests で別解釈しない

- [x] current billing summary / contracts page が transition 後 state を曖昧なく反映できるよう整える (AC: 1, 2, 3)
  - [x] `apps/backend/src/routes/auth-routes.ts` の summary shaping で `premium_paid` / `free` への遷移結果が `planState`, `trialEndsAt`, `paymentMethodStatus`, `subscriptionStatus` に矛盾なく出るようにする
  - [x] contracts page が既存 summary refresh だけで post-transition state を説明できるか確認し、不足がある場合のみ `apps/web/src/routes/contracts/+page.svelte` の wording を最小限更新する
  - [x] read-only admin / non-owner には transition 操作を広げず、状態表示だけが必要に応じて追従するようにする

- [x] Story 2.1 の payment method registration state を transition policy の入力として安全に使う (AC: 1, 2)
  - [x] `paymentMethodStatus === 'registered'` を paid 継続条件の主要入力として扱い、redirect param や local UI 状態を transition 判定に使わない
  - [x] Stripe customer reflection が一時的に stale な場合でも、invalid paid transition や premature downgrade を避ける guardrail を決める
  - [x] もし schema/helper 拡張が必要でも、migration なし前提コードや UI heuristics を先行させない

- [x] regression test を追加・更新し、trial end transition policy と data preservation を固定する (AC: 1, 2, 3, 4)
  - [x] `apps/backend/src/app.test.ts` に paid 継続・free fallback・invalid current state conflict・duplicate transition rejection を追加する
  - [x] org/classroom/service/booking などの operational data が transition 前後で保持されることを backend integration test で確認する
  - [x] contracts page の wording を変えた場合のみ `apps/web/src/routes/contracts/page.svelte.spec.ts` を更新し、post-transition state の説明と read-only boundary を固定する

## Dev Notes

- Story 2.2 は「trial が終わるとどう state を確定させるか」の policy story である。Stripe webhook normalization、idempotency、trial reminder email、notification history は後続 story に残す。
- Story 2.1 により `paymentMethodStatus` が billing summary に追加され、trial organization に対して `not_started` / `pending` / `registered` を返せるようになった。Story 2.2 はこの field を transition 条件の主要入力として再利用する。
- current repo には trial start と payment method registration handoff はあるが、「trial completion を評価して paid / free を確定させる」明示的な lifecycle evaluator はまだない。
- architecture では lifecycle transition rules を route handler に散らさず、billing application service に集約することが求められている。Story 2.2 はこの方向へ寄せる最初の story と考える。
- downgrade 時も organization data / classroom setup / booking data は保持する必要がある。変更対象は billing/plan/entitlement 関連 field に限定し、破壊的な cleanup を入れない。

### Technical Requirements

- trial completion policy は既存 auth routes 配下の billing namespace とその helper/service で扱い、新しい billing app host や別 aggregate を導入しない。 [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- organization billing の正本は `organization_billing`。trial end transition でも classroom 単位課金や別 state store を作らない。 [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines] [Source: apps/backend/src/db/schema.ts]
- paid 継続条件には Story 2.1 の `paymentMethodStatus` を使うが、provider status 単純分岐に戻さない。trial timing と current lifecycle を含めた明示 policy として扱う。 [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples] [Source: apps/backend/src/routes/auth-routes.ts]
- invalid transition は `409` / `422` で拒否し、state を変更しない。business denial と provider/infrastructure failure を分けること。 [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- downgrade / conversion 後の summary は contracts page がそのまま使える shape を維持し、`planState`, `trialEndsAt`, `paymentMethodStatus`, `subscriptionStatus` の意味が食い違わないこと。 [Source: apps/backend/src/routes/auth-routes.ts] [Source: apps/web/src/routes/contracts/+page.svelte]

### Architecture Compliance

- route layer は request validation / authz / response shaping に集中し、trial completion rule は helper/service 側へ寄せる。 [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- premium entitlement 判定と lifecycle transition を provider status の単純 if 文にばらまかない。明示 policy として一箇所に集約する。 [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- Story 2.3 の webhook sync から再利用できる transition evaluator を意識し、今回の storyだけの ad hoc API に閉じない。 [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]
- contracts page は current owner billing workspace のまま使い、read-only admin/non-owner の権限境界を広げない。 [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 の既存構成を維持し、新規 dependency 追加は不要。 [Source: _bmad-output/project-context.md#Backend]
- Web は SvelteKit `2.50.1` + Svelte `5.48.2` + current `organization-context.svelte.ts` / `contracts/+page.svelte` パターンを維持する。 [Source: _bmad-output/project-context.md#Web]
- Stripe helper は既存 `apps/backend/src/payment/stripe.ts` と Story 2.1 の customer/payment-method reflection を正本にし、重複 helper を増やさない。 [Source: apps/backend/src/payment/stripe.ts]

### File Structure Requirements

- 主変更候補:
  - `apps/backend/src/routes/auth-routes.ts`
  - 必要に応じて `apps/backend/src/payment/stripe.ts`
  - `apps/backend/src/app.test.ts`
  - 必要に応じて `apps/web/src/lib/rpc-client.ts`
  - 必要に応じて `apps/web/src/lib/features/organization-context.svelte.ts`
  - 必要に応じて `apps/web/src/routes/contracts/+page.svelte`
  - 必要に応じて `apps/web/src/routes/contracts/page.svelte.spec.ts`
- schema 変更が不要なら migration を増やさない。Story 2.2 の主眼は transition policy であり、新しい billing table を作ることではない。
- transition evaluator を helper/service 化する場合でも、既存 `routes` / `payment` / `db` の責務分離を崩さない。 [Source: _bmad-output/project-context.md#コード品質・スタイルルール]

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
  - wording を変えた場合のみ `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`
- Story 2.2 は lifecycle policy が主題のため、backend integration test を最優先にする。paid 継続、free fallback、invalid state conflict、duplicate transition rejection を `apps/backend/src/app.test.ts` で固定する。 [Source: docs/test-strategy.md#Backend]
- data preservation は unit test ではなく API/integration test で確認する。organization/classroom/service/booking の主要 record が transition 前後で壊れていないことを見せる。 [Source: docs/test-strategy.md#Backend]
- contracts page wording を変えた場合は browser test で post-transition state の表示分岐と owner/read-only 差分を固定する。 [Source: docs/test-strategy.md#Web browser]

### Previous Story Intelligence

- Story 2.1 で `/api/v1/auth/organizations/billing/payment-method` と `paymentMethodStatus` が追加され、trial 継続準備の state を contracts page で見られるようになった。Story 2.2 はその state を trial completion policy の入力として再利用する。
- Story 2.1 は schema migration を増やさず、Stripe customer の default payment method から `registered` を判断した。Story 2.2 でも redirect param や local message ではなく backend summary を正本にする。
- Story 1.3 / 1.4 ですでに owner-only trial lifecycle UX と read-only admin boundary が整理されている。Story 2.2 でも transition 操作を non-owner に広げない。

### Git Intelligence Summary

- 直近の relevant commits:
  - `be1cbbd feat(billing): add trial payment method registration`
  - `8202b6d chore(config): set Stripe billing catalog IDs`
  - `03f928f feat(contracts): add premium trial lifecycle UI`
  - `291f3f5 feat(billing): add owner-only premium trials`
  - `1677073 feat(web): add route transition progress bar`
- guardrail:
  - recent billing workは auth routes と Stripe helper に寄せているため、trial completion policy も同じ seams に揃える
  - payment method registration は既に org-scoped trial state に結びついているため、Story 2.2 ではそこから paid/free を確定する rule を明示する
  - contracts page は already intermediate status を持つので、post-transition wording が必要でも minimal update に留める

### Project Context Reference

- `display` 系フィールドを権限制御の根拠に使わず、backend role / explicit permission field を正本にする。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- staged migration 中の `authRpc` と Remote Functions の共存を壊さず、この story でも billing action/sync は current auth route pattern を維持する。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- `.svelte` の重要分岐を変える場合は browser test を省略しない。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]

### Project Structure Notes

- current `apps/backend/src/routes/auth-routes.ts` には trial start、payment method handoff、billing summary はあるが、trial completion evaluator / transition applier はまだない。
- current summary には `paymentMethodStatus` が含まれるため、Story 2.2 ではこの field を transition decision の入力として扱うのが自然である。
- current contracts page は free / premium_trial / premium_paid と payment method registration 状態を表示できる。Story 2.2 は backend policy が主であり、web 変更は必要最小限になる可能性が高い。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2]
- [Source: _bmad-output/planning-artifacts/prd.md#MVP - Minimum Viable Product]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 1: Owner / Operator - Happy Path]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 2: Owner / Operator - Edge Case / Recovery Path]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 5: Billing Integration / Stripe Operational Flow]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Loading State Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]
- [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- [Source: _bmad-output/project-context.md#コード品質・スタイルルール]
- [Source: docs/test-strategy.md#Backend]
- [Source: docs/test-strategy.md#Web browser]
- [Source: apps/backend/src/routes/auth-routes.ts]
- [Source: apps/backend/src/payment/stripe.ts]
- [Source: apps/backend/src/db/schema.ts]
- [Source: apps/backend/src/app.test.ts]
- [Source: apps/web/src/lib/rpc-client.ts]
- [Source: apps/web/src/lib/features/organization-context.svelte.ts]
- [Source: apps/web/src/routes/contracts/+page.svelte]
- [Source: apps/web/src/routes/contracts/page.svelte.spec.ts]
- [Source: _bmad-output/implementation-artifacts/2-1-payment-method-registration-handoff-and-billing-status-reflection.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Reviewed create-story workflow, current sprint ordering, Epic 2 source, PRD MVP/journey sections, architecture sections for auth/API/frontend/loading/enforcement, current Story 2.1 implementation notes, and latest billing commits.
- Confirmed current repo now has trial start and payment method registration handoff plus `paymentMethodStatus`, but still lacks an explicit trial completion evaluator / transition applier.
- Added an owner-only `/api/v1/auth/organizations/billing/trial/complete` route and centralized transition logic in `apps/backend/src/routes/auth-routes.ts` so webhook work can reuse the same evaluator later.
- Refactored payment-method reflection into a richer evaluation helper that distinguishes `registered`, true unmet billing conditions, and temporary Stripe sync failure without adding schema migrations.
- Added backend integration coverage for paid conversion, free fallback, invalid current state rejection, duplicate completion rejection, sync-pending guardrail, and operational data preservation.

### Implementation Plan

- Keep the route layer thin: validate session/org/owner authority and delegate trial-end decision making to a single lifecycle helper.
- Reuse Story 2.1 payment-method reflection semantics as transition input, but distinguish missing payment method from temporary Stripe lookup failure.
- Preserve non-billing organization data by limiting writes to `organization_billing` fields only and proving that with API-level integration tests.

### Completion Notes List

- 2026-04-09: create-story workflow により Story 2.2 の包括的な実装コンテキストを作成し、trial completion policy・paid/free transition 条件・data preservation・invalid transition guardrail を整理した。
- 2026-04-09: owner-only trial completion endpoint を追加し、`premium_trial` の終了時点に `registered` なら `premium_paid`、未達なら `free` へ遷移する evaluator / applier を `auth-routes.ts` に集約した。
- 2026-04-09: Stripe 反映が一時的に不確定なときは `503` で state を保持する guardrail を追加し、premature downgrade を防いだ。
- 2026-04-09: backend integration test で paid conversion・free fallback・invalid state conflict・duplicate rejection・operational data preservation を固定し、backend/web の required validation を通した。

### File List

- _bmad-output/implementation-artifacts/2-2-trial-lifecycle-transition-policy.md
- apps/backend/src/routes/auth-routes.ts
- apps/backend/src/app.test.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-04-09: Story 2.2 を新規作成し、trial lifecycle transition policy を backend lifecycle evaluator 中心で実装するための詳細ガイドを追加。
- 2026-04-09: trial completion evaluator と owner-only completion route を追加し、paid/free transition policy と関連 integration test を実装。
