---
description: "Task list for organization-scoped billing implementation"
---

# Tasks: Organization Billing

**Input**: Design documents from `/specs/001-organization-billing/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required by the constitution because this feature affects authorization, billing
lifecycle, Stripe/webhook processing, D1 schema, API response shape, premium entitlement
gating, and user-visible UI branching.

**Organization**: Tasks are grouped by user story to enable independent implementation and
testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the existing brownfield billing baseline and generated planning artifacts.

- [X] T001 Verify active feature pointer references `specs/001-organization-billing` in `.specify/feature.json`
- [X] T002 [P] Review feature requirements and user-story scope in `specs/001-organization-billing/spec.md`
- [X] T003 [P] Review implementation constraints and source layout in `specs/001-organization-billing/plan.md`
- [X] T004 [P] Review data entities and state transitions in `specs/001-organization-billing/data-model.md`
- [X] T005 [P] Review API and UI contracts in `specs/001-organization-billing/contracts/billing-api.openapi.yaml`
- [X] T006 [P] Review UI behavior contract in `specs/001-organization-billing/contracts/billing-ui-contract.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared billing state, provider normalization, authorization, and observability that block all user stories.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T007 Verify `organization_billing` preserves one row per organization and supports plan/trial/provider fields in `apps/backend/src/db/schema.ts`
- [X] T008 Verify organization billing base migration preserves existing organizations in `apps/backend/drizzle/0012_organization_billing.sql`
- [X] T009 [P] Verify webhook event persistence and idempotency tables in `apps/backend/drizzle/0013_stripe_webhook_sync.sql`
- [X] T010 [P] Verify notification history table supports trial reminder delivery states in `apps/backend/drizzle/0014_organization_billing_notifications.sql`
- [X] T011 [P] Verify billing audit and reconciliation signal tables are append-only in `apps/backend/drizzle/0015_billing_audit_and_signals.sql`
- [X] T012 Implement shared plan-state and provider-status normalization helpers in `apps/backend/src/billing/organization-billing.ts`
- [X] T013 Implement Stripe webhook authenticity verification plus provider event idempotency and duplicate classification in `apps/backend/src/billing/stripe-webhook-sync.ts`
- [X] T014 Implement shared audit and reconciliation signal writers in `apps/backend/src/billing/organization-billing-observability.ts`
- [X] T015 Implement internal operator allowlist parsing and denial behavior in `apps/backend/src/billing/internal-operator-access.ts`
- [X] T016 [P] Update web billing payload type guards for plan/trial/provider fields in `apps/web/src/lib/rpc-client.ts`
- [X] T017 [P] Add backend integration fixtures for owner/admin/staff/internal-operator billing cases in `apps/backend/src/app.test.ts`
- [X] T018 [P] Add web fixture builders for owner/non-owner billing page states in `apps/web/src/routes/contracts/page.svelte.spec.ts`

**Checkpoint**: Foundation ready; user story implementation can proceed.

---

## Phase 3: User Story 1 - Owner Billing Workspace and Trial Entry (Priority: P1)

**Goal**: Owners can understand organization plan state, compare premium value, and start one 7-day premium trial.

**Independent Test**: Free organization owner can start trial and see trial end state; non-owner sees read-only status with no billing actions.

### Tests for User Story 1

- [X] T019 [P] [US1] Add backend test for owner billing summary and role-specific permissions in `apps/backend/src/app.test.ts`
- [X] T020 [P] [US1] Add backend test denying admin/staff/participant trial start in `apps/backend/src/app.test.ts`
- [X] T021 [P] [US1] Add backend test preventing overlapping or repeated trial creation in `apps/backend/src/app.test.ts`
- [X] T022 [P] [US1] Add web browser test for free owner trial entry and non-owner read-only state in `apps/web/src/routes/contracts/page.svelte.spec.ts`

### Implementation for User Story 1

