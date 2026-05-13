# Feature Specification: AI Chatbot

**Feature Branch**: `004-ai-chatbot`  
**Created**: 2026-05-12  
**Status**: Draft  
**Input**: User description: "reserve-app の既存構成を前提に、AIチャット機能 V1 を作成する。利用者の質問に対して、ナレッジ検索、権限判定、業務文脈、根拠提示、会話ログ、フィードバックを備えたAIサポートを提供する。"

## Clarifications

### Session 2026-05-12

- Q: How should internal specifications be used as AI knowledge in V1? → A: Specs may inform answers only for permitted internal/operational roles; general users see docs/FAQ/safe summaries only.
- Q: How long should AI conversation content and feedback be retained in V1? → A: AI conversation content is retained for 180 days, then deleted or anonymized; aggregate feedback is retained for 1 year.
- Q: What AI chat usage limits should V1 enforce? → A: 20 messages per user per hour and 200 messages per organization per day.
- Q: Who can review AI feedback themes, conversation context, and knowledge freshness in V1? → A: Internal operators only.
- Q: How should business facts be used in V1 answers? → A: Use current permitted business facts at answer time for booking, invitation, ticket, participant, and billing summaries.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 根拠付きセルフサポート (Priority: P1)

ログイン済み利用者は、予約、参加者、チケット、課金、招待、操作方法について質問し、アプリ内で根拠付きの回答と次に取るべき導線を確認できる。回答は操作を代行せず、利用者が判断して画面を開ける案内に留める。

**Why this priority**: 問い合わせ前に利用者が自力で解決できることが、AIチャット V1 の最小価値であり、サポート負荷と業務停止時間を直接下げるため。

**Independent Test**: 代表的な予約、参加者、チケット、課金、招待の質問を入力し、回答、根拠、推奨導線、低信頼時の案内が期待どおりであることを確認できる。

**Acceptance Scenarios**:

1. **Given** ログイン済み利用者が予約設定画面にいる, **When** 「予約枠を作るには？」と質問する, **Then** 予約枠作成に関する回答、参照元、該当画面への導線が表示される
2. **Given** 回答に使える根拠が十分にある, **When** 利用者が操作方法を質問する, **Then** 回答には根拠として確認できる情報源が少なくとも1件表示される
3. **Given** 根拠が見つからない質問が入力された, **When** AIチャットが回答する, **Then** 推測で断定せず、確認できない旨と人への相談導線を表示する
4. **Given** 利用者が「このまま予約を作成して」と依頼する, **When** AIチャットが応答する, **Then** 予約作成を実行せず、作成画面または必要な手順を案内する

---

### User Story 2 - 権限に応じた安全な回答 (Priority: P1)

owner、admin、manager、staff、participant は、自分の organization と classroom に対して許可された範囲の情報だけを使った回答を受け取る。課金や請求書など owner-only の情報は、owner 以外には詳細を返さず、owner に確認する案内を出す。

**Why this priority**: AI回答が権限外の業務情報や課金情報を漏らすと、既存の認可境界を破壊し、機能全体を提供できなくなるため。

**Independent Test**: 同じ質問を owner、manager、staff、participant で実行し、回答内容、根拠、推奨導線が各 role の許可範囲に収まることを確認できる。

**Acceptance Scenarios**:

1. **Given** participant が請求書の場所を質問する, **When** AIチャットが応答する, **Then** 請求書や支払い詳細を表示せず、owner に確認するよう案内する
2. **Given** owner が Premium の支払い方法について質問する, **When** AIチャットが応答する, **Then** owner に許可された契約状態の概要と支払い方法更新導線を表示する
3. **Given** staff が参加者管理について質問する, **When** staff に参加者管理権限がない, **Then** 権限が必要な操作は実行できないことと、管理者へ確認する案内を表示する
4. **Given** 利用者が別 organization の識別子を指定して質問する, **When** その organization への権限がない, **Then** その organization の情報を使わず、権限外であることを示す

---

### User Story 3 - 業務文脈を踏まえた案内 (Priority: P2)

owner、manager、staff は、現在の画面、所属 classroom、利用可能な権限、予約・参加者・チケット・課金の現在状態を踏まえた案内を受けられる。回答は一般的なヘルプだけでなく、利用者の状況で次に確認すべき項目を示す。

**Why this priority**: reserve-app の問い合わせは設定状態や権限によって答えが変わるため、一般的なFAQだけでは解決に至らないケースが多いため。

