# Tasks: Stripe Payment Failure Handling

**Input**: Design documents from `/specs/003-stripe-payment-failure/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Required. This feature changes billing lifecycle, Stripe webhook processing, owner notification scope, Premium entitlement decisions, API response shape, and user-visible authorization branches.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently after shared foundation is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other tasks in the same phase because it touches different files or test scopes
- **[Story]**: User story label from [spec.md](./spec.md)
- Every task includes an exact repository file path

## Path Conventions

- **Backend**: `apps/backend/src/`, integration tests in `apps/backend/src/app.test.ts` or focused nearby `*.test.ts`
- **Web**: `apps/web/src/lib/`, `apps/web/src/routes/`, route specs near changed files
- **E2E**: `apps/web/tests/e2e/billing/`
- **Docs**: `docs/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the brownfield storage and contract baseline before implementation.

- [x] T001 [P] Verify existing payment issue fields and indexes in `apps/backend/src/db/schema.ts` against `specs/003-stripe-payment-failure/data-model.md`
- [x] T002 [P] Verify Stripe payment issue event coverage in `apps/backend/src/billing/stripe-webhook-sync.ts` against `specs/003-stripe-payment-failure/contracts/billing-api.openapi.yaml`
- [x] T003 [P] Verify owner contract UI state coverage in `apps/web/src/routes/contracts/+page.svelte` against `specs/003-stripe-payment-failure/contracts/billing-ui-contract.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type, schema, fixture, and helper work that all user stories depend on.

**Critical**: No user story work should start until this phase is complete.

- [x] T004 Add normalized payment issue state and timing types in `apps/backend/src/billing/organization-billing.ts`
- [x] T005 Add billing summary payment issue Zod fields and internal inspection Zod fields in `apps/backend/src/routes/auth-routes.ts`
- [x] T006 [P] Add frontend billing payload payment issue fields in `apps/web/src/lib/rpc-client.ts`
- [x] T007 [P] Add shared backend fixture helpers for payment issue billing rows, invoice events, notifications, signals, and webhook receipts in `apps/backend/src/app.test.ts`
- [x] T008 [P] Add shared web route fixture helpers for payment issue summaries and safe history entries in `apps/web/src/routes/contracts/page.svelte.spec.ts`
- [x] T009 [P] Add Stripe Billing E2E helper support for declined payment recovery and repeated event replay in `apps/web/tests/e2e/billing/stripe-test-clock-helpers.ts`

**Checkpoint**: Foundation ready. User story implementation can proceed.

---

## Phase 3: User Story 1 - 支払い失敗時の Premium 利用制御 (Priority: P1)

**Goal**: Owners and operators see consistent Premium eligibility for failed, action-required, past-due, unpaid, incomplete, and recovered states.

**Independent Test**: Prepare organizations in payment failed, action-required, past-due within grace, grace expired, unpaid, incomplete, and recovered states; verify billing summary, Premium gates, owner UI, and non-owner read-only status.

### Tests for User Story 1

- [x] T010 [P] [US1] Add policy tests for provider issue time, application receipt fallback, seven-day grace, unpaid, incomplete, and recovery in `apps/backend/src/billing/organization-billing-policy.test.ts`
- [x] T011 [P] [US1] Add backend integration tests for billing summary payment issue fields and Premium gated operations in `apps/backend/src/app.test.ts`
- [x] T012 [P] [US1] Add owner and non-owner contract page tests for payment failed, action required, grace active, grace expired, unpaid, incomplete, recovered, and stale-history-only display in `apps/web/src/routes/contracts/page.svelte.spec.ts`

### Implementation for User Story 1

- [x] T013 [US1] Update payment issue field resolution to accept provider-side issue timestamps with receipt-time fallback in `apps/backend/src/billing/organization-billing.ts`
- [x] T014 [US1] Update Premium entitlement policy reasons for active grace, expired grace, unpaid, incomplete, and recovered states in `apps/backend/src/billing/organization-billing-policy.ts`
- [x] T015 [US1] Pass normalized Stripe issue timestamps and recovered provider states into billing upserts in `apps/backend/src/billing/stripe-webhook-sync.ts`
- [x] T016 [US1] Expose `paymentIssueState`, `paymentIssueTiming`, `premiumEligible`, `entitlementReason`, and `nextOwnerAction` in the billing summary response in `apps/backend/src/routes/auth-routes.ts`
- [x] T017 [US1] Update Premium restriction payload mapping so blocked Premium features use payment issue reasons in `apps/web/src/lib/features/premium-restrictions.ts`
- [x] T018 [US1] Render owner payment issue guidance, grace deadline, recovery action, recovered state, and non-owner read-only state in `apps/web/src/routes/contracts/+page.svelte`

**Checkpoint**: User Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 - owner への支払い失敗通知 (Priority: P2)

**Goal**: Verified owners receive immediate and reminder notifications, while non-owners never receive billing issue notifications.

**Independent Test**: Use organizations with multiple verified owners, no verified owners, only non-owner roles, duplicate payment issue events, and partial notification delivery failures; verify recipient-scoped outcomes and retries.

### Tests for User Story 2

- [x] T019 [P] [US2] Add backend tests for multiple verified owners receiving exactly one immediate payment issue notification in `apps/backend/src/app.test.ts`
- [x] T020 [P] [US2] Add backend tests for no verified owner, no non-owner email, and support signal creation in `apps/backend/src/app.test.ts`
- [x] T021 [P] [US2] Add focused notification tests for retrying only failed verified-owner recipients and skipping already sent recipients in `apps/backend/src/billing/organization-billing-notifications.test.ts`
- [x] T022 [P] [US2] Add backend maintenance tests for three-days-before past-due grace reminder selection in `apps/backend/src/billing/organization-billing-maintenance.test.ts`
- [x] T023 [P] [US2] Add web tests proving owner and non-owner contract UI does not expose notification recipient details in `apps/web/src/routes/contracts/page.svelte.spec.ts`

### Implementation for User Story 2

- [x] T024 [US2] Update verified owner selection and notification attempt lookup to be recipient-scoped in `apps/backend/src/billing/organization-billing-notifications.ts`
- [x] T025 [US2] Update payment issue notification sending to retry only failed verified-owner recipients and never resend to sent recipients in `apps/backend/src/billing/organization-billing-notifications.ts`
- [x] T026 [US2] Preserve no-verified-owner handling as support-visible signal without non-owner delivery in `apps/backend/src/billing/organization-billing-notifications.ts`
- [x] T027 [US2] Add past-due grace reminder discovery and dispatch for unresolved issues three days before expiry in `apps/backend/src/billing/organization-billing-maintenance.ts`
- [x] T028 [US2] Ensure payment issue notification copy includes contract-page recovery action and safe invoice reference only in `apps/backend/src/email/templates/billing-payment-issue-email.tsx`

**Checkpoint**: User Story 2 is independently functional and testable.

---

## Phase 5: User Story 3 - 支払い失敗履歴と社内調査 (Priority: P3)

**Goal**: Owners and internal operators can inspect safe payment issue history, notification outcomes, recovery flow, and support signals without payment details or raw provider payloads.

**Independent Test**: Prepare organizations with payment failure history, action-required history, sent notification, failed notification, stale failure after recovery, and recovery; verify owner-safe and internal-only fields separately.

### Tests for User Story 3

- [x] T029 [P] [US3] Add owner billing history tests for payment failed, action required, payment succeeded, recovered, and stale-history-only entries in `apps/backend/src/app.test.ts`
- [x] T030 [P] [US3] Add internal inspection tests for recipient outcomes, retry eligibility, stale failure events, and support signals in `apps/backend/src/app.test.ts`
- [x] T031 [P] [US3] Add data minimization regression tests that reject card numbers, full payment method details, tax details, and raw Stripe payload in owner and internal responses in `apps/backend/src/app.test.ts`
- [x] T032 [P] [US3] Add contract page tests for owner-safe history and absence of internal-only notification recipient details in `apps/web/src/routes/contracts/page.svelte.spec.ts`

### Implementation for User Story 3

- [x] T033 [US3] Update owner billing history mapping for payment issue, recovery, and stale-history-only entries in `apps/backend/src/billing/organization-billing-history.ts`
- [x] T034 [US3] Add internal payment issue inspection fields for notification recipients, retry eligibility, stale failures, and support signals in `apps/backend/src/billing/internal-billing-inspection.ts`
- [x] T035 [US3] Expose internal payment issue inspection contract fields through response validation in `apps/backend/src/routes/auth-routes.ts`
- [x] T036 [US3] Render owner-safe payment issue history without internal recipient data in `apps/web/src/routes/contracts/+page.svelte`

**Checkpoint**: User Story 3 is independently functional and testable.

---

## Phase 6: User Story 4 - 通知遅延・重複・順不同への収束 (Priority: P3)

**Goal**: Duplicate, delayed, out-of-order, failed, and stale Stripe events converge to the correct organization billing state, notification history, and support context.

**Independent Test**: Replay the same trusted event, process failure then success, process success then delayed failure, process untrusted webhook attempts, and process unknown linkage; verify final state and append-only history.

### Tests for User Story 4

- [x] T037 [P] [US4] Add backend webhook tests for replaying the same trusted event five times with no duplicate state, notification, entitlement, or history mutation in `apps/backend/src/app.test.ts`
- [x] T038 [P] [US4] Add backend webhook tests for payment failure followed by success and success followed by delayed stale failure in `apps/backend/src/app.test.ts`
- [x] T039 [P] [US4] Add backend webhook tests for untrusted signatures and unknown customer, subscription, or organization linkage in `apps/backend/src/app.test.ts`
- [x] T040 [P] [US4] Add maintenance and reconciliation tests for hourly risky-state checks and daily provider-linked checks in `apps/backend/src/billing/organization-billing-maintenance.test.ts`
- [x] T041 [P] [US4] Extend Stripe Test Clock billing E2E for failed renewal recovery and repeated Stripe event replay in `apps/web/tests/e2e/billing/stripe-test-clock.spec.ts`

### Implementation for User Story 4

- [x] T042 [US4] Keep processed Stripe event duplicates as permanent no-ops for billing state, notifications, entitlement, and invoice history in `apps/backend/src/billing/stripe-webhook-sync.ts`
- [x] T043 [US4] Classify stale payment failures after confirmed recovery as history and support context only in `apps/backend/src/billing/stripe-webhook-sync.ts`
- [x] T044 [US4] Preserve unknown linkage and unverifiable webhook attempts as sanitized failures or signals without changing unrelated organizations in `apps/backend/src/billing/stripe-webhook-sync.ts`
- [x] T045 [US4] Add risky-state and provider-linked billing re-check scheduling behavior in `apps/backend/src/billing/organization-billing-maintenance.ts`
- [x] T046 [US4] Record reconciliation and stale-event support signals without payment details in `apps/backend/src/billing/organization-billing-observability.ts`

**Checkpoint**: User Story 4 is independently functional and testable.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, design, release evidence, and full verification.

- [x] T047 [P] Update operational payment failure behavior and rollback notes in `docs/billing.md`
- [x] T048 [P] Update Stripe Billing E2E and CI expectations in `docs/test-strategy.md`
- [x] T049 [P] Verify DESIGN.md accessibility and layout requirements for payment issue UI in `apps/web/src/routes/contracts/+page.svelte`
- [ ] T050 Run targeted backend verification for `apps/backend/src/billing/organization-billing-policy.test.ts`, `apps/backend/src/billing/organization-billing-notifications.test.ts`, `apps/backend/src/billing/organization-billing-maintenance.test.ts`, and `apps/backend/src/app.test.ts`
- [ ] T051 Run targeted web and billing E2E verification for `apps/web/src/routes/contracts/page.svelte.spec.ts` and `apps/web/tests/e2e/billing/stripe-test-clock.spec.ts`
- [ ] T052 Run final repository verification for `package.json` using `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm format:check`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundation; MVP scope.
- **User Story 2 (Phase 4)**: Depends on Foundation and can start after US1 billing state fields are available.
- **User Story 3 (Phase 5)**: Depends on Foundation and benefits from US1 payment issue state fields.
- **User Story 4 (Phase 6)**: Depends on Foundation and should be integrated after US1/US2 semantics are stable.
- **Polish (Phase 7)**: Depends on all selected user stories.

### User Story Dependencies

- **US1 (P1)**: No dependency on other user stories after Foundation.
- **US2 (P2)**: Requires US1 payment issue classification and timing fields for accurate notification copy and reminder timing.
- **US3 (P3)**: Requires US1 classification and US2 notification records for complete inspection output.
- **US4 (P3)**: Requires US1/US2 semantics to enforce duplicate, stale, and retry convergence.

### Within Each User Story

- Write the listed tests before implementation and confirm they fail for the missing behavior.
- Backend policy and service behavior should land before API response and UI work.
- UI tests should land before Svelte route changes.
- E2E evidence should run after backend and web targeted tests pass.

---

## Parallel Opportunities

- **Setup**: T001, T002, and T003 can run in parallel.
- **Foundation**: T006, T007, T008, and T009 can run in parallel after T004/T005 interfaces are agreed.
- **US1**: T010, T011, and T012 can be authored in parallel; T017 and T018 can follow T016.
- **US2**: T019, T020, T021, T022, and T023 can be authored in parallel; T024/T025/T026 should be integrated before T027.
- **US3**: T029, T030, T031, and T032 can be authored in parallel; T033/T034/T035 can be implemented in sequence by backend ownership.
- **US4**: T037, T038, T039, T040, and T041 can be authored in parallel; T042/T043/T044 share webhook ownership and should be serialized.
- **Polish**: T047, T048, and T049 can run in parallel with final verification preparation.

---

## Parallel Example: User Story 1

```bash
# Backend policy and integration tests can be authored together:
Task: "T010 [P] [US1] Add policy tests in apps/backend/src/billing/organization-billing-policy.test.ts"
Task: "T011 [P] [US1] Add backend integration tests in apps/backend/src/app.test.ts"

