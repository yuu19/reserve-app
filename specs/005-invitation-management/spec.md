# Feature Specification: Invitation Management

**Feature Branch**: `main`
**Created**: 2026-05-15
**Status**: Draft
**Input**: User description: "招待機能について、現在の仕様をもとにspeckitの仕様を作成。ブランチは切り替えない。"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 権限を持つユーザーが招待を送信する (Priority: P1)

組織または教室の運用権限を持つユーザーは、対象の organization/classroom の範囲内で、管理者、教室運営者、参加者をメールアドレス宛てに招待できる。参加者招待では参加者名も指定できる。

**Why this priority**: 招待は organization と classroom に新しい運用者または参加者を安全に追加するための主要導線であり、予約運用の開始と拡張に不可欠なため。

**Independent Test**: owner/admin/manager/staff/participant の代表アカウントで招待送信を試し、許可された role と scope のみ招待できることを確認できる。

**Acceptance Scenarios**:

1. **Given** organization 管理権限を持つユーザーが対象 organization を開いている, **When** admin または member の管理者招待を送信する, **Then** 未対応の管理者招待が作成され、招待メールが送信される
2. **Given** 教室管理権限を持つユーザーが対象 classroom を開いている, **When** manager または staff の教室運営招待を送信する, **Then** 未対応の教室運営招待が作成され、招待メールが送信される
3. **Given** 参加者管理権限を持つユーザーが対象 classroom を開いている, **When** メールアドレスと参加者名を指定して参加者招待を送信する, **Then** 未対応の参加者招待が作成され、参加者向け招待メールが送信される
4. **Given** 権限のないユーザーが招待送信を試みる, **When** 招待を送信する, **Then** 招待は作成されず、権限がないことが分かる応答または表示になる

---

### User Story 2 - 招待されたユーザーが招待に応答する (Priority: P1)

招待メールを受け取ったユーザーは、ログイン後に自分宛ての招待内容を確認し、承諾または辞退できる。承諾すると招待種別に応じた所属または参加者登録が反映される。

**Why this priority**: 招待は送信だけでは価値が完結せず、招待先本人が安全に受け入れて所属や参加者状態へ反映できる必要があるため。

**Independent Test**: 招待先メールアドレスのユーザーで招待詳細を開き、承諾、辞退、処理済み再操作、別メールユーザーでの閲覧不可を確認できる。

**Acceptance Scenarios**:

1. **Given** 未対応の管理者招待を受け取ったユーザーがログインしている, **When** 招待を承諾する, **Then** 対象 organization の member または admin として利用できる
2. **Given** 未対応の教室運営招待を受け取ったユーザーがログインしている, **When** 招待を承諾する, **Then** 対象 organization に所属し、対象 classroom の manager または staff として利用できる
3. **Given** 未対応の参加者招待を受け取ったユーザーがログインしている, **When** 招待を承諾する, **Then** 対象 classroom の参加者として利用できる
4. **Given** 招待先メールアドレスと異なるユーザーが招待詳細を開く, **When** 招待内容を確認または応答しようとする, **Then** 招待内容は表示されず、承諾や辞退もできない
5. **Given** 招待されたユーザーが未対応の招待を辞退する, **When** 辞退を確定する, **Then** 招待状態は辞退済みになり、以後承諾できない

---

### User Story 3 - 招待の再送、取消、期限切れ、重複を管理する (Priority: P2)

招待を送信したユーザーまたは対象範囲の管理権限を持つユーザーは、未対応の招待を再送または取消できる。システムは未対応招待の重複作成、過剰な再送、期限切れ招待への応答を防ぐ。

**Why this priority**: 招待メールの未着や誤送信を運用で回復しつつ、同じ相手への重複招待や古い招待の誤利用を防ぐため。

**Independent Test**: 同じメールアドレスと同じ招待種別での重複送信、再送上限、取消後の承諾不可、期限切れ後の表示と応答不可を確認できる。

**Acceptance Scenarios**:

