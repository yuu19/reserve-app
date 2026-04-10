# Story 3.2: Premium Feature Enforcement in Backend Operational Flows

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a staff or owner user,
I want premium-only operations to be enforced by the backend,
So that restricted capabilities cannot be used when the organization lacks premium eligibility.

## Acceptance Criteria

1. organization に active premium eligibility がないとき、user が premium-only backend operation を実行しようとすると backend が拒否し、その拒否は organization-scoped entitlement policy に基づくこと。
2. organization に active premium eligibility があるとき、user が operational role 上許可される premium-only backend operation を実行しようとすると backend が許可し、billing authority は通常の premium feature usage に不要であること。
3. premium restriction が multiple classroom/site management、staff invitation and role management、recurring schedule operations、approval-based booking flows、ticket or recurring payment capabilities、advanced management capabilities に適用される場合、各 capability category は同じ entitlement policy boundary を通して判定され、ad hoc duplication がないこと。
4. non-premium organization が premium になる、または premium eligibility を失うとき、subsequent backend operation の access は updated entitlement state を反映し、existing operational data は access change によって破壊されないこと。

## Tasks / Subtasks

- [x] premium enforcement の共通 backend gate を追加する (AC: 1, 2, 3, 4)
  - [x] Story 3.1 の `organization-billing-policy.ts` を consumer とする shared enforcement helper を billing / authorization seam に追加する
  - [x] denial 判定は owner-only billing authority ではなく organization-scoped premium eligibility に基づかせ、billing rule と operational role rule を混同しない
  - [x] premium eligibility 未充足時の backend denial message / status shape を統一し、後続 web gating UX が同じ理由を参照できるようにする

- [x] premium-only backend operation の最初の適用面を明示的に実装する (AC: 1, 2, 3, 4)
  - [x] Epic 3 / FR38-FR43 の premium categories から current MVP で backend enforcement を入れる対象を明示し、Story 3.2 の write scope に含める
  - [x] 少なくとも multi-classroom / staff invitation-role management / recurring schedule / approval booking / ticket or recurring payment / advanced management に対応する route or operation を同じ gate で保護する
  - [x] category ごとに別ロジックを増やさず、shared helper と existing role-based authorization を組み合わせて実装する

- [x] existing role authorization と premium eligibility の境界を保つ (AC: 1, 2, 3)
  - [x] `owner/admin/manager/staff/participant` の operational role 判定は既存 authorization を正本とし、その前後に premium gate を重ねる形にする
  - [x] premium であっても operational role が不足していれば deny され、premium 非対象 operation には影響しないことを保つ
  - [x] 逆に premium feature usage に billing management 権限を要求しないことを backend test で固定する

- [x] access change が data destruction を起こさないことを保証する (AC: 4)
  - [x] premium eligibility 喪失後は operation を deny しても、existing recurring schedules / approval-configured services / ticket settings などの stored data を削除しない
  - [x] premium eligibility 回復後は same operational data を前提に access が戻る構造を壊さない
  - [x] migration や cleanup を伴わず、capability gate のみで制御する

- [x] regression test を追加して enforcement boundary を固定する (AC: 1, 2, 3, 4)
  - [x] `apps/backend/src/app.test.ts` で non-premium deny / premium allow / role insufficient deny / data preserved の統合テストを追加する
  - [x] capability category ごとの representative route を通じて、shared policy boundary が使われていることを回帰テストで固定する
  - [x] `.svelte` 変更は原則不要とし、web test 更新は API/contract 変更時のみに限定する

## Dev Notes

- Story 3.2 の目的は premium eligibility policy を backend operational flow に適用することであり、UI messaging や owner 向け案内は Story 3.3 の責務である。
- Story 3.1 で shared policy が入ったため、Story 3.2 では route ごとに `planState === premium_paid` のような分岐を書くのではなく、その policy を通す enforcement boundary を追加することが重要である。
- owner-only billing authority と premium operational eligibility は別概念である。owner でなくても organization が premium かつ role が許せば premium operation は使えるべきであり、ここを混線させると Story 3.2 の acceptance を外す。
- premium eligibility を失ったときに止めるのは「新しい操作」であり、既存の operational data を破壊してはならない。denial と cleanup を混同しない。

### Technical Requirements

