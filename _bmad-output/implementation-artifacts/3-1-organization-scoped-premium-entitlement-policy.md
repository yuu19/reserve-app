# Story 3.1: Organization-Scoped Premium Entitlement Policy

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the platform,
I want premium eligibility to be evaluated once at the organization level,
So that all classrooms and staff workflows use the same entitlement decision.

## Acceptance Criteria

1. organization billing state が premium access のために評価されるとき、system は organization-scoped billing state から premium eligibility を導出できること。
2. organization が複数 classroom を持つときでも、premium eligibility の結果はその organization 配下で一貫して同一であり、classroom-specific subscription rule を作らないこと。
3. Stripe provider status と internal product plan state の意味が異なる場合でも、policy は raw provider status shortcut ではなく application billing-state rule を用いて explicit で testable な eligibility result を返すこと。
4. organization が free / trial / paid を遷移するとき、eligibility の再計算結果は一貫して更新され、UI-local state に依存しないこと。

## Tasks / Subtasks

- [x] organization-scoped premium entitlement policy module を追加する (AC: 1, 2, 3, 4)
  - [x] `apps/backend/src/billing/organization-billing-policy.ts` 相当の dedicated policy helper を追加し、organization 単位で entitlement を評価する
  - [x] policy input は classroom 数・classroom role・UI state ではなく、`organization_billing` 由来の app-side billing truth に限定する
  - [x] policy result は少なくとも `isPremiumEligible`、entitlement state、reason / source fields を持ち、後続 story が backend/web から再利用できる shape にする

- [x] existing billing truth と policy を接続し、ad hoc entitlement derivation を排除する (AC: 1, 3, 4)
  - [x] Story 2.5 で `organization-billing-observability.ts` に暫定的にある entitlement derivation を新 policy helper 経由へ移す
  - [x] `planState`, `subscriptionStatus`, `paymentMethodStatus`, trial period など既存 app-side lifecycle truth から eligibility を導出し、raw Stripe status の単純分岐を増やさない
  - [x] `organization_billing` current summary と policy の責務を分離し、summary row に capability rule を埋め込まない

- [x] organization 単位の一貫性を固定する policy contract を定義する (AC: 1, 2, 4)
  - [x] organization 全体で 1 subscription / 1 eligibility decision の前提をコード上で明文化する
  - [x] multi-classroom organization でも同じ eligibility result が返ることを helper / contract レベルで保証する
  - [x] future backend enforcement (Story 3.2) と web gating UX (Story 3.3) が同じ policy result を共有できるようにする

- [x] policy の reason model を explicit にする (AC: 3, 4)
  - [x] `free`, `premium_trial`, `premium_paid` の app plan state に対し、eligibility reason を明示的に返す
  - [x] provider status と product plan state のズレを policy 内で吸収し、consumer が Stripe status 文字列を直接解釈しなくてよい状態にする
  - [x] policy reason / state naming は observability, audit, future support inspection と矛盾しない語彙に合わせる

- [x] regression test を追加して policy を固定する (AC: 1, 2, 3, 4)
  - [x] pure policy test または backend 近接 unit test で free / trial / paid / canceled / past_due などの主要分岐を固定する
  - [x] Story 2.5 の audit / signal path が新 policy helper を使っても壊れないことを backend integration test で確認する
  - [x] web UI 変更は原則不要とし、summary contract を変えない限り web test 更新は必要時のみに限定する

## Dev Notes

- Story 3.1 の目的は premium feature をもう gate することではなく、「premium を使える organization か」を一箇所で判定する policy を定義することである。実際の backend deny/allow は Story 3.2、UI messaging は Story 3.3 で扱う。
- すでに Story 2.5 で `organization-billing-observability.ts` が `entitlementState` を暫定導出している。Story 3.1 ではこの暫定導出を正式な policy layer に移し、audit / signal / future enforcement が同じ判断を使うようにするのが重要である。
- policy は classroom ごと・route ごと・UI ごとに別実装してはいけない。organization billing state から 1 度だけ判定し、その結果を各 consumer が使う構造に寄せる。
- owner-only billing authority と premium operational eligibility は別概念である。Story 3.1 で扱うのは後者であり、billing authority rule を混ぜて entitlement policy を歪めない。

### Technical Requirements

