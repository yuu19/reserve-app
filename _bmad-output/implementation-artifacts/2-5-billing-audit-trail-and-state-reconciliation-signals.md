# Story 2.5: Billing Audit Trail and State Reconciliation Signals

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the product team,
I want billing transitions and Stripe/app mismatches to be recorded explicitly,
so that the system remains auditable and recoverable when lifecycle issues occur.

## Acceptance Criteria

1. billing state または entitlement state が変更されたとき、system は previous state / next state / source context を含む append-only audit event を記録できること。
2. audit event は organization と、取得可能であれば Stripe customer / subscription / event identifier に結びつけられること。
3. billing-related owner notification が requested / sent / retried / failed になったとき、system は mutable billing summary state とは別に append-only history を保持し続けること。
4. Stripe provider state と application billing state が一致しない場合、synchronization または status evaluation は mismatch を検出し、後続 investigation / resync に必要な signal を記録できること。
5. Stripe 一時障害や synchronization failure が発生した場合でも、system は unsafe な billing mutation を避け、recoverable な application state と traceable signal を残すこと。

## Tasks / Subtasks

- [x] billing / entitlement transition の append-only audit trail を追加する (AC: 1, 2, 5)
  - [x] `organization_billing` の mutable summary に履歴を詰め込まず、`organization_billing_audit_event` 相当の dedicated table を追加する
  - [x] audit event には少なくとも organization linkage、source kind、previous state、next state、provider identifiers、timestamp を残す
  - [x] state change を commit する主要経路だけに絞って記録し、同じ transition を route / webhook / helper の複数箇所で二重記録しない

- [x] Story 2.1-2.4 で作った lifecycle seams に audit trail を接続する (AC: 1, 2, 5)
  - [x] owner trial start、payment-method handoff reflection、trial completion、webhook lifecycle reconciliation など current billing transition path へ audit append を組み込む
  - [x] raw `planCode` だけでなく `planState`, `subscriptionStatus`, `paymentMethodStatus` など、後続 investigation に必要な app-side billing truth を event context に残す
  - [x] reminder / notification history は Story 2.4 の `organization_billing_notification` を正本として維持し、Story 2.5 では notification history を壊さず audit trail と連携させる

- [x] Stripe/app mismatch detection signal を追加する (AC: 4, 5)
  - [x] `stripe_webhook_event`, `stripe_webhook_failure`, current billing summary, payment-method evaluation から mismatch / reconciliation pending を検出できる helper を追加する
  - [x] mismatch signal は dedicated table か audit/event record の structured shape にし、future internal inspection story が参照できるようにする
  - [x] mismatch signal には provider-side state と app-side state の両方、および pending / recovered / mismatch / unavailable の区別を持たせる

- [x] recoverable failure と resync 前提の signal 設計を整える (AC: 4, 5)
  - [x] Stripe lookup failure、webhook reconciliation pending、out-of-order / duplicate event recovery、notification delivery issue を traceable に残す
  - [x] temporary failure を final mismatch と混同せず、retryable / resolved / unresolved を読み分けられる state model にする
  - [x] unsafe mutation を避けて `500` retryable response を返している current webhook flow と矛盾しないように signal を設計する

- [x] Story 4.1-4.3 が読み取りやすい data shape を先に整える (AC: 1, 3, 4, 5)
  - [x] support/internal inspection UI はまだ作らず、backend で organization timeline / mismatch investigation に使える append-only records を正本として整備する
  - [x] notification history、audit trail、mismatch signal の責務を分離し、同じ情報を複数 table に曖昧に重複させない
  - [x] future inspection で sequence / chronology を再構築しやすいよう、deterministic ordering を持つ

