# Research: Organization Billing

## Decision: Use the existing brownfield monorepo baseline

**Rationale**: The project already has backend, web, mobile, authentication,
organization/classroom authorization, billing rows, Stripe integration, contracts UI,
D1 migrations, and test/deploy workflows. The feature is a billing lifecycle evolution,
not a bootstrap problem.

**Alternatives considered**:
- New billing service: rejected because it would duplicate auth, D1, deployment, and
  support observability concerns.
- New frontend app or state layer: rejected because contracts/billing workspace already
  exists and must remain consistent with organization context.

## Decision: Keep subscription ownership at organization scope

**Rationale**: The product sells premium operational capacity to an organization, while
classrooms are downstream operational units. One organization must have at most one active
subscription aggregate, and premium entitlement must apply consistently across classrooms.

**Alternatives considered**:
- Classroom-scoped subscriptions: rejected because it would create conflicting entitlement
  decisions for staff and cross-classroom workflows.
- User-scoped subscriptions: rejected because billing authority belongs to the organization
  owner, not individual staff or participants.

## Decision: Separate product plan state from provider subscription status

**Rationale**: Product behavior depends on `free`, `premium_trial`, and `premium_paid`, while
provider status includes lifecycle details such as trialing, active, incomplete, past_due,
unpaid, and canceled. Entitlement decisions must be stable and product-oriented, while
provider status remains available for reconciliation and support.

**Alternatives considered**:
- Use provider status directly for entitlement: rejected because provider states do not map
  one-to-one to product capabilities.
- Hide provider status entirely: rejected because support needs mismatch diagnosis.

## Decision: Owner-only billing authority

**Rationale**: Billing responsibility is separate from operational authority. Admins and
staff can manage operations, but plan changes and payment settings must remain with the
organization owner to avoid accidental contract changes.

**Alternatives considered**:
- Admin billing management: rejected for MVP because it weakens the contract responsibility
  boundary.
- Staff billing controls hidden only in UI: rejected because backend enforcement is required.

## Decision: Webhook processing must be idempotent and reconcilable

**Rationale**: External billing events can be duplicated, delayed, or delivered out of order.
The application must record event identity, normalize lifecycle events, avoid conflicting
state writes, and expose mismatch/recovery signals.

**Alternatives considered**:
- Process events as simple updates without event history: rejected because it cannot support
  duplicate detection or support triage.
- Manual-only reconciliation: rejected because it would not meet reliability expectations.

## Decision: Trial reminder communication is email-only for MVP

**Rationale**: The PRD constrains MVP reminder communication to email. This keeps the revenue
loop focused while still requiring delivery history, failure visibility, and retry state.

**Alternatives considered**:
- In-app notifications in MVP: deferred to post-MVP to avoid expanding scope.
- Multiple channels in MVP: rejected because channel coordination adds complexity before the
  core lifecycle is proven.

## Decision: Append-only histories for notification, audit, and signals

**Rationale**: Billing support requires a timeline of what changed, which event caused it,
what communication was attempted, and whether app/provider state matched. Append-only
history preserves supportability without overloading the current billing row.

**Alternatives considered**:
- Store only latest state on the billing row: rejected because it loses investigation context.
- One generic JSON log only: rejected because queryable support views need structured fields.

## Decision: Risk-based testing centered on backend integration

**Rationale**: The highest risks are authorization, lifecycle state, D1-backed persistence,
webhook deduplication, downgrade/free fallback, and premium gating. These cross multiple
tables and routes, so backend integration tests provide the right safety net. Web tests cover
role-specific UI and status rendering.

**Alternatives considered**:
- Unit tests only: rejected because cross-table lifecycle bugs would be missed.
- Browser tests for all behavior: rejected because backend lifecycle correctness is the
  primary risk and browser tests are not currently CI-required.
