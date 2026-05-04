# UI Contract: Billing Production Hardening

## Route Surface

Primary user-facing surface remains the active organization contracts/billing workspace:

- `apps/web/src/routes/contracts/+page.svelte`
- Existing admin navigation may link to the same workspace.
- Mobile is out of scope unless mobile exposes Premium billing controls or payment document access during planning.

## API Coupling

- Billing summary reads `GET /api/v1/auth/organizations/billing` and expects the billing summary body directly.
- Trial, paid checkout, payment method setup, trial completion, and portal actions use the common billing action
  envelope with `status`, `message`, `billing`, `handoff`, and optional compatibility `url`.
- Handoff controls must treat `handoff.reused=true` as a continuation of an existing provider-hosted action, not as a
  new billing lifecycle.

## Owner Billing Workspace

**Required states**:

- Loading: visible, non-ambiguous loading state while billing summary is fetched.
- Free, trial available: show trial availability, monthly/yearly post-trial price summary, billing interval, and paid
  checkout options.
- Free, trial used: do not show trial start; show direct monthly/yearly paid checkout when configured.
- Premium trial: show trial end, post-trial billing start, payment method state, monthly/yearly interval, and setup
  handoff if relevant.
- Initial paid checkout incomplete: Premium unavailable; show checkout/payment confirmation guidance.
- Past due within 7-day grace: Premium remains available; show grace deadline, payment update action, and upcoming
  stop warning.
- Unpaid: Premium unavailable; preserve data; show payment update or support guidance.
- Active paid: show Premium enabled, interval, current period, provider portal action, payment documents, and history.
- Active/trialing with period-end cancellation scheduled: show Premium enabled until current period end and show
  cancellation date.
- Canceled: Premium unavailable; preserve data; do not show billing portal handoff.
- Unknown price: Premium unavailable; show owner-safe diagnostic and support action without exposing raw provider data.
- Billing profile readiness incomplete/unavailable: show provider-hosted next action guidance, but do not frame it as a
  Premium eligibility blocker.
- Payment documents unavailable/missing/checking: show explicit state and avoid implying successful document
  availability.

**Owner actions**:

- Start trial only if trial is available and no active/recoverable provider-linked Premium subscription exists.
- Start paid checkout for eligible free organizations, including trial-used organizations.
- Choose monthly or yearly interval when both approved prices are configured.
- Register/update payment method through provider-hosted handoff.
- Open billing portal only for provider-linked `active`, `trialing`, `past_due`, `unpaid`, or `incomplete`
  subscriptions. Do not show portal for `free`, `canceled`, or no-provider-subscription states.
- Repeated owner actions within 30 minutes should reuse existing handoff state and show a stable continuation message.
- Billing profile readiness can show owner guidance, but the UI must not describe readiness alone as a checkout or
  Premium eligibility blocker.

## Non-Owner Billing Workspace

**Required behavior**:

- Show role-safe status visibility for permitted non-owner roles.
- Do not show trial, checkout, payment method, portal, billing profile edit, or payment document controls.
- Provide operationally useful explanation for Premium restriction without directing non-owners to payment actions.
- Contract history details and payment document links are owner-only.
- Payment issue states remain visible as read-only status where the user is allowed to view the organization, but
  recovery controls remain owner-only.

## Payment Issue Communication UI

**Required states**:

- Payment failed: show owner next action and history entry after event processing.
- Payment action required: show owner next action and history entry after event processing.
- Past-due grace reminder: show grace deadline and reminder history when available.
- No verified owner: internal inspection only; no non-owner billing notification UI.

## Payment Documents and Invoice Events

**Owner-visible fields**:

- Document kind: invoice or receipt.
- Availability: available, unavailable, missing, checking.
- Provider-hosted link when available.
- Event state: invoice available, payment succeeded, payment failed, payment action required.

**Security behavior**:

- Do not show raw card data, full payment method details, raw tax details, or raw provider payloads.
- Do not show documents to non-owner roles.
- Refund and credit note states are not rendered as first-class v1 history.

## Internal Billing Inspection UI

**Audience**: authorized internal operators only.

**Required sections**:

- Current billing summary and Premium eligibility decision.
- Provider subscription/customer summary.
- Billing action attempts and handoff reuse/expiry outcomes.
- Invoice/payment event history.
- Payment document reference availability.
- Owner notification delivery history and failure reasons.
- Reconciliation signals and latest provider/app comparison.
- Webhook receipt, duplicate no-op, and sanitized signature failure history.
- Unknown price and billing profile readiness diagnostics.
- Operation attempts must expose purpose, state, interval, provider references, handoff expiry, and sanitized failure
  reason only.

**Security behavior**:

- Non-authorized users receive access denial.
- Payment details, card details, raw tax details, and raw provider payloads are never displayed.

## Accessibility and Design

- Follow `DESIGN.md`; `preview.html` is reference-only.
- Communicate status with text, structure, and accessible labels, not color alone.
- Buttons and links must have clear accessible names.
- Disabled or unavailable actions must explain why in text.
- Loading, checking, failed, unavailable, read-only, action-required, and successful states must be visually and
  semantically distinct.
- Text must fit mobile and desktop containers without overlap.