1. **Given** 同じ対象に未対応の招待が存在する, **When** 同じ scope、招待種別、role、メールアドレスで新規招待を送信する, **Then** 新しい招待は作成されず、既存の未対応招待があることが分かる
2. **Given** 未対応の招待が存在する, **When** 許可されたユーザーが再送する, **Then** 招待メールが再送され、招待状態は未対応のまま保持される
3. **Given** 同じ招待の再送回数が上限に達している, **When** さらに再送しようとする, **Then** 再送は行われず、上限に達したことが分かる
4. **Given** 未対応の招待が存在する, **When** 招待者本人または対象 scope の管理権限を持つユーザーが取消する, **Then** 招待状態は取消済みになり、招待先は承諾できない
5. **Given** 招待期限を過ぎた招待が存在する, **When** 招待一覧または詳細で確認される, **Then** 期限切れとして扱われ、承諾、辞退、取消の対象にならない

---

### User Story 4 - 権限と Premium 状態に応じて招待管理を制限する (Priority: P2)

ユーザーは自分に許可された招待一覧と操作だけを確認できる。Premium が必要な招待管理操作は、対象 organization の利用状態に応じて制限される。

**Why this priority**: 招待機能は組織所属、教室運営、参加者情報に関わるため、権限外の一覧表示や操作、Premium 対象外での利用を防ぐ必要があるため。

**Independent Test**: 同じ招待一覧画面を複数 role と Premium 状態で開き、表示される招待種別、操作可否、制限案内が期待どおりであることを確認できる。

**Acceptance Scenarios**:

1. **Given** organization 管理権限のないユーザーが管理者招待一覧を開く, **When** 招待一覧を取得する, **Then** 送信済み管理者招待は表示されず、管理操作もできない
2. **Given** classroom 管理権限のみを持つユーザーが教室招待一覧を開く, **When** 招待一覧を確認する, **Then** 教室運営招待は確認でき、参加者管理権限がなければ参加者招待の管理操作はできない
3. **Given** 参加者管理権限を持つユーザーが教室招待一覧を開く, **When** 招待一覧を確認する, **Then** 参加者招待を確認でき、教室管理権限がなければ教室運営招待の管理操作はできない
4. **Given** 対象 organization で Premium が利用できない, **When** 招待の作成、再送、一覧確認、または管理者/教室運営招待の承諾を行う, **Then** 必要なプランが分かる案内が表示され、保護対象の操作は行われない

---

### User Story 5 - 招待操作を監査できる (Priority: P3)

運用担当者は、招待の作成、再送、承諾、辞退、取消について、対象メールアドレス、対象 organization/classroom、実行者、操作時点を後から確認できる。

**Why this priority**: 招待はメンバー追加と参加者登録につながるため、誤招待、再送、取消、承諾の経緯を追跡できることが運用品質と問い合わせ対応に必要なため。

**Independent Test**: 各招待操作を実行し、操作ごとに必要な監査情報が残ること、不要な本文や秘密情報が記録されないことを確認できる。

**Acceptance Scenarios**:

1. **Given** 招待が作成された, **When** 監査記録を確認する, **Then** 作成者、対象メールアドレス、招待種別、role、対象 scope、作成時点が分かる
2. **Given** 招待が再送、承諾、辞退、取消された, **When** 監査記録を確認する, **Then** 実行者、操作種別、対象招待、対象メールアドレス、操作時点が分かる
3. **Given** 参加者招待が作成された, **When** 監査記録を確認する, **Then** 参加者名を含む招待管理に必要な最小限の情報だけが残る

### Edge Cases

