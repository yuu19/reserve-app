---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
---

# reserve-app - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for reserve-app, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: owner can view the organization's current plan state as `free`, `premium trial`, or `premium paid`
FR2: owner can see which capabilities are available in the free plan and which require premium
FR3: the system can determine premium feature eligibility at the organization level
FR4: the system can apply premium eligibility consistently across all classrooms belonging to the same organization
FR5: staff can use premium-enabled operational capabilities only when their organization has active premium eligibility
FR6: the system can return an organization to free eligibility when a premium trial ends without a valid payment method
FR7: owner can start a 7-day premium trial for their organization
FR8: the system can prevent multiple overlapping premium trials for the same organization
FR9: owner can see when the current trial will end
FR10: the system can transition an organization from `premium trial` to `premium paid` when trial completion conditions are met
FR11: the system can transition an organization from `premium trial` back to `free` when trial completion conditions are not met
FR12: the system can preserve organization data and existing operational setup when plan state changes between free, trial, and paid
FR13: only the organization owner can initiate or manage subscription billing actions
FR14: organization admins cannot change plan state or payment settings
FR15: staff and classroom managers cannot access subscription billing controls
FR16: the system can separate billing authority from operational management authority
FR17: owner can access a billing status view without exposing billing controls to non-owner roles
FR18: owner can register a payment method for the organization before trial end
FR19: owner can complete payment method registration without leaving ambiguity about whether premium will continue
FR20: the system can continue premium access without interruption when a valid payment method exists at trial end
FR21: the system can reflect whether payment method registration has been completed for the organization
FR22: the system can prevent paid conversion when required billing conditions are not satisfied
FR23: the system can notify the owner by email that premium trial end is approaching
FR24: the system can send the owner a reminder 3 days before trial end
FR25: the reminder communication can direct the owner to complete payment method registration
FR26: the system can communicate the consequence of taking no billing action before trial end
FR27: the system can retain a history of billing-related owner notifications
FR28: the system can synchronize organization billing state with Stripe subscription state
FR29: the system can process premium trial lifecycle events received from Stripe
FR30: the system can avoid creating conflicting organization billing states when duplicate billing events are received
FR31: the system can recover to a correct organization billing state when billing events arrive out of order
FR32: the system can identify when Stripe state and organization billing state do not match
FR33: the system can maintain an auditable history of billing state changes and entitlement changes
FR34: authorized internal operators can inspect the billing state of an organization
FR35: authorized internal operators can inspect whether reminder communication was sent
FR36: authorized internal operators can inspect differences between Stripe billing state and application billing state
FR37: authorized internal operators can use billing history and audit records to investigate billing-related issues
FR38: the system can gate multiple classroom and multiple site management behind premium eligibility
FR39: the system can gate staff invitation and role management behind premium eligibility
FR40: the system can gate recurring schedule operations behind premium eligibility
FR41: the system can gate approval-based booking flows behind premium eligibility
FR42: the system can gate ticket and recurring payment related capabilities behind premium eligibility
FR43: the system can gate advanced contract management, participant invitation operations, CSV export, analytics, audit-oriented views, and priority support behind premium eligibility
FR44: owner can review billing history for the organization
FR45: owner can change subscription plan after initial paid activation
FR46: owner can upgrade or downgrade the organization's paid plan when multiple paid tiers are introduced
FR47: the system can support multiple paid tiers in a future phase without changing the organization-scoped billing model
FR48: the system can support additional billing communications beyond email in future phases
FR49: the system can support invoice and receipt related capabilities in future phases

### NonFunctional Requirements

NFR1: Billing status page must load within 3 seconds under normal usage conditions.
NFR2: Trial start and payment method registration handoff must feel immediate to the owner, without ambiguous waiting states.
NFR3: Entitlement changes triggered by Stripe events should be reflected within a few minutes, with a target of within 1 minute under normal conditions.
NFR4: Billing state changes must be restricted to the organization owner.
NFR5: Billing-related data must be protected in transit and at rest.
NFR6: Stripe webhook authenticity must be verified before billing state changes are applied.
NFR7: Billing state changes must be recorded in an auditable trail.
NFR8: Payment details must remain with the payment provider and must not be stored directly by the application except for the minimum provider-derived state needed for billing management.
NFR9: Reminder emails must retry on failure and must not fail silently.
NFR10: Duplicate or out-of-order Stripe webhook events must not corrupt organization billing state.
NFR11: If Stripe is temporarily unavailable, the system must recover safely and support resynchronization to a correct billing state.
NFR12: Plan state and entitlement state must remain internally consistent even when external event delivery is delayed or retried.
NFR13: Billing and billing-status flows must meet a basic WCAG-minded accessibility standard for web use.
NFR14: Core billing actions and status information must be understandable and operable without relying solely on color or ambiguous visual cues.
NFR15: Stripe is the single billing provider for MVP and must be treated as the source of truth for subscription lifecycle events.
NFR16: Email delivery is the only reminder channel for MVP and must be reliable enough to support trial conversion.
NFR17: The application must keep organization billing state and Stripe subscription state reconcilable at all times.
NFR18: MVP must support normal growth in organization count without requiring redesign of the billing model.
NFR19: The billing model must preserve the organization-scoped subscription approach as usage grows, even if classroom count increases.
NFR20: No hard enterprise-scale target is required for MVP, but the design must not block future tier expansion or larger organization adoption.

