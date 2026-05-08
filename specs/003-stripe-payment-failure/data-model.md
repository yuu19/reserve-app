# Data Model: Stripe Payment Failure Handling

## Overview

This feature reuses the existing organization-scoped billing aggregate and append-only support tables. The data model
does not require a new top-level aggregate. `organization_billing` remains the source for current Premium eligibility,
while webhook receipts, invoice/payment events, notifications, audit events, and signals explain how the state changed.

## Existing Aggregate: `organization_billing`

**Purpose**: One billing row per organization and the source for current Premium payment issue state.

**Relevant fields**:

- `organization_id`: unique organization scope.
- `plan_code`: `free` or `premium`.
- `subscription_status`: `free`, `trialing`, `active`, `past_due`, `unpaid`, `incomplete`, `canceled`.
- `payment_issue_started_at`: timestamp nullable; set from provider-side issue time when available, otherwise
  application receipt time.
- `past_due_grace_ends_at`: timestamp nullable; `payment_issue_started_at + 7 days` for `past_due`.
- `current_period_end`: timestamp nullable; used for subscription and cancellation context.
- `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`: provider linkage.
- `last_reconciled_at`, `last_reconciliation_reason`: latest provider comparison context.

**Validation rules**:

- Billing remains organization-scoped; no classroom-scoped subscription ownership.
- `past_due_grace_ends_at` is meaningful only for `past_due`.
- `unpaid` and `incomplete` stop Premium immediately.
- `past_due` allows Premium only while `past_due_grace_ends_at` is in the future.
- Recovery clears unresolved payment issue guidance when latest provider state is no longer blocking.

## Existing Entity: `stripe_webhook_event`

**Purpose**: Permanent trusted provider event receipt and duplicate detection.

**Relevant fields**:

- `id`: Stripe event id.
- `event_type`: provider event type.
- `processing_status`: `processing`, `processed`, or `failed`.
- `receipt_status`: `accepted`, `duplicate`, or `failed`.
- `duplicate_detected`, `duplicate_detected_at`.
- `organization_id`, `stripe_customer_id`, `stripe_subscription_id`.
- `failure_reason`, `processed_at`.

**Validation rules**:

- Processed duplicate events are no-op for state, notifications, entitlement, and payment history.
- Failed events can be retried through the failed-processing path.
- Untrusted webhooks never become trusted event receipts.

## Existing Entity: `stripe_webhook_failure`

**Purpose**: Sanitized history for untrusted or failed webhook attempts.

**Relevant fields**:

- `event_id`, `event_type`.
- `failure_stage`, `failure_reason`.
- `organization_id`, `stripe_customer_id`, `stripe_subscription_id`.
- `created_at`.

**Validation rules**:

- Signature failures do not mutate billing state.
- Unknown organization/customer/subscription linkage records failure context only.
- Raw webhook body and payment details are not stored.

## Existing Entity: `organization_billing_invoice_event`

**Purpose**: Safe payment issue and recovery history.

**Relevant fields**:

- `organization_id`.
- `stripe_event_id`.
- `event_type`: `invoice_available`, `payment_succeeded`, `payment_failed`, `payment_action_required`.
- `stripe_customer_id`, `stripe_subscription_id`, `stripe_invoice_id`, `stripe_payment_intent_id`.
- `provider_status`.
- `owner_facing_status`: `available`, `checking`, `missing`, `action_required`, `failed`, `succeeded`.
- `occurred_at`: provider-side event time where available.

**Validation rules**:

- Trusted `(stripe_event_id, event_type)` pairs are unique.
- Stale payment failure events after recovery are retained as history and investigation context only.
- No card data, payment method details, tax details, or raw provider payloads.

## Existing Entity: `organization_billing_notification`

**Purpose**: Append-only owner payment issue communication history.

**Relevant fields**:

- `organization_id`.
- `recipient_user_id`, `recipient_email`.
- `notification_kind`: `payment_failed_email`, `payment_action_required_email`,
  `past_due_grace_reminder_email`, plus existing billing notification kinds.
- `delivery_state`: `requested`, `retried`, `sent`, `failed`.
- `attempt_number`.
- `stripe_event_id`, `stripe_customer_id`, `stripe_subscription_id`.
- `failure_reason`.

**Validation rules**:

- Immediate payment issue notification is recipient-scoped for every verified owner.
- Retry attempts target failed verified-owner recipients only.
- Already sent recipient/event/kind combinations are not re-sent.
- If no verified owner exists, no non-owner email is sent; create support-visible signal only.

## Existing Entity: `organization_billing_signal`

**Purpose**: Support-visible investigation and recovery context.

**Relevant fields**:

- `organization_id`.
- `signal_kind`: includes `notification_delivery`, `reconciliation`, and billing diagnostics.
- `signal_status`: pending/resolved/unavailable style status.
- `source_kind`, `reason`.
- `stripe_event_id`, `stripe_customer_id`, `stripe_subscription_id`.
- provider/app state snapshot fields.

**Validation rules**:

- Missing verified owner creates an internal signal.
- Notification delivery failures create pending or unavailable signal context.
- Stale failure-after-recovery and unknown linkage states remain support-visible without leaking payment details.

## State Transitions

```text
active/trialing
  ├─ payment_failed or action_required -> past_due/incomplete/unpaid depending on latest provider state
  ├─ payment_succeeded -> active/recovered
  └─ stale failure after confirmed recovery -> recovered + history only

past_due
  ├─ within 7-day grace -> Premium enabled + payment update guidance
  ├─ grace expired -> Premium stopped + payment update guidance
  └─ payment_succeeded/latest active -> recovered/active

unpaid or incomplete
  ├─ payment_succeeded/latest active -> recovered/active
  └─ unresolved -> Premium stopped
```

## Migration Position

No new D1 migration is planned for the initial implementation. If implementation proves recipient-level retry cannot
be made deterministic with the existing append-only notification records, add an additive migration only after updating
this data model and contracts.