- [X] T023 [US1] Implement owner-visible billing summary response fields in `apps/backend/src/routes/auth-routes.ts`
- [X] T024 [US1] Implement owner-only trial start route behavior in `apps/backend/src/routes/auth-routes.ts`
- [X] T025 [US1] Implement trial creation and no-overlap policy in `apps/backend/src/billing/organization-billing-policy.ts`
- [X] T026 [US1] Emit trial-start audit entry from billing service in `apps/backend/src/billing/organization-billing-observability.ts`
- [X] T027 [US1] Expose trial start client method and response type in `apps/web/src/lib/rpc-client.ts`
- [X] T028 [US1] Load billing summary into active organization context in `apps/web/src/lib/features/organization-context.svelte.ts`
- [X] T029 [US1] Render free/premium comparison, trial end state, and owner-only trial action in `apps/web/src/routes/contracts/+page.svelte`
- [X] T030 [US1] Document owner trial entry behavior and required environment assumptions in `apps/backend/README.md`

**Checkpoint**: US1 is independently functional and testable.

---

## Phase 4: User Story 2 - Trial-to-Paid Lifecycle and Billing Reliability (Priority: P1)

**Goal**: Trial organizations can register payment methods, convert to paid or fall back to free, receive reminders, and remain correct under duplicate/out-of-order provider events.

**Independent Test**: Payment method registered/unregistered trial completion, trial reminder, duplicate event, and out-of-order event cases converge to correct billing, entitlement, notification, and audit state.

### Tests for User Story 2

- [X] T031 [P] [US2] Add backend test for payment method registration handoff and status reflection in `apps/backend/src/app.test.ts`
- [X] T032 [P] [US2] Add backend test for trial completion converting to premium paid when payment conditions are met in `apps/backend/src/app.test.ts`
- [X] T033 [P] [US2] Add backend test for trial completion falling back to free while preserving setup in `apps/backend/src/app.test.ts`
- [X] T034 [P] [US2] Add backend test for invalid Stripe webhook signature rejection and duplicate provider lifecycle event idempotency in `apps/backend/src/app.test.ts`
- [X] T035 [P] [US2] Add backend test for out-of-order provider event reconciliation in `apps/backend/src/app.test.ts`
- [X] T036 [P] [US2] Add backend test for trial-will-end reminder delivery history and retry states in `apps/backend/src/app.test.ts`
- [X] T037 [P] [US2] Add web test for payment method status and paid-continuation guidance in `apps/web/src/routes/contracts/page.svelte.spec.ts`

### Implementation for User Story 2

- [X] T038 [US2] Implement payment method registration handoff route in `apps/backend/src/routes/auth-routes.ts`
- [X] T039 [US2] Implement provider checkout and portal session creation rules in `apps/backend/src/payment/stripe.ts`
- [X] T040 [US2] Implement trial completion transition policy in `apps/backend/src/billing/organization-billing-policy.ts`
- [X] T041 [US2] Implement subscription lifecycle event normalization only after Stripe webhook signature verification succeeds in `apps/backend/src/billing/stripe-webhook-sync.ts`
- [X] T042 [US2] Implement webhook-driven billing state synchronization in `apps/backend/src/billing/organization-billing.ts`
- [X] T043 [US2] Implement trial reminder notification recording and delivery state handling in `apps/backend/src/billing/organization-billing-notifications.ts`
- [X] T044 [US2] Emit audit entries and reconciliation signals for lifecycle/reminder outcomes in `apps/backend/src/billing/organization-billing-observability.ts`
- [X] T045 [US2] Render payment method handoff, continuation guidance, reminder context, and loading/error states in `apps/web/src/routes/contracts/+page.svelte`

**Checkpoint**: US2 is independently functional and testable.

---

## Phase 5: User Story 3 - Premium Capability Access Across the Organization (Priority: P2)

**Goal**: Premium capability access is consistently enforced at organization scope across backend operations and role-safe UI.

**Independent Test**: Free organizations are blocked from premium-only capabilities, premium trial/paid organizations can use them, and plan changes re-evaluate eligibility without deleting data.

### Tests for User Story 3

