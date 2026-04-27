# Feature Specification: Organization Billing

**Feature Branch**: `001-organization-billing`  
**Created**: 2026-04-27  
**Status**: Draft  
**Input**: User description: "_bmad-output以下を参照してspeckit用のspecを作成"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Owner Billing Workspace and Trial Entry (Priority: P1)

organization owner は、現在の plan state、free と premium の違い、trial 終了日、
自分が実行できる billing action を contracts/billing 画面で理解し、7 日間の
premium trial を開始できる。

**Why this priority**: owner が self-serve で trial を開始できなければ、課金導線と
premium value の検証が成立しないため。

**Independent Test**: free organization の owner と non-owner で billing 画面を開き、
owner だけが trial start action を実行でき、non-owner には read-only な状態表示だけが
見えることを確認する。

**Acceptance Scenarios**:

1. **Given** free plan の organization owner が billing 画面を開く, **When** billing
   summary が表示される, **Then** plan state、free/premium capability の違い、trial
   開始 action、owner-only 権限が確認できる
2. **Given** owner が 7 日間 trial を開始する, **When** trial start が成功する,
   **Then** organization は premium trial 状態になり、trial end date と premium
   eligibility が表示される
3. **Given** admin、manager、staff、participant が billing 画面を開く, **When**
   status 情報が表示される, **Then** billing action は表示または実行できず、契約責任が
   owner に限定されることが分かる
4. **Given** trial 中または trial 済みの organization, **When** owner が trial start を
   試みる, **Then** overlapping trial は作成されず、現在の状態と次に取れる action が
   明確に表示される

---

### User Story 2 - Trial-to-Paid Lifecycle and Billing Reliability (Priority: P1)

owner は trial 終了前に payment method を登録でき、trial 終了時には条件に応じて
premium paid へ継続するか free へ安全に戻る。Stripe 由来の lifecycle event は重複や
順不同でも organization billing state を壊さない。

**Why this priority**: trial conversion、paid access の継続、free fallback は revenue と
信頼性に直結し、誤判定は無料開放または支払い済み顧客の利用停止につながるため。

**Independent Test**: trial organization に対して payment method 登録済み/未登録、
重複 webhook、順不同 webhook、trial end reminder の各ケースを再現し、最終 plan state、
entitlement、notification history、audit trail が期待通りになることを確認する。

**Acceptance Scenarios**:

1. **Given** premium trial 中の owner, **When** trial 終了前に payment method を登録する,
   **Then** paid 継続予定であることが曖昧なく表示され、registration status が反映される
2. **Given** payment method 登録済みの trial organization, **When** trial が終了する,
   **Then** organization は premium paid へ移行し、premium access は中断されない
3. **Given** payment method 未登録の trial organization, **When** trial が終了する,
   **Then** organization は free eligibility に戻り、既存データと operational setup は
   保持される
4. **Given** trial 終了 3 日前の Stripe lifecycle event, **When** reminder 処理が行われる,
   **Then** owner へ email reminder が送られ、送信履歴と失敗時の再試行状態が残る
5. **Given** duplicate または out-of-order の Stripe event, **When** billing sync が処理される,
   **Then** conflicting billing state は作られず、最終的に reconcilable な state へ収束する

---

### User Story 3 - Premium Capability Access Across the Organization (Priority: P2)

owner、admin、manager、staff は、organization の premium eligibility に応じて、
複数 classroom、staff invitation、role management、recurring schedule、approval-based
booking、ticket/recurring payment、CSV/export、analytics、audit-oriented view などの
premium capability を一貫して利用または制限される。

**Why this priority**: premium plan の価値は単なる契約状態ではなく、organization 配下の
operational capability が正しく解放・制限されることで成立するため。

**Independent Test**: free、premium trial、premium paid の organization で主要 capability
を操作し、UI 表示と backend enforcement が同じ eligibility decision に従うことを確認する。

**Acceptance Scenarios**:

1. **Given** free organization の staff または manager, **When** premium capability を
   実行しようとする, **Then** backend は操作を拒否し、UI は upgrade/trial に必要な情報を
   role-safe に表示する
