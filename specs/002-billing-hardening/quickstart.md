# Quickstart: Billing Production Hardening

## Scope

This plan hardens the existing organization billing implementation. It does not create a new billing provider, a new
top-level package, classroom-scoped subscriptions, refund/credit-note lifecycle, or in-app payment/tax detail storage.

## Prerequisites

- Existing 001 organization billing migrations are applied through `0016_organization_billing_trial_tracking.sql`.
- Stripe Premium monthly and yearly prices are configured for environments that expose paid checkout.
- Stripe webhook endpoint is configured for subscription, checkout, invoice, payment failure, payment success, and
  action-required events needed by this feature.
- Resend is configured for owner payment issue emails in environments where email delivery is verified.

## Expected Environment Variables

Backend:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PREMIUM_MONTHLY_PRICE_ID`
- `STRIPE_PREMIUM_YEARLY_PRICE_ID`
- `WEB_BASE_URL`
- Resend variables already documented by existing email setup
- Internal billing inspection allowlist variables already used by 001 billing

Frontend:

- `PUBLIC_BACKEND_URL`

## Implementation Order

1. Add D1 migration for billing hardening:
   - operation attempt table
   - invoice/payment event table
   - payment document reference table
   - `organization_billing` readiness/grace/reconciliation fields
   - webhook receipt/failure extensions if needed
   - notification/audit/signal enum-compatible values

2. Update backend domain types and policies:
   - payment issue grace: `incomplete` stop, `past_due` 7-day grace, `unpaid` stop
   - cancellation entitlement: `canceled` stop, period-end cancellation keep until current period end
   - unknown price blocks Premium
   - billing profile readiness is non-gating
   - portal availability for `active`, `trialing`, `past_due`, `unpaid`, `incomplete`

3. Add operation attempt/idempotent handoff service:
   - trial start, paid checkout, payment method setup, portal
   - 30-minute reuse by organization and purpose
   - common billing action envelope

4. Harden Stripe webhook processing:
   - reject unsigned, mismatched, and expired signatures before event trust
   - persist trusted provider event ids permanently
   - duplicate provider event ids are no-op for state, notification, entitlement, and invoice history
   - process invoice availability, payment success, payment failure, and payment action required

5. Add reconciliation jobs:
   - targeted hourly risky-state reconciliation
   - daily full provider-linked reconciliation
   - append audit/signal output without unnecessary no-op churn

6. Add owner notifications:
   - immediate payment failure email to all verified owners
   - immediate payment action required email to all verified owners
   - past-due grace expiry reminder 3 days before expiry
   - internal signal only when no verified owner exists

7. Update owner and internal read models:
   - billing summary with action availability, interval choices, readiness, documents, invoice/payment events
   - internal inspection with handoff attempts, webhook receipt/failure, notifications, reconciliation, unknown price

8. Update web billing UI:
   - trial available and trial-used free states
   - monthly/yearly paid checkout
   - payment issue states and grace messaging
   - document availability states
   - owner-only controls and non-owner read-only messaging

9. Update documentation:
   - `docs/README.md` deployment/migration order
   - `docs/billing.md` operational behavior and Stripe dashboard/webhook requirements

## Verification Commands

Run targeted checks during implementation:

```bash
pnpm --filter @apps/backend test
pnpm --filter @apps/web test
pnpm typecheck
pnpm lint
pnpm format:check
```

Run broader checks before completion:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

## Implementation Evidence Checklist

Record concrete evidence here while completing `tasks.md`:

- [x] D1 migration applied locally or migration SQL reviewed with backward-compatible add-only behavior.
  - Reviewed `apps/backend/drizzle/0017_billing_production_hardening.sql`; migration is add-only for existing tables plus new append-only billing hardening tables.
- [x] Backend targeted billing tests executed and results recorded.
  - `pnpm --filter @apps/backend exec vitest run src/billing/organization-billing-policy.test.ts` -> 14 tests passed.
  - `pnpm --filter @apps/backend exec vitest run src/billing/organization-billing-documents.test.ts` -> 2 tests passed.
  - `pnpm --filter @apps/backend exec vitest run src/payment/stripe.test.ts` -> 3 tests passed.
  - `pnpm --filter @apps/backend exec vitest run src/app.test.ts -t "signature and payload|hardened Premium gate|common billing action envelopes|invoice payment webhooks|targeted and full billing reconciliation"` -> 5 integration tests passed.
  - `pnpm --filter @apps/backend exec vitest run src/app.test.ts -t "internal billing inspection view|internal reconciliation diagnosis"` -> 2 integration tests passed after aligning fixtures with the unknown-price Premium stop policy.
  - `pnpm --filter @apps/backend test` -> 93 tests passed after the verified-owner payment issue notification fan-out fix.
- [x] Web contracts page tests executed and results recorded.
  - `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts` -> 20 tests passed.
- [x] Billing API contract validation executed for summary, trial, checkout, payment method, portal, and inspection responses.
  - `specs/002-billing-hardening/contracts/billing-api.openapi.yaml` was updated to match the implemented route schemas: summary returns `BillingSummary`, billing actions return the common action envelope, and internal inspection includes lifecycle, reconciliation, notification, document, invoice event, and operation attempt sections.
  - Contract shape was validated through targeted backend integration tests for billing summary/action envelopes and internal inspection responses.
- [x] Owner billing summary 3-second evidence recorded under normal test conditions.
  - Existing client test `should display the primary billing state within the 3-second success criterion` passed inside the contracts page test run.
- [x] Stripe webhook signature, duplicate event, Customer Portal, monthly/yearly price ids, invoice/receipt links, owner emails, and scheduled reconciliation release evidence recorded or blocker noted.
  - Blocker: live Stripe/Resend/Cloudflare scheduled-trigger evidence requires configured non-local provider environment.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` executed or non-feature blockers recorded.
  - `pnpm test` initially hit sandbox `listen EPERM` for docs Playwright; re-run with approved normal execution passed: backend 93 tests, web server 39 tests, docs unit/browser/e2e 3 tests.
  - After the final backend notification fan-out correction, `pnpm --filter @apps/backend test` passed again with 93 tests.
  - `pnpm typecheck` passed for backend, web, docs, and mobile.
  - `pnpm lint` remains blocked by pre-existing formatting warnings in docs `project.inlang/*` and web UI/helper files before ESLint completion.
  - `pnpm format:check` remains blocked by pre-existing formatting warnings outside this billing slice: backend drizzle meta/booking/email-image helpers, mobile `dist-test`, and web UI/remote/admin route files.
  - Billing changed-file formatting passed with `pnpm exec prettier --check ...`; targeted ESLint for changed backend and web billing files passed.

