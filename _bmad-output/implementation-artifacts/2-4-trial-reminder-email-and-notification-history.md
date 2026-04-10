# Story 2.4: Trial Reminder Email and Notification History

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an organization owner,
I want to receive a clear reminder before trial end,
so that I know when premium access will change and what action I need to take.

## Acceptance Criteria

1. `premium_trial` の organization に対して `customer.subscription.trial_will_end` lifecycle event が処理されたとき、system は trial end の 3 日前 reminder を owner 向けに送信または送信要求できること。
2. reminder email は payment method registration を完了する導線を含み、trial 終了日時と、何もしない場合に free へ戻る可能性があることを current billing context に沿って明確に説明すること。
3. reminder の send attempt が成功・失敗・再試行になったとき、system は billing-related notification history を append-only に記録し、後続の監査または support inspection に使えること。
4. email delivery が transient に失敗した場合でも silent success にせず、retry と final outcome が観測可能であり、unsafe な billing lifecycle change を発生させないこと。

## Tasks / Subtasks

- [x] `customer.subscription.trial_will_end` を organization billing reminder flow に接続する (AC: 1, 4)
  - [x] `apps/backend/src/app.ts` の Stripe webhook entrypoint から billing webhook sync/service へ `customer.subscription.trial_will_end` を流せるようにする
  - [x] Story 2.3 の normalized billing sync path を再利用し、trial reminder だけ別の inline 分岐として route layer に増やしすぎない
  - [x] duplicate delivery や retry に備え、同じ reminder intent が重複送信されない guardrail を入れる

- [x] owner 向け trial reminder email の compose/send を追加する (AC: 1, 2, 4)
  - [x] owner の user/email を organization membership から解決し、admin/member/participant へ誤送信しない
  - [x] existing `apps/backend/src/email/resend.ts` + `apps/backend/src/email/templates/*` のパターンに沿って reminder template を追加する
  - [x] reminder 文面には trial end timing、payment method registration への導線、no action 時の consequence を current billing state に沿って含める
  - [x] `WEB_BASE_URL` など既存 env から contracts/billing completion 導線 URL を組み立て、固定 URL を埋め込まない

- [x] billing notification history を append-only で記録する (AC: 3, 4)
  - [x] mutable な `organization_billing` summary に reminder outcome を詰め込まず、`organization_billing_notification` 相当の dedicated table を追加する
  - [x] notification history には少なくとも organization linkage、notification kind、attempt/result、provider event id または dedupe context、timestamp、失敗理由を残す
  - [x] Story 4.2 の internal inspection で再利用できるよう、requested / sent / retried / failed を区別できる状態モデルにする

- [x] retry-aware な send flow と failure handling を整える (AC: 3, 4)
  - [x] Resend success / failure / config不足 / transient failure を notification history 上で区別し、silent skip にしない
  - [x] reminder send failure が organization の plan state や entitlement を誤って変更しないよう、billing lifecycle update と notification outcome を分離する
  - [x] retry policy を実装する場合は process-local memory に依存せず、履歴または idempotency 情報と整合する形にする

- [x] Story 2.1-2.3 の billing context と contracts workflow に矛盾しない reminder 文脈を保つ (AC: 1, 2, 3)
  - [x] `planState`, `trialEndsAt`, `paymentMethodStatus`, `subscriptionStatus` を UI truth / billing truth として再利用し、`planCode` だけで文面分岐しない
  - [x] reminder 対象は `premium_trial` organization に限定し、already paid / free fallback / canceled に誤送信しない
  - [x] Story 4.2/4.4 の support surface を先取りして UI を作らず、この story では backend reminder + history の正本整備に集中する

- [x] regression test を追加・更新して reminder/historical behavior を固定する (AC: 1, 2, 3, 4)
  - [x] `apps/backend/src/app.test.ts` に `customer.subscription.trial_will_end` 成功送信、重複イベント抑止、owner 解決、transient failure、history 記録のケースを追加する
  - [x] reminder template / email helper に複雑分岐がある場合のみ近接 unit test を追加する
  - [x] web UI を触らないなら web browser test は不要とし、summary contract を変える場合のみ web test を更新する

