# Story 2.3: Stripe Webhook Normalization and Idempotent Billing Synchronization

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the billing platform,
I want Stripe subscription lifecycle events to be normalized and synchronized safely,
so that organization billing state remains correct even when provider events are duplicated or arrive out of order.

## Acceptance Criteria

1. supported な Stripe subscription lifecycle event を受信したとき、webhook verification 成功後に payload が normalize され、business state change は dedicated billing sync / service layer を通して適用されること。
2. 同じ Stripe event が複数回配送されたとき、system が event id を idempotency key として扱い、duplicate processing によって conflicting な organization billing state を作らないこと。
3. 関連 Stripe event が out-of-order で到着したとき、system が provider state と current app state を比較して正しい organization billing state に reconcile し、subscription lifecycle が恒久的に不整合なまま残らないこと。
4. webhook verification 失敗または provider data 不正時、unsafe な billing state change を commit せず、diagnosis または retry handling に使える failure record が残ること。

## Tasks / Subtasks

- [x] Stripe webhook billing sync の責務境界を整理し、`app.ts` の inline 分岐を service/helper 中心へ寄せる (AC: 1, 2, 3, 4)
  - [x] current `apps/backend/src/app.ts` の `/api/webhooks/stripe` 実装を確認し、organization billing webhook 処理を ticket purchase webhook 処理と分離できる構造へ整理する
  - [x] verification 済み event から business layer に渡す normalized DTO を定義し、raw Stripe payload の直接分岐を route/app layer に残しすぎない
  - [x] Story 2.2 の lifecycle evaluator / applier を再利用できるよう、trial/premium/free transition を dedicated billing sync/service layer から呼ぶ前提を固定する

- [x] supported Stripe subscription event を normalize して organization billing sync に流す (AC: 1, 3)
  - [x] `checkout.session.completed` による org billing seed と、`customer.subscription.created` / `updated` / `deleted` の lifecycle event を一貫した normalization path に載せる
  - [x] provider status (`trialing`, `active`, `past_due`, `unpaid`, `incomplete`, `canceled`) と app plan state (`free`, `premium_trial`, `premium_paid`) を混同せず、sync service 内で bridge する
  - [x] trial end 後の paid/free 確定は Story 2.2 の policy と矛盾しないようにし、必要に応じて webhook sync から同 evaluator を呼び出す

- [x] Stripe event id を使った idempotent processing を追加する (AC: 2)
  - [x] duplicate event delivery を DB-backed idempotency key で抑止し、in-memory flag や process-local cache に依存しない
  - [x] 同一 event 再送時も 2 回目以降の processing が organization billing を壊さず、safe/no-op になることを固定する
  - [x] idempotency の正本を持つ schema/table を追加する場合は migration を含め、billing row に無理に履歴を詰め込まない

- [x] out-of-order event に耐える reconciliation を入れる (AC: 3)
  - [x] newer app state を stale event で巻き戻さない guardrail を入れる
  - [x] event arrival order ではなく normalized provider lifecycle と current billing record の比較で state を決める
  - [x] provider payload だけでは不足する場合、Stripe object summary の再取得または current billing comparison を使い、順不同イベントでも最終状態を正しく寄せる

- [x] verification failure / invalid payload / unmatchable event の failure recording を追加する (AC: 4)
  - [x] signature verification failure は `400` で拒否し、unsafe commit を行わない
  - [x] parse 不能 payload、unsupported subscription payload、organization に紐づけられない event は failure record または diagnostic record を残し、silent success にしない
  - [x] retry や support diagnosis のため、failure reason・event id・event type・organization linkage の有無を後続 story で再利用しやすい形で残す

- [x] organization billing summary と current contracts workflow が sync 後 state を矛盾なく読めるようにする (AC: 1, 3)
  - [x] webhook sync 後の `planState`, `trialEndsAt`, `paymentMethodStatus`, `subscriptionStatus`, `billingInterval` が Story 2.1/2.2 の UI 前提と食い違わないようにする
  - [x] read-only admin/non-owner の権限境界は広げず、必要なら summary shaping のみを調整する
  - [x] contracts page wording 変更が不要なら web UI を触らず、backend summary contract の安定性を優先する

- [x] regression test を追加・更新し、webhook normalization / idempotency / reconciliation を固定する (AC: 1, 2, 3, 4)
  - [x] `apps/backend/src/app.test.ts` に duplicate subscription event、out-of-order event、invalid signature、invalid payload、unmatchable event のケースを追加する
  - [x] billing sync/service helper を新設した場合は、複雑分岐のみ近接 unit test を追加する
  - [x] schema migration を追加した場合は migration 前提の backend integration test を壊さないことを確認する