# UI tests can be authored while backend implementation is in progress:
Task: "T012 [P] [US1] Add contract page tests in apps/web/src/routes/contracts/page.svelte.spec.ts"
```

## Parallel Example: User Story 2

```bash
# Notification behavior is split by test scope:
Task: "T019 [P] [US2] Add multiple-owner notification tests in apps/backend/src/app.test.ts"
Task: "T021 [P] [US2] Add recipient retry tests in apps/backend/src/billing/organization-billing-notifications.test.ts"
Task: "T022 [P] [US2] Add grace reminder maintenance tests in apps/backend/src/billing/organization-billing-maintenance.test.ts"
```

## Parallel Example: User Story 3

```bash
# Owner history and internal inspection can be validated independently:
Task: "T029 [P] [US3] Add owner billing history tests in apps/backend/src/app.test.ts"
Task: "T030 [P] [US3] Add internal inspection tests in apps/backend/src/app.test.ts"
Task: "T032 [P] [US3] Add contract page history tests in apps/web/src/routes/contracts/page.svelte.spec.ts"
```

## Parallel Example: User Story 4

```bash
# Convergence tests are independent until webhook implementation begins:
Task: "T037 [P] [US4] Add duplicate trusted event tests in apps/backend/src/app.test.ts"
Task: "T038 [P] [US4] Add out-of-order recovery tests in apps/backend/src/app.test.ts"
Task: "T041 [P] [US4] Extend Stripe Test Clock E2E in apps/web/tests/e2e/billing/stripe-test-clock.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 for US1.
3. Validate backend policy, backend integration, and contract page tests for payment issue eligibility.
4. Stop and demo the owner/non-owner billing state behavior before notification retry and convergence work.

### Incremental Delivery

1. Add US1 payment issue state and Premium control.
2. Add US2 verified-owner notification and reminder behavior.
3. Add US3 owner-safe history and internal inspection.
4. Add US4 duplicate, stale, and reconciliation convergence.
5. Run Stripe Billing E2E evidence after backend and web targeted suites pass.

### Team Strategy

1. One backend owner handles shared payment issue state, policy, and webhook integration.
2. One backend owner handles notification retry, maintenance, and internal inspection.
3. One frontend owner handles contract page UI and route tests.
4. One verification owner handles Stripe Test Clock E2E and release evidence.

---

## Independent Test Criteria Summary

- **US1**: Billing summary, Premium gates, and contracts UI agree for failed, action-required, past-due grace active, grace expired, unpaid, incomplete, recovered, and non-owner read-only states.
- **US2**: Verified owners receive exactly one payment issue email per event, failed verified-owner recipients alone are retried, and no non-owner receives billing issue email.
- **US3**: Owner and internal views show safe payment issue history and support context without card data, full payment method details, tax details, or raw provider payloads.
- **US4**: Duplicate, delayed, stale, untrusted, and unknown-linkage Stripe events converge without duplicate side effects or unrelated organization mutation.
