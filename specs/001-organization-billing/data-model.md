# Data Model: Organization Billing

## Entity: Organization Billing

**Purpose**: Organization-scoped source of truth for product billing state and provider linkage.

**Key fields**:
- `id`: billing row identifier
- `organizationId`: owning organization; unique
- `planState`: `free` | `premium_trial` | `premium_paid`
- `providerCustomerId`: external customer identifier, nullable for free organizations
- `providerSubscriptionId`: external subscription identifier, nullable until linked
- `providerPriceId`: current price identifier, nullable
- `providerSubscriptionStatus`: provider lifecycle status such as `trialing`, `active`,
  `past_due`, `unpaid`, `incomplete`, or `canceled`
- `billingInterval`: `month` | `year` | null
- `trialStartedAt`: nullable timestamp
- `trialEndsAt`: nullable timestamp
- `paymentMethodRegisteredAt`: nullable timestamp
- `currentPeriodStart`: nullable timestamp
- `currentPeriodEnd`: nullable timestamp
- `cancelAtPeriodEnd`: boolean
- `lastProviderEventId`: nullable identifier for latest applied provider event
- `lastSyncedAt`: nullable timestamp

**Relationships**:
- Belongs to one organization.
- Has many subscription lifecycle events.
- Has many notification records.
- Has many audit entries and reconciliation signals.

**Validation rules**:
- Exactly one active billing row per organization.
- `premium_trial` requires `trialEndsAt`.
- `premium_paid` requires a provider subscription link or a documented migration exception.
- `free` must not grant premium-only capabilities.
- Payment details are not stored directly.

## Entity: Subscription Lifecycle Event

**Purpose**: Normalized record of external or application-triggered billing lifecycle input.

**Key fields**:
- `id`: internal event record identifier
- `eventId`: external event id or application-generated idempotency key
- `organizationId`: nullable until resolved
- `eventType`: checkout completion, subscription created/updated/deleted, trial will end,
  trial completion, owner trial start, payment method handoff, manual recovery
- `scope`: organization billing, ticket purchase, ignored, or unknown
- `providerCustomerId`: nullable
- `providerSubscriptionId`: nullable
- `receivedAt`: timestamp
- `processedAt`: nullable timestamp
- `processingStatus`: `processed` | `ignored` | `failed` | `duplicate`
- `failureReason`: nullable

**Relationships**:
- May resolve to one organization billing row.
- May produce audit entries, notification records, and reconciliation signals.

**Validation rules**:
- `eventId` is unique for provider events.
- Duplicate events do not re-apply state transitions.
- Failed events retain enough context for retry or support classification.

## Entity: Premium Entitlement

**Purpose**: Product policy result that determines whether an organization can use premium
capabilities.

**Key fields**:
- `organizationId`
- `planState`
- `eligible`: boolean
- `reason`: active paid, active trial, expired trial, free plan, provider mismatch, missing
  trial end, payment incomplete
- `trialEndsAt`: nullable timestamp
- `paymentMethodRegistered`: boolean
- `capabilities`: capability identifiers enabled for the organization

**Relationships**:
- Derived from Organization Billing.
- Consumed by backend operational flows and UI status rendering.

**Validation rules**:
- Entitlement is derived; it is not manually edited as a separate source of truth.
- Classroom-specific operations must use organization entitlement for premium gating.

## Entity: Billing Notification

**Purpose**: History of owner-facing billing communication.

**Key fields**:
- `id`
- `organizationId`
- `recipientUserId`
- `recipientEmail`
- `notificationKind`: `trial_will_end`, future billing communication kinds
- `channel`: `email`
- `triggerEventId`: nullable lifecycle event id
- `trialEndsAt`: nullable timestamp
- `deliveryStatus`: `pending` | `delivered` | `failed` | `skipped`
- `attemptCount`: number
- `lastAttemptAt`: nullable timestamp
- `deliveredAt`: nullable timestamp
- `failureReason`: nullable

**Relationships**:
- Belongs to organization billing.
- May be linked to a lifecycle event and audit/signal entries.

**Validation rules**:
- Trial reminder records must be queryable by organization and event id.
- Failure must not be silent; a failed or pending state must be inspectable.

## Entity: Billing Audit Entry

**Purpose**: Append-only trail of billing state and entitlement changes.

**Key fields**:
- `id`
- `organizationId`
- `sequenceNumber`
- `sourceKind`: owner action, webhook lifecycle, trial completion, notification, manual recovery
- `sourceEventId`: nullable
- `previousPlanState`
- `nextPlanState`
- `previousProviderStatus`
- `nextProviderStatus`
- `previousEligibility`
- `nextEligibility`
- `summary`
- `createdAt`

**Relationships**:
- Belongs to organization billing.
- Correlates to lifecycle events and notifications.

**Validation rules**:
- Entries are append-only.
- State-changing billing operations must emit audit entries.

## Entity: Reconciliation Signal

**Purpose**: Support-facing signal that identifies provider/application drift or recovery state.

**Key fields**:
- `id`
- `organizationId`
- `sequenceNumber`
- `signalKind`: mismatch, recovered, pending, provider unavailable, notification failed
- `signalStatus`: open, resolved, informational
- `providerPlanState`
- `providerSubscriptionStatus`
- `appPlanState`
- `appSubscriptionStatus`
- `sourceEventId`
- `reason`
- `createdAt`
- `resolvedAt`

**Relationships**:
- Belongs to organization billing.
- May be shown in internal billing inspection.

**Validation rules**:
- Signals must be queryable by organization and status.
- Recovery must not erase historical signals.

## Entity: Internal Billing Inspection

**Purpose**: Read model for support investigation.

**Key fields**:
- `organizationId`
- `organizationName`
- `currentBillingSummary`
- `providerState`
- `appState`
- `latestNotification`
- `latestSignal`
- `auditTimeline`
- `webhookTimeline`

**Relationships**:
- Composes Organization Billing, Billing Notification, Billing Audit Entry, Reconciliation
  Signal, and Subscription Lifecycle Event.

**Validation rules**:
- Accessible only to authorized internal operators.
- Must not expose payment details beyond provider-derived status and identifiers needed for
  support.

## State Transitions

```text
free
  -> premium_trial
     Trigger: owner starts eligible 7-day trial
     Guards: owner-only, no overlapping/conflicting trial

premium_trial
  -> premium_paid
     Trigger: trial completion with valid payment continuation
     Guards: provider state confirms paid continuation or payment method conditions are met

premium_trial
  -> free
     Trigger: trial completion without valid payment continuation
     Guards: data/setup preserved, premium-only actions disabled

premium_paid
  -> free
     Trigger: cancellation/deletion/non-recoverable provider state requiring fallback
     Guards: audit entry and reconciliation signal emitted

any state
  -> same state
     Trigger: duplicate provider event or ignored event
     Guards: idempotency prevents duplicate effects
```
