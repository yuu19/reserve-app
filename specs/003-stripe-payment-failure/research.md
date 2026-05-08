# Research: Stripe Payment Failure Handling

## Decision: Treat 003 as a focused brownfield patch on top of 002 billing hardening

**Rationale**: Existing 002 artifacts and code already include organization-scoped billing, Stripe webhook receipts,
invoice/payment events, notification history, audit/signal records, owner contract UI, and Stripe Test Clock E2E. The
remaining risk is behavior precision for payment failure edge cases, not a new billing architecture.

**Alternatives considered**:

- Create a new billing subsystem: rejected because it violates the existing architecture and duplicates 002.
- Add a broad migration-first feature: rejected because current tables already carry the required aggregate, event,
  notification, and signal data for this focused patch.

## Decision: Calculate past-due grace from provider-side issue time with application receipt fallback

**Rationale**: Stripe notifications can be delayed or retried. Using the provider-side issue time keeps the 7-day
grace policy aligned with the actual billing lifecycle. Application receipt time is retained as fallback for incomplete
or unavailable provider timestamps so the policy remains deterministic.

**Alternatives considered**:

- Start grace from application receipt time only: simpler but gives inconsistent grace when webhooks are delayed.
- Start grace from owner notification time: rejected because notification delivery should not change entitlement policy.

## Decision: Retry payment issue notifications per failed verified-owner recipient

**Rationale**: Payment issue emails are recipient-scoped. Re-sending to already notified owners creates noise and can
make support history harder to interpret. Retrying only failed verified owners preserves delivery recovery without
duplicating successful notifications.

**Alternatives considered**:

- Retry all verified owners if any owner failed: rejected due to duplicate owner communication.
- Do not retry failed owners: rejected because retryable Resend or configuration failures should be recoverable.

## Decision: Preserve stale failure events after recovery as history only

**Rationale**: Out-of-order Stripe notifications are expected. If the latest provider state confirms recovery, an older
failure event should remain auditable but must not re-open the payment issue or stop Premium again.

**Alternatives considered**:

- Always reopen on any failure event: rejected because stale events can incorrectly stop recovered organizations.
- Ignore stale failure events entirely: rejected because support needs an audit trail for received provider events.

## Decision: Keep webhook duplicate handling permanent and add retry path only for failed processing states

**Rationale**: Trusted Stripe event ids should remain permanent duplicate keys. Retryable failures should use the
existing failed-processing path and should not be confused with processed duplicate no-ops. This keeps state changes,
notification sends, entitlement updates, and invoice history idempotent.

**Alternatives considered**:

- Allow processed duplicates to trigger notification retry: rejected because it weakens permanent no-op semantics.
- Add a separate queue service: rejected because it adds operational complexity beyond the current Workers/D1 setup.

## Decision: Use existing billing tables unless implementation discovers a concrete storage gap

**Rationale**: `organization_billing` already stores payment issue timestamps and grace deadline. Existing append-only
notification rows include recipient, delivery state, attempt number, event id, and failure reason. Existing invoice
event, webhook receipt/failure, audit, and signal tables cover payment history and investigation context.

**Alternatives considered**:

- Add a dedicated payment issue table: rejected for this plan because current aggregate and append-only tables already
  model the required state and history.
- Add uniqueness constraints before implementation: deferred unless tests show duplicate prevention cannot be enforced
  safely in service logic.

## Decision: Keep Stripe payment details provider-hosted and provider-reference-only

**Rationale**: Stripe Billing and Customer Portal remain the source for payment method management. The application only
needs safe references, statuses, timestamps, and owner/support guidance. This reduces privacy and compliance risk and
aligns with existing docs.

**Alternatives considered**:

- Store payment method details locally: rejected because it is unnecessary and increases sensitive data scope.
- Build in-app payment management UI: rejected because provider-hosted flows already cover the required recovery path.
