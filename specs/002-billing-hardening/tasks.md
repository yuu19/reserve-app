# Tasks: Billing Production Hardening

**Input**: Design documents from `/specs/002-billing-hardening/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Required. This feature changes billing lifecycle, Stripe/webhook processing, D1 schema, API response shape, Premium entitlement, notification delivery, internal inspection, and user-visible billing branching.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after the shared foundation is complete.

## Phase 1: Setup (Shared Context)

**Purpose**: Confirm the existing brownfield billing baseline and prepare implementation evidence.

- [x] T001 Review hardening scope and source layout in specs/002-billing-hardening/spec.md, specs/002-billing-hardening/plan.md, and specs/002-billing-hardening/data-model.md
- [x] T002 [P] Review current billing baseline and completed follow-up tasks in specs/001-organization-billing/tasks.md
- [x] T003 [P] Review current Stripe billing environment documentation in apps/backend/.env.example and apps/backend/.dev.vars.example
- [x] T004 [P] Review current operational deployment notes in docs/README.md and docs/billing.md
- [x] T005 [P] Review current backend and web billing test coverage in apps/backend/src/app.test.ts and apps/web/src/routes/contracts/page.svelte.spec.ts
- [x] T006 Add an implementation evidence checklist section for this feature in specs/002-billing-hardening/quickstart.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared schema, type, response, and fixture foundations required by all user stories.

**CRITICAL**: No user story implementation should start until this phase is complete.

- [x] T007 Add additive D1 migration for operation attempts, invoice events, document references, billing readiness fields, payment issue fields, and webhook receipt fields in apps/backend/drizzle/0017_billing_production_hardening.sql
- [x] T008 Update Drizzle schema for billing hardening tables and columns in apps/backend/src/db/schema.ts
- [x] T009 [P] Add billing operation attempt domain types and 30-minute reuse helpers in apps/backend/src/billing/organization-billing-operations.ts
- [x] T010 [P] Add invoice/payment event domain types and persistence helpers in apps/backend/src/billing/organization-billing-invoice-events.ts
- [x] T011 [P] Add billing profile readiness domain types and normalization helpers in apps/backend/src/billing/organization-billing-profile.ts
- [x] T012 Update shared billing aggregate selectors and mutation helpers for new fields in apps/backend/src/billing/organization-billing.ts
- [x] T013 Update billing observation snapshots, signal reasons, and audit source kinds for new hardening states in apps/backend/src/billing/organization-billing-observability.ts
- [x] T014 Add common billing action envelope schemas and response builders in apps/backend/src/routes/auth-routes.ts
- [x] T015 Update web RPC payload types and guards for common billing action envelope and hardening fields in apps/web/src/lib/rpc-client.ts
- [x] T016 Update organization context billing helpers to consume common action envelopes in apps/web/src/lib/features/organization-context.svelte.ts
- [x] T017 [P] Add backend billing fixture helpers for hardening scenarios in apps/backend/src/app.test.ts
- [x] T018 [P] Add web billing fixture builders for hardening UI states in apps/web/src/routes/contracts/page.svelte.spec.ts
- [x] T019 Add migration/backfill compatibility regression coverage for existing billing rows, including a negative regression that billing lifecycle remains organization-scoped and no classroom-scoped subscription ownership is created, in apps/backend/src/app.test.ts

**Checkpoint**: Schema, contracts, shared response shape, and fixtures are ready.

---

## Phase 3: User Story 1 - 支払い状態に応じた Premium 利用制御 (Priority: P1) MVP

**Goal**: Premium eligibility, owner messaging, and notifications behave consistently for incomplete, past due, unpaid, canceled, scheduled cancellation, and recovered payment states.

**Independent Test**: Create organizations in each payment state and verify contract summary, Premium-gated operations, owner/non-owner messaging, notification history, and internal signals all follow the same eligibility decision.

### Tests for User Story 1

- [x] T020 [P] [US1] Add policy tests for incomplete, past_due grace, unpaid, canceled, scheduled period-end cancellation, and recovery in apps/backend/src/billing/organization-billing-policy.test.ts
- [x] T021 [P] [US1] Add backend integration tests for Premium-gated operations under incomplete, past_due, unpaid, canceled, and recovered states in apps/backend/src/app.test.ts
- [x] T022 [P] [US1] Add backend integration tests for verified-owner payment failed/action-required email records and no-verified-owner internal signal behavior in apps/backend/src/app.test.ts
- [x] T023 [P] [US1] Add web contracts page tests for owner and non-owner payment issue states in apps/web/src/routes/contracts/page.svelte.spec.ts

### Implementation for User Story 1

- [x] T024 [US1] Update Premium entitlement policy for incomplete immediate stop, past_due 7-day grace, unpaid stop, canceled stop, and scheduled cancellation behavior in apps/backend/src/billing/organization-billing-policy.ts
- [x] T025 [US1] Update billing aggregate mutation logic to maintain payment issue start, grace end, cancellation, and recovery fields in apps/backend/src/billing/organization-billing.ts
- [x] T026 [US1] Update Premium restriction reasons and owner/non-owner messaging payloads in apps/backend/src/billing/organization-billing-policy.ts and apps/web/src/lib/features/premium-restrictions.ts
- [x] T027 [US1] Add payment failure, action-required, past-due reminder, and no-verified-owner notification logic in apps/backend/src/billing/organization-billing-notifications.ts
- [x] T028 [US1] Add or extend Resend email senders for payment failed, action required, and past-due grace reminder emails in apps/backend/src/email/resend.ts
- [x] T029 [US1] Append notification audit events and support-visible signals for payment issues in apps/backend/src/billing/organization-billing-observability.ts
- [x] T030 [US1] Include payment issue status, grace deadline, cancellation status, and notification context in billing summary responses in apps/backend/src/routes/auth-routes.ts
- [x] T031 [US1] Update web RPC types for payment issue, grace, cancellation, and notification fields in apps/web/src/lib/rpc-client.ts
- [x] T032 [US1] Render owner payment issue guidance, grace deadline, cancellation date, and non-owner read-only messaging in apps/web/src/routes/contracts/+page.svelte
- [x] T033 [US1] Update owner billing history display for payment issue notification outcomes in apps/web/src/routes/contracts/+page.svelte

**Checkpoint**: User Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 - 課金操作の冪等性と自動復旧 (Priority: P1)

**Goal**: Repeated owner billing actions and duplicated/delayed/missing Stripe events converge to one correct organization billing state with audit and reconciliation context.

**Independent Test**: Repeat trial, checkout, payment-method, and portal actions within and after 30 minutes; replay duplicate webhooks; reject invalid signatures; run targeted and full reconciliation; verify one correct aggregate state and append-only diagnostics.

### Tests for User Story 2

- [x] T034 [P] [US2] Add backend tests for 30-minute handoff reuse and post-expiry recreation for trial, checkout, setup, and portal actions in apps/backend/src/app.test.ts
- [x] T035 [P] [US2] Add Stripe webhook duplicate event id no-op tests for state, notification, entitlement, and invoice history in apps/backend/src/app.test.ts
- [x] T036 [P] [US2] Add Stripe webhook signature failure tests for unsigned, mismatched, and expired signatures in apps/backend/src/app.test.ts
- [x] T037 [P] [US2] Add targeted and full reconciliation tests for risky states and provider-linked statuses in apps/backend/src/app.test.ts
- [x] T038 [P] [US2] Add payment adapter tests for Stripe idempotency metadata and provider lookup summaries in apps/backend/src/payment/stripe.test.ts

### Implementation for User Story 2

- [x] T039 [US2] Implement persistent operation attempt claiming, reuse, expiry, conflict, and failure state in apps/backend/src/billing/organization-billing-operations.ts
- [x] T040 [US2] Integrate operation attempt reuse into trial, checkout, payment method, and portal routes in apps/backend/src/routes/auth-routes.ts
- [x] T041 [US2] Add Stripe idempotency key support and provider metadata propagation for billing handoffs in apps/backend/src/payment/stripe.ts
- [x] T042 [US2] Harden Stripe webhook receipt flow for permanent event id idempotency and duplicate receipt classification in apps/backend/src/billing/stripe-webhook-sync.ts
- [x] T043 [US2] Reject unsigned, mismatched, and expired Stripe webhook signatures before event trust and persist sanitized failure context in apps/backend/src/app.ts
- [x] T044 [US2] Add targeted risky-state reconciliation logic in apps/backend/src/billing/organization-billing-maintenance.ts
- [x] T045 [US2] Add daily full provider-linked reconciliation logic in apps/backend/src/billing/organization-billing-maintenance.ts
- [x] T046 [US2] Wire scheduled targeted and full reconciliation entry points in apps/backend/src/worker.ts
- [x] T047 [US2] Append reconciliation audit entries and resolve stale signals without no-op churn in apps/backend/src/billing/organization-billing-observability.ts
- [x] T048 [US2] Expose operation attempt, webhook receipt, duplicate, and reconciliation context in internal inspection in apps/backend/src/billing/internal-billing-inspection.ts
- [x] T049 [US2] Update internal inspection route schemas for operation attempts, webhook signature failures, duplicate receipts, and reconciliation cadence in apps/backend/src/routes/auth-routes.ts

**Checkpoint**: User Story 2 is independently functional and testable.

---

## Phase 5: User Story 3 - Owner の契約開始・管理導線 (Priority: P2)

**Goal**: Owners can start trial or paid checkout according to trial usage, choose monthly/yearly paid entry, understand pre-checkout pricing, and open portal for recoverable provider-linked states.

**Independent Test**: Verify free/trial available, trial-used free, direct paid checkout, paid active, payment issue, canceled, and non-owner contract page states with correct owner actions and common API envelope responses.

### Tests for User Story 3

- [x] T050 [P] [US3] Add backend contract tests for billing summary, trial, checkout, payment method, and portal common envelopes in apps/backend/src/app.test.ts
- [x] T051 [P] [US3] Add backend tests for monthly/yearly paid checkout availability and trial-used direct paid checkout in apps/backend/src/app.test.ts
- [x] T052 [P] [US3] Add backend tests for portal eligibility on active, trialing, past_due, unpaid, incomplete, free, canceled, and no-provider-subscription states in apps/backend/src/app.test.ts
- [x] T053 [P] [US3] Add web contracts page tests for trial-available, trial-used free, monthly/yearly checkout, portal eligibility, and non-owner read-only states in apps/web/src/routes/contracts/page.svelte.spec.ts

### Implementation for User Story 3

- [x] T054 [US3] Add billing action availability resolver for trial, paid checkout, payment method setup, and portal decisions in apps/backend/src/billing/organization-billing.ts
- [x] T055 [US3] Update paid checkout route to support trial-used free organizations and return common envelope with reused handoff state in apps/backend/src/routes/auth-routes.ts
- [x] T056 [US3] Update portal route to allow provider-linked active, trialing, past_due, unpaid, and incomplete states and block free, canceled, and no-provider-subscription states in apps/backend/src/routes/auth-routes.ts
- [x] T057 [US3] Add monthly/yearly price availability and pre-checkout display fields to billing summary in apps/backend/src/routes/auth-routes.ts
- [x] T058 [US3] Update organization context helpers for trial, checkout, setup, and portal envelope handling in apps/web/src/lib/features/organization-context.svelte.ts
- [x] T059 [US3] Update web RPC payload types for action availability and handoff reuse fields in apps/web/src/lib/rpc-client.ts
- [x] T060 [US3] Render trial-used free state, monthly/yearly paid checkout controls, and pre-checkout billing copy in apps/web/src/routes/contracts/+page.svelte
- [x] T061 [US3] Render portal availability and unavailable reasons for payment issue, free, canceled, and non-owner states in apps/web/src/routes/contracts/+page.svelte

**Checkpoint**: User Story 3 is independently functional and testable.

---

## Phase 6: User Story 4 - 請求書・領収書・請求イベントの可視化 (Priority: P2)

**Goal**: Owners and internal operators can safely inspect invoice, receipt, payment success, payment failure, payment action required, invoice availability, and owner notification outcomes without payment detail leakage.

**Independent Test**: Seed invoice/receipt/payment event states and verify owner UI plus internal inspection show only provider-derived references, statuses, timestamps, notification outcomes, and support actions.

### Tests for User Story 4

- [x] T062 [P] [US4] Add document readiness tests for available, unavailable, missing, and checking invoice/receipt states in apps/backend/src/billing/organization-billing-documents.test.ts
- [x] T063 [P] [US4] Add backend webhook tests for invoice available, payment succeeded, payment failed, and payment action required event normalization in apps/backend/src/app.test.ts
- [x] T064 [P] [US4] Add backend internal inspection tests for invoice/payment event context and notification outcomes without payment details in apps/backend/src/app.test.ts
- [x] T065 [P] [US4] Add web contracts page tests for owner payment document states and non-owner document denial in apps/web/src/routes/contracts/page.svelte.spec.ts

### Implementation for User Story 4

- [x] T066 [US4] Add Stripe invoice, payment intent, and charge receipt parsing helpers for provider-derived document references in apps/backend/src/payment/stripe.ts
- [x] T067 [US4] Implement invoice/payment event persistence and no-raw-payload safeguards in apps/backend/src/billing/organization-billing-invoice-events.ts
- [x] T068 [US4] Extend Stripe webhook normalization for invoice availability, payment success, payment failure, and action-required events in apps/backend/src/billing/stripe-webhook-sync.ts
- [x] T069 [US4] Update payment document readiness builder to include available, unavailable, missing, and checking states in apps/backend/src/billing/organization-billing-documents.ts
- [x] T070 [US4] Include invoice/payment events and document references in owner billing history in apps/backend/src/billing/organization-billing-history.ts
- [x] T071 [US4] Include invoice/payment events, document references, and owner notification results in internal inspection in apps/backend/src/billing/internal-billing-inspection.ts
- [x] T072 [US4] Update billing summary and internal inspection schemas for invoice/payment event and document fields in apps/backend/src/routes/auth-routes.ts
- [x] T073 [US4] Update web RPC types for invoice/payment events and document states in apps/web/src/lib/rpc-client.ts
- [x] T074 [US4] Render owner invoice/receipt links, unavailable/missing/checking states, and payment event history in apps/web/src/routes/contracts/+page.svelte
- [x] T075 [US4] Ensure non-owner UI cannot render payment document links or billing document controls in apps/web/src/routes/contracts/+page.svelte

**Checkpoint**: User Story 4 is independently functional and testable.

---

## Phase 7: User Story 5 - 請求先情報・価格カタログ・税務境界の管理 (Priority: P3)

**Goal**: Billing profile readiness, tax collection boundary, and paid tier price catalog behavior protect Premium entitlement while keeping checkout provider-hosted.

**Independent Test**: Verify known price, unknown price, missing profile, unavailable profile, and otherwise-eligible readiness gaps across checkout, Premium eligibility, owner guidance, and internal inspection.

### Tests for User Story 5

- [x] T076 [P] [US5] Add policy tests for known price, unknown price, and paid tier capability resolution in apps/backend/src/billing/organization-billing-policy.test.ts
- [x] T077 [P] [US5] Add backend tests confirming billing profile readiness does not block checkout or Premium eligibility in apps/backend/src/app.test.ts
- [x] T078 [P] [US5] Add backend internal inspection tests for unknown price and billing profile readiness diagnostics in apps/backend/src/app.test.ts
- [x] T079 [P] [US5] Add web contracts page tests for unknown price and billing profile readiness owner guidance in apps/web/src/routes/contracts/page.svelte.spec.ts

### Implementation for User Story 5

- [x] T080 [US5] Update paid tier catalog resolution to stop Premium for unknown Stripe price ids and expose diagnostic reasons in apps/backend/src/billing/organization-billing-policy.ts
- [x] T081 [US5] Implement billing profile readiness persistence and owner/support next-action helpers in apps/backend/src/billing/organization-billing-profile.ts
- [x] T082 [US5] Include billing profile readiness and unknown price diagnostics in billing summary responses in apps/backend/src/routes/auth-routes.ts
- [x] T083 [US5] Include billing profile readiness, unknown price, and price catalog diagnostics in internal inspection in apps/backend/src/billing/internal-billing-inspection.ts
- [x] T084 [US5] Update web RPC types for billing profile readiness and unknown price diagnostics in apps/web/src/lib/rpc-client.ts
- [x] T085 [US5] Render billing profile readiness guidance and unknown price support-safe messaging in apps/web/src/routes/contracts/+page.svelte

**Checkpoint**: User Story 5 is independently functional and testable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, release evidence, validation, and final consistency checks across all stories.

- [x] T086 [P] Update billing API contract with final implementation response fields and run/record contract validation for billing summary, trial, checkout, payment method, portal, and inspection responses in specs/002-billing-hardening/contracts/billing-api.openapi.yaml and specs/002-billing-hardening/quickstart.md
- [x] T087 [P] Update billing UI contract with final owner, non-owner, document, payment issue, and internal inspection states in specs/002-billing-hardening/contracts/billing-ui-contract.md
- [x] T088 [P] Update deployment and migration order notes for billing hardening in docs/README.md
- [x] T089 [P] Update billing operations documentation for Stripe dashboard, webhook events, Customer Portal, invoices, owner emails, and reconciliation in docs/billing.md
- [x] T090 Record manual release evidence for Stripe webhook, Customer Portal, price ids, document links, owner emails, and scheduled reconciliation in specs/002-billing-hardening/quickstart.md
- [x] T091 Run backend targeted tests and record results in specs/002-billing-hardening/quickstart.md
- [x] T092 Run web targeted tests and record results in specs/002-billing-hardening/quickstart.md
- [x] T093 Run pnpm test, pnpm typecheck, pnpm lint, and pnpm format:check, record results or blockers, and include owner billing summary 3-second evidence under normal test conditions in specs/002-billing-hardening/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup and blocks all user stories.
- **US1 (Phase 3, P1 MVP)**: Depends on Foundational.
- **US2 (Phase 4, P1)**: Depends on Foundational; can run in parallel with US1 after shared schema/envelope is complete, but final reconciliation assertions should be checked after US1 policy behavior stabilizes.
- **US3 (Phase 5, P2)**: Depends on Foundational; uses operation attempts from US2 for final handoff reuse behavior.
- **US4 (Phase 6, P2)**: Depends on Foundational; webhook invoice/payment event handling benefits from US2 webhook hardening.
- **US5 (Phase 7, P3)**: Depends on Foundational; unknown price entitlement overlaps with US1 policy but remains independently testable.
- **Polish (Phase 8)**: Depends on selected user stories being complete.

### User Story Dependencies

- **US1**: MVP; no dependency on other user stories after foundation.
- **US2**: Independent recovery/idempotency slice; should be completed before relying on stable handoff reuse in US3.
- **US3**: User-facing action slice; depends on shared envelope and should integrate with US2 operation attempts when available.
- **US4**: Invoice/document slice; depends on webhook hardening from US2 for final event intake behavior.
- **US5**: Price/readiness slice; can be completed after US1 policy foundations.

### Within Each User Story

- Write tests first and confirm they fail before implementation.
- Update domain/persistence before routes.
- Update route schemas before web RPC types.
- Update web data helpers before Svelte UI.
- Complete story-specific backend and web tests before moving to the next story checkpoint.

## Parallel Execution Examples

### US1

```text
Task: "T020 [P] [US1] Add policy tests for incomplete, past_due grace, unpaid, canceled, scheduled period-end cancellation, and recovery in apps/backend/src/billing/organization-billing-policy.test.ts"
Task: "T023 [P] [US1] Add web contracts page tests for owner and non-owner payment issue states in apps/web/src/routes/contracts/page.svelte.spec.ts"
```

### US2

```text
Task: "T035 [P] [US2] Add Stripe webhook duplicate event id no-op tests for state, notification, entitlement, and invoice history in apps/backend/src/app.test.ts"
Task: "T038 [P] [US2] Add payment adapter tests for Stripe idempotency metadata and provider lookup summaries in apps/backend/src/payment/stripe.test.ts"
```

### US3

```text
Task: "T051 [P] [US3] Add backend tests for monthly/yearly paid checkout availability and trial-used direct paid checkout in apps/backend/src/app.test.ts"
Task: "T053 [P] [US3] Add web contracts page tests for trial-available, trial-used free, monthly/yearly checkout, portal eligibility, and non-owner read-only states in apps/web/src/routes/contracts/page.svelte.spec.ts"
```

### US4

```text
Task: "T062 [P] [US4] Add document readiness tests for available, unavailable, missing, and checking invoice/receipt states in apps/backend/src/billing/organization-billing-documents.test.ts"
Task: "T065 [P] [US4] Add web contracts page tests for owner payment document states and non-owner document denial in apps/web/src/routes/contracts/page.svelte.spec.ts"
```

### US5

```text
Task: "T076 [P] [US5] Add policy tests for known price, unknown price, and paid tier capability resolution in apps/backend/src/billing/organization-billing-policy.test.ts"
Task: "T079 [P] [US5] Add web contracts page tests for unknown price and billing profile readiness owner guidance in apps/web/src/routes/contracts/page.svelte.spec.ts"
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1) only.
3. Validate Premium eligibility, owner/non-owner status, notifications, and internal signals.
4. Stop and review before adding handoff/reconciliation hardening.

### Incremental Delivery

1. Foundation.
2. US1 payment state correctness and owner communication.
3. US2 idempotency, webhook hardening, and reconciliation.
4. US3 owner paid entry and portal UX.
5. US4 invoice/payment documents and support visibility.
6. US5 price catalog and billing profile readiness.
7. Polish and release evidence.

### Parallel Team Strategy

After Phase 2:

- Backend policy owner can start US1/US5 policy tests and implementation.
- Web owner can start US3/US4 UI tests using fixture payloads.
- Billing integration owner can start US2 webhook/reconciliation tests and operation attempt service.
- Documentation owner can prepare Phase 8 docs once route and operational decisions stabilize.
