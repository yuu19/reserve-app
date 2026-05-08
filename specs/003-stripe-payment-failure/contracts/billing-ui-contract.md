# UI Contract: Stripe Payment Failure Handling

## Route Surface

Primary user-facing surface remains the active organization contracts workspace:

- `apps/web/src/routes/contracts/+page.svelte`
- Existing admin navigation may link to the same workspace.
- Mobile is out of scope unless mobile exposes Premium billing controls during planning.

## Owner Billing Workspace

**Required payment issue states**:

- No issue: show current Premium state and normal billing actions.
- Payment failed: show payment update guidance, provider-hosted recovery action, and safe history entry.
- Payment action required: show authentication/update guidance and safe history entry.
- Past due within grace: show Premium still available, grace deadline, and warning that Premium stops after expiry.
- Past due grace expired: show Premium unavailable and payment update or support guidance.
- Unpaid or incomplete: show Premium unavailable immediately and preserve organization data messaging.
- Recovered: remove unresolved payment issue guidance and show safe recovery history.
- Stale failure after recovery: show only history/internal investigation context; do not show active unresolved issue.

**Timing display**:

- Grace deadline derives from provider-side issue time when available.
- If provider-side issue time is unavailable, the UI may show deadline based on application receipt fallback.
- The UI must not imply grace starts from owner email delivery time.

**Owner actions**:

- Payment update and billing management actions remain owner-only.
- Owner can open provider-hosted billing management for provider-linked `active`, `trialing`, `past_due`, `unpaid`, or
  `incomplete` subscriptions.
- Recovered or stale failure history does not require a payment action unless another current blocking condition exists.

## Non-Owner Billing Workspace

**Required behavior**:

- Show role-safe status visibility only where the user can view the organization.
- Do not show payment update, portal, payment document, or detailed payment issue controls.
- Do not show owner notification recipient details.
- Explain Premium restriction operationally without directing non-owners to billing actions.

## Payment Issue History

**Owner-visible fields**:

- Payment issue state label.
- Safe event type: payment failed, payment action required, payment succeeded, recovered.
- Occurred time when available.
- Next owner action when there is an active unresolved issue.

**Internal-only fields**:

- Notification recipient delivery states.
- Retry eligibility for failed verified-owner recipients.
- Stale failure-after-recovery classification.
- Support-visible signal reason and status.

**Security behavior**:

- Never display card numbers, full payment method details, tax details, or raw Stripe payload.
- Provider ids may appear only where already allowed by internal inspection or safe owner history.

## Notification UX

- A successful owner notification is shown once per verified owner per provider event in history/internal inspection.
- Retry state is scoped to failed verified-owner recipients only.
- Already notified owners are not shown as retry targets.
- No verified owner creates internal investigation context only; non-owner users see no billing notification prompt.

## Accessibility and Design

- Follow `DESIGN.md`; `preview.html` is reference-only.
- Use text and structure for payment issue severity; do not rely on color alone.
- Buttons and links must have accessible names and clear disabled/unavailable reasons.
- Loading, checking, failed, action-required, recovered, stale-history-only, and read-only states must be distinct.
- Text must fit mobile and desktop containers without overlap.