**Independent Test**: 予約設定、招待、チケット残数、Premium 状態が異なる organization/classroom を用意し、同じ質問でも状況に応じた案内に変わることを確認できる。

**Acceptance Scenarios**:

1. **Given** 承認制予約が有効な classroom, **When** manager が「即時予約と承認制予約の違いは？」と質問する, **Then** 一般的な違いに加えて現在の classroom の設定確認を促す
2. **Given** チケット残数がある参加者が予約できない, **When** staff が理由を質問する, **Then** 予約条件、チケット条件、参加者状態の確認ポイントを示す
3. **Given** Premium が有効にならない organization, **When** owner が質問する, **Then** 契約状態、支払い方法、利用権限の確認ポイントと owner が取れる導線を示す
4. **Given** 招待が失敗している, **When** manager が質問する, **Then** 招待権限、メール状態、参加者登録状態の確認ポイントを示す

---

### User Story 4 - フィードバックと人への引き継ぎ (Priority: P3)

利用者はAI回答に対して役に立ったかどうかを送信でき、回答が不十分な場合は人への相談または owner/support への確認導線へ進める。internal operator は低評価や低信頼の回答を改善対象として確認できる。

**Why this priority**: AI回答の品質は初回から完全にはならないため、利用者が困った状態で止まらず、改善のためのシグナルを残せる必要があるため。

**Independent Test**: 回答に対する高評価、低評価、コメント付きフィードバック、低信頼回答、人への相談導線を個別に確認できる。

**Acceptance Scenarios**:

1. **Given** AI回答が表示された, **When** 利用者が「役に立たなかった」を選ぶ, **Then** 任意コメントを残せ、改善対象として記録される
2. **Given** AIチャットが低信頼と判断した, **When** 回答を表示する, **Then** 断定を避け、人への相談または確認先への導線を表示する
3. **Given** owner 以外の利用者が課金詳細を質問する, **When** AIチャットが応答する, **Then** 人への相談先は支払い詳細を含まない安全な表現で案内される

---

### User Story 5 - 知識鮮度と運用品質の確認 (Priority: P3)

internal operator は、AIチャットが参照するドキュメント、仕様、FAQ、安全な業務サマリーの対象範囲、公開範囲、言語、更新状態を確認できる。古い情報や失敗した更新がある場合は、利用者に誤った回答を出す前に検知できる。

**Why this priority**: AI回答の品質は参照知識の鮮度と公開範囲に依存するため、V1でも最低限の運用確認がなければ安全に継続できないため。

**Independent Test**: 新規FAQ追加、既存ドキュメント更新、公開範囲変更、更新失敗、重複内容を用意し、AI回答と運用確認状態が期待どおりであることを確認できる。

**Acceptance Scenarios**:

1. **Given** FAQが更新された, **When** internal operator が知識更新を確認する, **Then** 更新日時、対象範囲、公開範囲、利用可能状態が確認できる
2. **Given** owner-only の課金FAQが登録されている, **When** participant が関連質問をする, **Then** owner-only の本文や詳細は回答にも根拠にも表示されない
3. **Given** 知識更新に失敗した情報源がある, **When** internal operator が確認する, **Then** 失敗状態と再確認が必要な情報源が分かる

### Edge Cases

