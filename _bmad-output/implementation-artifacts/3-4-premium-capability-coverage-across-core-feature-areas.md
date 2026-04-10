# Story 3.4: Premium Capability Coverage Across Core Feature Areas

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a product team,
I want premium gating to cover all named premium feature categories in the MVP scope,
So that premium access is consistent across the operational surface area.

## Acceptance Criteria

1. subscription requirements で定義された premium feature categories に対して gating coverage を実装するとき、multiple classroom/site management、staff invitation and role management、recurring schedules、approval-based booking flows、ticket or recurring payment capabilities、advanced management capabilities を current MVP scope 内でカバーし、各 category が premium eligibility に明示的に対応付けられていること。
2. 後続で premium feature category を更新・拡張するとき、implementation に clear な policy-driven extension point があり、organization-scoped subscription model を変更せずに拡張できること。
3. premium organization が covered premium capabilities を application 全体で使うとき、active entitlement と矛盾しない一貫した体験になり、同じ organization state に対して allow と block が混在しないこと。
4. free organization が同じ application areas を使うとき、premium category の blocked behavior は covered feature set 全体で一貫し、premium pathway の guard 漏れが残らないこと。

## Tasks / Subtasks

- [x] premium capability coverage matrix を current MVP の実装面に落とし込む (AC: 1, 2, 3, 4)
  - [x] FR38-FR43 を current codebase の具体的 route / action / page に対応付け、Story 3.2 backend gate と Story 3.3 shared UX の「適用済み」と「未適用」を整理する
  - [x] representative coverage で止まっている箇所を洗い出し、current MVP で実在する premium capability のみを Story 3.4 の write scope に含める
  - [x] analytics / audit-oriented views / priority support など PRD 上は named category でも current MVP に surface が存在しないものは「未実装 capability」として扱い、擬似 UI や空 API を追加しない

- [x] backend premium enforcement を remaining core feature paths に拡張する (AC: 1, 2, 3, 4)
  - [x] Story 3.2 で代表実装した shared premium gate を使い、current MVP の core operational route で guard 漏れがある path を埋める
  - [x] classroom/site management と invitation management では org-level と classroom-scoped の両方の route 群で矛盾しない deny/allow にそろえる
  - [x] recurring / approval / ticket capabilities では create だけでなく current MVP の update / resend / management flow を含む remaining operational path を確認する
  - [x] premium entitlement は organization 単位のまま維持し、classroom ごとの独自 plan rule や route-local billing shortcut を増やさない

- [x] shared premium restriction UX を remaining core web surfaces に適用する (AC: 1, 3, 4)
  - [x] Story 3.3 の `premium-restrictions.ts` / `premium-restriction-notice.svelte` を再利用し、残っている core route へ同じ説明パターンを適用する
  - [x] classroom-scoped invitation management、received operator invitation flows、wrapper route / scoped route の差分で premium restriction が generic error や silent empty state に潰れないようにする
  - [x] owner には contracts page への導線を維持しつつ、non-owner には owner-only billing action を出さない
  - [x] 既存 representative pages と newly covered pages の copy / heading / assistive messaging が矛盾しないことをそろえる

- [x] policy-driven extension point をコード上で明確にする (AC: 2)
  - [x] Story 3.4 で追加した coverage を ad hoc な `if` 文の散在で終わらせず、「どの capability category がどの seam で premium 対象か」を後続 story が拡張しやすい形に残す
  - [x] backend では shared gate / helper / mapping comment など、frontend では shared restriction parser / notice consumer のどちらかに extension point を集約する
  - [x] Story 3.1 の entitlement policy と Story 3.2 denial payload shape を正本にし、category 追加のたびに billing semantics を再定義しない

- [x] coverage regression を追加して premium allow/block の一貫性を固定する (AC: 1, 3, 4)
  - [x] backend では uncovered だった category / path に対して non-premium deny と premium allow の統合テストを追加する
  - [x] web では remaining core surfaces の browser/page spec を追加または拡張し、premium restriction notice が出ることと generic error でないことを固定する
  - [x] representative surface と remaining surface の両方で、same organization state に contradictory mix が起きないことを回帰テストで確認する

