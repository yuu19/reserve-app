# Feature Specification: Billing Production Hardening

**Feature Branch**: `002-billing-hardening`  
**Created**: 2026-04-30  
**Status**: Draft  
**Input**: User description: "現在の課金実装に対して、未払い/incomplete の権限制御、Stripe 作成処理の冪等性、Stripe-linked subscription の定期リコンシリエーション、トライアル再利用不可後の有料導線、free からの有料契約開始 UI、Customer Portal 利用条件、トライアル開始前の料金・請求周期表示、API 契約整合、請求書・領収書、invoice webhook、税・請求先情報、unknown price の扱いを、適切な粒度で仕様化する。"

## Clarifications

### Session 2026-04-30

- Q: Payment issue grace policy for Premium eligibility? → A: `incomplete` is stopped immediately, `past_due` receives a 7-day grace period, and `unpaid` is stopped immediately.
- Q: Reconciliation cadence for provider-linked subscriptions? → A: targeted reconciliation runs hourly for risky billing states, plus one daily full reconciliation.
- Q: Unknown provider price handling for Premium eligibility? → A: unknown provider prices stop Premium eligibility and create investigation signals until mapped to a known catalog entry.
- Q: Billing profile and tax information collection boundary? → A: billing profile and tax information are collected through provider-hosted flows; the application stores only readiness state.
- Q: Billing profile readiness effect on checkout and Premium eligibility? → A: paid checkout is allowed, and billing profile readiness alone does not stop Premium; readiness gaps create owner guidance and support signals.
- Q: Reuse window for identical active billing handoffs? → A: active handoffs for the same organization and purpose are reused for 30 minutes; new handoffs are created only after expiry.
- Q: Payment document and invoice event scope for v1? → A: v1 handles invoice availability, payment success, payment failure, and payment action required; refunds and credit notes are out of scope.
- Q: Billing action API response shape? → A: all billing actions return a common envelope that includes `billing` and `handoff` only when relevant.
- Q: Owner notification policy for payment failures and action-required events? → A: owners receive immediate email plus contract history entries, and past-due grace reminders are emailed 3 days before expiry.
- Q: Payment issue notification recipients? → A: send to all verified owners; if no verified owner exists, create an internal signal only.
- Q: Billing interval availability for v1? → A: owners can choose both monthly and yearly billing intervals in v1.
- Q: Billing management handoff eligibility by subscription state? → A: allow provider-linked `active`, `trialing`, `past_due`, `unpaid`, and `incomplete` subscriptions; block `free`, `canceled`, and no-provider-subscription states.
- Q: Provider webhook duplicate event handling? → A: persist provider event ids for permanent duplicate detection; duplicate events are no-op for state changes and keep receipt history only.
- Q: Cancellation entitlement behavior? → A: `canceled` stops Premium immediately; scheduled period-end cancellation on `active` or `trialing` keeps Premium until current period end, then stops.
- Q: Provider webhook signature failure handling? → A: unsigned, mismatched, or expired-signature webhooks are not processed, do not change billing state, and create only sanitized security/audit signals.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 支払い状態に応じた Premium 利用制御 (Priority: P1)

organization owner と業務ユーザーは、支払い未完了・支払い遅延・未払い・解約済み・期間末解約予定・通常有効の状態ごとに、Premium 機能を使えるかどうかを一貫した説明と制御で確認できる。初回決済未完了の組織に Premium 機能が開放されず、支払い遅延中の組織には 7 日間の猶予が適用され、未払い状態と解約済み状態は即時停止される。`active` または `trialing` の期間末解約予定は current period end まで Premium を維持し、期限後に停止する。支払い失敗や支払い対応要求が発生した場合、verified owner 全員には即時 email と契約履歴で知らせ、支払い遅延の猶予期限 3 日前にも email で通知する。verified owner が存在しない場合は non-owner へ課金通知を送らず、internal signal のみ残す。

**Why this priority**: 未払い利用や支払い済み顧客の誤停止は、売上・信頼・サポート負荷に直結するため。

**Independent Test**: 支払い状態別の organization を用意し、契約画面、Premium 機能の操作、owner 向け説明、非 owner 向け説明が同じ eligibility 判定に従うことを確認できる。

