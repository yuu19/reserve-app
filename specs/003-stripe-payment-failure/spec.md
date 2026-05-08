# Feature Specification: Stripe Payment Failure Handling

**Feature Branch**: `003-stripe-payment-failure`  
**Created**: 2026-05-07  
**Status**: Draft  
**Input**: User description: "stripeでの支払い失敗時の実装をします"

## Clarifications

### Session 2026-05-07

- Q: When does the 7-day past-due grace period start? → A: Stripe-side payment issue timestamp; fallback to app receipt time.
- Q: How should payment issue email delivery failures be retried? → A: Retry only failed verified-owner recipients; do not resend to owners already notified.
- Q: How should stale failure events be handled after payment recovery? → A: Keep history and investigation context only; do not reopen when latest Stripe state is recovered.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 支払い失敗時の Premium 利用制御 (Priority: P1)

organization owner と業務ユーザーは、Stripe で支払い失敗、支払い対応要求、支払い遅延、未払いが発生したときに、Premium 機能を使えるかどうかを一貫した状態として確認できる。支払い遅延中は、Stripe 側で支払い遅延が発生した時刻から 7 日間の猶予を持つ。その時刻が取得できない場合は、アプリが支払い遅延を受信した時刻から 7 日間の猶予を持つ。猶予後または未払い状態では Premium 機能が停止される。支払いが復旧した場合は、Premium 利用可否と画面表示も復旧する。

**Why this priority**: 支払い失敗時に Premium を誤って開放または停止し続けると、売上、予約運用、サポート対応に直接影響するため。

**Independent Test**: 支払い失敗、支払い遅延中、猶予切れ、未払い、復旧済みの organization を用意し、Premium 機能の可否と契約状態表示が期待どおりであることを確認できる。

**Acceptance Scenarios**:

1. **Given** 支払い遅延が始まった Premium organization, **When** owner が契約状態を確認する, **Then** 支払い方法更新が必要であること、猶予期限、Premium が猶予期間中だけ継続することが表示される
2. **Given** 支払い遅延の 7 日間の猶予が終了した organization, **When** Premium 機能を利用しようとする, **Then** Premium 機能は停止され、owner には支払い方法更新または契約確認が必要であることが表示される
3. **Given** 未払いまたは初回決済未完了の organization, **When** Premium 機能を利用しようとする, **Then** Premium 機能は即時停止され、組織データは保持される
4. **Given** 支払い問題が解消された organization, **When** 契約状態が再評価される, **Then** Premium 利用可否が復旧し、支払い問題の案内は解消済みとして扱われる

---

### User Story 2 - owner への支払い失敗通知 (Priority: P2)

verified owner は、支払い失敗または支払い対応要求が発生したらすぐに通知を受け取り、契約画面で次に必要な操作を確認できる。verified owner がいない場合、admin、manager、staff、participant には課金通知を送らず、社内調査で確認できる状態だけを残す。

**Why this priority**: owner が支払い問題を早く解消できなければ Premium 停止や問い合わせにつながる一方で、owner 以外に課金情報を通知すると権限境界を壊すため。

**Independent Test**: verified owner が複数いる organization、verified owner がいない organization、owner 以外だけがいる organization を用意し、通知対象、通知履歴、契約画面の案内が期待どおりであることを確認できる。

**Acceptance Scenarios**:

1. **Given** verified owner が複数いる organization, **When** 支払い失敗が発生する, **Then** verified owner 全員に通知され、各 owner への通知結果が契約履歴または社内調査で確認できる
2. **Given** 同じ支払い失敗が再通知される, **When** 支払い失敗処理が再評価される, **Then** 同じ owner へ同じ内容の通知を重複送信しない
3. **Given** verified owner がいない organization, **When** 支払い失敗が発生する, **Then** owner 以外には課金通知を送らず、社内調査で「owner へ通知できない」状態が確認できる
4. **Given** 支払い遅延の猶予期限が 3 日後に迫った organization, **When** 支払い問題が未解消である, **Then** verified owner に猶予期限前の案内が送られる
5. **Given** verified owner の一部だけ通知送信に失敗した organization, **When** 同じ支払い問題の通知を再試行する, **Then** 送信失敗した verified owner だけを再試行し、送信済み owner には再送しない

---

### User Story 3 - 支払い失敗履歴と社内調査 (Priority: P3)

owner と internal operator は、支払い失敗、支払い対応要求、支払い成功、復旧、通知結果を安全な履歴として確認できる。カード番号、支払い方法の詳細、税務詳細、Stripe の raw payload は保存または表示しない。

**Why this priority**: 支払い問題では owner への説明とサポート調査が必要だが、支払い詳細を保持すると不要な情報管理リスクが増えるため。

**Independent Test**: 支払い失敗履歴、支払い対応要求履歴、通知成功、通知失敗、復旧済みの organization を用意し、owner と internal operator が必要な状態だけを確認できることを検証できる。

**Acceptance Scenarios**:

