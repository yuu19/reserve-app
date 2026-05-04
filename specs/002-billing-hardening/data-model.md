# Data Model: Billing Production Hardening

## Overview

The feature extends existing organization-scoped billing. `organization_billing` remains the single aggregate root.
New or extended append-only records provide idempotency, invoice/payment history, notification history, webhook
receipt history, auditability, and reconciliation diagnostics.

## Existing Aggregate: `organization_billing`

**Purpose**: One billing row per organization and the source for current plan, subscription, provider linkage, and
eligibility evaluation.

**Existing fields kept**:
- `id`
- `organization_id`
- `plan_code`: `free` or `premium`
- `stripe_customer_id`
- `stripe_subscription_id`
- `stripe_price_id`
- `billing_interval`: `month`, `year`, or null
- `subscription_status`: `free`, `trialing`, `active`, `past_due`, `unpaid`, `incomplete`, `canceled`
- `cancel_at_period_end`
- `trial_started_at`
- `trial_ended_at`
- `current_period_start`
- `current_period_end`
- `created_at`
- `updated_at`

**New or extended fields**:
- `payment_issue_started_at`: timestamp nullable; set when `past_due`, `unpaid`, or `incomplete` is first observed.
- `past_due_grace_ends_at`: timestamp nullable; set to 7 days after `past_due` starts.
- `billing_profile_readiness`: `complete`, `incomplete`, `unavailable`, `not_required`; default `not_required`.
- `billing_profile_next_action`: nullable diagnostic string for owner/support guidance.
- `billing_profile_checked_at`: timestamp nullable.
- `last_reconciled_at`: timestamp nullable.
- `last_reconciliation_reason`: nullable diagnostic string.

**Validation rules**:
- Unique `organization_id`.
- `stripe_customer_id` and `stripe_subscription_id` remain unique when present.
- `plan_code = free` requires `subscription_status = free` or `canceled` after migration normalization.
- `past_due_grace_ends_at` is meaningful only when `subscription_status = past_due`.
- Billing profile readiness never independently blocks paid checkout or Premium eligibility.

## Entity: `organization_billing_operation_attempt`

**Purpose**: Persistent idempotency and reuse record for owner-initiated billing actions.

**Fields**:
- `id`
- `organization_id`
- `purpose`: `trial_start`, `paid_checkout`, `payment_method_setup`, `billing_portal`
- `billing_interval`: `month`, `year`, or null
- `state`: `processing`, `succeeded`, `conflict`, `expired`, `failed`
- `handoff_url`: provider-hosted URL, nullable
- `handoff_expires_at`: timestamp nullable; active handoffs are reused for 30 minutes
- `provider`: `stripe`
- `stripe_customer_id`
- `stripe_subscription_id`
- `stripe_checkout_session_id`
- `stripe_portal_session_id`
- `idempotency_key`: stable local key for organization + purpose + interval + active window
- `failure_reason`: sanitized string nullable
- `created_by_user_id`
- `created_at`
- `updated_at`

**Validation rules**:
- At most one active reusable attempt for the same `organization_id`, `purpose`, and `billing_interval`.
- Reuse if `state in (processing, succeeded)` and `handoff_expires_at > now`.
- Create a new attempt after expiry.
- Never store raw provider payloads.

## Existing Entity: `stripe_webhook_event`

**Purpose**: Permanent provider event idempotency and receipt history for trusted Stripe events.

**Existing fields kept**:
- `id`: Stripe event id
- `event_type`
- `scope`
- `processing_status`
- `organization_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `failure_reason`
- `processed_at`
- `created_at`
- `updated_at`

**New or extended fields**:
- `signature_verification_status`: `verified`
- `duplicate_detected`: boolean default false
- `duplicate_detected_at`: timestamp nullable
- `receipt_status`: `accepted`, `duplicate`, `failed`

**Validation rules**:
- Stripe event ids are never automatically expired for this feature.
- Duplicate event ids are no-op for billing state, notifications, entitlement, and invoice history.
- Only events that pass signature verification can be recorded as trusted event ids.

## Existing Entity: `stripe_webhook_failure`

**Purpose**: Sanitized failure history for untrusted or failed webhook attempts.

**Existing fields kept**:
- `id`
- `event_id`
- `event_type`
- `scope`
- `failure_stage`
- `failure_reason`
- `organization_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `created_at`

**New accepted failure values**:
- `failure_stage`: add `signature_verification`
- `failure_reason`: add `missing_signature`, `mismatched_signature`, `expired_signature`

**Validation rules**:
- Signature failures must not update `organization_billing`.
- Signature failures must not create owner notifications, entitlement changes, or invoice history rows.
- Failure context is sanitized and must not store raw webhook body or raw payment details.

## Entity: `organization_billing_invoice_event`

**Purpose**: Append-only normalized invoice and payment event history.

**Fields**:
- `id`
- `organization_id`
- `stripe_event_id`
- `event_type`: `invoice_available`, `payment_succeeded`, `payment_failed`, `payment_action_required`
- `stripe_customer_id`
- `stripe_subscription_id`
- `stripe_invoice_id`
- `stripe_payment_intent_id`
- `provider_status`
- `owner_facing_status`: `available`, `checking`, `missing`, `action_required`, `failed`, `succeeded`
- `occurred_at`
- `created_at`

**Validation rules**:
- Unique `(stripe_event_id, event_type)` for trusted provider events.
- Refunds and credit notes are not recorded as v1 invoice events.
- No raw card data, payment method details, raw tax details, or raw provider payloads.

## Entity: `organization_billing_document_reference`

