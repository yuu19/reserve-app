# UI Contract: AI Chatbot

## Route Surface

V1 adds a web-only authenticated AI chat widget:

- Primary mount: `apps/web/src/routes/+layout.svelte`
- Client state: `apps/web/src/lib/features/ai-chat.svelte.ts`
- API client: `apps/web/src/lib/ai-client.ts`
- Components:
  - `apps/web/src/lib/components/ai/AiChatWidget.svelte`
  - `apps/web/src/lib/components/ai/AiMessageList.svelte`
  - `apps/web/src/lib/components/ai/AiSourceList.svelte`
  - `apps/web/src/lib/components/ai/AiSuggestedActions.svelte`

The widget is hidden or disabled when no authenticated session is available.

## Chat Widget Behavior

**Required states**:

- Closed: compact launcher with accessible name.
- Opening/loading: focus moves into the chat surface and status text indicates loading.
- Ready: message input, message list, source list per answer, suggested actions, and feedback controls.
- Sending: input remains stable; duplicate send is disabled.
- Low confidence: answer uses non-assertive wording and shows contact owner/support guidance.
- No source: answer states it cannot confirm the answer and offers a safe next step.
- Rate limited: message explains retry timing and does not lose the typed message.
- Unavailable: message says AI support is temporarily unavailable and offers non-AI navigation/support guidance.

**Input rules**:

- Empty messages cannot be sent.
- Messages over 4,000 characters are rejected before sending with accessible error text.
- Current page path can be sent as context hint, but UI must not present it as proof of permission.

## Message Rendering

**User messages**:

- Show the submitted text and timestamp.
- Do not expose internal ids.

**Assistant messages**:

- Show answer text, confidence state, source references when allowed, suggested actions, and feedback controls.
- Must not claim that an action was performed.
- Must not expose secrets, payment method details, raw provider payloads, private audit details, or source snippets blocked by role.

## Source List

**Required behavior**:

- Show at least title and source kind for each permitted source.
- Show `sourcePath` only when it is appropriate for the user role. Internal specs paths are internal-operator only.
- Collapse or summarize long source lists so messages remain scan-friendly.
- If no permitted source supports an answer, show a "確認できません" style fallback instead of empty citations.

## Suggested Actions

Allowed action kinds:

- `open_page`: navigate to an existing permitted page.
- `contact_owner`: guide non-owner users to ask an owner.
- `contact_support`: guide users to support.

Suggested actions must never execute booking, billing, participant, ticket, invitation, or purchase operations.

## Feedback Controls

**Required behavior**:

- Each assistant message has helpful and unhelpful controls.
- Unhelpful can optionally open a short comment field.
- Feedback submission success/failure is visible with text, not color alone.
- Feedback controls become disabled after successful submission for the same message.
- Organization users cannot browse feedback themes or other users' conversation context.

## Internal Operator Review Surface

V1 may add an internal-only route or reuse an internal workspace for:

- Knowledge freshness and indexing failures.
- Aggregate unhelpful-answer themes.
- Permitted conversation context for quality review.

The review surface is internal-operator only and must not be linked from organization user navigation.

## Accessibility and Design

- Follow `DESIGN.md`; `preview.html` is reference only.
- Use existing button, badge, alert, dialog/popover, input, and card primitives where appropriate.
- Do not rely on color alone for confidence, errors, rate limits, or unavailable states.
- The chat widget must fit mobile and desktop widths without text overlap.
- Focus order must support keyboard-only send, close, source review, suggested actions, and feedback.
- Buttons and icon controls must have accessible names.

## Browser Test Expectations

- Authenticated user can open widget, send a message, see answer/source/action, and submit feedback.
- Empty/too-long message validation is visible.
- Low-confidence answer renders support guidance.
- Rate-limit response keeps typed message and shows retry guidance.
- Participant billing-detail question does not render owner-only details.
- Internal spec source path is not shown to general organization users.