### Additional Requirements

- Use the existing brownfield monorepo as the implementation baseline; do not introduce a new starter template or bootstrap flow.
- Treat `organization_billing` as the source-of-truth aggregate for subscription lifecycle, and preserve the `1 organization = 1 subscription` model.
- Separate product plan state (`free`, `premium_trial`, `premium_paid`) from provider subscription status (`trialing`, `active`, `past_due`, etc.) rather than using Stripe status directly for entitlement decisions.
- Extend the existing `organization_billing` model instead of replacing it, potentially adding synchronization fields such as `trialStartedAt`, `trialEndsAt`, `lastStripeEventId`, and `lastSyncedAt`.
- Record billing audit and notification history in append-only supporting tables such as `organization_billing_event` and `organization_billing_notification`.
- Enforce owner-only billing authority in both backend and web UI; admins may be read-only, and manager/staff/participant roles must not gain billing controls.
- Keep premium entitlement organization-scoped and apply it consistently to all classrooms and downstream operational features.
- Continue using the existing billing routes under `/api/v1/auth/organizations/billing*` and the existing Stripe webhook endpoint `/api/webhooks/stripe`.
- Normalize Stripe webhook payloads before applying billing state transitions, and funnel state changes through a dedicated billing service/policy layer instead of ad hoc route or webhook updates.
- Process `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and `customer.subscription.trial_will_end` as the core subscription lifecycle events.
- Design webhook processing for idempotency and out-of-order delivery tolerance using Stripe event IDs as idempotency keys.
- Extend the existing contracts page and organization context feature for a trial-first owner billing workspace; do not introduce a new global state library or new app host.
- Show non-owners a read-only billing view where appropriate, while keeping owner actions clearly separated from operational management controls.
- Preserve the current backend/web/module boundaries: route layer, billing application service, Stripe adapter/normalizer, entitlement policy, and notification recorder/sender.
- Keep reminder email as the MVP notification channel and implement retryable, observable send flow with structured logs and Sentry visibility.
- Use existing Cloudflare Workers, D1, Better Auth, and Resend infrastructure; billing schema changes must ship with D1 migrations and existing deployment flow.
- Prefer DB-backed strong consistency over a new cache layer for billing state reads and writes in MVP.
- Make backend integration tests the primary safety net for lifecycle, webhook duplication, downgrade/free fallback, and owner-only denial, with web tests covering contracts page behavior and role-based UI differences.

### UX Design Requirements

- No UX design document was included for this subscription-only scope.

### FR Coverage Map

FR1: Epic 1 - Owner can understand current organization plan state
FR2: Epic 1 - Owner can compare free and premium capabilities
FR3: Epic 3 - System can determine premium eligibility at the organization level
FR4: Epic 3 - Premium eligibility applies consistently across classrooms
FR5: Epic 3 - Staff can use premium capabilities only when the organization is eligible
FR6: Epic 2 - Trial can fall back safely to free when payment conditions are not met
FR7: Epic 1 - Owner can start a 7-day premium trial
FR8: Epic 1 - System prevents overlapping premium trials
FR9: Epic 1 - Owner can see the trial end date
FR10: Epic 2 - Trial can convert to premium paid when conditions are met
FR11: Epic 2 - Trial can revert to free when conditions are not met
FR12: Epic 2 - Plan transitions preserve organization data and setup
FR13: Epic 1 - Only the owner can manage subscription billing actions
FR14: Epic 1 - Admins cannot change plan or payment settings
FR15: Epic 1 - Staff and classroom managers cannot access billing controls
FR16: Epic 1 - Billing authority is separated from operational authority
FR17: Epic 1 - Owner can access billing status without exposing controls to non-owners
FR18: Epic 2 - Owner can register a payment method before trial end
FR19: Epic 2 - Payment method registration communicates conversion outcome clearly
FR20: Epic 2 - Premium access continues without interruption when payment conditions are met
FR21: Epic 2 - System reflects payment method registration status
FR22: Epic 2 - System blocks paid conversion when billing conditions are not satisfied
FR23: Epic 2 - System notifies owner that trial end is approaching
FR24: Epic 2 - System sends a reminder 3 days before trial end
FR25: Epic 2 - Reminder directs owner to complete payment method registration
FR26: Epic 2 - Reminder communicates the consequence of no billing action
FR27: Epic 2 - System keeps a history of billing-related owner notifications
FR28: Epic 2 - System synchronizes app billing state with Stripe subscription state
FR29: Epic 2 - System processes premium trial lifecycle events from Stripe
FR30: Epic 2 - Duplicate billing events do not create conflicting states
FR31: Epic 2 - Out-of-order billing events can still reconcile to the correct state
FR32: Epic 2 - System can detect Stripe/app billing mismatches
FR33: Epic 2 - System maintains auditable billing and entitlement history
FR34: Epic 4 - Internal operators can inspect organization billing state
FR35: Epic 4 - Internal operators can inspect reminder communication status
FR36: Epic 4 - Internal operators can inspect Stripe/app state differences
FR37: Epic 4 - Internal operators can investigate billing issues using audit history
FR38: Epic 3 - Multiple classroom/site management is gated behind premium
FR39: Epic 3 - Staff invitation and role management are gated behind premium
FR40: Epic 3 - Recurring schedule operations are gated behind premium
FR41: Epic 3 - Approval-based booking flows are gated behind premium
FR42: Epic 3 - Ticket and recurring payment capabilities are gated behind premium
FR43: Epic 3 - Advanced management and analytics capabilities are gated behind premium
FR44: Epic 5 - Owner can review billing history in a future expansion phase
FR45: Epic 5 - Owner can change subscription plan after initial paid activation
FR46: Epic 5 - Owner can upgrade or downgrade when multiple paid tiers exist
FR47: Epic 5 - System supports future multiple paid tiers without changing the org billing model
FR48: Epic 5 - System supports future non-email billing communications
FR49: Epic 5 - System supports future invoice and receipt capabilities

## Epic List

### Epic 1: Owner Billing Workspace and Trial Entry
Owners can understand their organization's current plan, compare free versus premium value, and start a premium trial from an owner-only billing workspace.
**FRs covered:** FR1, FR2, FR7, FR8, FR9, FR13, FR14, FR15, FR16, FR17

### Epic 2: Trial-to-Paid Lifecycle and Billing Reliability
Owners can register a payment method, receive clear trial-end guidance, and move from trial to paid or back to free with reliable Stripe-backed lifecycle handling.
**FRs covered:** FR6, FR10, FR11, FR12, FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR27, FR28, FR29, FR30, FR31, FR32, FR33

### Epic 3: Premium Capability Access Across the Organization
Organizations with premium eligibility can consistently use premium operational capabilities across classrooms, staff workflows, and gated management features.
**FRs covered:** FR3, FR4, FR5, FR38, FR39, FR40, FR41, FR42, FR43

### Epic 4: Internal Billing Support and Investigation
Authorized internal operators can inspect billing state, reminder delivery, and Stripe/application mismatches well enough to investigate subscription issues.
**FRs covered:** FR34, FR35, FR36, FR37

### Epic 5: Subscription Management Expansion
Owners can later manage billing history and richer subscription changes while the product evolves without changing the organization-scoped billing model.
**FRs covered:** FR44, FR45, FR46, FR47, FR48, FR49

<!-- Repeat for each epic in epics_list (N = 1, 2, 3...) -->

## Epic 1: Owner Billing Workspace and Trial Entry

Owners can understand their organization's current plan, compare free versus premium value, and start a premium trial from an owner-only billing workspace.

### Story 1.1: Organization Billing Summary and Owner Authorization

As an organization owner,
I want the system to return my organization's billing summary and enforce billing permissions,
So that only the correct role can view or act on subscription billing.

**Acceptance Criteria:**

**Given** an authenticated member requests organization billing data
**When** the member belongs to the organization
**Then** the system returns the current billing summary including product plan state and role-specific permissions
**And** the response distinguishes between view access and billing-action access

**Given** an organization owner requests billing actions or billing summary
**When** the request is authorized
**Then** the system allows access to billing actions for that organization
**And** the permission model is organization-scoped

**Given** an admin, manager, or staff member attempts a billing action
**When** the request reaches the backend
**Then** the system denies the action with an owner-only authorization error
**And** no billing state is changed

**Given** the organization is in `free`, `premium_trial`, or `premium_paid`
**When** billing summary data is returned
**Then** the plan state is represented explicitly
**And** trial timing fields are included when relevant

### Story 1.2: Contracts Page Plan Visibility and Premium Value Comparison

As an organization owner,
I want to see the current plan state, trial timing, and premium-vs-free differences on the contracts page,
So that I can decide whether to start or continue a premium workflow.

**Acceptance Criteria:**

**Given** an owner opens the contracts page
**When** billing data loads successfully
**Then** the page shows the organization's current plan state
**And** it presents trial end information when the organization is in trial

**Given** an owner is on the free plan
**When** the contracts page is displayed
**Then** the page clearly shows which capabilities are available in free
**And** which capabilities require premium

**Given** a non-owner opens the contracts page
**When** billing data is displayed
**Then** the page does not expose owner-only billing controls
**And** any visible status information is read-only and role-appropriate

**Given** billing data is loading or temporarily delayed
**When** the page renders
**Then** the UI provides an understandable loading or intermediate state
**And** it does not rely only on color to communicate status

### Story 1.3: Owner Trial Start Flow

As an organization owner,
I want to start a 7-day premium trial from the billing workspace,
So that I can evaluate premium features for my organization.

**Acceptance Criteria:**

**Given** an eligible owner on the free plan starts a premium trial
**When** the trial action is submitted
**Then** the system creates or updates the organization billing record for a 7-day premium trial
**And** the resulting trial start and end timestamps are persisted

**Given** an organization already has an active premium trial or active paid lifecycle that makes a new trial invalid
**When** the owner attempts to start another trial
**Then** the system rejects the request
**And** it returns a clear lifecycle conflict message

**Given** a trial is started successfully
**When** the owner is returned to the contracts page
**Then** the page reflects the new `premium_trial` state
**And** the trial end date is visible without ambiguity

**Given** a non-owner attempts to start a trial from the UI or direct request
**When** the action is attempted
**Then** the action is blocked in both frontend affordance and backend enforcement
**And** no trial is created

### Story 1.4: Trial Entry UX Messaging and Role-Safe Access Boundaries

As an organization owner,
I want trial entry messaging and access boundaries to be clear,
So that I understand what I can do now and what other roles cannot do.

**Acceptance Criteria:**

**Given** an owner is eligible to start a trial
**When** the contracts page presents the trial entry point
**Then** the UI explains the value of premium and the meaning of the trial clearly
**And** the action is placed in the owner billing workspace

**Given** a non-owner views organization billing status
**When** the page is rendered
**Then** the UI does not imply that the user can modify billing
**And** billing authority is clearly separated from operational authority

**Given** the organization is already in trial or paid state
**When** the contracts page is rendered
**Then** the UI does not present an invalid duplicate trial action
**And** the current lifecycle state is explained clearly

**Given** the billing workspace is used with keyboard or assistive technology
**When** the owner navigates the page
**Then** core status and actions remain understandable and operable
**And** ambiguous visual-only cues are avoided

## Epic 2: Trial-to-Paid Lifecycle and Billing Reliability

Owners can register a payment method, receive clear trial-end guidance, and move from trial to paid or back to free with reliable Stripe-backed lifecycle handling.

### Story 2.1: Payment Method Registration Handoff and Billing Status Reflection

As an organization owner,
I want to start payment method registration from the billing workspace and see whether it has been completed,
So that I can confidently prepare my organization for trial-to-paid conversion.

**Acceptance Criteria:**

**Given** an owner with a valid organization billing context starts payment method registration
**When** the owner chooses the payment method action
**Then** the system creates a Stripe-hosted handoff for that organization
**And** the handoff is tied to the correct organization billing record

**Given** a non-owner attempts to start payment method registration
**When** the request reaches the backend
**Then** the system denies the request as owner-only
**And** no Stripe billing handoff is created

**Given** payment method registration completes through the provider flow
**When** the billing state is refreshed
**Then** the organization billing summary reflects whether payment method registration has been completed
**And** the owner can see that status without ambiguity

**Given** the owner returns from the provider flow before webhook-based updates fully settle
**When** the contracts page reloads
**Then** the UI shows an intermediate status that explains billing updates may take a short time
**And** the page does not falsely report conversion success or failure

### Story 2.2: Trial Lifecycle Transition Policy

As an organization owner,
I want the system to apply correct trial completion rules,
So that my organization moves cleanly to paid or back to free at trial end.

**Acceptance Criteria:**

**Given** an organization is in `premium_trial` and trial completion conditions are satisfied
**When** the billing lifecycle transition is evaluated
**Then** the system transitions the organization to `premium_paid`
**And** premium access continues without interruption

**Given** an organization is in `premium_trial` and required billing conditions are not satisfied at trial end
**When** the billing lifecycle transition is evaluated
**Then** the system transitions the organization back to `free`
**And** premium entitlement is removed consistently

**Given** the organization changes between `free`, `premium_trial`, and `premium_paid`
**When** the lifecycle transition is applied
**Then** organization data and operational setup are preserved
**And** only plan state and entitlement-related fields are changed

**Given** a lifecycle transition request is invalid for the current state
**When** the system evaluates the transition
**Then** it rejects the transition with a clear conflict or validation error
**And** the existing billing state remains unchanged

### Story 2.3: Stripe Webhook Normalization and Idempotent Billing Synchronization

As the billing platform,
I want Stripe subscription lifecycle events to be normalized and synchronized safely,
So that organization billing state remains correct even when provider events are duplicated or arrive out of order.

**Acceptance Criteria:**

**Given** the system receives supported Stripe subscription lifecycle events
**When** the webhook is verified successfully
**Then** the payload is normalized before business state changes are applied
**And** lifecycle updates are routed through a dedicated billing sync/service layer

**Given** the same Stripe event is delivered more than once
**When** webhook processing runs repeatedly
**Then** the system treats the event id as an idempotency key
**And** duplicate processing does not create conflicting billing state

**Given** related Stripe events arrive out of order
**When** the synchronization logic evaluates provider state versus current app state
**Then** the system reconciles to the correct organization billing state
**And** it does not leave the subscription in a permanently inconsistent lifecycle state

**Given** webhook verification fails or provider data is invalid
**When** the webhook is processed
**Then** no unsafe billing state change is committed
**And** the failure is recorded for diagnosis or retry handling

### Story 2.4: Trial Reminder Email and Notification History

As an organization owner,
I want to receive a clear reminder before trial end,
So that I know when premium access will change and what action I need to take.

**Acceptance Criteria:**

**Given** an organization has an active premium trial approaching its end date
**When** the `customer.subscription.trial_will_end` lifecycle event is processed
**Then** the system schedules or sends an email reminder to the owner 3 days before trial end
**And** the reminder includes a path to complete payment method registration

**Given** a reminder email is generated
**When** the message is composed
**Then** it explains the trial end timing and the consequence of taking no billing action
**And** it matches the organization’s current billing context

**Given** a reminder send attempt succeeds or fails
**When** notification processing completes
**Then** the system records the outcome in billing-related notification history
**And** the record is suitable for later audit or support inspection

**Given** email delivery fails transiently
**When** the reminder send is retried
**Then** the system does not fail silently
**And** retry behavior and final outcome are observable

### Story 2.5: Billing Audit Trail and State Reconciliation Signals

As the product team,
I want billing transitions and Stripe/app mismatches to be recorded explicitly,
So that the system remains auditable and recoverable when lifecycle issues occur.

**Acceptance Criteria:**

**Given** a billing state or entitlement state changes
**When** the transition is committed
**Then** the system records an append-only audit event with previous state, next state, and source context
**And** the event can be tied back to the organization and provider identifiers where available

**Given** a billing-related owner notification is requested, succeeds, or fails
**When** the notification pipeline runs
**Then** the system records the event in append-only history
**And** the record is separate from mutable billing summary state

**Given** Stripe provider state and application billing state do not match
**When** synchronization or status evaluation runs
**Then** the system can detect the mismatch
**And** it records enough information to support later investigation or resynchronization

**Given** Stripe is temporarily unavailable or synchronization cannot complete normally
**When** the system handles the failure
**Then** it preserves a recoverable application state
**And** leaves a traceable signal for later resync or manual investigation

## Epic 3: Premium Capability Access Across the Organization

Organizations with premium eligibility can consistently use premium operational capabilities across classrooms, staff workflows, and gated management features.

### Story 3.1: Organization-Scoped Premium Entitlement Policy

As the platform,
I want premium eligibility to be evaluated once at the organization level,
So that all classrooms and staff workflows use the same entitlement decision.

**Acceptance Criteria:**

**Given** an organization billing state is evaluated for premium access
**When** the entitlement policy runs
**Then** it derives premium eligibility from the organization-scoped billing state
**And** it does not create classroom-specific subscription rules

**Given** an organization has multiple classrooms
**When** premium eligibility is active or inactive
**Then** the same entitlement result applies consistently across all classrooms in that organization
**And** downstream capability checks receive the same policy result

**Given** Stripe provider status and internal product plan state differ in meaning
**When** premium eligibility is computed
**Then** the policy uses the application's billing-state rules rather than a raw provider-status shortcut
**And** the eligibility outcome is explicit and testable

**Given** the organization transitions between free, trial, and paid
**When** eligibility is recalculated
**Then** the entitlement result updates consistently
**And** the policy remains independent of UI-local state

### Story 3.2: Premium Feature Enforcement in Backend Operational Flows

As a staff or owner user,
I want premium-only operations to be enforced by the backend,
So that restricted capabilities cannot be used when the organization lacks premium eligibility.

**Acceptance Criteria:**

**Given** an organization lacks active premium eligibility
**When** a user attempts a premium-only backend operation
**Then** the backend denies the operation
**And** the denial is based on organization-scoped entitlement policy

**Given** an organization has active premium eligibility
**When** a user attempts a premium-only backend operation allowed by their operational role
**Then** the backend allows the operation
**And** billing authority is not required for normal premium feature usage

**Given** premium restrictions apply to multiple classroom/site management, staff invitation and role management, recurring schedule operations, approval-based booking flows, ticket or recurring payment capabilities, and advanced management capabilities
**When** backend enforcement is implemented
**Then** each capability category is checked through the same entitlement policy boundary
**And** enforcement logic is not duplicated ad hoc across unrelated handlers

**Given** a non-premium organization becomes premium or loses premium eligibility
**When** subsequent backend operations are evaluated
**Then** access reflects the updated entitlement state
**And** existing operational data is not destroyed by the access change

### Story 3.3: Premium Gating UX on Restricted Features

As an organization member,
I want premium-restricted features to communicate access status clearly,
So that I understand why a feature is unavailable and what it depends on.

**Acceptance Criteria:**

**Given** a user encounters a premium-restricted feature in the web app
**When** the organization lacks premium eligibility
**Then** the UI indicates that premium is required
**And** the messaging is consistent with the organization's current billing context

**Given** the current user is not an owner
**When** a premium restriction is shown
**Then** the UI does not expose owner-only billing actions
**And** it avoids implying that the user can change the subscription themselves

**Given** the current user is an owner in a non-premium organization
**When** a premium restriction is shown
**Then** the UI can guide the owner toward the appropriate billing workspace
**And** the guidance matches the contracts-page trial and billing flow

**Given** restricted status is displayed in the UI
**When** the page is used with keyboard or assistive technology
**Then** the gating state is understandable without relying only on color or hidden context
**And** the user can distinguish unavailable premium features from generic errors

### Story 3.4: Premium Capability Coverage Across Core Feature Areas

As a product team,
I want premium gating to cover all named premium feature categories in the MVP scope,
So that premium access is consistent across the operational surface area.

**Acceptance Criteria:**

**Given** the premium feature categories defined in the subscription requirements
**When** gating coverage is implemented
**Then** the system covers multiple classroom/site management, staff invitation and role management, recurring schedules, approval-based booking flows, ticket or recurring payment capabilities, and advanced management capabilities
**And** each category is explicitly mapped to premium eligibility

**Given** one premium feature category is updated or expanded later
**When** the product team extends gating logic
**Then** the implementation has a clear policy-driven extension point
**And** the organization-scoped subscription model remains unchanged

**Given** a premium organization uses covered premium capabilities
**When** those capabilities are accessed across different parts of the application
**Then** the user experience is consistent with active entitlement
**And** there is no contradictory mix of allowed and blocked behavior for the same organization state

**Given** a free organization uses the same application areas
**When** premium categories are encountered
**Then** the blocked behavior is consistent across the covered feature set
**And** the system does not accidentally leave a premium pathway unguarded

## Epic 4: Internal Billing Support and Investigation

Authorized internal operators can inspect billing state, reminder delivery, and Stripe/application mismatches well enough to investigate subscription issues.

### Story 4.1: Internal Billing Inspection View

As an authorized internal operator,
I want to inspect an organization's billing state and lifecycle summary,
So that I can understand its current subscription situation without direct database access.

**Acceptance Criteria:**

**Given** an authorized internal operator requests an organization's billing inspection view
**When** the request is valid
**Then** the system returns the organization's current billing state summary
**And** the response includes enough lifecycle context to understand free, trial, or paid status

**Given** the inspected organization has Stripe-linked billing information
**When** the inspection view is returned
**Then** key provider-linked identifiers and current provider-facing status are visible where appropriate
**And** the output remains scoped to diagnosis rather than billing mutation

**Given** an unauthorized user attempts to access the internal billing inspection view
**When** the request reaches the backend
**Then** the system denies access
**And** no internal billing details are exposed

**Given** the billing state has changed over time
**When** the internal operator inspects the organization
**Then** the current state can be interpreted in light of recent lifecycle context
**And** the view does not require manual reconstruction from raw logs alone

### Story 4.2: Reminder Delivery and Notification Audit Inspection

As an authorized internal operator,
I want to inspect billing reminder delivery history,
So that I can determine whether trial-end communication was attempted, succeeded, or failed.

**Acceptance Criteria:**

**Given** an organization has billing-related owner notifications in history
**When** an authorized internal operator inspects reminder delivery
**Then** the system shows whether reminder communication was requested, sent, retried, or failed
**And** the timeline is tied to the organization's billing context

**Given** a trial reminder should have been sent before trial end
**When** an operator inspects that organization
**Then** the system can show whether the expected reminder event exists
**And** whether delivery outcome is known

**Given** reminder delivery failed or retried
**When** the history is inspected
**Then** the operator can distinguish transient delivery problems from successful sends
**And** the audit data supports follow-up investigation

**Given** a user without internal support access attempts to inspect notification history
**When** the request is made
**Then** the system denies access
**And** billing notification history remains protected

### Story 4.3: Stripe and Application Billing Mismatch Diagnosis

As an authorized internal operator,
I want to inspect Stripe/application billing mismatches,
So that I can quickly identify whether the problem is provider-side, app-side, or synchronization-related.

**Acceptance Criteria:**

**Given** Stripe provider state and application billing state differ
**When** an authorized internal operator inspects the organization
**Then** the system can surface the mismatch explicitly
**And** the mismatch information distinguishes provider state from product plan state

**Given** synchronization has processed duplicate or out-of-order events
**When** the mismatch view is examined
**Then** the operator can see enough recent billing event context to understand whether reconciliation has already occurred or may still be pending
**And** the diagnostic view does not hide ordering-related clues

**Given** no mismatch exists
**When** the operator inspects the organization
**Then** the system can show that Stripe and application state are aligned
**And** the aligned result is still auditable

**Given** a mismatch is detected
**When** the inspection result is returned
**Then** it provides enough structured information to support manual investigation or resync decisions
**And** it does not require raw provider payload reading as the primary support workflow

### Story 4.4: Billing Investigation Timeline for Support Triage

As an authorized internal operator,
I want a coherent billing investigation timeline,
So that I can use billing history and audit records to classify and explain subscription-related issues.

**Acceptance Criteria:**

**Given** billing state transitions, reminder events, and reconciliation signals have been recorded
**When** an authorized internal operator opens a billing investigation timeline
**Then** the system presents a coherent sequence of relevant events for the organization
**And** the sequence supports troubleshooting billing-related questions

**Given** an owner reports “payment method registered but premium not active” or “trial end email never arrived”
**When** the support operator reviews the timeline
**Then** the operator can correlate current billing state, reminder history, and recent billing events
**And** can classify the issue without ad hoc data gathering from multiple disconnected sources

**Given** the billing history contains audit entries from multiple event types
**When** the investigation timeline is rendered
**Then** the timeline stays focused on support-relevant billing and notification events
**And** it remains understandable for rapid triage

**Given** the system is used for MVP support workflows
**When** the timeline is implemented
**Then** it favors clear inspection and diagnosis over broad administrative controls
**And** it does not become a general-purpose billing admin console

## Epic 5: Subscription Management Expansion

Owners can later manage billing history and richer subscription changes while the product evolves without changing the organization-scoped billing model.

### Story 5.1: Owner Billing History Review

As an organization owner,
I want to review billing history for my organization,
So that I can understand past subscription events and payment-related changes.

**Acceptance Criteria:**

**Given** an owner opens the future billing history view
**When** billing history exists for the organization
**Then** the system shows a readable history of relevant billing events
**And** the history is scoped to the owner's organization

**Given** the organization has recorded plan transitions, notification events, or reconciliation events
**When** the owner reviews billing history
**Then** the history includes enough context to distinguish event types
**And** it presents them without exposing internal-only diagnostic details unnecessarily

**Given** a non-owner attempts to review owner billing history
**When** access is evaluated
**Then** the system denies or restricts access appropriately
**And** owner-facing billing history remains protected

**Given** the history view is introduced after MVP
**When** it is implemented
**Then** it reuses existing append-only billing records where practical
**And** it does not require a redesign of the core subscription model

### Story 5.2: Owner Subscription Plan Change After Paid Activation

As an organization owner,
I want to change my subscription plan after initial paid activation,
So that the product can support future paid-plan management without replacing the existing billing foundation.

**Acceptance Criteria:**

**Given** an owner has an active paid subscription and an eligible plan change path exists
**When** the owner initiates a plan change
**Then** the system starts the provider-backed plan change flow for that organization
**And** the request remains organization-scoped

**Given** the plan change completes successfully
**When** the billing state is synchronized
**Then** the organization's plan state and relevant billing summary are updated
**And** entitlement changes follow the product's plan policy rules

**Given** a non-owner attempts to initiate a subscription plan change
**When** the request is processed
**Then** the system denies the action as owner-only
**And** no plan mutation occurs

**Given** future plan changes are introduced
**When** the flow is implemented
**Then** it extends the existing billing service and policy boundaries
**And** it does not bypass the current audit and synchronization model

### Story 5.3: Multi-Tier Subscription Model Evolution

As a product team,
I want the billing model to support multiple paid tiers in the future,
So that richer subscription packaging can be introduced without changing the organization-scoped subscription architecture.

**Acceptance Criteria:**

**Given** the system evolves beyond a single paid tier
**When** additional paid tiers are defined
**Then** the billing model can represent them without changing the subscription unit from organization scope
**And** existing lifecycle and entitlement policy boundaries remain intact

**Given** new paid tiers introduce different premium capability bundles
**When** entitlement rules are extended
**Then** the implementation can map tier differences through explicit policy
**And** it does not rely on hard-coded assumptions that only one paid tier exists

**Given** current MVP data and billing records already exist
**When** multi-tier support is added
**Then** migration or extension paths preserve compatibility with existing organizations
**And** current paid organizations remain interpretable in the new model

**Given** multi-tier support is implemented
**When** support and audit tooling inspect organization billing
**Then** the tools can still explain the organization's current product plan and provider status clearly
**And** the history remains auditable across tier changes

### Story 5.4: Expanded Billing Communications Beyond Email

As a product team,
I want the platform to support additional billing communications in the future,
So that billing reminders and subscription messaging can expand beyond the MVP email-only channel.

**Acceptance Criteria:**

**Given** future billing communication channels are introduced
**When** the notification model is extended
**Then** the system can support channels beyond email
**And** the existing email reminder flow continues to function without regression

**Given** a new billing communication type is added
**When** notification history is recorded
**Then** the system can represent the channel and outcome in append-only billing communication history
**And** support tooling can inspect the result consistently

**Given** communication expansion is implemented after MVP
**When** product teams define the rollout
**Then** channel-specific behavior remains compatible with the existing reminder and audit architecture
**And** it does not require replacing the organization billing aggregate

**Given** multiple communication channels are available in the future
**When** reminder or billing notice delivery is evaluated
**Then** the system can distinguish which channels were attempted and their outcomes
**And** preserves support-friendly traceability

### Story 5.5: Invoice and Receipt Capability Readiness

As an organization owner,
I want invoice and receipt related capabilities to be supportable in a future phase,
So that the subscription system can evolve toward richer billing documentation needs.

**Acceptance Criteria:**

**Given** invoice or receipt capabilities are introduced in a future phase
**When** the product extends billing functionality
**Then** the implementation can attach those capabilities to the existing subscription model
**And** it does not require changing the organization-scoped ownership structure

**Given** the system continues to rely on provider-backed billing for MVP
**When** invoice or receipt support is later added
**Then** the design makes clear which records remain provider-derived and which are product-managed
**And** audit boundaries remain explicit

**Given** an owner reviews future invoice or receipt information
**When** access is authorized
**Then** the experience is scoped to the owner's organization
**And** non-owner roles do not gain unintended billing-document access

**Given** invoice and receipt support is added
**When** support operators inspect billing history and current status
**Then** the resulting data still aligns with the existing billing timeline and audit model
**And** the extended capability remains compatible with prior billing records