2. **Given** premium trial または premium paid organization, **When** staff が premium-enabled
   operational capability を利用する, **Then** billing control は見えないまま、業務上必要な
   capability だけが使える
3. **Given** organization の plan state が trial/paid から free に変わる, **When** premium
   capability が再評価される, **Then** data は保持されるが premium-only action は制限される
4. **Given** classroom が複数ある organization, **When** premium eligibility が有効になる,
   **Then** entitlement は classroom 単位ではなく organization 配下へ一貫して適用される

---

### User Story 4 - Internal Billing Support and Investigation (Priority: P3)

authorized internal operator は、問い合わせ対応のために organization billing state、
trial timing、payment method status、reminder delivery、Stripe/application mismatch、
billing audit history、entitlement change history を確認できる。

**Why this priority**: billing 問い合わせは手動調査の負荷が高く、状態不整合や通知未送信を
短時間で分類できなければ support quality と復旧速度が落ちるため。

**Independent Test**: internal operator と非許可ユーザーで inspection view を開き、許可者
だけが billing state、notification history、mismatch signal、timeline を確認できることを
検証する。

**Acceptance Scenarios**:

1. **Given** authorized internal operator, **When** organization を検索または指定する,
   **Then** current billing state、trial dates、provider state、application state、owner
   notification status が確認できる
2. **Given** Stripe state と application state が異なる organization, **When** inspection
   view を開く, **Then** mismatch の種類、最終同期時刻、調査に必要な context が表示される
3. **Given** reminder email が送信済みまたは失敗した organization, **When** notification
   audit を確認する, **Then** delivery status、retry status、owner 向け communication の
   履歴が分かる
4. **Given** internal operator ではない user, **When** internal inspection にアクセスする,
   **Then** billing support data は表示されず、権限エラーになる

---

### User Story 5 - Subscription Management Expansion Readiness (Priority: P4)

owner と product team は、MVP 後に billing history、paid activation 後の plan change、
multi-tier paid model、email 以外の billing communication、invoice/receipt capability を
追加できるよう、organization-scoped billing model を維持したまま拡張余地を持てる。

**Why this priority**: MVP の scope を肥大化させず、将来の subscription model evolution を
妨げないため。

**Independent Test**: MVP spec と data/entity model をレビューし、future tier、history、
communication、invoice/receipt の追加が organization-scoped billing model を壊さずに
扱えることを確認する。

**Acceptance Scenarios**:

1. **Given** premium paid organization, **When** owner が将来 billing history を確認する,
   **Then** subscription lifecycle と owner-facing billing event を説明可能な履歴として扱える
2. **Given** 将来複数 paid tier が導入される, **When** plan state が拡張される, **Then**
   organization-scoped subscription model は維持される
3. **Given** 将来 email 以外の communication channel が追加される, **When** notification
   history を拡張する, **Then** MVP の email history と矛盾しない

### Edge Cases

- owner が既に trial 中、paid、または過去に trial 済みの organization で再度 trial を開始しようとする
- organization に active classroom や staff が複数存在する状態で plan state が変わる
- payment method 登録が途中で中断される、または登録済みかどうかの反映が遅れる
- Stripe event が重複、順不同、遅延、または一時失敗後に再送される
- Stripe 側は active/trialing だが application 側が free/trial/paid と異なる
- reminder email の送信失敗、再試行中、重複送信防止
- owner が退会または role 変更された後の billing authority
- active organization 未選択時、または organization membership がない user の billing access
- non-owner に billing controls が露出する UI regression
- 色だけでは state を判別できない、または loading/error state が曖昧になる UI

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST represent each organization plan state explicitly as `free`,
  `premium_trial`, or `premium_paid`.
- **FR-002**: System MUST show owner-visible billing summary including current plan state,
  premium eligibility, trial timing when relevant, and role-specific permissions.
- **FR-003**: System MUST show the difference between free capabilities and premium-only
  capabilities in a way that supports owner decision-making.
- **FR-004**: System MUST allow only organization owners to start trial, register payment
  method, open paid conversion flows, or perform subscription management actions.
- **FR-005**: System MUST prevent admin, manager, staff, and participant roles from
  changing plan state or payment settings.