## Dev Notes

- Story 2.4 の中心は owner reminder email と append-only notification history である。support 向け inspection UI や mismatch diagnosis UI は後続 story に残す。
- Story 2.3 で Stripe webhook normalization と idempotent billing sync が整ったため、Story 2.4 はその seam に `customer.subscription.trial_will_end` を追加する形が自然である。
- current `apps/backend/src/email/resend.ts` の invitation / booking notification helpers は config 不足時に warn して return する best-effort 方式を持つが、billing reminder では silent success 扱いにしないことが重要である。通知履歴に outcome が残らない形は避ける。
- current repo には billing notification history table はまだなく、Story 2.5 / 4.2 が後続でその履歴を参照する。Story 2.4 の schema は後続 story が inspection しやすい append-only shape を意識する必要がある。

### Technical Requirements

- organization billing の正本は引き続き `organization_billing` とし、reminder outcome は別の append-only table へ分離する。 [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- plan lifecycle は `free -> premium_trial -> premium_paid` を app state として扱い、reminder 対象判定も `planState` / `trialEndsAt` / `paymentMethodStatus` と整合させる。 [Source: _bmad-output/planning-artifacts/architecture.md#Decision Priority Analysis]
- owner reminder は `customer.subscription.trial_will_end` を起点にしつつ、duplicate delivery / retry / out-of-order を前提に safe に扱う。 [Source: _bmad-output/planning-artifacts/architecture.md#External Integrations]
- notification history は append-only とし、requested / sent / retried / failed の遷移を後続 story から監査可能にする。 [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4] [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5]
- environment-driven URL と Resend 設定値を使い、trial reminder に必要な app URL / portal return URL をハードコードしない。 [Source: _bmad-output/planning-artifacts/architecture.md#Environment configuration]

### Architecture Compliance

- `app.ts` は webhook verification / coarse routing に集中し、trial reminder の業務分岐は billing sync/service または近接 helper に寄せる。 [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- Billing service -> email sender -> notification history append の連携を維持し、route から Resend を直接呼び出しすぎない。 [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points]
- auditability と reminder reliability を優先し、silent success を避ける。 [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]
- owner-only authority を守り、admin/member/participant に billing action 権限や通知対象を広げない。 [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 の既存構成を維持する。新規 dependency 追加は原則不要。 [Source: _bmad-output/project-context.md#Backend]
- Email 送信は existing `apps/backend/src/email/resend.ts` と React Email template パターンを正本とする。 [Source: apps/backend/src/email/resend.ts]
- Stripe parsing / webhook event 読み出しは `apps/backend/src/payment/stripe.ts` を正本とし、trial reminder event でも重複実装を増やさない。 [Source: apps/backend/src/payment/stripe.ts]
- schema 拡張が必要な場合は D1 migration を伴わせる。notification history をコードだけで仮定しない。 [Source: _bmad-output/project-context.md#開発ワークフロールール]

### File Structure Requirements

- 主変更候補:
  - `apps/backend/src/app.ts`
  - `apps/backend/src/billing/stripe-webhook-sync.ts`
  - `apps/backend/src/billing/organization-billing.ts` または近接 billing notification helper
  - `apps/backend/src/email/resend.ts`
  - `apps/backend/src/email/templates/*`
  - `apps/backend/src/db/schema.ts`
  - `apps/backend/drizzle/*`
  - `apps/backend/src/app.test.ts`
- notification history helper を切り出す場合は、billing domain に近い module に置き、`routes` / `email` / `billing sync` の責務が混ざりすぎないようにする。
- web UI 変更は原則不要。contracts page に reminder 状態を出す必要が明確になった場合のみ、影響範囲を最小にして `apps/web` を更新する。

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
- Story 2.4 の主力は backend integration test。`customer.subscription.trial_will_end` の成功、duplicate webhook、owner resolve、Resend failure、notification history append を `apps/backend/src/app.test.ts` で固定する。 [Source: docs/test-strategy.md#Backend]
- schema migration を追加した場合は migration 前提挙動を backend integration test で確認する。 [Source: docs/test-strategy.md#Migration / D1 スキーマ変更]
- `.svelte` を触らないなら browser test は原則不要。UI 分岐を増やした場合のみ `apps/web/src/routes/contracts/page.svelte.spec.ts` などを更新する。 [Source: docs/test-strategy.md#Web browser]

### Previous Story Intelligence

- Story 2.1 で payment method handoff と `paymentMethodStatus` summary が追加された。reminder 文脈でも redirect param ではなく backend billing summary を正本にする前提は維持する。
- Story 2.2 で premium trial completion policy が `auth-routes.ts` / shared billing helper に集約された。reminder はその paid/free decision rule を変えず、owner が事前に行動できる導線提供に徹するべきである。
- Story 2.3 で webhook normalization、idempotent event handling、failure recording が追加された。Story 2.4 は同じ webhook sync seam を拡張し、retryable notification failure を silent success にしない方向で実装するのが自然である。
- Story 2.3 review fix では failed idempotency row の再クレームと retryable failure の `500` 応答が入った。trial reminder でも duplicate delivery と transient failure を前提に、再試行可能な failure と最終 outcome を明確に分ける必要がある。

### Git Intelligence Summary

- 直近の relevant commits:
  - `d0d0e34 feat: webhookの実装`
  - `be1cbbd feat(billing): add trial payment method registration`
  - `8202b6d chore(config): set Stripe billing catalog IDs`
  - `03f928f feat(contracts): add premium trial lifecycle UI`
  - `291f3f5 feat(billing): add owner-only premium trials`
- guardrail:
  - recent billing work は `app.ts` / `billing` helper / `payment/stripe.ts` / `app.test.ts` に寄っているため、Story 2.4 でも同じ seam を優先する
  - email 送信は既存 `resend.ts` と template 配置に揃え、billing reminder だけ別送信スタックを作らない
  - notification history は後続 story で internal inspection に使われるため、今の段階で UI に寄せず backend append-only record を正本にする

### Latest Technical Notes

- Epics では reminder は `customer.subscription.trial_will_end` を起点に owner へ送る設計であり、3 日前 reminder と payment method registration 導線が必須である。 [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4]
- Architecture では reminder scheduling/sending、notification history、retry-aware recording を monitoring / cross-cutting concern として明示している。 [Source: _bmad-output/planning-artifacts/architecture.md#Environment configuration] [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]
- `customer.subscription.trial_will_end` と notification history / retry policy の詳細は implementation で詰める必要がある、と architecture gap に明記されている。 [Source: _bmad-output/planning-artifacts/architecture.md#Gap Analysis Results]

### Project Context Reference

- backend route 変更はまず `apps/backend/src/app.test.ts` の統合テストで守る。複数テーブルにまたがる通知履歴や webhook 処理は unit test だけで済ませない。 [Source: _bmad-output/project-context.md#テストルール]
- D1 schema 変更では migration・既存データ互換・統合テストを一緒に扱う。 [Source: _bmad-output/project-context.md#開発ワークフロールール]
- 環境変数、Resend、Stripe の設定値は app README や既存 env contract を正本とし、名前や前提を推測で変更しない。 [Source: _bmad-output/project-context.md]

### Project Structure Notes

- current `/api/webhooks/stripe` は `apps/backend/src/app.ts` にあり、ticket purchase webhook と organization billing webhook が同居している。
- current `apps/backend/src/billing/stripe-webhook-sync.ts` は subscription lifecycle sync と failure recording を持つが、trial reminder / notification history はまだ実装していない。
- current `apps/backend/src/email/resend.ts` には invitation / booking email の helper があり、template は `apps/backend/src/email/templates/` に置かれている。
- current schema には `organization_billing_notification` 相当の dedicated notification history table はまだない。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5]
- [Source: _bmad-output/planning-artifacts/architecture.md#Environment configuration]
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision Impact Analysis]
- [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points]
- [Source: _bmad-output/planning-artifacts/architecture.md#Gap Analysis Results]
- [Source: _bmad-output/project-context.md]
- [Source: docs/test-strategy.md#Backend]
- [Source: docs/test-strategy.md#Migration / D1 スキーマ変更]
- [Source: apps/backend/src/app.ts]
- [Source: apps/backend/src/billing/stripe-webhook-sync.ts]
- [Source: apps/backend/src/email/resend.ts]
- [Source: apps/backend/src/payment/stripe.ts]
- [Source: apps/backend/src/db/schema.ts]
- [Source: _bmad-output/implementation-artifacts/2-3-stripe-webhook-normalization-and-idempotent-billing-synchronization.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Loaded `bmad-create-story` workflow and current sprint tracking, then selected the first backlog story in order: `2-4-trial-reminder-email-and-notification-history`.
- Reviewed Epic 2 story definitions and FR23-FR28 context to capture trial reminder, payment-method CTA, consequence messaging, and notification history requirements.
- Reviewed Story 2.3 implementation notes to inherit the new webhook normalization seam, idempotent processing behavior, and retryable failure handling.
- Inspected current backend seams in `app.ts`, `billing/stripe-webhook-sync.ts`, `payment/stripe.ts`, `email/resend.ts`, `email/templates/*`, and `db/schema.ts` to anchor file targets and guardrails in the story.
- Reviewed architecture/test-strategy context for environment-driven URLs, Resend integration, append-only notification history, and backend-integration-first testing.

### Completion Notes List

- 2026-04-09: Created Story 2.4 as a dedicated implementation artifact for trial reminder email and billing notification history.
- 2026-04-09: Anchored the story on the existing webhook sync + Resend + append-only schema direction, with explicit guardrails against silent email failure and incorrect non-owner targeting.
- 2026-04-09: Updated sprint tracking so Story 2.4 is `ready-for-dev`.
- 2026-04-09: Added `customer.subscription.trial_will_end` handling to the normalized billing webhook sync path and kept duplicate/retry behavior inside the existing idempotent event-processing seam.
- 2026-04-09: Added a dedicated append-only `organization_billing_notification` table plus reminder send/history helpers so requested, sent, retried, and failed outcomes are persisted separately from mutable billing summary state.
- 2026-04-09: Added owner-only trial reminder email composition and delivery with environment-driven contracts URL generation and explicit failure handling for Resend config/delivery issues.
- 2026-04-09: Added backend integration coverage for successful reminder delivery, duplicate webhook suppression, and retryable reminder delivery failure with Stripe redelivery recovery.
- 2026-04-09: Applied review fixes so transport-level Resend failures remain retryable, registered-payment-method reminders use non-misleading copy, and notification history ordering is stabilized with a durable sequence number.

### File List

- _bmad-output/implementation-artifacts/2-4-trial-reminder-email-and-notification-history.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/backend/src/billing/stripe-webhook-sync.ts
- apps/backend/src/billing/organization-billing-notifications.ts
- apps/backend/src/db/schema.ts
- apps/backend/drizzle/0014_organization_billing_notifications.sql
- apps/backend/src/email/resend.ts
- apps/backend/src/email/templates/trial-ending-reminder-email.tsx
- apps/backend/src/app.test.ts

## Change Log

- 2026-04-09: Story 2.4 created and moved to `ready-for-dev`.
- 2026-04-09: Implemented owner-only trial reminder email delivery, append-only billing notification history, and webhook retry-safe reminder handling; moved story to `review`.
- 2026-04-09: Fixed review findings around retry classification, registered-state reminder messaging, and deterministic notification-history ordering.
