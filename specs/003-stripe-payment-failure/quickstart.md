# Quickstart: Stripe Payment Failure Handling

## Scope

This plan implements focused payment failure behavior for the existing organization billing system. It does not add a
new billing provider, new top-level package, classroom-scoped subscriptions, refund/credit-note lifecycle, in-app
payment method storage, or raw Stripe payload persistence.

## Prerequisites

- Existing billing hardening migrations are applied through `0017_billing_production_hardening.sql`.
- Stripe Premium monthly/yearly prices are configured where paid checkout is available.
- Stripe webhook endpoint is configured for subscription lifecycle, payment failure, payment success, and
  action-required events.
- Resend is configured for environments where payment issue emails are verified.
- Stripe Billing E2E CI secrets are available when running real Stripe Test Clock evidence.

## Expected Environment Variables

Backend:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PREMIUM_MONTHLY_PRICE_ID`
- `STRIPE_PREMIUM_YEARLY_PRICE_ID`
- `WEB_BASE_URL`
- Resend variables already documented by existing email setup
- Internal billing inspection allowlist variables already used by billing inspection

Frontend:

- `PUBLIC_BACKEND_URL`

Stripe Billing E2E:

- `STRIPE_E2E_SECRET_KEY`
- `STRIPE_E2E_PREMIUM_MONTHLY_PRICE_ID`
- `STRIPE_E2E_PREMIUM_YEARLY_PRICE_ID`
- Optional `STRIPE_E2E_WEBHOOK_SECRET`

## Implementation Order

1. Confirm no D1 migration is required.
   - Existing payment issue timestamp, grace deadline, invoice event, notification, webhook, audit, and signal fields
     are sufficient for the planned behavior.
   - If implementation discovers a concrete missing field or index, add an additive migration and update
     `data-model.md`.

2. Update billing state and policy behavior.
   - Set `payment_issue_started_at` from provider-side payment issue timestamp when available.
   - Fall back to application receipt time when provider-side issue time is unavailable.
   - Calculate `past_due_grace_ends_at` from that chosen start time.
   - Keep `unpaid` and `incomplete` immediate Premium stops.
   - Restore Premium when latest provider state confirms recovery and no other blocker applies.

3. Update Stripe webhook payment issue flow.
   - Keep trusted event id duplicate behavior permanent.
   - Use failed-processing retry path for retryable notification delivery failures.
   - Keep stale failure events after confirmed recovery as safe history/investigation context only.
   - Do not reopen payment issue or stop Premium from stale failure events when latest provider state is recovered.

4. Update owner notification delivery.
   - Select verified owners per payment issue event.
   - Insert recipient-scoped requested/retried/sent/failed records.
   - Retry only verified-owner recipients whose latest event/kind delivery did not reach `sent`.
   - Do not resend to already notified owners.
   - Create internal signal only when no verified owner exists.

5. Update owner and internal read models.
   - Expose grace start source and deadline as owner-safe context.
   - Include stale failure history without presenting it as an active issue.
   - Include recipient-level notification outcome and retry eligibility in internal inspection only.

6. Update web billing UI.
   - Render payment failed, action required, past-due grace active, grace expired, unpaid, incomplete, recovered, and
     stale-history-only states.
   - Keep payment recovery controls owner-only.
   - Keep non-owner view read-only and free of payment document/notification recipient details.

7. Update documentation if user-facing or operational behavior changes.
   - `docs/billing.md` for operational payment failure behavior.
   - `docs/test-strategy.md` only if verification commands or CI expectations change.

## Verification Commands

Targeted backend checks:

```bash
pnpm --filter @apps/backend exec vitest run src/billing/organization-billing-policy.test.ts
pnpm --filter @apps/backend exec vitest run src/app.test.ts -t "payment failure|payment issue|past_due|stale|notification"
pnpm --filter @apps/backend test
```

Targeted web checks:

```bash
pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts
pnpm --filter @apps/web test
```

Stripe Billing E2E when secrets are available:

```bash
pnpm --filter @apps/web test:e2e:billing
```

Broader checks before completion:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

## Required Backend Test Coverage

- `past_due` grace starts from provider-side issue time when available.
- `past_due` grace falls back to application receipt time when provider issue time is unavailable.
- `past_due` remains Premium eligible during the 7-day grace and stops after expiry.
- `unpaid` and `incomplete` stop Premium immediately.
- Payment recovery restores Premium when no other blocker applies.
- Stale payment failure after confirmed recovery creates history/investigation context only.
- Stale payment failure after recovery does not reopen issue, stop Premium, or send new owner notification.
- Payment failed and action-required events notify every verified owner once.
- Notification retry targets only failed verified-owner recipients.
- Already sent verified-owner recipients are not re-sent during retry.
- No verified owner creates internal signal and no non-owner email.
- Duplicate trusted event id creates no additional state, notification, entitlement, or payment history changes.
- Untrusted webhook attempts do not change billing state or notification history.
- Unknown organization/customer/subscription linkage creates sanitized failure or signal only.

## Required Web Test Coverage

- Owner sees payment failed next action and history.
- Owner sees payment action required next action and history.
- Owner sees past-due grace active with grace deadline.
- Owner sees grace expired, unpaid, and incomplete as Premium unavailable.
- Owner sees recovered state without unresolved payment issue guidance.
- Stale failure history does not render as an active payment issue.
- Non-owner sees read-only status and no payment recovery controls.
- Owner notification recipient details are not exposed in owner or non-owner contract UI.

## Manual Release Evidence

Record in implementation notes or PR:

- Stripe webhook endpoint includes required `invoice.*` and `customer.subscription.*` events.
- Payment failure, action-required, and recovery can be reproduced in a safe Stripe test mode environment.
- Resend sender is valid for owner payment issue emails in the target environment.
- Stripe Billing E2E workflow is configured with test-mode secrets before nightly/manual runs are expected.
- Internal operator can inspect notification failures without payment details.

## Rollback Notes

- If web rollout fails, revert UI changes while backend continues to expose backward-compatible billing summary fields.
- If backend payment failure behavior fails after deployment, disable payment recovery action entry points where possible
  and keep webhook/audit/signal records for investigation.
- Do not delete append-only webhook, notification, audit, signal, invoice, or operation attempt records during rollback.