**Acceptance Scenarios**:

1. **Given** 初回決済が完了していない Premium 申込中の organization, **When** staff が Premium 機能を実行する, **Then** Premium 機能は利用不可となり、owner には決済完了または支払い方法確認が必要であることが表示される
2. **Given** 支払い遅延中だが 7 日間の猶予期間内の organization, **When** Premium 機能を実行する, **Then** Premium 機能は継続利用でき、owner には猶予期限と支払い方法更新が必要であることが表示される
3. **Given** 初回決済未完了または未払い状態の organization, **When** Premium 機能を実行する, **Then** Premium 機能は停止され、既存データは保持される
4. **Given** 支払い状態が正常に戻った organization, **When** billing state が再評価される, **Then** Premium eligibility は復旧し、停止中に作成済みの業務データは削除されない
5. **Given** `active` または `trialing` の subscription が期間末解約予定である organization, **When** current period end までは Premium 機能を実行する, **Then** Premium 機能は継続利用でき、owner には解約予定日が表示される
6. **Given** subscription が `canceled` である、または期間末解約予定の current period end を過ぎた organization, **When** Premium 機能を実行する, **Then** Premium 機能は停止され、既存データは保持される
7. **Given** 支払い失敗、支払い対応要求、または支払い遅延の猶予期限 3 日前の organization, **When** billing communication が評価される, **Then** verified owner 全員に email が送信され、契約履歴に通知結果が残る
8. **Given** verified owner が存在しない organization, **When** 支払い問題の billing communication が評価される, **Then** non-owner へ課金通知は送信されず、internal signal のみが残る

---

### User Story 2 - 課金操作の冪等性と自動復旧 (Priority: P1)

owner が trial 開始、支払い方法登録、有料契約開始、契約管理を複数回押したり、通信失敗後に再試行したりしても、重複した customer、subscription、checkout handoff、状態遷移が作られない。同一 organization の同一目的で有効な billing handoff は 30 分間再利用され、期限切れ後だけ新規作成できる。Stripe からの通知が重複した場合は provider event id で永続的に重複排除し、重複 event は状態変更せず受信履歴だけを残す。署名なし、署名不一致、または期限切れ署名の webhook は provider event id の処理前に拒否し、課金状態を変更せず sanitized security/audit signal だけを残す。Stripe からの通知が欠落・失敗しても、支払い問題や処理中状態を対象にした 1 時間ごとの照合と、1 日 1 回の全体照合でアプリ側の契約状態が回復できる。

**Why this priority**: 課金操作は外部 provider と連携するため、二重作成・順不同・webhook 欠落を前提にした安全性が必要なため。

**Independent Test**: 同じ owner action を短時間に複数回実行し、さらに provider notification を遅延・欠落・重複させても、organization billing aggregate が単一の正しい状態に収束することを確認できる。

**Acceptance Scenarios**:

1. **Given** owner が trial 開始を連続実行する, **When** 最初の操作が処理中または成功済みである, **Then** 後続操作は既存の処理結果または安全な競合応答を返し、重複 trial subscription は作られない
2. **Given** owner が有料契約開始または支払い方法登録を再試行する, **When** 同一 organization の同一目的の handoff が作成から 30 分以内である, **Then** 新しい provider object を乱立させず、利用者には再開可能な handoff または現在の状態が返る
3. **Given** provider notification が届かない、または一時失敗した risky billing state の organization, **When** 1 時間ごとの対象限定照合が実行される, **Then** provider 側の subscription state をもとに application billing state が補正され、audit と reconciliation signal が残る
4. **Given** provider 側と application 側の状態が一致している organization, **When** 定期照合が実行される, **Then** 不要な状態変更は行わず、必要に応じて未解決 signal を解決済みにする
5. **Given** provider-linked subscription を持つ organization, **When** 1 日 1 回の全体照合が実行される, **Then** 対象限定照合から漏れた状態差分が検出または解決される
6. **Given** すでに処理済みの provider event id と同じ webhook が再送される, **When** webhook processing が実行される, **Then** organization billing state、通知、entitlement は再変更されず、duplicate receipt として受信履歴だけが残る
7. **Given** 署名なし、署名不一致、または期限切れ署名の webhook が届く, **When** webhook processing が実行される, **Then** organization billing state、通知、entitlement、invoice history は変更されず、sanitized security/audit signal だけが残る

