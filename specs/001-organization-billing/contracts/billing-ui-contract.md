# UI Contract: Organization Billing Workspace

## Owner Billing Workspace

**Route surface**: contracts/billing workspace for the active organization context.

**Required states**:
- Loading: visible non-ambiguous loading state while billing summary is fetched.
- Free: plan state, free capabilities, premium capabilities, trial start action for owner.
- Premium trial: trial end date, payment method registration status, paid continuation
  guidance, owner-only handoff action.
- Premium paid: paid status, provider portal/management action for owner, premium
  capability confirmation.
- Read-only non-owner: plan/status information only, no subscription management controls.
- Error: actionable error messaging without exposing payment details.

**Role behavior**:
- Owner can see and trigger billing actions allowed by current state.
- Admin, manager, staff, and participant can see only role-appropriate read-only information.
- Billing controls must not be shown merely hidden by disabled styling if the user cannot act.

**Accessibility and design**:
- Status must be communicated by text/label, not color alone.
- Buttons and links must have clear accessible names.
- Focus order must reach primary actions and error messages predictably.
- Visual decisions follow DESIGN.md; preview.html is reference-only.

## Premium Restriction UI

**Required states**:
- Free plan restriction: explain premium requirement and owner action path.
- Trial active but unavailable condition: explain trial status and why action is blocked.
- Trial expired: explain that data remains but premium action is disabled.
- Premium paid: no restriction for covered capability.

**Role behavior**:
- Non-owner users receive operationally useful explanation without billing controls.
- Owner users receive a path to contracts/billing workspace where applicable.

## Internal Billing Inspection UI

**Audience**: authorized internal operators only.

**Required sections**:
- Current application billing summary.
- Provider subscription summary.
- Latest mismatch/reconciliation signal.
- Reminder delivery history.
- Billing audit timeline.
- Webhook or lifecycle event timeline.

**Security behavior**:
- Non-authorized users receive access denial.
- Payment details are not displayed; only provider-derived identifiers/status needed for
  support triage are allowed.