- [x] regression test を追加・更新して audit / mismatch behavior を固定する (AC: 1, 2, 3, 4, 5)
  - [x] `apps/backend/src/app.test.ts` に trial start / trial completion / webhook reconciliation / mismatch detection / recoverable failure signal の統合テストを追加する
  - [x] append-only ordering、previous/next state recording、resolved mismatch signal の回帰ケースを固定する
  - [x] summary contract を変えない限り web UI 変更は不要とし、web test 更新は必要時のみに限定する

## Dev Notes

- Story 2.5 の目的は billing summary をさらに賢く見せることではなく、「後から reconstruct できる append-only record」と「mismatch / resync の痕跡」を backend に残すことである。
- Story 2.3 で `stripe_webhook_event` / `stripe_webhook_failure` による webhook idempotency と failure logging が入り、Story 2.4 で `organization_billing_notification` が入った。Story 2.5 はそれらを壊さず、billing state transition と mismatch diagnosis を追加で構造化する位置づけである。
- support/internal inspection UI は Epic 4 に残っているため、Story 2.5 では API surface より先に backend data model と recording policy を正しく定義する方が重要である。
- audit event は「何がどう変わったか」、mismatch signal は「今どこが食い違っているか or pending か」を表す役割に分ける。片方に全部詰め込まない。

### Technical Requirements