---

### User Story 3 - Owner の契約開始・管理導線 (Priority: P2)

owner は、トライアルを使える場合は trial を開始でき、トライアル利用済みの場合は直接有料契約へ進める。v1 では月額と年額の両方を選択でき、トライアル開始前または有料契約開始前に、請求周期、trial 後の課金開始、料金表示、支払い方法登録の要否を確認できる。provider-linked subscription が `active`、`trialing`、`past_due`、`unpaid`、`incomplete` の場合は契約管理 handoff へ進め、`free`、`canceled`、provider 未連携では契約管理 handoff を表示しない。

**Why this priority**: 現在の free 表示だけでは、トライアル利用済み organization の次アクションや直接有料化の導線が曖昧になるため。

**Independent Test**: free、trial available、trial used、paid active、payment issue の organization を契約画面で確認し、それぞれの owner action と non-owner 表示が期待どおりであることを検証できる。

**Acceptance Scenarios**:

1. **Given** trial 未使用の free organization owner, **When** 契約画面を開く, **Then** trial 開始の可否、trial 後の月額・年額料金、請求周期、支払い方法登録のタイミングが表示される
2. **Given** trial 利用済みの free organization owner, **When** 契約画面を開く, **Then** trial 開始ボタンは表示されず、月額または年額の有料契約開始導線が表示される
3. **Given** owner が直接有料契約を開始したい, **When** 月額または年額の請求周期を選んで進む, **Then** provider-hosted checkout へ移動でき、戻ってきた後は確認中・成功・キャンセルが区別される
4. **Given** provider-linked subscription が `active`、`trialing`、`past_due`、`unpaid`、または `incomplete` の organization, **When** owner が契約管理を開く, **Then** subscription が完全に有効でなくても、支払い方法更新または契約確認に進める
5. **Given** organization が `free`、`canceled`、または provider 未連携である, **When** owner が契約画面を開く, **Then** 契約管理 handoff は表示されず、利用可能な trial または有料契約開始導線だけが表示される
6. **Given** non-owner が契約画面を開く, **When** organization が trial used または payment issue である, **Then** 状態は確認できるが契約操作は実行できない

---

### User Story 4 - 請求書・領収書・請求イベントの可視化 (Priority: P2)

owner と internal operator は、organization の請求書、領収書、支払い成功、支払い失敗、支払い対応要求、請求書利用可能状態、owner 通知結果の履歴を安全に確認できる。支払い詳細そのものは保存・表示せず、provider が提供する参照情報と状態だけを扱う。返金とクレジットノートは v1 のアプリ内履歴対象外とし、別 feature で扱う。

**Why this priority**: 支払い後の問い合わせ、領収書確認、支払い失敗対応は本番運用で頻出し、契約状態だけでは十分に説明できないため。

**Independent Test**: 請求書あり、領収書あり、支払い成功、支払い失敗、請求書未生成の organization を用意し、owner 画面と internal inspection で必要な情報だけが表示されることを確認できる。

**Acceptance Scenarios**:

1. **Given** 支払い済み invoice がある organization owner, **When** 契約画面で支払いドキュメントを確認する, **Then** 請求書または領収書の provider-hosted 参照へ進める
2. **Given** 支払い失敗または支払い対応要求 event がある organization, **When** owner が契約画面を開く, **Then** 支払い方法更新が必要であることと次に取るべき action が表示される
3. **Given** invoice がまだ生成されていない paid organization, **When** owner が契約画面を開く, **Then** 「未生成」または「確認中」として表示され、存在しない書類を成功状態として扱わない
4. **Given** internal operator が billing inspection を開く, **When** 支払い成功・失敗・invoice 関連履歴がある, **Then** payment details を露出せずに、support triage に必要な provider id、状態、時刻、関連 lifecycle が確認できる
5. **Given** 支払い失敗または支払い対応要求の owner 通知が送信済みまたは失敗している, **When** internal operator が billing inspection を開く, **Then** 通知結果、送信時刻、失敗理由、次に必要な support action が確認できる