- 招待メールアドレスが空、不正形式、大文字小文字や前後空白を含む
- 参加者招待で参加者名が空、長すぎる、または空白のみ
- 同じメールアドレスに複数 role または複数 classroom の招待が存在する
- 招待先ユーザーがすでに対象 organization、classroom、participant として存在する
- 未対応招待が承諾直前に取消、辞退、期限切れ、または別操作で処理済みになる
- 招待先ユーザーがメールアドレスを変更した、またはログイン中ユーザーにメールアドレスがない
- 招待メール送信に失敗する
- organization または classroom が削除、非表示、または URL 上の slug と一致しない
- Premium 状態が招待作成後、承諾前、一覧表示前に変化する
- 招待者本人が権限を失った後に取消や再送を試みる

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST require an authenticated user before creating, listing, viewing, accepting, rejecting, resending, or cancelling invitations.
- **FR-002**: System MUST support three invitation categories: organization operator invitations, classroom operator invitations, and participant invitations.
- **FR-003**: System MUST allow organization operator invitations only for organization-level roles member and admin.
- **FR-004**: System MUST allow classroom operator invitations only for classroom-level roles staff and manager.
- **FR-005**: System MUST allow participant invitations only with a recipient email address and participant name.
- **FR-006**: System MUST scope every invitation to exactly one organization and MAY additionally scope it to one classroom when the invitation is classroom-specific.
- **FR-007**: System MUST normalize recipient email addresses before duplicate checks, recipient checks, and persistence-visible behavior.
- **FR-008**: System MUST create new invitations in an unprocessed state with an expiration time.
- **FR-009**: System MUST send an invitation email after a new invitation is created or a pending invitation is resent.
- **FR-010**: System MUST prevent a duplicate pending invitation for the same organization, optional classroom, invitation category, role, and recipient email.
- **FR-011**: Users MUST be able to resend a pending invitation when they have permission to manage that invitation.
- **FR-012**: System MUST limit resends of a single invitation to 3 successful resend operations.
- **FR-013**: Users MUST be able to cancel a pending invitation when they are the original inviter or have management permission for the invitation scope.
- **FR-014**: System MUST allow recipients to view invitation detail only when their authenticated email matches the invitation recipient email.
- **FR-015**: System MUST allow recipients to accept or reject only pending invitations addressed to their authenticated email.
- **FR-016**: System MUST treat expired invitations as expired before showing or acting on them.
- **FR-017**: System MUST prevent accepted, rejected, cancelled, or expired invitations from being accepted, rejected, resent, or cancelled again.
- **FR-018**: When an organization operator invitation is accepted, System MUST create or update the recipient's organization membership without reducing an existing higher role.
- **FR-019**: When a classroom operator invitation is accepted, System MUST ensure organization membership exists and create or update the recipient's classroom membership without reducing an existing higher classroom role.
- **FR-020**: When a participant invitation is accepted, System MUST create or reuse a participant record for the recipient in the invitation's organization and classroom.
- **FR-021**: System MUST keep recipient-facing invitation lists limited to invitations addressed to the authenticated user's email.
- **FR-022**: System MUST keep sender-facing organization invitation lists limited to users with organization management permission.
- **FR-023**: System MUST keep sender-facing classroom invitation lists limited by classroom management and participant management permissions.
- **FR-024**: System MUST enforce Premium restrictions for invitation management surfaces and protected invitation operations.
- **FR-025**: System MUST return clear user-facing failure messages for unauthorized access, missing scope, duplicate pending invitations, resend limit, expired invitations, processed invitations, and Premium restrictions.
- **FR-026**: System MUST record audit events for invitation creation, resend, acceptance, rejection, and cancellation.
- **FR-027**: Audit records MUST include the invitation, organization, optional classroom, actor, target email, action, timestamp, and minimal action metadata.
- **FR-028**: System MUST NOT expose invitation details, audit history, unrelated organization/classroom names, or recipient personal data to users outside the invitation's permitted scope.
- **FR-029**: System MUST keep existing organization/classroom authorization behavior as the source of truth and MUST NOT rely on UI labels, URL display text, or client-provided role labels for authorization.
- **FR-030**: System MUST preserve existing invitation statuses and user-facing meanings: pending, accepted, rejected, cancelled, and expired.

### Key Entities