- **FR-006**: System MUST allow an eligible organization owner to start exactly one
  7-day premium trial for an organization.
- **FR-007**: System MUST prevent overlapping or conflicting premium trials for the same
  organization.
- **FR-008**: System MUST maintain premium entitlement at organization scope and apply it
  consistently across all classrooms belonging to the organization.
- **FR-009**: System MUST allow premium-enabled operational capabilities only when the
  organization has active premium eligibility.
- **FR-010**: System MUST preserve organization data and existing operational setup when
  plan state changes between free, trial, and paid.
- **FR-011**: System MUST allow owner to register a payment method before trial end and
  reflect whether registration is complete.
- **FR-012**: System MUST communicate whether premium will continue after payment method
  registration without ambiguous waiting or success states.
- **FR-013**: System MUST transition trial organizations with valid paid continuation
  conditions to `premium_paid` at trial completion.
- **FR-014**: System MUST transition trial organizations without valid paid continuation
  conditions back to `free` eligibility at trial completion.
- **FR-015**: System MUST prevent paid conversion when required billing conditions are
  not satisfied.
- **FR-016**: System MUST notify owner by email 3 days before premium trial end.
- **FR-017**: System MUST direct reminder communication to payment method registration
  and explain the consequence of taking no action.
- **FR-018**: System MUST retain history of billing-related owner notifications, including
  delivery status and retry/failure state.
- **FR-019**: System MUST synchronize organization billing state with Stripe subscription
  lifecycle state while keeping product plan state separate from provider status.
- **FR-020**: System MUST process core subscription lifecycle events for checkout completion,
  subscription creation/update/deletion, and trial-will-end.
- **FR-021**: System MUST verify Stripe webhook authenticity before applying billing state
  changes.
- **FR-022**: System MUST avoid conflicting billing states when duplicate Stripe events are
  received.
- **FR-023**: System MUST recover to a correct organization billing state when Stripe events
  arrive out of order or after temporary failure.
- **FR-024**: System MUST identify when Stripe subscription state and application billing
  state do not match.
- **FR-025**: System MUST maintain auditable history of billing state changes and entitlement
  changes.
- **FR-026**: System MUST expose internal billing inspection only to authorized internal
  operators.
- **FR-027**: System MUST allow authorized internal operators to inspect organization billing
  state, trial timing, payment method status, reminder delivery status, and mismatch signals.
- **FR-028**: System MUST allow authorized internal operators to review billing investigation
  timeline data sufficient to classify support issues.
- **FR-029**: System MUST gate multiple classroom/site management behind premium eligibility.
- **FR-030**: System MUST gate staff invitation and role management behind premium eligibility.
- **FR-031**: System MUST gate recurring schedule operations behind premium eligibility.
- **FR-032**: System MUST gate approval-based booking flows behind premium eligibility.
- **FR-033**: System MUST gate ticket and recurring payment related capabilities behind premium
  eligibility.
- **FR-034**: System MUST gate each existing or newly touched premium-only surface behind
  premium eligibility, including advanced contract management, participant invitation operations,
  CSV export, analytics, audit-oriented views, and priority support where those surfaces exist
  in the current application.
- **FR-035**: System MUST keep billing and entitlement status understandable without relying
  solely on color.
- **FR-036**: System MUST keep MVP billing provider scope to Stripe and MVP reminder channel
  scope to email.
- **FR-037**: System MUST preserve the organization-scoped billing model for future billing
  history, plan change, multi-tier paid plan, expanded communication, and invoice/receipt
  capability by keeping extensible plan codes, provider references, communication history, and
  billing document references out of classroom-scoped ownership.

### Key Entities *(include if feature involves data)*

- **Organization Billing**: organization 単位の billing aggregate。product plan state、
  premium eligibility、trial timing、payment method registration status、provider-derived
  subscription state、current period、last sync context を表す。
- **Subscription Lifecycle Event**: Stripe または application action 由来の billing state
  transition。event identity、provider status、normalized action、processing result、
  idempotency/reconciliation context を持つ。
- **Premium Entitlement**: organization が premium capability を利用できるかを表す policy
  result。plan state、trial validity、paid validity、free fallback を考慮する。