- `organization_billing` は引き続き current summary の正本とし、監査や mismatch diagnosis は append-only data に分離する。 [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- `free -> premium_trial -> premium_paid` と payment-method evaluation の app-side lifecycle truth を audit context に残し、raw provider status shortcut だけで監査を作らない。 [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]
- Stripe/app mismatch は provider-side state と app-side state の両方を持った structured signal とし、future support inspection が manual log reconstruction に依存しないようにする。 [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5]
- temporary failure では recoverable application state を守り、resolved / pending / mismatch の区別が監査・signal 側から読める必要がある。 [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5]
- Story 2.4 の notification history は append-only のまま維持し、mutable summary state とは混ぜない。 [Source: _bmad-output/implementation-artifacts/2-4-trial-reminder-email-and-notification-history.md]

### Architecture Compliance

- `app.ts` は webhook verification / coarse routing に集中させ、audit trail と mismatch recording は billing sync/service layer に寄せる。 [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points]
- Stripe/app reconciliation は `app.ts` + sync service の current seam を維持し、ad hoc な route-local state repair を増やさない。 [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- auditability は schema + history tables + structured logs で担保し、support/internal visibility は後続 story に渡せる shape で設計する。 [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- duplicate / out-of-order webhook 耐性、trial completion safe recovery、notification reliability と矛盾しない event model にする。 [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 の既存構成を維持し、新規 dependency 追加は原則不要。 [Source: _bmad-output/project-context.md#Backend]
- schema 拡張が必要なら `apps/backend/drizzle/*` migration を伴わせ、コード先行で仮定しない。 [Source: _bmad-output/project-context.md#開発ワークフロールール]
- Stripe state normalization は existing `apps/backend/src/payment/stripe.ts` と `apps/backend/src/billing/stripe-webhook-sync.ts` を正本とし、provider parsing を別流儀で増やさない。 [Source: apps/backend/src/billing/stripe-webhook-sync.ts]
- Story 2.4 で追加した `organization_billing_notification` は既存 notification history として尊重し、Story 2.5 の audit / signal 実装で置き換えない。 [Source: apps/backend/src/db/schema.ts]

### File Structure Requirements

- 主変更候補:
  - `apps/backend/src/db/schema.ts`
  - `apps/backend/drizzle/*`
  - `apps/backend/src/billing/organization-billing.ts`
  - `apps/backend/src/billing/stripe-webhook-sync.ts`
  - `apps/backend/src/billing/organization-billing-notifications.ts`
  - `apps/backend/src/app.test.ts`
- audit / mismatch helper を切り出す場合は billing domain 近傍 (`apps/backend/src/billing/*`) に置き、route / payment adapter / email sender の責務を混線させない。
- web UI 変更は原則不要。inspection UI は Epic 4 の担当なので、Story 2.5 では backend data model と recording policy に集中する。

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
- Story 2.5 の主戦場は `apps/backend/src/app.test.ts`。trial start、trial completion、subscription reconciliation、retryable webhook failure、resolved mismatch signal を統合テストで固定する。 [Source: docs/test-strategy.md#Backend]
- migration を追加する場合は append-only ordering と既存 billing rows / notification history との互換を backend integration test で確認する。 [Source: docs/test-strategy.md#Migration / D1 スキーマ変更]
- `.svelte` を触らない限り browser test は不要。summary contract や UI-visible contract を変えるときだけ web test を更新する。 [Source: docs/test-strategy.md#Web browser]

### Previous Story Intelligence

- Story 2.1 で payment-method registration handoff と `paymentMethodStatus` summary が入り、trial-to-paid continuity の前提が整った。Story 2.5 でも redirect param ではなく backend billing truth を正本にする必要がある。
- Story 2.2 で premium trial completion policy が shared helper に集約された。billing transition audit はこの shared policy path に寄せて記録し、別経路で transition を再実装しない。
- Story 2.3 で webhook normalization、idempotent event tracking、failure recording が入った。mismatch signal は `stripe_webhook_event` / `stripe_webhook_failure` と競合せず、それらを investigation context として再利用するのが自然である。
- Story 2.4 で `organization_billing_notification` と durable `sequence_number` が入った。Story 2.5 では append-only chronology の重要性がさらに上がるため、audit trail / mismatch signal でも deterministic ordering を持つべきである。
- Story 2.4 review fix では transport-level Resend failure を retryable にし、registered payment method 用の文面分岐を追加した。Story 2.5 でも temporary failure と final mismatch を混同しないことが重要である。

### Git Intelligence Summary

- 直近の relevant commits:
  - `d0d0e34 feat: webhookの実装`
  - `be1cbbd feat(billing): add trial payment method registration`
  - `8202b6d chore(config): set Stripe billing catalog IDs`
  - `03f928f feat(contracts): add premium trial lifecycle UI`
  - `291f3f5 feat(billing): add owner-only premium trials`
- guardrail:
  - recent billing work は `billing/` helper、`stripe-webhook-sync.ts`、`schema.ts`、`app.test.ts` に寄っているため、Story 2.5 でも同じ seam を優先する
  - webhook event / failure / notification history はすでに別 table に分かれ始めているため、audit trail と mismatch signal も mutable summary に寄せず append-only で分離する
  - Epic 4 の internal inspection UI が後続にあるため、今は queryability と chronology を優先し、画面 API を先走らない

### Latest Technical Notes

- Epic 2 の FR28-FR33 は billing state synchronization、duplicate / out-of-order 耐性、Stripe/app mismatch detection、auditable history をまとめて要求している。Story 2.5 はその最後の reliability / audit layer を担う。 [Source: _bmad-output/planning-artifacts/epics.md]
- architecture では `Support & Internal Operations` を「最小 internal visibility + audit/event history」と位置づけており、story 実装段階では data shape を先に整えるのが筋である。 [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- current backend には `stripe_webhook_event`, `stripe_webhook_failure`, `organization_billing_notification` はあるが、billing transition audit と mismatch diagnosis の dedicated record はまだない。 [Source: apps/backend/src/db/schema.ts]

### Project Context Reference

- backend の高リスク変更は `apps/backend/src/app.test.ts` の統合テストを最優先にする。複数 table にまたがる audit / signal recording を unit test だけで済ませない。 [Source: _bmad-output/project-context.md#テストルール]
- D1 schema 変更では migration・既存データ互換・統合テストを一緒に扱う。append-only chronology を壊さない migration 設計が必要。 [Source: _bmad-output/project-context.md#開発ワークフロールール]
- staged migration 中の brownfield 変更として、既存 contracts UI / Stripe integration / webhook sync を壊さず段階拡張する。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]

### Project Structure Notes

- current `/api/webhooks/stripe` は `apps/backend/src/app.ts` にあり、organization billing webhook は `apps/backend/src/billing/stripe-webhook-sync.ts` に寄っている。
- current billing summary / lifecycle helper は `apps/backend/src/billing/organization-billing.ts` に集約されている。
- current schema には `organization_billing`, `stripe_webhook_event`, `stripe_webhook_failure`, `organization_billing_notification` があるが、billing transition audit / mismatch signal の dedicated table はまだない。
- current Story 2.4 実装で reminder history の deterministic ordering (`sequence_number`) が入っているため、Story 2.5 でも chronology reconstruction を同じ水準で考えるべきである。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3]
- [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points]
- [Source: _bmad-output/project-context.md]
- [Source: docs/test-strategy.md#Backend]
- [Source: docs/test-strategy.md#Migration / D1 スキーマ変更]
- [Source: apps/backend/src/db/schema.ts]
- [Source: apps/backend/src/billing/organization-billing.ts]
- [Source: apps/backend/src/billing/stripe-webhook-sync.ts]
- [Source: _bmad-output/implementation-artifacts/2-4-trial-reminder-email-and-notification-history.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Loaded `bmad-create-story` workflow and sprint tracking, then selected the first backlog story in order: `2-5-billing-audit-trail-and-state-reconciliation-signals`.
- Reviewed Epic 2 and Epic 4 story definitions to connect audit trail / mismatch signals with future internal inspection stories.
- Reviewed Story 2.4 implementation notes to inherit reminder history, deterministic ordering, and retry-aware billing reliability patterns.
- Inspected current billing seams in `schema.ts`, `organization-billing.ts`, and `stripe-webhook-sync.ts` to anchor likely file targets and avoid duplicating webhook or billing-summary responsibilities.
- Reviewed architecture and project context for auditability, supportability, append-only history, mismatch diagnosis, and backend-integration-first testing expectations.

### Completion Notes List

- 2026-04-09: Created Story 2.5 as the next implementation artifact in sprint order.
- 2026-04-09: Anchored the story on append-only audit trail plus mismatch signal design, separate from mutable billing summary state.
- 2026-04-09: Connected Story 2.5 guardrails to Story 2.4 notification history and future Epic 4 internal inspection requirements.
- 2026-04-09: Added `organization_billing_audit_event` and `organization_billing_signal` as append-only backend records with deterministic `sequence_number` ordering for future inspection timelines.
- 2026-04-09: Wired audit recording into owner trial start, payment-method customer linkage, route trial completion, webhook checkout seeding, webhook subscription reconciliation, and webhook trial completion without duplicating the same transition across layers.
- 2026-04-09: Added structured reconciliation and notification-delivery signals for mismatch, pending, unavailable, and resolved states so retryable Stripe and delivery issues remain diagnosable without mutating the current billing summary.
- 2026-04-09: Expanded backend integration coverage for audit ordering, previous/next state capture, reconciliation mismatch detection/resolution, and recoverable reminder/trial-completion signal behavior. Web regression checks remained green without UI changes.

### File List

- _bmad-output/implementation-artifacts/2-5-billing-audit-trail-and-state-reconciliation-signals.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/backend/src/billing/organization-billing-observability.ts
- apps/backend/src/billing/organization-billing-notifications.ts
- apps/backend/src/billing/stripe-webhook-sync.ts
- apps/backend/src/db/schema.ts
- apps/backend/src/routes/auth-routes.ts
- apps/backend/src/app.test.ts
- apps/backend/drizzle/0015_billing_audit_and_signals.sql

## Change Log

- 2026-04-09: Story 2.5 created and moved to `ready-for-dev`.
- 2026-04-09: Implemented append-only billing audit events, structured reconciliation signals, and backend regression coverage; moved story to `review`.