---

### User Story 5 - 請求先情報・価格カタログ・税務境界の管理 (Priority: P3)

owner は、有料契約前に請求先名、連絡先、必要な税務・請求先情報の扱いを理解できる。請求先・税務情報の入力は provider-hosted flow で行い、アプリは入力完了や不足などの readiness 状態だけを保持する。readiness が incomplete または unavailable でも、それ単独では paid checkout や Premium eligibility を停止せず、owner guidance と support signal の根拠にする。product team と operator は、未知の provider price、複数 price、将来の税務対応に対して、Premium entitlement を誤って開放しない安全な価格カタログ方針を持てる。未知の provider price は Premium eligibility を停止し、既知の価格カタログへ紐づけるまで要調査として扱う。

**Why this priority**: MVP 後の請求実務、価格変更、税務対応は product の継続運用に必要だが、初期リリースの安全性を壊さない範囲で境界を決める必要があるため。

**Independent Test**: 既知 price、未知 price、請求先情報未入力、請求先情報入力済み、readiness 不足だが支払い状態は正常な organization を用意し、契約開始可否、Premium eligibility、owner 表示、internal inspection が仕様どおりであることを検証できる。

**Acceptance Scenarios**:

1. **Given** provider から未知の price id を持つ subscription が届いた, **When** billing state を評価する, **Then** Premium eligibility は停止され、operator が調査できる signal と診断理由が残る
2. **Given** owner が有料契約を開始する, **When** 請求先情報が必要な料金・地域・運用条件である, **Then** readiness 不足だけでは paid checkout を開始不可にせず、provider-hosted flow へ案内され、アプリ側には readiness 状態だけが反映される
3. **Given** 請求先情報が未確認の organization, **When** internal operator が調査する, **Then** 支払い詳細や税務詳細を表示せず、provider-hosted 入力の readiness 状態と次アクションだけが確認できる
4. **Given** product team が新しい price を導入する, **When** provider event が届く, **Then** price catalog に登録された price のみが期待する paid tier と capability に解決される
5. **Given** 既知 price かつ支払い状態が正常な paid organization の billing profile readiness が incomplete または unavailable である, **When** Premium eligibility を評価する, **Then** readiness 不足だけでは Premium eligibility を停止せず、owner guidance と support signal が残る

### Edge Cases