## Dev Notes

- Story 3.2 は backend premium enforcement の「代表面」、Story 3.3 は shared UX の「代表面」までを担当している。Story 3.4 ではその shared seams を使って named premium categories の coverage を current MVP surface 全体へ広げる。
- Story 3.4 の目的は新しい billing semantics を作ることではない。organization-scoped entitlement policy と shared denial payload / shared UI notice を再利用し、残りの route / page に漏れなく適用することが中心である。
- PRD の FR43 には analytics / audit-oriented views / priority support が含まれるが、current MVP codebase に surface がないものまで無理に実装してはいけない。実在する current MVP capability の coverage completion に限定する。
- owner-only billing authority と premium operational usage は引き続き別概念である。coverage 拡張の過程で non-owner の operational usage を owner billing action と混線させてはいけない。

### Technical Requirements

- premium feature categories defined in the subscription requirements を current MVP scope 内で明示的に premium eligibility に対応付ける必要がある。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4]
- one premium feature category is updated or expanded later でも clear な policy-driven extension point が必要であり、organization-scoped subscription model は変更しない。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4]
- premium organization / free organization の双方で、application 全体に contradictory mix of allowed and blocked behavior が出ないこと。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4]
- Premium Capability Gating の named categories は FR38-FR43 を正本にする。 [Source: _bmad-output/planning-artifacts/prd.md#Premium Capability Gating]

### Architecture Compliance

- premium capability gating は `backend policy + web explanatory UX + existing operational modules` の組み合わせで行う。新しい subscription model や classroom-specific billing rule を作らない。 [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- booking / invitation / participant / classroom は billing state の consumer であり owner ではないため、feature coverage 拡張でも billing truth を route/page 側で再定義しない。 [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- shared premium gate は既存 authorization の代替ではなく追加境界として使い、role authorization と premium eligibility の責務を分離したまま広げる。 [Source: _bmad-output/implementation-artifacts/3-2-premium-feature-enforcement-in-backend-operational-flows.md]
- shared premium notice は contracts page の billing workspace wording を consumer として再利用し、remaining surfaces に ad hoc copy をばらまかない。 [Source: _bmad-output/implementation-artifacts/3-3-premium-gating-ux-on-restricted-features.md]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 の既存構成を維持し、新規 dependency 追加は原則不要。 [Source: _bmad-output/project-context.md#Backend]
- Web は SvelteKit `2.50.1` + Svelte `5.48.2` の current repo 構成を維持し、`.svelte` 変更時は shared feature helper / remote helper パターンを壊さない。 [Source: _bmad-output/project-context.md#Web]
- backend relative import は `.js` 拡張子付き ESM 形式を維持する。 [Source: _bmad-output/project-context.md#重要な実装ルール]
- `.remote.ts` は server-side read seam として維持し、client-only dependency を持ち込まない。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]

### File Structure Requirements

- backend 主変更候補:
  - `apps/backend/src/booking/authorization.ts`
  - `apps/backend/src/routes/auth-routes.ts`
  - `apps/backend/src/routes/booking-routes.ts`
  - `apps/backend/src/app.test.ts`
- web 主変更候補:
  - `apps/web/src/lib/features/premium-restrictions.ts`
  - `apps/web/src/lib/components/premium-restriction-notice.svelte`
  - `apps/web/src/lib/features/invitations-classroom.svelte.ts`
  - `apps/web/src/lib/features/invitations-admin.svelte.ts`
  - `apps/web/src/lib/features/invitations-participant.svelte.ts`
  - `apps/web/src/lib/features/participants-page.svelte.ts`
  - `apps/web/src/lib/pages/bookings-page.svelte`
  - `apps/web/src/routes/participant/admin-invitations/+page.svelte`
  - `apps/web/src/routes/[orgSlug]/[classroomSlug]/admin/invitations/+page.svelte`
  - 既存 wrapper pages と対応する `page.svelte.spec.ts`
- Story 3.4 では billing schema / migration 変更は原則不要。coverage completion のために backend/web enforcement と tests を主対象にする。
- current MVP に存在しない analytics / audit inspection / support 導線をこの story で新設しない。それらは Epic 4 / Epic 5 の既存計画に従う。

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
  - affected browser/page specs
  - edited backend/web files に対する `eslint`
- Story 3.4 は coverage completion story なので、backend integration test と web browser spec の両方を増やす前提で考える。 [Source: _bmad-output/project-context.md#テストルール]
- backend では category ごとの representative route だけでなく、Story 3.2 で未固定だった remaining path を統合テストで埋める。 [Source: _bmad-output/implementation-artifacts/3-2-premium-feature-enforcement-in-backend-operational-flows.md]
- web では remaining core surfaces で premium restriction notice と owner/non-owner difference が維持されることを browser spec で固定する。 [Source: _bmad-output/implementation-artifacts/3-3-premium-gating-ux-on-restricted-features.md]

### Previous Story Intelligence

- Story 3.3 で `premium-restrictions.ts` と `premium-restriction-notice.svelte` が入り、代表的な admin/participant surfaces には shared UX seam ができた。Story 3.4 はこれを残りの current MVP surfaces に広げる story である。
- Story 3.3 実装で recurring create path に premium restriction state の読み込み漏れが見つかった。Story 3.4 でも wrapper route / scoped route / older page のような duplicated entry point に同種の抜けが残りやすい点に注意する。
- Story 3.2 は backend enforcement を representative route に絞っている。Story 3.4 では same capability category 内の remaining path を補完し、「同じ org state なのに path によって通る/止まる」が残らないようにする必要がある。
- Story 3.1 の organization-scoped entitlement policy が premium truth の正本であり、expired trial semantics を含む。Story 3.4 でも `planState` shortcut は使わない。

### Git Intelligence Summary

- 直近の relevant commits:
  - `d0d0e34 feat: webhookの実装`
  - `be1cbbd feat(billing): add trial payment method registration`
  - `8202b6d chore(config): set Stripe billing catalog IDs`
  - `03f928f feat(contracts): add premium trial lifecycle UI`
  - `291f3f5 feat(billing): add owner-only premium trials`
- guardrail:
  - premium gating work は backend `authorization.ts` / route files と web `lib/features` / page spec に集約して進める
  - current codebase には admin wrapper route と scoped route が併存しているため、一方だけ直しても coverage completion にならない
  - Story 3.4 は coverage story だが、Epic 4/5 で予定済みの billing investigation / history / post-MVP surfaces を先取りしない

### Latest Technical Notes

- current web route tree には `admin-invitations/+page.svelte` / `participants/+page.svelte` の shared surfacesに加え、`participant/admin-invitations/+page.svelte` や `[orgSlug]/[classroomSlug]/admin/invitations/+page.svelte` の older/scoped surfaces が残っている。Story 3.4 ではこうした remaining core surfaces の premium handling も対象に含めるべきである。
- current classroom invitation helper `apps/web/src/lib/features/invitations-classroom.svelte.ts` は premium denial payload をまだ解釈していないため、classroom-scoped operator/participant invitation flows は Story 3.3 の shared notice seam にまだ乗っていない。
- backend `createClassroomInvitationRoute` は `classroom_operator` にだけ premium gate をかけ、participant 招待は current MVP semantics 上 `advanced management capability` として product decision が必要になる可能性がある。Story 3.4 では Epic/PRD の FR43 と current MVP actual behavior を突き合わせて scope を明確にする。
- `booking-routes.ts` の shared premium gate はすでに複数 route で利用されているため、Story 3.4 は新しい gate を増やすより remaining path へ同じ gate を広げる方向が安全である。

### Project Context Reference

- `403` は想定内の権限制御分岐として扱い、generic fetch failure と混同しない。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- UI 表示用フィールドを authorization の根拠にせず、backend policy / effective access を正本にする。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- staged migration 中の brownfield 変更として、旧 wrapper / scoped route を一度に削除せず、existing behavior を壊さない範囲で coverage を広げる。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- browser test が CI 必須でないからといって、UI の重要分岐変更を未検証で終えない。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]

### Project Structure Notes

- current shared backend premium gate は `apps/backend/src/booking/authorization.ts` にある。
- current shared web premium restriction seam は `apps/web/src/lib/features/premium-restrictions.ts` と `apps/web/src/lib/components/premium-restriction-notice.svelte` にある。
- current bookings admin/participant flows は `apps/web/src/lib/pages/bookings-page.svelte` に集約されているが、招待系は `admin-invitations`, `participants`, `participant/admin-invitations`, `scoped admin invitations` に分散している。
- current backend route surface は `auth-routes.ts` と `booking-routes.ts` に集約されているため、coverage matrix もこの 2 ファイルを中心に考えるのが自然である。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]
- [Source: _bmad-output/planning-artifacts/prd.md#Premium Capability Gating]
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points]
- [Source: _bmad-output/project-context.md]
- [Source: docs/test-strategy.md#Web browser]
- [Source: apps/backend/src/booking/authorization.ts]
- [Source: apps/backend/src/routes/auth-routes.ts]
- [Source: apps/backend/src/routes/booking-routes.ts]
- [Source: apps/web/src/lib/features/invitations-classroom.svelte.ts]
- [Source: apps/web/src/lib/features/premium-restrictions.ts]
- [Source: apps/web/src/lib/components/premium-restriction-notice.svelte]
- [Source: apps/web/src/routes/participant/admin-invitations/+page.svelte]
- [Source: apps/web/src/routes/[orgSlug]/[classroomSlug]/admin/invitations/+page.svelte]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Loaded `bmad-create-story` workflow and sprint tracking, then selected the first backlog story in order: `3-4-premium-capability-coverage-across-core-feature-areas`.
- Reviewed Epic 3 stories end-to-end to keep Story 3.4 positioned as coverage completion on top of Story 3.2 backend enforcement and Story 3.3 shared UX, not a new billing-policy story.
- Re-read Story 3.2 and Story 3.3 implementation notes to capture the established seams, previous regressions, and the explicit handoff that Story 3.4 should expand coverage rather than reinvent the pattern.
- Inspected current backend gate placement and current web route tree to identify remaining core feature surfaces, especially classroom-scoped invitation management and received operator invitation flows that still bypass the shared premium restriction seam.
- Extended backend premium gating to remaining invitation and participant management routes, then added integration coverage for list/create/accept/list flows under downgraded organization state.
- Applied the shared premium restriction notice to classroom-scoped invitation management and received operator invitation pages, and verified the new page-spec coverage plus full backend/web validation.

### Completion Notes List

- 2026-04-10: Created Story 3.4 as the next implementation artifact in sprint order.
- 2026-04-10: Scoped the story to current MVP premium capability coverage completion, explicitly excluding nonexistent analytics/audit/support surfaces from speculative implementation.
- 2026-04-10: Anchored the story on the existing organization-scoped entitlement policy, shared backend premium gate, and shared web premium notice so implementation can extend coverage without creating new billing rules.
- 2026-04-10: Added remaining backend premium enforcement for organization invitation listing, classroom invitation listing/participant invitation creation, operator invitation acceptance, and participant listing.
- 2026-04-10: Added premium restriction UX coverage to classroom-scoped invitation management and participant operator-invitation acceptance flows using the existing shared notice model.
- 2026-04-10: Verified with backend/web typecheck, targeted browser specs, targeted eslint, and full backend/web test suites.

### File List

- _bmad-output/implementation-artifacts/3-4-premium-capability-coverage-across-core-feature-areas.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/backend/src/routes/auth-routes.ts
- apps/backend/src/app.test.ts
- apps/web/src/lib/features/invitations-classroom.svelte.ts
- apps/web/src/routes/[orgSlug]/[classroomSlug]/admin/invitations/+page.svelte
- apps/web/src/routes/participant/admin-invitations/+page.svelte
- apps/web/src/routes/[orgSlug]/[classroomSlug]/admin/invitations/page.svelte.spec.ts
- apps/web/src/routes/participant/admin-invitations/page.svelte.spec.ts

## Change Log

- 2026-04-10: Story 3.4 created and moved to `ready-for-dev`.
- 2026-04-10: Story 3.4 implementation completed and moved to `review`.