- 質問が空、長すぎる、連続投稿される、または複数の意図を含む
- 利用者の session が期限切れ、または organization/classroom の所属が変更済み
- 現在のページ情報が古い、欠落している、または権限判断に使えない
- 検索できる根拠がない、根拠が古い、または根拠同士が矛盾している
- 利用者がプロンプト注入、秘密情報の開示、権限外の情報取得、操作実行を指示する
- 請求書、領収書、支払い方法、契約状態など owner-only の情報を non-owner が質問する
- organization または classroom をまたいだ会話継続が発生する
- AI応答生成、知識検索、業務文脈取得の一部が一時的に利用できない
- 個人情報、支払い詳細、外部サービスの生データ、内部監査情報が回答候補に含まれる
- 参照元が削除、移動、または公開範囲変更され、過去の会話に残っている

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST provide AI chat only to authenticated users and MUST require a valid user context before answering.
- **FR-002**: System MUST resolve the user's active organization, classroom, and role from trusted account state before retrieving or presenting contextual information.
- **FR-003**: Users MUST be able to send a question of up to 4,000 characters with optional current page context and continue an existing conversation when permitted.
- **FR-004**: System MUST keep AI conversations scoped to the user, organization, and classroom context in which they were created.
- **FR-005**: System MUST return an answer, source references, suggested next actions, a confidence indicator, and a human-support-needed indicator for every successful chat response.
- **FR-006**: System MUST NOT execute reservations, billing changes, participant changes, ticket changes, or other business operations from chat in V1.
- **FR-007**: System MUST base answers on approved knowledge sources and permitted business facts rather than unsupported model-only guesses.
- **FR-008**: System MUST support knowledge sources for product documentation, role-permitted internal specifications, fixed FAQ content, and safe business summaries.
- **FR-009**: Each knowledge source MUST have a title, source kind, locale, visibility level, optional organization/classroom scope, and freshness status.
- **FR-010**: System MUST show source references used for an answer when doing so is allowed for the user's role and scope.
- **FR-011**: System MUST state that it cannot confirm an answer when no reliable permitted source or business fact supports the response.
- **FR-012**: System MUST enforce visibility levels for public, authenticated, participant, staff, manager, admin, and owner information.
- **FR-013**: System MUST keep billing documents, payment method details, invoices, receipts, and owner-only billing actions unavailable to non-owner roles.
- **FR-014**: System MUST use current page context only to improve relevance and MUST NOT use it as proof of authorization.
- **FR-015**: System MUST include current permitted business facts at answer time for booking, service settings, invitations, participant status, ticket status, and billing summary when they materially affect the answer.
- **FR-016**: System MUST exclude secrets, raw external payloads, full payment method details, private audit data, and unnecessary personal data from AI answers and source snippets.
- **FR-017**: System MUST use internal specifications only for permitted internal or operational roles and MUST keep general users limited to product documentation, FAQ content, and safe summaries.
- **FR-018**: System MUST answer in Japanese by default and SHOULD answer in the user's language when supported knowledge is available.
- **FR-019**: System MUST offer human-support or owner-contact guidance when confidence is low, sources conflict, or the question requires authority the user does not have.
- **FR-020**: System MUST provide a user-friendly fallback when AI answering, knowledge search, or contextual lookup is temporarily unavailable.
- **FR-021**: Users MUST be able to submit helpful/unhelpful feedback for assistant messages and optionally add a comment for unhelpful answers.
- **FR-022**: System MUST record enough conversation, source, confidence, and feedback context to support internal-operator quality review without exposing that context to organization users or unauthorized users.
- **FR-023**: System MUST retain AI conversation content for 180 days, then delete or anonymize it, while retaining aggregate feedback for 1 year.
- **FR-024**: Internal operators MUST be able to identify stale, failed, or missing knowledge updates before release or routine operation depends on them.
- **FR-025**: System MUST avoid duplicate knowledge entries causing duplicate source citations for the same content.
- **FR-026**: System MUST limit AI chat use to 20 messages per user per hour and 200 messages per organization per day, and provide a clear retry message when either limit is reached.
- **FR-027**: System MUST preserve existing organization/classroom authorization behavior and MUST NOT introduce a separate AI-specific authority model.
- **FR-028**: System MUST keep AI answer wording consistent with existing product vocabulary for booking, participant, invitation, ticket, billing, entitlement, and role concepts.

### Key Entities

- **AI Conversation**: A scoped dialogue between a user and the assistant, associated with the organization/classroom context used for the conversation and subject to the 180-day content retention policy.
- **AI Message**: A user or assistant message, including content, role, creation time, and safe quality-review context, with content deleted or anonymized after the retention period.
- **Knowledge Document**: A source of approved information such as documentation, role-permitted specification, FAQ, or safe business summary.
- **Knowledge Chunk**: A searchable portion of a knowledge document with title, source, locale, visibility, scope, and freshness metadata.
- **Source Visibility**: The access level that determines which roles and scopes may use or view a knowledge item.
- **User Context**: The trusted combination of user identity, organization, classroom, role, capabilities, and current page hint used to shape safe answers.
- **Business Fact Summary**: A role-safe answer-time summary of current booking, invitation, ticket, participant, or billing state that may affect the answer.
- **Source Reference**: The user-visible citation or reference to information used in an answer, limited by the user's access rights.
- **Suggested Action**: A safe next step such as opening a page, contacting an owner, or contacting support.
- **AI Feedback**: A user rating and optional comment tied to an assistant message for quality review and improvement.
- **Internal Operator**: A trusted operational role that may review AI feedback themes, permitted conversation context, and knowledge freshness across organizations for support quality and safety.

