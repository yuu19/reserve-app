# Research: Billing Production Hardening

## Decision: Brownfield extension of existing organization billing

**Rationale**: The current 001 billing implementation already has the correct aggregate root
(`organization_billing`), Stripe webhook intake, notification history, audit events, reconciliation signals,
internal inspection, and web contracts page. Hardening should add missing states and recovery surfaces without
introducing a second billing subsystem.

**Alternatives considered**:
- New billing service: rejected because it duplicates state and weakens D1/Worker operational simplicity.
- Classroom-scoped subscription ownership: rejected by spec and constitution because Premium remains
  organization-scoped.

## Decision: Stripe Billing + Checkout Sessions + Customer Portal remain the provider surfaces

**Rationale**: Recurring SaaS billing is already modeled as Stripe subscription lifecycle. Paid checkout,
trial subscription creation, setup handoff, billing portal management, invoice/receipt references, and billing/tax
collection should remain provider-hosted. This keeps payment details, card data, billing profile, and tax-relevant
collection outside application storage.

**Alternatives considered**:
- PaymentIntent-only subscription modeling: rejected because subscription lifecycle, invoice events, and portal
  management are first-class Stripe Billing concerns.
- Custom in-app payment method or tax form: rejected because it increases PCI/privacy risk and conflicts with the
  provider-hosted collection boundary.

## Decision: Common billing action envelope for all billing actions

**Rationale**: Trial start, paid checkout, payment method setup, and portal handoff currently return inconsistent
payloads. A shared envelope with `status`, optional `billing`, optional `handoff`, and optional `message` makes web
guards and API contract tests stable. The envelope also supports conflict and reused handoff outcomes.

**Alternatives considered**:
- Keep endpoint-specific responses: rejected because UI and documentation drift is already a risk.
- Return raw provider session objects: rejected because raw provider payloads are unnecessary and leak provider
  implementation detail.

## Decision: Payment eligibility state is explicit and conservative

**Rationale**: `incomplete` and `unpaid` stop Premium immediately; `past_due` gets a 7-day grace period; `canceled`
stops Premium immediately; scheduled period-end cancellation on `active` or `trialing` keeps Premium until current
period end. Unknown price stops Premium until mapped. Billing profile readiness alone does not block paid checkout
or Premium eligibility.

**Alternatives considered**:
- Permit all provider-linked statuses: rejected because initial incomplete and unpaid usage can leak paid features.
- Stop `past_due` immediately: rejected because recoverable payment issues would create unnecessary support load.
- Gate Premium on billing profile readiness: rejected because provider-hosted flow owns collection and readiness is
  diagnostic/guidance state.

## Decision: Add persistent operation attempts for owner billing handoffs

**Rationale**: The spec requires 30-minute reuse for active handoffs by organization and purpose. Persisting
operation attempts allows repeated button clicks, network retries, and browser reloads to return an existing
handoff rather than creating duplicate Checkout, Setup, or Portal sessions. Attempts also explain processing,
success, conflict, expiry, and retry outcomes in support inspection.

**Alternatives considered**:
- Client-side debounce only: rejected because retry and duplicate protection must survive browser/session loss.
- Provider lookup only: rejected because provider APIs do not represent all local purposes and reuse semantics.

## Decision: Webhook processing verifies signature before event trust and stores provider event ids permanently

**Rationale**: Signature failure must not change billing state, create notifications, or update invoice history.
After signature verification succeeds, provider event id is the permanent idempotency key. Duplicate event ids are
no-op for state changes and retain receipt history only.

**Alternatives considered**:
- 30-day event id retention: rejected because replay risk and audit needs exceed a rolling cache.
- Process unverified events if event id is new: rejected because event id does not prove authenticity.
- Treat duplicates as errors: rejected because provider retry/replay is normal and should not create false alarms.

## Decision: Reconciliation uses targeted hourly plus daily full coverage

**Rationale**: Risky states (`incomplete`, `past_due`, `unpaid`, stale `trialing`, unresolved signals, provider lookup
failures) need fast recovery. Daily full reconciliation catches missed webhook or drift across all provider-linked
statuses, including active/trialing/canceled. Both modes append audit or signals only when meaningful.

**Alternatives considered**:
- Webhook-only synchronization: rejected because webhook delivery can be delayed, duplicated, or missed.
- Full reconciliation hourly: deferred because cost and rate considerations are unnecessary for low-risk active
  subscriptions.

## Decision: Owner payment issue notifications go to every verified owner

**Rationale**: Payment failure, action-required, and upcoming past-due grace expiry are organization billing
responsibilities. All verified owners should receive email and contract history entries. If no verified owner exists,
the system must not send to non-owners and should create an internal signal.

**Alternatives considered**:
- Send only to the active owner: rejected because ownership can change and billing responsibility is shared.
- Notify admins/managers when no verified owner exists: rejected because non-owner roles do not have billing
  authority.

## Decision: Invoice/payment events are normalized as billing history and support context

**Rationale**: v1 needs invoice availability, payment success, payment failure, and payment action required. Owner UI
should expose provider-hosted invoice/receipt references only. Internal inspection should show provider ids, event
state, timestamps, notification outcome, and next support action without raw payment details.

**Alternatives considered**:
- Query Stripe live only from the UI: rejected because owner history and support timelines need auditable application
  context.
- Store raw Stripe invoice/payment payloads: rejected because the feature only needs sanitized references and states.

## Decision: Billing profile readiness is stored as guidance and diagnostic state

**Rationale**: Billing contact/tax collection happens through Stripe-hosted flows. The application stores readiness
state (`complete`, `incomplete`, `unavailable`, `not_required`) and next action context, but readiness does not
independently gate checkout or Premium eligibility.

**Alternatives considered**:
- Block paid checkout until readiness is complete: rejected because checkout can be the provider-hosted collection
  point.
- Hide readiness from owners: rejected because owners need next action guidance when provider collection is
  incomplete or unavailable.

## Decision: Monthly and yearly paid entry are both first-class v1 choices

**Rationale**: The spec requires both intervals when approved prices are configured. Trial and paid checkout UI and
API should expose available monthly/yearly price metadata, and unknown/unconfigured prices must be diagnostic rather
than silently falling back.

**Alternatives considered**:
- Default-price-only checkout: rejected by clarification.
- Allow arbitrary provider prices: rejected because unknown price must not unlock Premium.