## Dev Notes

- Story 2.3 の主題は webhook verification 後の normalization / idempotent sync / reconciliation である。trial reminder email、notification history UI、support inspection UI は後続 story に残す。
- current repo では `apps/backend/src/app.ts` の `/api/webhooks/stripe` が `checkout.session.completed` と `customer.subscription.created|updated|deleted` を inline で処理し、organization billing の upsert を直接行っている。現状でも一部 duplicate-safe だが、event id による明示 idempotency、failure recording、out-of-order reconciliation の dedicated layer はまだない。
- Story 2.2 で `premium_trial` 完了時の paid/free policy が `auth-routes.ts` に集約された。Story 2.3 では webhook sync がその policy と競合しないことが重要であり、同じ lifecycle rule を別実装で複製しない。
- Stripe の公式 guidance では webhook delivery は duplicate や out-of-order を前提に扱い、event sequence に依存しすぎないことが重要である。必要なら current subscription object の正規化や再取得で reconciliation する前提を dev に明示する。
- current app は ticket purchase webhook も同じ `/api/webhooks/stripe` に載っているため、organization billing webhook 整理時に ticket purchase flow を壊さないことが必須である。

### Technical Requirements

- organization billing の正本は `organization_billing` とし、1 organization = 1 billing row を維持する。webhook sync でも classroom 単位課金や別 aggregate を作らない。 [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- plan lifecycle は `free -> premium_trial -> premium_paid` を app state として扱い、Stripe provider status は別レイヤーの state として bridge する。 [Source: _bmad-output/planning-artifacts/architecture.md#Decision Priority Analysis] [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- Stripe webhook は冪等・順不同耐性ありの同期パイプラインとして扱う。event order を前提に state machine を組まない。 [Source: _bmad-output/planning-artifacts/architecture.md#Decision Priority Analysis]
- duplicate event handling は process-local memory ではなく durable な idempotency record で扱う。もし current schema で表現できなければ migration を追加する。 [Source: _bmad-output/planning-artifacts/architecture.md#Recommended schema direction]
- verification failure / invalid payload / unmatched event は unsafe state change を避けた上で diagnosis/retry に使える形で記録する。 [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3]

### Architecture Compliance

- `app.ts` は webhook entrypoint / verification / coarse routing に集中し、billing lifecycle rule は dedicated sync/service helper に寄せる。 [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- Story 2.2 の trial completion evaluator を再利用可能な正本とし、webhook sync 側で paid/free transition rule を再実装しない。 [Source: _bmad-output/implementation-artifacts/2-2-trial-lifecycle-transition-policy.md]
- billing event / notification / entitlement change には監査可能な履歴を残す方針であり、MVP でも最低限の failure/event recording を入れる。 [Source: _bmad-output/planning-artifacts/architecture.md#Decision Priority Analysis]
- contracts UI の権限境界は owner-only authority を維持し、Story 2.3 で admin/staff に billing action を広げない。 [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 の既存構成を維持する。新規 dependency 追加は原則不要。 [Source: _bmad-output/project-context.md#Backend]
- Stripe helper は `apps/backend/src/payment/stripe.ts` を正本とし、signature verification / event parsing / subscription summary parsing の重複実装を増やさない。 [Source: apps/backend/src/payment/stripe.ts]
- schema 拡張が必要な場合は D1 migration を伴わせる。コードだけ先に `lastStripeEventId` 相当を仮定しない。 [Source: _bmad-output/project-context.md#開発ワークフロールール]

### File Structure Requirements

- 主変更候補:
  - `apps/backend/src/app.ts`
  - 必要に応じて `apps/backend/src/payment/stripe.ts`
  - 必要に応じて `apps/backend/src/db/schema.ts`
  - migration が必要なら `apps/backend/migrations/*`
  - `apps/backend/src/app.test.ts`
- event normalization / sync helper を切り出す場合は、既存 backend 構造に沿って `payment` または billing 用の近接 helper/module として追加し、`routes` と domain helper の責務分離を崩さない。
- web 変更が不要なら `apps/web` は触らない。summary contract が変わる場合のみ、影響範囲を最小にして `rpc-client` / feature / contracts page を整合させる。

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
- Story 2.3 の主力は backend integration test。duplicate subscription event、out-of-order event、invalid signature、invalid payload、unmatched event、trial completion evaluator との整合を `apps/backend/src/app.test.ts` で固定する。 [Source: docs/test-strategy.md#Backend]
- schema migration を追加した場合は migration 前提挙動を backend integration test で確認する。 [Source: docs/test-strategy.md#Migration / D1 スキーマ変更]
- `.svelte` を触らないなら browser test は原則不要。summary shape や contracts page の表示分岐を変えた場合のみ `apps/web/src/routes/contracts/page.svelte.spec.ts` を追加更新する。 [Source: docs/test-strategy.md#Web browser]

### Previous Story Intelligence

- Story 2.1 で org billing 向け payment method handoff と `paymentMethodStatus` summary が追加された。Webhook sync でも redirect param ではなく backend summary を正本にする前提は維持する。
- Story 2.2 で owner-only trial completion route と lifecycle evaluator が追加され、`registered` / unmet billing / temporary Stripe uncertainty を分ける guardrail が入った。Story 2.3 は webhook sync からその rule を安全に再利用する方向で設計すべきである。
- 既存 webhook 実装は `checkout.session.completed` で org billing row を `incomplete` seed し、`customer.subscription.created|updated|deleted` で直接 upsert している。ここを無批判に広げると trial completion policy と二重化するため、Story 2.3 では service/helper 化が必須である。

### Git Intelligence Summary

- 直近の relevant commits:
  - `be1cbbd feat(billing): add trial payment method registration`
  - `8202b6d chore(config): set Stripe billing catalog IDs`
  - `03f928f feat(contracts): add premium trial lifecycle UI`
  - `291f3f5 feat(billing): add owner-only premium trials`
  - `1677073 feat(web): add route transition progress bar`
- guardrail:
  - recent billing work は `auth-routes.ts` / `payment/stripe.ts` / `app.test.ts` に寄っているため、Story 2.3 でも同じ seam を優先する
  - billing sync は already shipped な checkout/session + subscription webhook path を壊さずに進化させる必要がある
  - webhook refactor で ticket purchase webhook を巻き込んで壊さないよう、billing webhook branch の責務だけを切り出す

### Latest Technical Notes

- Stripe docs では subscription integration で webhook endpoint を前提にし、subscription lifecycle は webhook で追跡することが推奨されている。`customer.subscription.created|updated|deleted` だけでなく、必要な downstream behavior に応じて event を選ぶ前提である。 [Source: https://docs.stripe.com/billing/subscriptions/overview]
- Stripe の guidance と support knowledge では webhook event order に依存しすぎず、必要なら latest subscription object を retrieve して current state と reconcile する方針が推奨されている。duplicate delivery も前提で扱う。 [Source: Stripe docs search knowledge gem, 2026-04-09]
- webhook signature verification failure は `400` で扱い、bad signature を business processing へ流さない実装が Stripe の sample/guide と整合する。 [Source: https://docs.stripe.com/billing/quickstart]

### Project Context Reference

- backend route 変更はまず `apps/backend/src/app.test.ts` の統合テストで守る。複数テーブルにまたがる sync は unit test だけで済ませない。 [Source: _bmad-output/project-context.md#テストルール]
- D1 schema 変更では migration・既存データ互換・統合テストを一緒に扱う。コードだけ先に合わせない。 [Source: _bmad-output/project-context.md#開発ワークフロールール]
- `display` 系フィールドを権限制御の根拠に使わず、billing authority の境界は backend role を正本にする。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]

### Project Structure Notes

- current `/api/webhooks/stripe` は `apps/backend/src/app.ts` にあり、ticket purchase webhook と organization billing webhook が同居している。
- current `apps/backend/src/payment/stripe.ts` には signature verification、basic event parse、checkout/session summary parse、subscription summary parse まではあるが、organization billing sync 専用の normalization/service layer はまだない。
- current `apps/backend/src/db/schema.ts` には webhook idempotency or failure recording 用の dedicated table はまだない。Story 2.3 で durable idempotency/failure record が必要なら migration 追加が自然である。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3]
- [Source: _bmad-output/planning-artifacts/prd.md#Trial Lifecycle]
- [Source: _bmad-output/planning-artifacts/prd.md#Billing State Synchronization & Reliability]
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision Priority Analysis]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- [Source: _bmad-output/project-context.md#テストルール]
- [Source: _bmad-output/project-context.md#開発ワークフロールール]
- [Source: docs/test-strategy.md#Backend]
- [Source: docs/test-strategy.md#Migration / D1 スキーマ変更]
- [Source: apps/backend/src/app.ts]
- [Source: apps/backend/src/payment/stripe.ts]
- [Source: apps/backend/src/db/schema.ts]
- [Source: apps/backend/src/app.test.ts]
- [Source: _bmad-output/implementation-artifacts/2-2-trial-lifecycle-transition-policy.md]
- [Source: https://docs.stripe.com/billing/subscriptions/overview]
- [Source: https://docs.stripe.com/billing/quickstart]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Reviewed create-story workflow, current sprint ordering, Epic 2 source, PRD trial/billing synchronization sections, architecture decision/data sections, Story 2.2 implementation notes, and current webhook code in `apps/backend/src/app.ts`.
- Confirmed current repo already verifies Stripe signatures and parses subscription summaries, but still processes organization billing webhook events inline in `app.ts` without durable idempotency or failure recording.
- Checked recent billing commits to preserve existing seams around `app.ts`, `payment/stripe.ts`, `auth-routes.ts`, and `app.test.ts`.
- Cross-checked Stripe official documentation/search results for webhook lifecycle guidance, duplicate delivery, verification handling, and the recommendation not to rely on webhook arrival order.
- Extracted shared organization billing lifecycle helpers into `apps/backend/src/billing/organization-billing.ts` so `auth-routes.ts` and webhook synchronization can reuse the same premium trial completion policy.
- Added `apps/backend/src/billing/stripe-webhook-sync.ts` to normalize supported billing events, persist DB-backed idempotency records, record diagnostic failures, and reconcile subscription lifecycle using the latest Stripe subscription summary.
- Added D1 schema support for durable webhook event/failure records in `apps/backend/src/db/schema.ts` and `apps/backend/drizzle/0013_stripe_webhook_sync.sql`, then expanded `apps/backend/src/app.test.ts` coverage for duplicate, out-of-order, invalid signature, invalid payload, and unmatched subscription events.
- 2026-04-09 review fix cycle: updated webhook claim/retry handling so failed idempotency rows can be reclaimed on Stripe redelivery, changed retryable organization billing sync failures to return `500` instead of silently acknowledging, and added a final catch path that marks claimed events as `failed` instead of leaving them stuck in `processing`.
- 2026-04-09 review fix cycle: expanded backend regression coverage for `subscription-before-checkout` replay, expired-trial completion still pending, and unexpected exceptions after event claim.

### Completion Notes List

- 2026-04-09: `app.ts` の organization billing webhook 分岐を dedicated billing sync layer に移し、ticket purchase webhook とは分離した。
- 2026-04-09: Stripe event id を durable idempotency key として保持する `stripe_webhook_event` と、診断用の `stripe_webhook_failure` を追加した。
- 2026-04-09: subscription webhook は latest Stripe subscription summary で reconcile する実装に変更し、stale event で newer billing state を巻き戻さないようにした。
- 2026-04-09: Story 2.2 の premium trial completion policy を webhook sync から再利用し、trial end 後の paid/free 決定ルールを二重化しない構造にした。
- 2026-04-09: 検証として `pnpm --filter @apps/backend test`、`pnpm --filter @apps/backend typecheck`、targeted backend `eslint`、`pnpm --filter @apps/web test`、`pnpm --filter @apps/web typecheck` を実行し、すべて成功した。
- 2026-04-09: review で見つかった 3 件の欠陥に対して、早着 subscription event を `200` で握り潰さず再試行可能に修正し、trial completion の非成功結果を `processed` 扱いしないようにし、予期しない例外時も idempotency row が `processing` のまま固着しないようにした。

### File List

- _bmad-output/implementation-artifacts/2-3-stripe-webhook-normalization-and-idempotent-billing-synchronization.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/backend/drizzle/0013_stripe_webhook_sync.sql
- apps/backend/src/app.ts
- apps/backend/src/app.test.ts
- apps/backend/src/billing/organization-billing.ts
- apps/backend/src/billing/stripe-webhook-sync.ts
- apps/backend/src/db/schema.ts
- apps/backend/src/payment/stripe.ts
- apps/backend/src/routes/auth-routes.ts

## Change Log

- 2026-04-09: Story 2.3 を新規作成し、Stripe webhook normalization / idempotent billing synchronization の実装ガイドを追加。
- 2026-04-09: organization billing webhook sync を service/helper 化し、latest subscription reconciliation・durable idempotency・failure recording を実装。
- 2026-04-09: review fix cycle で retryable webhook failure を `500` 応答へ変更し、failed event 再クレーム・trial completion pending guard・unexpected exception fallback を追加。