1. **Given** 支払い失敗履歴がある organization, **When** owner が契約画面を開く, **Then** 支払い問題の状態、次の操作、関連する履歴が安全な情報だけで表示される
2. **Given** 通知送信が失敗した organization, **When** internal operator が調査する, **Then** 通知失敗理由と次に必要な対応が確認でき、支払い詳細は表示されない
3. **Given** 支払い問題が復旧済みの organization, **When** internal operator が履歴を確認する, **Then** 失敗、復旧、通知結果の流れが追跡できる

---

### User Story 4 - 通知遅延・重複・順不同への収束 (Priority: P3)

Stripe からの通知が重複、遅延、順不同、または一時的に欠落しても、organization の契約状態、Premium 利用可否、通知履歴、社内調査状態は最終的に正しい状態へ収束する。

**Why this priority**: 支払い通知は外部サービスに依存するため、成功時だけでなく再送や遅延時にも課金状態を説明可能にする必要があるため。

**Independent Test**: 同一通知の再送、失敗通知後の成功通知、成功通知後の遅延した失敗通知、外部状態との不一致を再現し、最終状態と履歴が仕様どおりであることを確認できる。

**Acceptance Scenarios**:

1. **Given** 同じ Stripe event が複数回届く, **When** 支払い失敗処理が実行される, **Then** 契約状態、Premium 利用可否、通知、履歴は重複作成されない
2. **Given** 支払い失敗通知の後に支払い成功が確認される, **When** 契約状態が再評価される, **Then** Premium 利用可否は復旧し、履歴は失敗から復旧までを示す
3. **Given** アプリ側の契約状態と Stripe 側の契約状態が異なる, **When** 定期的な確認が行われる, **Then** 差分は調査可能な状態として残り、復旧可能な場合は正しい状態へ更新される
4. **Given** 支払い復旧済みであることが最新の Stripe 状態で確認できる organization, **When** 古い支払い失敗通知が遅れて届く, **Then** 支払い問題は再オープンせず、履歴と社内調査情報だけが残る

### Edge Cases

- 支払い失敗が未知の organization、未知の customer、または未知の subscription に紐づく
- 支払い失敗、支払い成功、契約解約の通知が順不同で届く
- 支払い遅延中に owner が退会する、または owner role を失う
- すべての owner の email が未検証である
- owner への通知が一時失敗、恒久失敗、または送信設定不足で送れず、送信失敗 recipient だけを再試行する必要がある
- 支払い問題が解消済みなのに、古い失敗通知が再送または遅延到着し、履歴と調査情報だけ残す必要がある
- 支払い遅延の発生時刻が外部状態から判断できず、アプリが受信した時刻を猶予開始点にする
- non-owner が契約画面を開く、または支払い方法更新導線へアクセスしようとする
- 既存の有料 organization に支払い失敗履歴がない状態でこの feature が導入される

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST distinguish payment failure, payment action required, payment past due, unpaid, initial payment incomplete, recovered, and normal paid states for each organization.
- **FR-002**: System MUST stop Premium eligibility immediately for unpaid and initial payment incomplete states while preserving organization data and billing history.
- **FR-003**: System MUST allow a 7-day Premium eligibility grace period for payment past due states, starting from the provider-side payment issue timestamp when available and from the application receipt time otherwise, and MUST stop Premium eligibility after that grace period expires unless payment has recovered.
- **FR-004**: System MUST restore Premium eligibility when the provider state confirms the payment issue is resolved and no other blocking condition applies.
- **FR-005**: Organization owners MUST be able to see the current payment issue state, the grace deadline when available, and the next action needed to resolve the issue.
- **FR-006**: System MUST keep payment update and billing management actions owner-only, while allowing permitted non-owner roles to see only role-safe billing status.
- **FR-007**: System MUST notify every verified owner immediately for payment failure and payment action required events.
- **FR-008**: System MUST send a verified-owner reminder 3 days before payment past-due grace expiry unless the payment issue has already been resolved.
- **FR-009**: System MUST NOT send billing issue notifications to non-owner roles when no verified owner exists; it MUST leave a support-visible signal instead.
- **FR-010**: System MUST record notification outcomes per verified-owner recipient, including sent, skipped, retryable failure, and permanent failure states, and MUST retry only failed recipients without treating notification delivery failure as payment state success.
- **FR-011**: System MUST retain safe payment issue history for owners and internal operators, including payment failure, payment action required, payment success, recovery, notification, and investigation states.
- **FR-012**: System MUST NOT store or display card numbers, full payment method details, tax details, or raw provider payloads as part of payment failure handling.
- **FR-013**: System MUST treat duplicate trusted provider events as no-ops for billing state changes, Premium eligibility changes, owner notifications, and payment history creation.
- **FR-014**: System MUST reject untrusted or unverifiable provider notifications without changing billing state, Premium eligibility, owner notifications, or payment history.
- **FR-015**: System MUST keep stale payment failure notifications as history and investigation context only, without reopening the payment issue when the latest provider state confirms recovery.
- **FR-016**: System MUST avoid changing unrelated organizations when a payment issue cannot be confidently linked to an organization.
- **FR-017**: System MUST expose support-visible investigation context for unresolved, unknown, or mismatched payment issue states.
- **FR-018**: System MUST re-check risky payment states at least hourly and provider-linked billing states at least daily until they are resolved or confirmed current.
- **FR-019**: System MUST preserve compatibility with existing organizations that have no prior payment issue history.
- **FR-020**: System MUST keep all Premium billing lifecycle decisions organization-scoped and MUST NOT create classroom-scoped subscription ownership.
- **FR-021**: System MUST use consistent payment issue terms across owner guidance, Premium restriction reasons, billing history, notifications, and internal inspection.