- [X] T046 [P] [US3] Add unit tests for premium entitlement reasons and edge cases in `apps/backend/src/billing/organization-billing-policy.test.ts`
- [X] T047 [P] [US3] Add backend integration test for multiple-classroom premium gating in `apps/backend/src/app.test.ts`
- [X] T048 [P] [US3] Add backend integration test for staff invitation and role-management premium gating in `apps/backend/src/app.test.ts`
- [X] T049 [P] [US3] Add backend integration test for recurring schedule and approval booking premium gating in `apps/backend/src/app.test.ts`
- [X] T050 [P] [US3] Add backend integration test for ticket/payment plus each existing advanced capability premium gate: advanced contract management, participant invitations, CSV export, analytics, audit-oriented views, and priority support in `apps/backend/src/app.test.ts`
- [X] T051 [P] [US3] Add web test for role-safe premium restriction messaging in `apps/web/src/routes/page.svelte.spec.ts`

### Implementation for User Story 3

- [X] T052 [US3] Implement organization-scoped premium entitlement policy in `apps/backend/src/billing/organization-billing-policy.ts`
- [X] T053 [US3] Enforce premium eligibility in backend operational authorization boundaries in `apps/backend/src/booking/authorization.ts`
- [X] T054 [US3] Apply premium gating to relevant authenticated and booking routes, including every existing route for advanced contract management, participant invitations, CSV export, analytics, audit-oriented views, and priority support in `apps/backend/src/routes/auth-routes.ts` and `apps/backend/src/routes/booking-routes.ts`
- [X] T055 [US3] Expose premium restriction payloads for UI consumers in `apps/web/src/lib/features/premium-restrictions.ts`
- [X] T056 [US3] Integrate premium restriction state into organization context in `apps/web/src/lib/features/organization-context.svelte.ts`
- [X] T057 [US3] Render premium-gated messaging without non-owner billing controls in `apps/web/src/routes/+page.svelte`

**Checkpoint**: US3 is independently functional and testable.

---

## Phase 6: User Story 4 - Internal Billing Support and Investigation (Priority: P3)

**Goal**: Authorized internal operators can inspect billing state, reminder delivery, mismatch signals, and investigation timeline for support triage.

**Independent Test**: Authorized operator can inspect billing state and timeline; non-authorized user is denied; reminder and mismatch states are visible.

### Tests for User Story 4

- [X] T058 [P] [US4] Add backend test for internal operator access allow/deny behavior in `apps/backend/src/app.test.ts`
- [X] T059 [P] [US4] Add backend test for billing inspection summary response in `apps/backend/src/app.test.ts`
- [X] T060 [P] [US4] Add backend test for reminder notification audit inspection in `apps/backend/src/app.test.ts`
- [X] T061 [P] [US4] Add backend test for provider/application mismatch diagnosis in `apps/backend/src/app.test.ts`
- [X] T062 [P] [US4] Add backend test for correlated investigation timeline response in `apps/backend/src/app.test.ts`

### Implementation for User Story 4

- [X] T063 [US4] Implement internal billing inspection read model in `apps/backend/src/billing/internal-billing-inspection.ts`
- [X] T064 [US4] Add internal billing inspection route and OpenAPI registration in `apps/backend/src/routes/auth-routes.ts`
- [X] T065 [US4] Include notification history and latest delivery status in inspection output from `apps/backend/src/billing/organization-billing-notifications.ts`
- [X] T066 [US4] Include audit trail and reconciliation signals in inspection output from `apps/backend/src/billing/organization-billing-observability.ts`
- [X] T067 [US4] Document internal operator configuration and support triage usage in `apps/backend/README.md`

**Checkpoint**: US4 is independently functional and testable.

---

## Phase 7: User Story 5 - Subscription Management Expansion Readiness (Priority: P4)

**Goal**: MVP data and contracts preserve future billing history, plan change, multi-tier, expanded communication, and invoice/receipt readiness without expanding current scope.

**Independent Test**: Review and tests confirm future expansion can build on organization-scoped billing history without changing subscription ownership.

### Tests for User Story 5

- [X] T068 [P] [US5] Add backend test for owner billing history read model shape in `apps/backend/src/app.test.ts`
- [X] T069 [P] [US5] Add backend policy test for future plan-code/tier-safe entitlement behavior, plan-change readiness, communication history references, and invoice/receipt provider references in `apps/backend/src/billing/organization-billing-policy.test.ts`
- [X] T070 [P] [US5] Add web test for owner billing history entries when present in `apps/web/src/routes/contracts/page.svelte.spec.ts`

### Implementation for User Story 5