- **Billing Notification**: owner 向け reminder や billing communication の履歴。送信先、
  channel、trigger、delivery status、retry/failure context を持つ。
- **Billing Audit Entry**: billing state change、entitlement change、manual recovery、
  mismatch detection、internal inspection に関する監査可能な履歴。
- **Internal Operator Access**: internal billing inspection を利用できる operator の権限。
  end-user role とは分離して管理される。
- **Premium Capability**: multiple classroom、staff invitation、role management、
  recurring schedule、approval booking、ticket/payment、CSV/export、analytics など、
  premium eligibility によって利用可否が変わる業務能力。current implementation で
  確認対象に含める surface は backend の authenticated routes と booking authorization、
  web の contracts/home premium restriction messaging、admin contracts、admin participants、
  admin schedules、admin bookings、participant invitation/bookings flows とする。

### Constitution Alignment *(mandatory)*

- **既存 brownfield baseline**: 既存の organization/classroom model、contracts/billing
  workspace、billing lifecycle intake、email communication、operational observability、
  data migration flow を維持する。新しい starter や別アプリホストは導入しない。
- **認可と scope**: subscription と entitlement の正本は organization。billing action は
  owner-only。admin/staff/manager/participant は billing control 不可。UI 表示用 role/status
  は認可判断の正本にしない。
- **信頼性と監査可能性**: product plan state と provider status を分離し、Stripe webhook
  は署名検証、正規化、event id 冪等性、順不同耐性、reconciliation signal を必要とする。
  notification と audit history は後から support が追跡できる形で保持する。
- **検証義務**: lifecycle transition、duplicate/out-of-order external event、owner-only denial、
  persisted billing state、premium gating は backend integration test を必須とする。contracts
  page と role-based UI は web server/browser または明示的な手動確認で検証する。
- **design system 義務**: billing/status UI は DESIGN.md を優先し、状態、action、結果を色だけに
  依存せず表示する。loading、error、read-only、owner-only state は明確に区別する。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: owner が support なしで billing 画面から 7 日間 trial を開始し、trial end date と
  premium capability を確認できる。
- **SC-002**: trial start と payment method registration handoff は、通常利用時に owner が
  indefinite loading に留まらず、完了状態、明示的な pending state、または再試行可能な error
  state のいずれかを表示する。
- **SC-003**: billing status page は通常利用条件で 3 秒以内に主要状態を表示できる。
- **SC-004**: Stripe event に起因する entitlement change は通常数分以内、目標 1 分以内に
  application state へ反映される。
- **SC-005**: duplicate または out-of-order Stripe event を処理しても、organization billing state
  に conflicting state が作られない。
- **SC-006**: payment method 登録済み trial organization は trial 終了後も premium access が
  中断されない。
- **SC-007**: payment method 未登録 trial organization は trial 終了後に free eligibility へ戻り、
  existing data と setup が保持される。
- **SC-008**: trial 終了 3 日前 reminder email の送信成功、失敗、再試行状態を support が確認できる。
- **SC-009**: free organization に premium-only capability が誤って開放されず、paid organization が
  誤って premium access を失わない。
- **SC-010**: non-owner に subscription management control が表示または実行されない。
- **SC-011**: authorized internal operator が billing 問い合わせを billing state、notification history、
  mismatch signal、audit timeline から分類できる。
- **SC-012**: billing UI の主要状態と action は、色だけに依存せず、label と説明で理解できる。

## Assumptions

- MVP の billing provider は Stripe のみ、trial reminder channel は email のみとする。
- Payment details は Stripe-hosted flow に閉じ、アプリケーションはカード情報を直接保持しない。
- MVP の plan state は `free`、`premium_trial`、`premium_paid` の 3 種類とし、複数 paid tier は
  future expansion とする。
- Billing authority は owner-only を hard rule とし、admin は契約操作不可とする。
- Subscription ownership は classroom ではなく organization に固定する。
- Support/internal inspection は authorized internal operator に限定する。
- Mobile client は MVP billing management の主要導線ではなく、premium entitlement の影響がある場合は
  manual smoke coverage を残す。
- Existing organization/classroom migration status、design system、project guidance を実装時の正本として扱う。