### Constitution Alignment _(mandatory)_

- **I. Existing Architecture**: This feature extends the existing organization/classroom-scoped product and must not replace current app boundaries, authentication, authorization, billing ownership, or deployment paths.
- **II. Type Safety と API Boundary**: User input, session-derived context, role values, AI responses, source references, feedback, and business fact summaries must be validated and normalized before they affect answers or stored records.
- **III. Authorization と Scope**: Authorization remains based on organization/classroom scope and effective capabilities. Display role labels, current page hints, or AI-generated text must not become authorization sources.
- **IV. Risk-Based Verification**: Role filtering, source visibility, prompt-injection resistance, low-confidence fallbacks, conversation scoping, feedback persistence, and domain-specific answers require regression coverage.
- **V. Data, Billing, Deployment Safety**: Conversation and feedback records must be auditable and privacy-safe. Billing facts must continue to treat organization billing as the source of truth and owner-only billing details must remain protected.
- **VI. UI と Design System**: The chat UI, answer states, confidence, source list, feedback controls, disabled states, and fallback states must follow DESIGN.md and communicate status with text and structure, not color alone.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: At least 90% of a reviewed set of 20 representative booking, participant, ticket, invitation, and billing questions produce a helpful answer with correct next steps.
- **SC-002**: 100% of covered role-boundary tests prevent participant, staff, manager, and admin users from seeing owner-only billing details.
- **SC-003**: 100% of answers in covered grounded-answer tests either show at least one permitted source reference or explicitly state that the answer cannot be confirmed.
- **SC-004**: At least 95% of standard support questions show a complete answer or fallback within 10 seconds under normal operating conditions.
- **SC-005**: 0 covered tests allow chat to create, update, delete, or purchase anything directly; the assistant only guides users to permitted next actions.
- **SC-006**: At least 90% of reviewed answers use existing product terminology consistently for booking, participant, ticket, invitation, billing, entitlement, and role concepts.
- **SC-007**: Users can submit helpful/unhelpful feedback for an assistant answer in 2 interactions or fewer.
- **SC-008**: 100% of low-confidence, conflicting-source, or insufficient-source scenarios produce a non-assertive answer and a human-support or owner-contact path.
- **SC-009**: Knowledge updates for approved documentation and FAQ sources are reflected in AI answers or flagged as failed within 1 business day.
- **SC-010**: 100% of covered cross-organization and cross-classroom conversation tests keep conversation history, sources, and business context within the permitted scope.
- **SC-011**: No covered AI response exposes secrets, full payment method details, raw external payloads, private audit data, or unnecessary personal data.
- **SC-012**: Internal operators can identify the top unhelpful-answer themes from feedback records for a release period without reading data outside their authorized scope.
- **SC-013**: 100% of retained AI conversation content older than 180 days is deleted or anonymized, while aggregate feedback remains available for 1 year in covered retention checks.
- **SC-014**: 100% of covered usage-limit scenarios block additional AI chat messages after 20 messages per user per hour or 200 messages per organization per day and show a retry message.
- **SC-015**: 100% of covered booking, invitation, ticket, participant, and billing context scenarios use current permitted business facts at answer time or fall back without unsupported assertions.

## Assumptions

- V1 targets authenticated web users; mobile chat entry points are out of scope unless planning explicitly adds them.
- V1 provides guidance only and does not perform booking, billing, participant, ticket, invitation, or support-ticket creation actions.
- Japanese is the default language for reserve-app support content.
- Existing organization, classroom, role, billing, booking, invitation, participant, and ticket vocabulary remains the source of truth.
- Public, authenticated, participant, staff, manager, admin, and owner visibility levels are sufficient for V1 source access control.
- Approved knowledge sources for V1 are product documentation, role-permitted specifications, fixed FAQ content, and safe summaries of existing business data.
- Owner-only billing rules continue to apply to invoices, receipts, payment methods, and detailed billing actions.
- Human support handoff in V1 means guidance to contact an owner or support channel, not automatic ticket creation.
- AI conversation content is retained for 180 days, then deleted or anonymized. Aggregate feedback is retained for 1 year.
- AI chat usage is capped at 20 messages per user per hour and 200 messages per organization per day in V1.
- AI feedback theme review, conversation-context review, and knowledge freshness review are internal-operator only in V1.
- V1 answers use current permitted business facts at answer time for booking, invitation, ticket, participant, and billing summaries.