- **Invitation**: A request for a recipient email address to join an organization, join a classroom as an operator, or become a participant. It has a category, role, target scope, status, expiration, inviter, and response information.
- **Organization Operator Invitation**: An invitation for an admin or member role at the organization level.
- **Classroom Operator Invitation**: An invitation for a manager or staff role within a specific classroom, with organization membership ensured on acceptance.
- **Participant Invitation**: An invitation for a participant in a specific classroom, including the participant name shown to the recipient and used when creating participant access.
- **Invitation Recipient**: The authenticated user whose email address matches the invitation recipient email and who may view, accept, or reject that invitation.
- **Invitation Manager**: A user with permission to create, list, resend, or cancel invitations for a given organization/classroom scope.
- **Invitation Status**: The lifecycle state of an invitation: pending, accepted, rejected, cancelled, or expired.
- **Invitation Audit Event**: A minimal record of a significant invitation action for operational traceability.

### Constitution Alignment _(mandatory)_

- **I. Existing Architecture**: The specification documents the existing organization/classroom-scoped invitation behavior and does not introduce a new app boundary, deployment path, or branch workflow. The feature remains compatible with existing scoped URLs and legacy invite entry points.
- **II. Type Safety と API Boundary**: Recipient email, role, invitation category, participant name, status, session identity, organization/classroom scope, and response payloads must be validated and normalized before they affect invitations or membership.
- **III. Authorization と Scope**: Authorization remains based on trusted session identity, organization membership, classroom membership, participant management capability, and invitation recipient email. Client display state and route text must not become authorization sources.
- **IV. Risk-Based Verification**: Role boundaries, recipient-only access, duplicate prevention, resend limits, expiration behavior, Premium restriction, acceptance side effects, and audit logging require regression coverage.
- **V. Data, Billing, Deployment Safety**: Invitation state changes must be idempotent from the user's perspective, auditable, and safe under concurrent response attempts. Premium gating must continue to use the organization entitlement source of truth.
- **VI. UI と Design System**: Invitation management and recipient screens must follow DESIGN.md, distinguish available and unavailable actions with text and disabled states, and avoid relying on color alone for pending, processed, restricted, or error states.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of covered role-boundary tests allow invitation creation only for users with the required organization, classroom, or participant management permission.
- **SC-002**: 100% of covered recipient-boundary tests prevent users from viewing or responding to invitations addressed to another email address.
- **SC-003**: 100% of covered duplicate scenarios prevent creation of a second pending invitation for the same target scope, category, role, and email.
- **SC-004**: 100% of covered resend scenarios allow at most 3 successful resends for a single pending invitation.
- **SC-005**: 100% of covered processed-state scenarios prevent accepted, rejected, cancelled, and expired invitations from being accepted again.
- **SC-006**: 100% of covered acceptance scenarios result in the correct organization membership, classroom membership, or participant access for the invitation category.
- **SC-007**: 100% of covered role-merge scenarios preserve an existing higher organization or classroom role when accepting a lower-role invitation.
- **SC-008**: 100% of covered Premium-restricted scenarios block protected invitation management operations and show a clear plan requirement message.
- **SC-009**: 100% of covered invitation action scenarios create an audit event with actor, target email, target scope, action, and timestamp.
- **SC-010**: A user can identify whether an invitation is pending, processed, expired, restricted, or unavailable from the UI without relying on color alone.
- **SC-011**: At least 95% of standard invitation create, list, detail, accept, reject, cancel, and resend flows complete or show a clear recoverable error within 5 seconds under normal operating conditions.
- **SC-012**: 0 covered tests expose unrelated organization/classroom invitations, audit history, or invitee personal data to unauthorized users.

## Assumptions

- This specification captures the current behavior and is not a request to redesign invitation UX, data model, email contents, or permissions.
- Existing authentication, organization membership, classroom membership, participant management capability, and Premium entitlement remain the source of truth.
- Invitation expiration is 2 days from creation unless a later planning phase explicitly changes it.
- Resend limit is 3 successful resend operations per invitation.
- Management UI is web-first; mobile-specific invitation screens are out of scope for this specification.
- Email delivery is required for the normal invitation flow, but recipient-facing in-app lists can still show invitations addressed to the logged-in user's email.
- Human-readable role names in UI may be localized, but the product meanings of admin, member, manager, staff, and participant remain unchanged.
- The feature branch hook is intentionally skipped because the user explicitly required no branch switching.