- owner が checkout や payment method handoff から戻らず、同じ操作を後日再開する
- owner が checkout や payment method handoff を 30 分以内に再試行する、または 30 分経過後に再試行する
- owner が checkout 完了直後に画面を閉じ、provider notification が遅延する
- subscription は provider 側で active だが application 側では incomplete のまま残る
- provider notification が duplicate、順不同、欠落、または一時失敗後に再送され、duplicate は provider event id で no-op になる
- provider notification の署名がない、不一致、または期限切れであり、課金状態を変更せず security/audit signal だけ残す
- subscription が period end で解約予定になった後に、owner が再開せず current period end を迎える
- subscription が provider 側で `canceled` に変わったが、application 側では active のまま残る
- 支払い遅延中に owner が退会または owner role を失う
- owner が存在しない、または全 owner の email が未検証である
- 支払い問題の owner email が送信失敗、未設定、または重複送信になりそうになる
- 支払い問題が解消された後、過去の Premium 操作制限が解除されない
- invoice や receipt の URL が provider から返らない、期限切れになる、または後から生成される
- 返金やクレジットノートの問い合わせが来るが、v1 のアプリ内履歴対象外である
- provider price id が設定漏れ、旧 price、テスト price、削除済み price のいずれかで届く
- 請求先情報が不足した状態で有料契約を開始し、provider-hosted flow で補完が必要になる
- non-owner に支払い方法・請求書・契約操作が露出する UI regression

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST distinguish active paid, trial, scheduled period-end cancellation, initial payment incomplete, payment past due, unpaid, canceled, and free states in owner-visible and policy-visible billing state.
- **FR-002**: System MUST prevent Premium capability access for organizations whose initial paid checkout has not completed.
- **FR-003**: System MUST stop Premium eligibility immediately for initial payment incomplete and unpaid states, while preserving all organization data and setup.
- **FR-004**: System MUST allow a 7-day Premium eligibility grace period for payment past due states and show owner-facing payment update guidance throughout the grace period.
- **FR-005**: System MUST restore Premium eligibility when provider state confirms the payment issue is resolved.
- **FR-006**: System MUST send immediate email to every verified owner for payment failure and payment action required events, and record the notification outcome in billing history.
- **FR-007**: System MUST send email to every verified owner 3 days before a past-due grace period expires, unless the payment issue has already been resolved.
- **FR-008**: System MUST create a support-visible internal signal instead of sending billing email to non-owner roles when no verified owner exists.
- **FR-009**: System MUST make trial start, paid checkout, payment method registration, and billing portal handoff idempotent for the same organization and purpose.
- **FR-010**: System MUST prevent duplicate provider subscriptions for repeated trial start or paid checkout attempts from the same organization.
- **FR-011**: System MUST reuse active billing handoffs for the same organization and purpose for 30 minutes and create a new handoff only after that window expires.
- **FR-012**: System MUST record billing operation attempts in a way that can explain processing, success, conflict, expiry, and retry outcomes.
- **FR-013**: System MUST run targeted reconciliation at least hourly for risky billing states such as incomplete, past due, unpaid, stale trialing, and unresolved reconciliation signals.
- **FR-014**: System MUST run full reconciliation at least once per day for provider-linked subscriptions, including active, trialing, incomplete, past due, unpaid, and canceled states.
- **FR-015**: System MUST record audit entries and reconciliation signals for periodic reconciliation changes, failures, and recoveries.
- **FR-016**: System MUST expose whether a free organization can start a trial, has already used a trial, or should proceed directly to paid checkout.
- **FR-017**: System MUST provide an owner-only paid checkout path for eligible free organizations, including trial-used organizations.
- **FR-018**: System MUST offer monthly and yearly billing intervals for v1 paid subscription entry when both approved prices are configured.
- **FR-019**: System MUST show owner-visible price, billing interval, trial duration, post-trial billing start timing, and cancellation implications before trial or paid checkout begins.
- **FR-020**: System MUST allow owner billing management handoff for provider-linked subscriptions in `active`, `trialing`, `past_due`, `unpaid`, or `incomplete` state, and MUST block that handoff for `free`, `canceled`, or no-provider-subscription states.
- **FR-021**: System MUST keep billing controls owner-only while allowing role-safe status visibility for permitted non-owner roles.
- **FR-022**: System MUST align documented API contracts with actual billing action responses for trial start, paid checkout, payment method setup, and portal handoff.
- **FR-023**: System MUST return a common billing action response envelope for all billing actions, including updated billing summary and provider handoff details only when relevant.
- **FR-024**: System MUST expose invoice and receipt availability to organization owners using provider-derived references only.
- **FR-025**: System MUST process invoice availability, payment success, payment failure, and payment action required events as billing history and support-visible context.
- **FR-026**: System MUST avoid storing or displaying raw payment details, full card data, or unnecessary provider payloads.
- **FR-027**: System MUST show payment document states as available, unavailable, missing, or checking, without implying success when no document is available.
- **FR-028**: System MUST expose payment document and invoice event context in internal billing inspection without leaking payment details.
- **FR-029**: System MUST collect billing profile and tax-relevant information through provider-hosted flows and store only readiness status in the application.
- **FR-030**: System MUST stop Premium eligibility when a provider price is unknown, while preserving organization data and provider references.
- **FR-031**: System MUST require provider prices to map to known product tiers before enabling any Premium capability.
- **FR-032**: System MUST provide support-visible diagnostics for unknown price, missing billing profile, unavailable provider lookup, and stale subscription state.
- **FR-033**: System MUST keep all billing lifecycle changes organization-scoped and must not create classroom-scoped subscription ownership.
- **FR-034**: System MUST preserve existing organization billing history and trial usage data when applying this feature to existing organizations.
- **FR-035**: System MUST NOT block paid checkout or Premium eligibility solely because billing profile readiness is incomplete or unavailable; it MUST surface owner guidance and support-visible signals instead.
- **FR-036**: System MUST persist provider webhook event ids without automatic expiry for this feature and MUST treat duplicate provider event ids as no-op state changes while retaining receipt history.
- **FR-037**: System MUST stop Premium eligibility immediately for `canceled` subscriptions and MUST keep Premium eligibility until current period end for `active` or `trialing` subscriptions scheduled to cancel at period end unless another blocking condition applies.
- **FR-038**: System MUST reject unsigned, mismatched-signature, and expired-signature provider webhooks before applying billing state changes or duplicate event handling, and MUST record only sanitized security/audit signals for those attempts.

