# Quickstart: Organization Billing Plan

## Prerequisites

- Work from branch `001-organization-billing`.
- Keep existing uncommitted user work intact.
- Use the existing monorepo, backend/web/mobile boundaries, and D1 migration flow.
- Treat `specs/001-organization-billing/spec.md` and this plan directory as the feature source.

## Implementation Order

1. Confirm data model and migrations preserve one billing aggregate per organization.
2. Implement or verify owner-only billing summary, trial start, payment method handoff, and
   provider portal/checkout behavior.
3. Implement or verify lifecycle normalization, idempotency, out-of-order tolerance, audit
   entries, notification history, and reconciliation signals.
4. Implement or verify organization-scoped premium entitlement policy and backend enforcement
   for premium capabilities.
5. Implement or verify contracts/billing UI states for owner, non-owner, loading, error,
   free, trial, and paid states.
6. Implement or verify internal billing inspection for authorized operators.
7. Keep future expansion hooks for billing history, multi-tier plans, expanded communication,
   and invoice/receipt readiness without expanding MVP scope.

## Verification

Run targeted checks first:

```bash
pnpm --filter @apps/backend test
pnpm --filter @apps/web test
```

For important Svelte UI state changes, also run the browser/client project locally:

```bash
pnpm --filter @apps/web exec vitest run --project client
```

For mobile entitlement-impacting changes, record manual smoke coverage:

- login
- organization/classroom switching
- invitation list/acceptance
- any premium-gated flow visible in mobile

## Validation Evidence

Recorded during implementation on 2026-04-27:

- `pnpm --filter @apps/backend test`: passed, 5 files / 84 tests.
- `pnpm --filter @apps/web test`: passed, 15 files / 39 tests.
- `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`:
  passed, 14 tests, including the 3-second billing status display criterion.
- `pnpm --filter @apps/backend exec vitest run src/app.test.ts -t "creates free billing rows"`:
  passed, including the 1-minute Stripe entitlement reflection evidence.
- `pnpm typecheck`: passed across backend, web, mobile, and docs.
- `pnpm --filter @apps/web exec vitest run --project client`: failed on non-billing blockers:
  dynamic public env import failures in events/invitation specs, organization switcher logo
  assertion, and admin slot date-picker expectations. The contracts billing spec passed in
  the same run.
- `pnpm lint`: blocked by existing Prettier warnings in docs/web files before ESLint completed.
- `pnpm format:check`: blocked by existing formatting warnings across backend, web, mobile
  generated dist-test CSS, and docs project files.

## Mobile Manual Smoke Record

Expo/mobile manual smoke was not executed in this CLI session. No mobile source files were
changed for this billing implementation. Before release, run manual smoke for login,
organization/classroom switching, invitation list/acceptance, and any mobile-visible
premium-gated flow if the deployed entitlement behavior affects mobile users.

## Constitution Gates

- No new starter, app host, or global state architecture.
- Billing actions remain owner-only at backend and UI levels.
- Subscription and entitlement remain organization-scoped.
- Product plan state remains separate from provider subscription status.
- External lifecycle events are idempotent, auditable, and reconcilable.
- D1 schema changes include migration, compatibility reasoning, and backend integration tests.
- Billing UI follows DESIGN.md and avoids color-only state communication.

## Deployment Notes

- Apply D1 migrations before backend code depending on new schema.
- Deploy backend before web when response shape or billing behavior changes.
- Keep docs/README.md and app README deployment sequencing as the operational reference.