- [X] T071 [US5] Implement owner billing history read model with extensible plan-code, provider document reference, and communication history fields in `apps/backend/src/billing/organization-billing-history.ts`
- [X] T072 [US5] Expose billing history in owner billing summary response in `apps/backend/src/routes/auth-routes.ts`
- [X] T073 [US5] Add billing history response types and guards in `apps/web/src/lib/rpc-client.ts`
- [X] T074 [US5] Render owner billing history section without adding plan-change controls in `apps/web/src/routes/contracts/+page.svelte`
- [X] T075 [US5] Document post-MVP expansion boundaries for plan changes, multiple paid tiers, communication channels, and invoice/receipt handling in `specs/001-organization-billing/quickstart.md`

**Checkpoint**: US5 readiness is independently reviewable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, documentation, and deployment-readiness checks across all stories.

- [X] T076 [P] Update billing API contract with final response fields in `specs/001-organization-billing/contracts/billing-api.openapi.yaml`
- [X] T077 [P] Update UI contract with final owner/non-owner/internal inspection states in `specs/001-organization-billing/contracts/billing-ui-contract.md`
- [X] T078 [P] Update project deployment notes for billing env vars and migration order in `docs/README.md`
- [X] T079 Verify backend integration suite for billing scenarios in `apps/backend/src/app.test.ts`
- [X] T080 Verify web server/browser coverage for contracts page and premium restrictions in `apps/web/src/routes/contracts/page.svelte.spec.ts`
- [X] T081 Verify package-level checks remain aligned with root scripts in `package.json`
- [X] T082 Record mobile manual smoke coverage for each completed entitlement-impacting story in `specs/001-organization-billing/quickstart.md`
- [X] T083 Verify billing status page displays primary state within the 3-second success criterion under normal local/test conditions in `apps/web/src/routes/contracts/page.svelte.spec.ts`
- [X] T084 Verify Stripe event entitlement reflection timing evidence, including the 1-minute target or documented local/test limitation, in `apps/backend/src/app.test.ts`
- [X] T085 Add backend regression coverage for owner role removal or demotion after billing state exists in `apps/backend/src/app.test.ts`
- [X] T086 Add access guard coverage for active organization unselected or no-membership billing access in `apps/backend/src/app.test.ts` and `apps/web/src/routes/contracts/page.svelte.spec.ts`
- [X] T087 Run `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`, or document any non-feature blocker in `specs/001-organization-billing/quickstart.md`
- [X] T088 Review final task completion evidence and unresolved risks in `specs/001-organization-billing/tasks.md`

---

## Phase 9: Post-Review Billing Correctness Additions

**Purpose**: Close production billing gaps found after comparing the implementation with the
organization billing specification and Stripe-hosted subscription behavior.