### Key Entities *(include if feature involves data)*

- **Billing Eligibility Decision**: Derived result that determines Premium access for an organization, including state, reason, grace status, scheduled cancellation status, current period end, next owner action, and whether Premium capabilities are enabled.
- **Billing Operation Attempt**: Owner-initiated action record for trial start, paid checkout, payment method setup, or portal handoff; includes purpose, organization, state, retryability, 30-minute handoff reuse expiry, and provider references where available.
- **Provider Subscription Reconciliation**: Periodic comparison between application billing state and provider subscription state; produces updates, audit entries, and reconciliation signals.
- **Billing Action Availability**: Owner and non-owner facing summary of allowed actions, including trial availability, paid checkout availability, payment method update, and billing portal access. Billing portal access is available only for owner users when the provider-linked subscription state is `active`, `trialing`, `past_due`, `unpaid`, or `incomplete`.
- **Billing Action Response**: Common response envelope for billing actions; includes current billing summary when available, provider handoff URL and expiry when applicable, and action status or message without raw provider payloads.
- **Provider Webhook Event Receipt**: Append-only record of provider webhook receipt and processing outcome; includes provider event id when trusted, event type when trusted, received time, signature verification result, duplicate detection result, linked organization when known, processing status, and sanitized error context without raw payment details.
- **Payment Document Reference**: Provider-derived invoice or receipt reference that is safe to show to owners without storing payment details.
- **Invoice Payment Event**: Provider-derived invoice availability, payment success, payment failure, or payment action required event linked to organization billing history and support inspection; refunds and credit notes are outside v1 scope.
- **Billing Payment Issue Notification**: Owner-facing communication sent to every verified owner and triggered by payment failure, payment action required, or upcoming past-due grace expiry; includes delivery outcome, attempt context, and support-visible failure reason without payment details. If no verified owner exists, it is represented as an internal signal only.
- **Billing Profile Readiness**: Organization-level readiness state indicating whether provider-hosted billing contact and tax-relevant collection is complete, incomplete, unavailable, or not required. This readiness state is diagnostic and guidance-oriented; it does not independently gate paid checkout or Premium eligibility.
- **Paid Tier Catalog Entry**: Approved mapping between provider price, product tier, capabilities, and diagnostic behavior when the price is unknown.

### Constitution Alignment *(mandatory)*