**Purpose**: Safe owner-visible provider document references.

**Fields**:
- `id`
- `organization_id`
- `invoice_event_id`
- `document_kind`: `invoice`, `receipt`
- `provider_document_id`
- `hosted_invoice_url`
- `invoice_pdf_url`
- `receipt_url`
- `availability`: `available`, `unavailable`, `missing`, `checking`
- `owner_facing_status`: `available`, `unavailable`, `checking`
- `provider_derived`: boolean
- `created_at`
- `updated_at`

**Validation rules**:
- URLs are provider-hosted references only.
- Documents are owner-only in organization UI and internal-operator-only in inspection.
- Absence of a document is represented as `missing` or `checking`, never as success.

## Existing Entity: `organization_billing_notification`

**Purpose**: Append-only owner billing communication history.

**Existing fields kept**:
- `organization_id`
- `recipient_user_id`
- `notification_kind`
- `channel`
- `sequence_number`
- `delivery_state`
- `attempt_number`
- `stripe_event_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `recipient_email`
- `plan_state`
- `subscription_status`
- `payment_method_status`
- `trial_ends_at`
- `failure_reason`
- `created_at`

**New notification kinds**:
- `payment_failed_email`
- `payment_action_required_email`
- `past_due_grace_expiring_email`
- `payment_issue_owner_missing_signal`

**Validation rules**:
- Payment failure and action-required notifications create exactly one immediate notification record per verified
  owner per provider event.
- Past-due reminder is sent 3 days before grace expiry if unresolved.
- If no verified owner exists, no non-owner email is sent; create internal signal only.

## Existing Entity: `organization_billing_audit_event`

**Purpose**: Append-only lifecycle transition history.

**New source kinds**:
- `paid_checkout_started`
- `payment_method_setup_started`
- `billing_portal_started`
- `webhook_invoice_available`
- `webhook_payment_succeeded`
- `webhook_payment_failed`
- `webhook_payment_action_required`
- `reconciliation_targeted`
- `reconciliation_full`
- `payment_issue_notification`
- `billing_profile_readiness_changed`

**Validation rules**:
- Do not append no-op transition rows unless they explain duplicate/recovery behavior in a separate receipt/signal.
- Preserve sequence order per organization.

## Existing Entity: `organization_billing_signal`

**Purpose**: Support-visible diagnostics and recovery state.

**New or extended reasons**:
- `unknown_price`
- `missing_billing_profile`
- `billing_profile_unavailable`
- `provider_subscription_unavailable`
- `stale_subscription_state`
- `no_verified_owner_for_payment_issue`
- `past_due_grace_expiring`
- `webhook_signature_rejected`
- `duplicate_webhook_noop`

**Validation rules**:
- Unknown provider price always creates or keeps support-visible investigation context and stops Premium.
- Billing profile readiness gaps create guidance/signals but do not independently stop Premium.
- Signals can be resolved by reconciliation or state recovery.

## Configuration Model: Paid Tier Catalog Entry

**Purpose**: Approved mapping between Stripe price ids and product capabilities.

**Fields**:
- `code`: `premium_default`, `premium_growth`, `premium_scale`
- `label`
- `billing_interval`: `month` or `year`
- `stripe_price_id`
- `capabilities`
- `active`

**Storage decision**: v1 can remain environment/config backed using monthly/yearly Premium price ids. Data model
supports moving to a D1-backed catalog later without changing entitlement semantics.

## Derived Entity: Billing Eligibility Decision

**Inputs**:
- `organization_billing.plan_code`
- `subscription_status`
- `payment_issue_started_at`
- `past_due_grace_ends_at`
- `cancel_at_period_end`
- `current_period_end`
- `stripe_price_id`
- paid tier catalog
- billing profile readiness

**Outputs**:
- `premium_eligible`
- `entitlement_state`: `free_only`, `premium_enabled`
- `reason`
- `grace_status`: `none`, `active`, `expired`
- `next_owner_action`
- `scheduled_cancellation_status`
- `current_period_end`

**Rules**:
- `free`: Premium disabled.
- `trialing`: Premium enabled until `current_period_end`, unless current time is after the end.
- `active`: Premium enabled. If `cancel_at_period_end`, keep enabled until `current_period_end`.
- `past_due`: Premium enabled only during the 7-day grace period.
- `incomplete`: Premium disabled immediately.
- `unpaid`: Premium disabled immediately.
- `canceled`: Premium disabled immediately.
- Unknown price: Premium disabled until price maps to a known catalog entry.
- Billing profile readiness alone never disables Premium.

## State Transitions

```text
free
  -> trialing
  -> active
  -> past_due
  -> active
  -> canceled

free
  -> paid_checkout_handoff
  -> incomplete
  -> active

active/trialing + cancel_at_period_end=true
  -> active/trialing until current_period_end
  -> canceled after current_period_end if not reactivated

past_due
  -> active within 7-day grace
  -> unpaid after unresolved provider state

any provider-linked state
  -> reconciliation_signal when provider lookup unavailable or mismatched
  -> resolved when app/provider state converges
```

## Migration Requirements

- Migration must be additive and preserve existing `organization_billing` rows and trial usage.
- Existing Stripe identifiers and audit/signal rows must remain queryable.
- Backfill `billing_profile_readiness = not_required` for existing rows.
- Backfill `payment_issue_started_at` and `past_due_grace_ends_at` conservatively only for existing `past_due` rows;
  otherwise leave null and let reconciliation set them.
- Do not delete or rewrite historical webhook, notification, audit, or signal rows.