- [X] T089 [US1] Add persistent trial usage tracking to prevent repeated trials after free fallback in `apps/backend/src/db/schema.ts` and `apps/backend/drizzle/0016_organization_billing_trial_tracking.sql`
- [X] T090 [US1] Create a Stripe trial subscription during owner trial start when Premium price configuration is available in `apps/backend/src/routes/auth-routes.ts` and `apps/backend/src/payment/stripe.ts`
- [X] T091 [US2] Process setup-mode Checkout completion by setting Customer and Subscription default payment methods in `apps/backend/src/billing/stripe-webhook-sync.ts`
- [X] T092 [US2] Complete expired local premium trials from scheduled Worker maintenance in `apps/backend/src/billing/organization-billing-maintenance.ts` and `apps/backend/src/worker.ts`
- [X] T093 [US2] Add backend regression coverage for Stripe-backed trial creation, setup completion webhook synchronization, scheduled trial completion, and trial reuse denial in `apps/backend/src/app.test.ts`
- [X] T094 [US5] Update Premium Stripe environment documentation and examples in `apps/backend/.env.example`, `apps/backend/.dev.vars.example`, `apps/backend/README.md`, `docs/README.md`, and `docs/billing.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **US1 (Phase 3)**: Depends on Foundational; MVP entry point.
- **US2 (Phase 4)**: Depends on Foundational and uses US1 billing summary/trial fields.
- **US3 (Phase 5)**: Depends on Foundational and can proceed after entitlement policy shape is stable.
- **US4 (Phase 6)**: Depends on Foundational and benefits from US2 audit/notification/signal data.
- **US5 (Phase 7)**: Depends on Foundational and should follow MVP lifecycle model.
- **Polish (Phase 8)**: Depends on selected story completion.

### User Story Dependencies

- **US1**: Core owner workspace and trial entry; recommended MVP first slice.
- **US2**: Can start after foundation, but payment/trial UX integrates with US1 fields.
- **US3**: Can start after foundation; backend gating can run in parallel with US2 if policy fields are stable.
- **US4**: Can start after audit/notification/signal foundation exists; richer cases depend on US2 outputs.
- **US5**: Future-readiness slice; should not block MVP launch unless billing history is required.

### Within Each User Story

- Tests required by the Constitution Check must be written and fail before implementation.
- Data/policy work before route and UI integration.
- Route/contract work before web client rendering.
- Story complete before using it as a dependency for downstream slices.

---

## Parallel Opportunities

- T002-T006 can run in parallel during setup.
- T009-T011, T016-T018 can run in parallel after schema ownership is understood.
- US1 tests T019-T022 can run in parallel.
- US2 tests T031-T037 can run in parallel.
- US3 tests T046-T051 can run in parallel.
- US4 tests T058-T062 can run in parallel.
- US5 tests T068-T070 can run in parallel.
- Polish contract/docs tasks T076-T078 can run in parallel.

---

## Parallel Example: User Story 2

```bash
# Launch independent failing tests first:
Task: "T031 [US2] Add backend test for payment method registration handoff and status reflection in apps/backend/src/app.test.ts"
Task: "T034 [US2] Add backend test for invalid Stripe webhook signature rejection and duplicate provider lifecycle event idempotency in apps/backend/src/app.test.ts"
Task: "T035 [US2] Add backend test for out-of-order provider event reconciliation in apps/backend/src/app.test.ts"
Task: "T037 [US2] Add web test for payment method status and paid-continuation guidance in apps/web/src/routes/contracts/page.svelte.spec.ts"
```

## Parallel Example: User Story 3

```bash
# Launch separate premium-gating test coverage:
Task: "T046 [US3] Add unit tests for premium entitlement reasons and edge cases in apps/backend/src/billing/organization-billing-policy.test.ts"
Task: "T047 [US3] Add backend integration test for multiple-classroom premium gating in apps/backend/src/app.test.ts"
Task: "T051 [US3] Add web test for role-safe premium restriction messaging in apps/web/src/routes/page.svelte.spec.ts"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete US1 so owner billing workspace and trial entry are usable.
3. Complete US2 so trial-to-paid/free lifecycle is reliable.
4. Stop and validate backend integration tests plus contracts page UI tests.

### Incremental Delivery

1. Deliver US1 as self-serve trial entry.
2. Add US2 lifecycle reliability and reminder support.
3. Add US3 premium gating across operational capabilities.
4. Add US4 internal inspection for support triage.
5. Add US5 only as post-MVP readiness unless owner billing history is in launch scope.

### Validation Commands

```bash
pnpm --filter @apps/backend test
pnpm --filter @apps/web test
pnpm --filter @apps/web exec vitest run --project client
pnpm typecheck
pnpm lint
pnpm format:check
```

## Notes

- [P] tasks use different files or can be authored independently before integration.
- Every user-story task includes a [USx] label for traceability.
- D1 schema changes must ship with migration compatibility reasoning and backend tests.
- Payment details must stay provider-hosted; store only provider-derived management state.
- Avoid combining unrelated refactors with billing lifecycle changes.

## Completion Evidence

- `pnpm --filter @apps/backend test`: passed, 5 files / 84 tests.
- `pnpm --filter @apps/web test`: passed, 15 files / 39 tests.
- `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`:
  passed, 14 tests.
- `pnpm --filter @apps/backend exec vitest run src/app.test.ts -t "creates free billing rows"`:
  passed.
- `pnpm typecheck`: passed.
- `pnpm --filter @apps/web exec vitest run --project client`: blocked by non-billing client
  project failures documented in `specs/001-organization-billing/quickstart.md`.
- `pnpm lint` and `pnpm format:check`: blocked by existing formatting warnings documented in
  `specs/001-organization-billing/quickstart.md`.