## Required Backend Test Coverage

- `incomplete` blocks Premium immediately.
- `past_due` allows Premium during 7-day grace and blocks after expiry.
- `unpaid` blocks Premium immediately.
- `canceled` blocks Premium immediately.
- `active` / `trialing` with period-end cancellation keeps Premium until current period end.
- Unknown price blocks Premium and creates support-visible signal.
- Billing profile readiness incomplete/unavailable does not block checkout or Premium.
- Trial start, checkout, payment method setup, and portal reuse handoffs for 30 minutes.
- Duplicate webhook event id creates no additional state, notification, entitlement, or invoice history changes.
- Missing/mismatched/expired webhook signature creates sanitized failure/signal only.
- Invoice available, payment succeeded, payment failed, and payment action required events are normalized.
- Verified owners receive one notification per payment issue event.
- No verified owner creates internal signal and no non-owner email.
- Targeted reconciliation resolves or flags risky state.
- Daily full reconciliation covers provider-linked statuses.
- API action responses conform to the common envelope.

## Required Web Test Coverage

- Owner sees trial-available free state with monthly/yearly post-trial price information.
- Owner with trial-used free state sees direct monthly/yearly paid checkout and no trial start.
- Owner sees payment issue messaging for `incomplete`, `past_due`, and `unpaid`.
- Owner sees period-end cancellation date and Premium availability until current period end.
- Owner sees document states: available, unavailable, missing, checking.
- Non-owner sees read-only status with no billing controls or document links.
- Unknown price and billing profile readiness guidance render without exposing raw provider details.

## Manual Release Evidence

Record in implementation notes or PR:

- Stripe webhook endpoint configured with required events.
- Stripe Customer Portal enabled for subscription/payment method management.
- Monthly and yearly price ids match configured environment values.
- Provider-hosted invoice/receipt links open for owner test account when available.
- Payment issue emails are sent to verified owners in a safe test environment.
- Cloudflare scheduled reconciliation triggers are configured or documented for the target environment.

## Deployment Notes

- Apply D1 migration before deploying backend code that reads new columns/tables.
- Deploy backend before web so the common billing action envelope exists before UI consumes it.
- Deploy docs after backend/web behavior is confirmed.
- Do not rotate Stripe webhook secret or price ids as part of this feature unless documented separately.
- Existing billing rows, trial usage, provider identifiers, audit history, notification history, and signals must remain
  compatible.

## Rollback Notes

- If web rollout fails, revert web to the previous billing UI while backend remains backward-compatible where possible.
- If backend rollout fails after migration, disable new billing actions at the route guard/config level and keep
  reconciliation/signals available for inspection.
- Do not delete append-only webhook, notification, audit, signal, invoice, or operation attempt rows during rollback.