- premium capability gating は backend policy + existing operational modules で行い、organization 単位の entitlement policy を正本にする。 [Source: _bmad-output/planning-artifacts/architecture.md#Requirements Coverage Validation]
- premium gating は classroom ごとの契約分岐ではなく organization 単位で一貫適用する。 [Source: _bmad-output/planning-artifacts/architecture.md#Technical Constraints & Dependencies]
- premium feature usage に billing authority を要求せず、owner-only は billing action 側に限定する。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]
- enforcement logic を unrelated handlers に ad hoc duplication しない。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]
- access change は updated entitlement state を反映するが、existing operational data を破壊しない。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]

### Architecture Compliance

- `organization-billing-policy.ts` を shared eligibility source とし、route 層や handler ごとに Stripe status を再解釈しない。 [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- premium gate は existing authorization の代替ではなく追加境界として実装し、role 判定の正本は `booking/authorization.ts` 側に残す。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- `booking-routes.ts` / invitation 管理 route など複数の operational surface に跨るため、shared helper を billing domain 近傍か authorization seam に追加して再利用可能にする。 [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- migration や destructive cleanup を伴わず、capability deny だけで premium restriction を表現する。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 の既存構成を維持し、新規 dependency 追加は原則不要。 [Source: _bmad-output/project-context.md#Backend]
- backend は `module: "NodeNext"` + `verbatimModuleSyntax: true` 前提なので、relative import は既存どおり `.js` 拡張子付き ESM 形式を維持する。 [Source: _bmad-output/project-context.md#重要な実装ルール]
- Story 3.2 の主戦場は backend route / authorization / billing policy consumer であり、schema 変更は原則不要。 [Source: _bmad-output/project-context.md#開発ワークフロールール]
- Web / mobile の premium restriction 表示はこの story の主責務ではないため、client-side gating を先行実装しない。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]

### File Structure Requirements

- 主変更候補:
  - `apps/backend/src/billing/organization-billing-policy.ts`
  - `apps/backend/src/booking/authorization.ts`
  - `apps/backend/src/routes/auth-routes.ts`
  - `apps/backend/src/routes/booking-routes.ts`
  - `apps/backend/src/app.test.ts`
- premium gate helper を追加する場合は route file 内に重複させず、複数 route から使える場所へ置く。
- Story 3.2 では UI gating file や contracts page への変更を混ぜない。
- enforcement を入れる capability category は representative route に絞りつつ、後続 Story 3.4 で coverage を拡張できる拡張点を残す。

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
- 高リスクな認可 / capability 境界変更なので、`apps/backend/src/app.test.ts` の統合テストを最優先にする。 [Source: docs/test-strategy.md#Backend]
- non-premium deny と premium allow の両方だけでなく、role insufficient deny、existing data preserved、premium 回復後 access 再開の representative case を固定する。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]
- `.svelte` を触らない限り browser test は不要。API contract を変えない場合は web server test の回帰確認で十分とする。 [Source: docs/test-strategy.md#Web server]

### Previous Story Intelligence

- Story 3.1 で `organization-billing-policy.ts` が入り、organization-scoped premium eligibility の shared truth ができた。Story 3.2 ではこの shared policy を mandatory boundary として使うべきである。
- Story 2.5 で audit / signal の append-only records が入り、expired trial は `premium_trial` billing state のままでも entitlement は `free_only` になり得る semantics へ整理された。Story 3.2 では plan state だけで premium allow を決めてはいけない。
- Story 2.1-2.4 の billing lifecycle, payment-method registration, reminder history, webhook sync はすでに backend truth として整っているため、premium enforcement 側で独自状態を持たず existing policy consumer として実装するのが安全である。
- current authorization は `facts -> effective -> sources -> display` の 4 層を前提にしている。Story 3.2 では `display` を premium gate の根拠にせず、existing role authorization と shared policy を組み合わせる必要がある。

### Git Intelligence Summary

- 直近の relevant commits:
  - `d0d0e34 feat: webhookの実装`
  - `be1cbbd feat(billing): add trial payment method registration`
  - `8202b6d chore(config): set Stripe billing catalog IDs`
  - `03f928f feat(contracts): add premium trial lifecycle UI`
  - `291f3f5 feat(billing): add owner-only premium trials`
- guardrail:
  - billing / policy workは `apps/backend/src/billing/*` と `apps/backend/src/app.test.ts` に集約されているので、Story 3.2 でも同じ seam に寄せる
  - operational authorization は `apps/backend/src/booking/authorization.ts` と route 層に既存パターンがあるため、それを壊さず premium gate を追加する
  - Story 3.3 / 3.4 が後続にあるため、今回は backend denial/allow に集中し、UI restriction copy や full coverage expansion を先走らない

### Latest Technical Notes

- Epic 3 の second story は premium-only operation を backend で deny/allow する story であり、restriction basis は organization-scoped entitlement policy である。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]
- architecture では premium capability gating を backend policy + existing operational modules で担保する前提で、owner-only billing authority と operational authority を分離している。 [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]
- current codebase には shared premium eligibility policy はあるが、operational routes への systematic enforcement はまだ入っていない。Story 3.2 はその最初の backend enforcement layer になる。 [Source: _bmad-output/implementation-artifacts/3-1-organization-scoped-premium-entitlement-policy.md]

### Project Context Reference

- 高リスクな権限制御変更は backend 統合テストを最優先にする。複数 route / table / authorization layer に跨る変更を unit test だけで済ませない。 [Source: _bmad-output/project-context.md#テストルール]
- `display.primaryRole` など UI 表示用フィールドを権限制御の根拠にしない。判定は `effective` と backend policy を正本にする。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- staged migration 中の brownfield 変更として、旧 organization/classroom authorization path や current contracts flow を壊さず段階拡張する。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]

### Project Structure Notes

- current shared premium eligibility policy は `apps/backend/src/billing/organization-billing-policy.ts` にある。
- current role authorization seam は `apps/backend/src/booking/authorization.ts` にある。
- current major operational routes は `apps/backend/src/routes/booking-routes.ts` にあり、premium categories の representative enforcement target になりやすい。
- current billing route / contracts summary は `apps/backend/src/routes/auth-routes.ts` にあるが、Story 3.2 の目的は billing action ではなく operational backend gate である。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1]
- [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements Coverage Validation]
- [Source: _bmad-output/project-context.md]
- [Source: docs/test-strategy.md#Backend]
- [Source: apps/backend/src/billing/organization-billing-policy.ts]
- [Source: apps/backend/src/booking/authorization.ts]
- [Source: apps/backend/src/routes/booking-routes.ts]
- [Source: _bmad-output/implementation-artifacts/3-1-organization-scoped-premium-entitlement-policy.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Loaded `bmad-create-story` workflow and sprint tracking, then selected the first backlog story in order: `3-2-premium-feature-enforcement-in-backend-operational-flows`.
- Reviewed Epic 3 story definitions to keep Story 3.2 scoped to backend operational enforcement and avoid leaking Story 3.3 UI gating concerns into this story.
- Reviewed Story 3.1 implementation notes to inherit the new shared organization-scoped entitlement policy and the expired-trial entitlement semantics introduced there.
- Inspected current backend authorization and route seams to identify likely premium enforcement entry points without duplicating role-based authorization logic.
- Reviewed project context and test strategy for backend-integration-first validation on authorization and capability-boundary changes.

### Completion Notes List

- 2026-04-09: Created Story 3.2 as the next implementation artifact in sprint order.
- 2026-04-09: Scoped the story to backend denial/allow enforcement only, leaving UI premium restriction messaging to Story 3.3.
- 2026-04-09: Anchored the story on Story 3.1 shared entitlement policy so operational premium gating does not reintroduce route-local billing-state shortcuts.
- 2026-04-09: Added a shared organization-scoped premium feature gate in `booking/authorization.ts` so backend premium enforcement reuses the Story 3.1 entitlement policy and returns one denial payload shape.
- 2026-04-09: Applied the shared premium gate to representative backend operations across classroom creation, operator invitation management, recurring schedule management, approval booking actions, and ticket capability flows without mixing billing authority into operational role checks.
- 2026-04-09: Added integration coverage for free-org denial, premium non-owner allow, role-insufficient denial, and data-preserved downgrade/recovery behavior; adjusted older invite-centric backend tests to explicitly enable premium only where those flows are now premium-gated.

### File List

- _bmad-output/implementation-artifacts/3-2-premium-feature-enforcement-in-backend-operational-flows.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/backend/src/booking/authorization.ts
- apps/backend/src/routes/auth-routes.ts
- apps/backend/src/routes/booking-routes.ts
- apps/backend/src/app.test.ts

## Change Log

- 2026-04-09: Story 3.2 created and moved to `ready-for-dev`.
- 2026-04-09: Implemented shared backend premium entitlement enforcement and representative operational route protection, then moved the story to `review`.