- **I. Existing Architecture**: This feature extends the existing organization-scoped billing model and keeps provider-hosted payment flows. It must not replace the monorepo, authentication, routing, data access, or deployment structure. Existing free/trial/paid behavior must remain compatible while new hardening states are introduced.
- **II. Type Safety と API Boundary**: Billing state, provider status, provider event ids, price ids, invoice events, operation attempts, and document references must be normalized at API boundaries. Unknown provider values must be represented explicitly instead of being treated as trusted product state.
- **III. Authorization と Scope**: Billing state remains organization-scoped. Contract changes, payment method setup, paid checkout, billing portal handoff, billing profile editing, and payment document access are owner-only. Non-owner visibility must not grant billing authority.
- **IV. Risk-Based Verification**: Backend integration coverage is required for payment state eligibility, idempotent actions, reconciliation, invoice events, webhook signature rejection, unknown price behavior, billing profile readiness non-gating behavior, and role boundaries. Web coverage is required for owner/non-owner contract page states. Manual release evidence is required for provider dashboard/webhook configuration and payment document access.
- **V. Data, Billing, Deployment Safety**: Existing billing rows, trial usage, provider identifiers, webhook event receipts, audit history, notification history, and reconciliation signals must remain compatible. New lifecycle and recovery behavior must be idempotent, auditable, retryable where appropriate, and documented in deployment notes.
- **VI. UI と Design System**: Contract and billing UI must follow DESIGN.md, use text and structure rather than color alone, and distinguish unavailable, checking, failed, successful, read-only, and action-required states.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of tested initial payment incomplete organizations are blocked from Premium-only operations until payment completion is confirmed.
- **SC-002**: Repeating the same owner billing action at least 5 times within 30 minutes creates at most one active provider subscription or setup handoff for the same organization and purpose.
- **SC-003**: Hourly targeted reconciliation resolves or flags risky stale provider-linked billing state within one targeted reconciliation window for 95% of recoverable cases in test scenarios.
- **SC-004**: Daily full reconciliation detects or confirms provider-linked subscription alignment for all covered subscription statuses within one full reconciliation window.
- **SC-005**: Owner contract page shows the correct next action for trial-available, trial-used free, paid active, payment issue, and read-only non-owner states, including monthly and yearly paid entry choices where available, in all covered UI tests.
- **SC-006**: Provider invoice availability, payment success, payment failure, and payment action required events appear in owner history or internal inspection within the same processing flow in all covered backend tests.
- **SC-007**: Payment failure and payment action required scenarios create exactly one immediate notification record for each verified owner per provider event in covered tests.
- **SC-008**: Past-due grace expiry scenarios create a verified-owner reminder 3 days before expiry unless the payment issue is resolved in covered tests.
- **SC-009**: No-verified-owner payment issue scenarios create support-visible internal signals and no non-owner billing email in covered tests.
- **SC-010**: No owner or internal billing response used by this feature contains raw card data, full payment method details, raw tax details, or raw provider payloads in covered tests.
- **SC-011**: Billing profile and tax information scenarios expose only readiness state and provider-hosted next actions in covered tests.
- **SC-012**: Unknown provider price scenarios never unlock Premium capabilities and always create support-visible investigation context in covered tests.
- **SC-013**: API contract validation confirms trial, checkout, payment method, portal, summary, and inspection response shapes use the common billing action envelope and match implementation behavior before release planning is marked complete.
- **SC-014**: Billing management availability tests confirm owner portal handoff is offered for provider-linked `active`, `trialing`, `past_due`, `unpaid`, and `incomplete` subscriptions, and not offered for `free`, `canceled`, or no-provider-subscription organizations.
- **SC-015**: Billing profile readiness tests confirm incomplete or unavailable readiness does not block paid checkout or Premium eligibility for otherwise eligible known-price subscriptions, while owner guidance and support-visible signals remain available.
- **SC-016**: Duplicate webhook tests confirm replaying the same provider event id does not create additional billing state changes, owner notifications, entitlement changes, or invoice history entries beyond a duplicate receipt record.
- **SC-017**: Cancellation entitlement tests confirm `canceled` subscriptions lose Premium immediately, while `active` or `trialing` subscriptions scheduled for period-end cancellation keep Premium until current period end and lose it after that time if not reactivated.
- **SC-018**: Webhook signature tests confirm unsigned, mismatched-signature, and expired-signature webhook attempts never change billing state, owner notifications, entitlement, or invoice history, and create only sanitized security/audit signals.

## Assumptions

- Stripe remains the only billing provider for this feature.
- The Premium subscription remains organization-scoped; classroom-scoped billing is out of scope.
- Payment documents are displayed through provider-hosted references; the application does not generate tax invoices itself in this feature.
- Refund and credit-note lifecycle handling is out of scope for v1 and should be specified separately if needed.
- Billing profile requirements cover readiness and owner-visible provider-hosted collection rules; jurisdiction-specific legal text and tax calculation policy may be handled by provider settings unless a later requirement expands scope.
- Mobile UI changes are out of scope unless mobile exposes Premium billing controls or payment document access during planning.