- premium entitlement は organization 単位の policy として扱い、各機能の利用可否へ一貫反映する。 [Source: _bmad-output/planning-artifacts/architecture.md#Decision Priority Analysis]
- provider subscription status と product plan state は分離して扱い、entitlement 判定は application billing-state rule を正本にする。 [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- premium gating は classroom ごとの契約分岐ではなく organization 単位で一貫適用する。 [Source: _bmad-output/planning-artifacts/architecture.md#Technical Constraints & Dependencies]
- plan state と entitlement state は external event delivery の遅延や retry があっても internally consistent である必要がある。 [Source: _bmad-output/planning-artifacts/epics.md#Requirements]
- raw Stripe status を UI / backend / tests で別解釈させず、明示的 policy を通す。 [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]

### Architecture Compliance

- policy layer は route 層や webhook handler に埋め込まず、billing domain 近傍の dedicated helper/module として定義する。 [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- `organization_billing` は current summary の aggregate root とし、policy 自体はその consumer に留める。 [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- entitlement 判定を provider status の単純分岐にせず、trial period や payment method 状態も含む policy を通して実装する。 [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]
- route/page ごとに premium gating 条件をばらまくのは anti-pattern であり、Story 3.1 ではその共通境界を先に用意する。 [Source: _bmad-output/planning-artifacts/architecture.md#Anti-Patterns]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 の既存構成を維持し、新規 dependency 追加は原則不要。 [Source: _bmad-output/project-context.md#Backend]
- backend は `module: "NodeNext"` + `verbatimModuleSyntax: true` 前提なので、relative import は既存どおり `.js` 拡張子付き ESM 形式を維持する。 [Source: _bmad-output/project-context.md#重要な実装ルール]
- Story 3.1 は policy 層導入が主であり、schema 変更は必須ではない。不要な migration を混ぜない。 [Source: _bmad-output/project-context.md#開発ワークフロールール]
- Web は `organization-context.svelte.ts` / `rpc-client.ts` の既存 contract を前提とし、summary shape を変える場合だけ最小限の追従に留める。 [Source: apps/web/src/lib/features/organization-context.svelte.ts]

### File Structure Requirements

- 主変更候補:
  - `apps/backend/src/billing/organization-billing-policy.ts` (new)
  - `apps/backend/src/billing/organization-billing.ts`
  - `apps/backend/src/billing/organization-billing-observability.ts`
  - `apps/backend/src/routes/auth-routes.ts` (policy consumer が必要な場合のみ)
  - `apps/backend/src/app.test.ts`
- Story 3.1 では enforcement route への広範囲適用はまだ行わず、policy module とその current consumer の最小接続に集中する。
- `booking-routes.ts` や operational route 群への deny/allow 適用は Story 3.2 の責務として残し、今回の story では premature gating を混ぜない。
- Web UI 変更は原則不要。policy 可視化や premium restriction messaging は Story 3.3 で扱う。

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
- policy 分岐は backend 近接 test で free / premium_trial / premium_paid / canceled / past_due などを固定し、consumer ごとに再実装させない。 [Source: docs/test-strategy.md#Backend]
- Story 2.5 で入った audit / signal path が新 policy に追従しても previous/next state や signal semantics を壊さないことを `apps/backend/src/app.test.ts` の統合テストで確認する。 [Source: _bmad-output/implementation-artifacts/2-5-billing-audit-trail-and-state-reconciliation-signals.md]
- `.svelte` を触らない限り browser test は不要。policy contract や screen data shaping を変える場合のみ web server/browser test を更新する。 [Source: docs/test-strategy.md#Web server]

### Previous Story Intelligence

- Story 2.1 で payment-method registration handoff と `paymentMethodStatus` summary が入り、trial / paid continuity の app-side truth が整った。Story 3.1 の policy はこの既存 truth を再利用すべきである。
- Story 2.2 で trial completion policy が shared helper に集約された。Story 3.1 でも plan lifecycle と entitlement lifecycle を route ごとに複製せず、shared policy に寄せる必要がある。
- Story 2.3 で webhook normalization と idempotent billing synchronization が入り、provider status の取り込み先が整理された。entitlement policy はその上で app-side state を読む consumer として置くのが自然である。
- Story 2.4 で reminder history、Story 2.5 で audit / signal の append-only records が追加された。Story 3.1 では `organization-billing-observability.ts` の暫定 `entitlementState` 導出を shared policy に置き換え、observability と policy の語彙を揃えるべきである。
- Story 2.5 では `free_only` / `premium_enabled` の entitlement 語彙と reconciliation signal が入った。Story 3.1 ではこの語彙を壊さず、eligibility reason / state model を正式化するのが安全である。

### Git Intelligence Summary

- 直近の relevant commits:
  - `d0d0e34 feat: webhookの実装`
  - `be1cbbd feat(billing): add trial payment method registration`
  - `8202b6d chore(config): set Stripe billing catalog IDs`
  - `03f928f feat(contracts): add premium trial lifecycle UI`
  - `291f3f5 feat(billing): add owner-only premium trials`
- guardrail:
  - recent billing work は `apps/backend/src/billing/*`、`auth-routes.ts`、`app.test.ts` に集約されているため、Story 3.1 も同じ seam を優先する
  - contracts UI には `planState` / `paymentMethodStatus` の consumer がすでに存在するため、consumer 側で premium rule を増殖させず backend policy を正本にする方向が安全
  - Story 3.2/3.3/3.4 が後続に控えているため、今回は policy 定義のみに留め、enforcement や UI messaging を先走らない

### Latest Technical Notes

- Epic 3 の first story は 「organization billing state を一回評価して全 classroom / staff workflow に共通利用できる premium entitlement policy を定義すること」である。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1]
- architecture では `organization-billing-policy.ts` を dedicated service boundary として想定しており、premium gating を route ごとにばらまかない前提が明示されている。 [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- current codebase には正式な entitlement policy module はまだなく、observability helper が `entitlementState` を暫定導出している。Story 3.1 はこの暫定状態を本設計へ引き上げるタイミングである。 [Source: apps/backend/src/billing/organization-billing-observability.ts]

### Project Context Reference

- 高リスクな認可 / capability 境界変更は backend 統合テストを優先し、route-level behavior ではなく API/consumer の整合まで守る。 [Source: _bmad-output/project-context.md#テストルール]
- staged migration 中の brownfield 変更として、既存 `organization_billing` / Stripe sync / contracts flow を壊さず段階拡張する。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- docs と既存コードの role/status/source 用語を別名に増やさず、union type・正規化関数・既存語彙へ寄せる。 [Source: _bmad-output/project-context.md#重要な実装ルール]

### Project Structure Notes

- current billing aggregate / lifecycle helper は `apps/backend/src/billing/organization-billing.ts` にある。
- current audit / signal consumer は `apps/backend/src/billing/organization-billing-observability.ts` にあり、ここが Story 3.1 の policy 化で最初の移行対象になる。
- current webhook reconciliation は `apps/backend/src/billing/stripe-webhook-sync.ts` にあり、provider state の取り込み先として維持するべきである。
- current operational enforcement route 群は `apps/backend/src/routes/booking-routes.ts` と `apps/backend/src/booking/authorization.ts` に存在するが、Story 3.1 ではこれらへ deny/allow をばらまかない。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision Priority Analysis]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements Coverage Validation]
- [Source: _bmad-output/project-context.md]
- [Source: docs/test-strategy.md#Backend]
- [Source: apps/backend/src/billing/organization-billing.ts]
- [Source: apps/backend/src/billing/organization-billing-observability.ts]
- [Source: apps/backend/src/billing/stripe-webhook-sync.ts]
- [Source: apps/backend/src/booking/authorization.ts]
- [Source: _bmad-output/implementation-artifacts/2-5-billing-audit-trail-and-state-reconciliation-signals.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Loaded `bmad-create-story` workflow and sprint tracking, then selected the first backlog story in order: `3-1-organization-scoped-premium-entitlement-policy`.
- Reviewed Epic 3 story definition and architecture service boundaries to isolate policy definition from later backend enforcement and UI gating stories.
- Reviewed Story 2.5 implementation notes to inherit audit/signal terminology and identify the current temporary `entitlementState` derivation that should move into a shared policy module.
- Inspected current backend billing, observability, webhook, and authorization seams to anchor likely file targets and avoid route-local premium rule duplication.
- Reviewed project context and test strategy for backend-integration-first validation on cross-cutting capability boundaries.
- Implemented a dedicated billing policy module and added focused policy tests before wiring existing consumers to the new policy.
- Replaced temporary entitlement derivation in billing observability and reused the same policy in billing summary and reminder-context consumers to avoid ad hoc plan-state interpretation drift.
- Reconciled Story 2.5 integration expectations so expired trials remain `premium_trial` as billing state while their entitlement becomes `free_only`.

### Completion Notes List

- 2026-04-09: Created Story 3.1 as the first implementation artifact for Epic 3.
- 2026-04-09: Scoped the story to shared organization-scoped entitlement policy definition only, leaving backend enforcement and UI gating to Stories 3.2 and 3.3.
- 2026-04-09: Connected the story to Story 2.5 learnings so the future policy replaces temporary entitlement derivation rather than adding a second source of truth.
- 2026-04-09: Added `apps/backend/src/billing/organization-billing-policy.ts` with a single organization-scoped premium eligibility decision that returns explicit `isPremiumEligible`, entitlement state, reason, and source fields.
- 2026-04-09: Moved Story 2.5 observability entitlement derivation onto the new policy and reused the same policy result in billing summary and reminder context consumers without changing the public web billing contract.
- 2026-04-09: Added focused policy tests for free, active trial, expired trial, paid active, and paid grace states, then updated backend integration expectations so expired trials remain visible as trial billing state but no longer keep premium entitlement.
- 2026-04-09: Verified backend and web regression suites stayed green without introducing schema changes or premature route-level premium gating.

### File List

- _bmad-output/implementation-artifacts/3-1-organization-scoped-premium-entitlement-policy.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/backend/src/billing/organization-billing-policy.ts
- apps/backend/src/billing/organization-billing-policy.test.ts
- apps/backend/src/billing/organization-billing-observability.ts
- apps/backend/src/billing/organization-billing-notifications.ts
- apps/backend/src/routes/auth-routes.ts
- apps/backend/src/app.test.ts

## Change Log

- 2026-04-09: Story 3.1 created and moved to `ready-for-dev`.
- 2026-04-09: Implemented the shared organization-scoped premium entitlement policy, updated current billing consumers to reuse it, and moved the story to `review`.