### Key Entities

- **Organization Billing State**: The current subscription and payment condition for an organization, including normal paid, payment issue, unpaid, incomplete, recovered, free, and trial states.
- **Billing Eligibility Decision**: The derived decision that determines whether Premium capabilities are available for the organization and why.
- **Payment Issue**: A provider-reported condition that requires payment method update, payment confirmation, or support review before Premium can continue indefinitely.
- **Grace Period**: The limited period during which a past-due organization may continue using Premium before payment recovery is required.
- **Billing Payment Issue Notification**: Owner-facing communication triggered by payment failure, payment action required, or upcoming grace expiry, including delivery outcome and recipient scope.
- **Payment Issue History**: Safe owner and operator-visible record of payment issue events, recovery events, notification outcomes, and investigation state.
- **Internal Billing Signal**: Support-visible context used when a payment issue cannot be resolved automatically or cannot be sent to a verified owner.

### Constitution Alignment _(mandatory)_

- **I. Existing Architecture**: This feature extends the existing organization-scoped Premium billing model and provider-hosted payment flow. It must not replace the current app boundaries, authentication model, billing ownership model, or deployment shape.
- **II. Type Safety と API Boundary**: Provider-derived states, notification receipts, billing summaries, and role-visible payment issue fields must be validated and normalized before they affect user-visible state or Premium eligibility.
- **III. Authorization と Scope**: Billing actions, payment update handoff, detailed payment issue history, and payment document access remain owner-only. Non-owner visibility must not grant billing authority or expose payment details.
- **IV. Risk-Based Verification**: Payment state policy, duplicate notification handling, recovery, owner notification scope, internal signal creation, and owner/non-owner UI branching require regression coverage.
- **V. Data, Billing, Deployment Safety**: Payment issue handling must be idempotent, auditable, compatible with existing billing rows, tolerant of duplicate and out-of-order provider notifications, and recoverable through periodic state checks.
- **VI. UI と Design System**: Owner-facing payment issue states must be conveyed with text, structure, and accessible controls rather than color alone, and must distinguish checking, failed, action-required, recovered, and read-only states.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of covered payment failure and payment action required scenarios show the correct owner guidance and Premium eligibility decision.
- **SC-002**: 100% of covered past-due scenarios preserve Premium during the 7-day grace period, calculate the grace start from provider-side issue time with application receipt fallback, and stop Premium after grace expiry unless payment recovery is confirmed.
- **SC-003**: Replaying the same trusted payment issue event at least 5 times creates no additional owner notifications, Premium eligibility changes, or payment history entries beyond duplicate receipt context.
- **SC-004**: In covered scenarios with multiple verified owners, each verified owner receives exactly one immediate payment issue notification per provider event.
- **SC-005**: In covered scenarios with no verified owner, zero non-owner billing issue notifications are sent and a support-visible signal is available.
- **SC-006**: 100% of covered payment recovery scenarios restore Premium eligibility and remove unresolved payment issue guidance when no other blocking condition applies.
- **SC-007**: No owner-facing or internal billing view covered by this feature exposes card numbers, full payment method details, tax details, or raw provider payloads.
- **SC-008**: Notification retry scenarios resend payment issue emails only to failed verified-owner recipients and never resend to already-notified owners in covered tests.
- **SC-009**: Risky payment states are re-checked within 60 minutes in covered operational scenarios, and provider-linked billing states are re-checked at least once per day.
- **SC-010**: Owner contract page checks cover active paid, payment failure, action required, past-due grace active, grace expired, unpaid, recovered, and non-owner read-only states.
- **SC-011**: Stale failure-after-recovery scenarios keep history and investigation context without reopening the payment issue or stopping Premium in covered tests.
- **SC-012**: End-to-end billing lifecycle verification covers successful renewal, failed renewal, and trial ending without a payment method before the feature is considered release-ready.

## Assumptions

- Stripe remains the only provider for Premium billing in this feature.
- Premium billing remains organization-scoped; classroom-scoped billing is out of scope.
- The existing 7-day past-due grace policy and 3-day-before-expiry reminder policy remain valid.
- Owner notification is email-based for this feature; additional notification channels are out of scope.
- Refunds, credit notes, tax calculation policy, multiple paid plans, and in-app card handling are out of scope.
- Mobile UI changes are out of scope unless mobile exposes Premium billing controls during planning.
- Existing Stripe Billing E2E CI is available for release evidence, but normal PR CI does not need to call real Stripe APIs.
