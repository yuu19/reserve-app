# Story 4.1: Internal Billing Inspection View

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an authorized internal operator,
I want to inspect an organization's billing state and lifecycle summary,
So that I can understand its current subscription situation without direct database access.

## Acceptance Criteria

1. authorized internal operator が organization billing inspection view を要求したとき、system は current billing summary を返し、free / trial / paid の current state を product-plan 観点で解釈できる lifecycle context を含めること。
2. inspected organization が Stripe-linked billing information を持つとき、inspection response には diagnosis に必要な provider-linked identifiers と provider-facing status が含まれること。ただし mutation action や provider payload の raw dump は返さないこと。
3. unauthorized user が internal billing inspection view へアクセスしたとき、system は access を deny し、internal billing detail を一切露出しないこと。
4. billing state が時間経過で変化しているとき、inspection response は recent lifecycle context を伴い、manual log reconstruction なしで current state を読めること。

## Tasks / Subtasks

- [ ] internal billing inspection の read scope と authorization seam を定義する (AC: 1, 2, 3, 4)
  - [ ] current repo に internal support role / route / env seam が存在しないことを前提に、owner/admin/member/participant と分離された internal-only access rule を追加する
  - [ ] organization billing inspection を organization owner 向け billing workspace や premium feature gating と混線させず、support/internal read concern として切り出す
  - [ ] internal access は read-only に限定し、この story では trial start / payment method handoff / plan mutation / resync trigger を追加しない
  - [ ] unauthorized access 時は generic auth failure ではなく protected internal inspection denial として振る舞い、billing summary / audit / signal detail を返さない

- [ ] current billing summary を internal diagnosis 向け inspection shape に整形する (AC: 1, 2)
  - [ ] `organization_billing` の mutable current summary を正本にし、`planCode`, `planState`, `subscriptionStatus`, `paymentMethodStatus`, `billingInterval`, `currentPeriodEnd`, `trialEndsAt`, `cancelAtPeriodEnd` を diagnosis 向けに読み出す
  - [ ] current state を raw Stripe status の羅列ではなく product-plan 観点で解釈できる summary にする
  - [ ] Stripe linkage がある場合は `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId` など provider-linked identifiers を含める
  - [ ] provider-facing status は current summary / existing reconciliation seam から読める範囲に限定し、raw provider payload 全体や billing mutation capability を inspection payload に混ぜない

- [ ] recent lifecycle context を inspection response に加える (AC: 1, 4)
  - [ ] Story 2.5 の `organization_billing_audit_event` を再利用し、recent billing transition context を current state の周辺情報として返す
  - [ ] current state が free / trial / paid のどこに位置するかを recent audit から読める最小 timeline に整形する
  - [ ] recent context は support diagnosis に必要な範囲へ絞り、full investigation timeline や notification history 全件表示までは広げない
  - [ ] current state interpretation に必要な latest signal があれば Story 2.5 の `organization_billing_signal` から summary を補助的に返し、Story 4.3 mismatch diagnosis の先取り実装にはしない

- [ ] inspection endpoint / consumer seam を future Epic 4 stories が再利用しやすい shape で実装する (AC: 1, 2, 4)
  - [ ] Story 4.2-4.4 が reminder history / mismatch / timeline を追加しやすいよう、organization inspection payload を sectioned な read model にする
  - [ ] current story では base inspection view に必要な fields だけ返し、notification history 全量・signal timeline 全量を初回 response に詰め込みすぎない
  - [ ] existing `auth-routes.ts` 集約パターンを尊重しつつ、billing internal inspection helper は billing domain 近傍へ寄せて route-local assembly を肥大化させない

- [ ] regression test を追加して internal inspection の allow / deny / read shape を固定する (AC: 1, 2, 3, 4)
  - [ ] authorized internal operator の access success と unauthorized access denial を backend integration test で追加する
  - [ ] free / trial / paid の representative billing state ごとに inspection payload が product-plan context と provider-linked identifiers を返すことを固定する
  - [ ] recent audit event が current state interpretation に使われることを統合テストで固定する
  - [ ] raw provider payload や mutation affordance が response に含まれないことを確認する

## Dev Notes

- Epic 4 は support/internal diagnosis 用の read concern であり、owner billing workspace や premium capability gating の延長ではない。Story 4.1 では internal inspection の最小 read model と authorization seam を作ることが主目的である。
- Story 2.5 で `organization_billing_audit_event` と `organization_billing_signal` が追加されている。Story 4.1 はそれらを人間が読める inspection summary に接続する最初の consumer であり、append-only records 自体の責務を変えない。
- current repo には internal operator 向けの既存 role / route / UI seam が見当たらない。したがって Story 4.1 では auth seam を安易に organization owner/admin に流用しないことが重要である。
- Story 4.1 は diagnosis read に留める。trial completion rerun、billing resync、notification retry、plan mutation など operational actions は後続 story でも scope 外と考える。

### Technical Requirements

- FR34 は authorized internal operators が organization billing state を inspect できることを要求する。 [Source: _bmad-output/planning-artifacts/prd.md#Support & Internal Operations]
- Epic 4 の internal billing inspection view は current billing state summary と lifecycle context を read-only で返し、unauthorized access を deny する必要がある。 [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1]
- Story 2.5 で追加済みの audit trail / signal は future internal inspection のための正本であり、Story 4.1 はそれを inspection read model に接続する位置づけである。 [Source: _bmad-output/implementation-artifacts/2-5-billing-audit-trail-and-state-reconciliation-signals.md]
- current billing truth は `organization_billing` summary と `organization-billing-policy.ts` の解釈を正本にし、provider status shortcut だけで state を再定義しない。 [Source: apps/backend/src/billing/organization-billing-policy.ts]

### Architecture Compliance

- Support & Internal Operations は `最小 internal visibility + audit/event history` として設計されている。Story 4.1 でも general-purpose admin console を作らず、inspection read concern に絞る。 [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- auditability は schema + history tables + structured logs に寄せる方針なので、inspection view は append-only records を読む consumer として実装する。 [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]
- route schema は既存どおり `auth-routes.ts` に置く current pattern を尊重し、必要な assembly helper は billing domain 近傍に寄せる。 [Source: _bmad-output/planning-artifacts/architecture.md#File Organization Patterns]
- internal inspection は diagnosis 専用 read であり、billing mutation や raw provider payload dumping を同じ endpoint に混在させない。 [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1]

### Library / Framework Requirements

- Backend は Hono `4.11.7` + Better Auth `1.4.18` + Drizzle ORM `0.45.1` + Cloudflare D1 の既存構成を維持し、新規 dependency 追加は原則不要。 [Source: _bmad-output/project-context.md#Backend]
- backend relative import は `.js` 拡張子付き ESM 形式を維持する。 [Source: _bmad-output/project-context.md#重要な実装ルール]
- internal access seam に env/config を足す場合は `apps/backend/src/auth-runtime.ts`, `apps/backend/.dev.vars.example`, `apps/backend/README.md`, `docs/README.md` の既存 env documentation flow に乗せる。 [Source: _bmad-output/project-context.md#開発ワークフロールール]
- schema 変更はこの storyでは原則不要。Story 2.5 で inspection 用の record はすでにあるため、まず read model と authorization に集中する。 [Source: _bmad-output/implementation-artifacts/2-5-billing-audit-trail-and-state-reconciliation-signals.md]

### File Structure Requirements

- backend 主変更候補:
  - `apps/backend/src/routes/auth-routes.ts`
  - `apps/backend/src/auth-runtime.ts`
  - `apps/backend/src/billing/organization-billing.ts`
  - `apps/backend/src/billing/organization-billing-policy.ts`
  - `apps/backend/src/billing/organization-billing-observability.ts`
  - `apps/backend/src/app.test.ts`
  - `apps/backend/README.md`
  - `apps/backend/.dev.vars.example`
  - `docs/README.md`
- current repo に internal support UI route が存在しない限り、Story 4.1 の主戦場は backend read endpoint / helper / tests とする
- web UI を追加する場合でも full support console は scope 外。inspection payload を確認する最小 consumer に留める

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/backend typecheck`
  - `pnpm --filter @apps/backend exec eslint ...` on edited backend files
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
- Story 4.1 の主戦場は backend integration test。authorized internal access, unauthorized denial, billing-state shape, recent audit context の統合テストを `apps/backend/src/app.test.ts` に追加する。 [Source: _bmad-output/project-context.md#テストルール]
- web UI を触らない限り browser test は不要。inspection API shape のみなら backend integration first を維持する。 [Source: _bmad-output/project-context.md#テストルール]
- auth seam に env/config を追加する場合は local/test env でも deterministic に切り替えられるようにし、テストで bypass しない。 [Source: _bmad-output/project-context.md#開発ワークフロールール]

### Previous Story Intelligence

- Story 3.4 では shared seam を拡張して allow / block contradiction を埋めた。Story 4.1 でも route ごとの ad hoc inspection shape ではなく shared read model を優先すべきである。
- Story 2.5 で `organization_billing_audit_event` と `organization_billing_signal`、Story 2.4 で `organization_billing_notification` が append-only ordering 付きで整備された。Story 4.1 は current billing summary と recent audit context を読める最小 inspection shape をまず作るべきで、notification history や mismatch deep-dive は Story 4.2/4.3 に残すのが自然である。
- Story 2.5 の completion note は audit を「何がどう変わったか」、signal を「今どこが食い違っているか or pending か」に分けている。Story 4.1 でもこの責務分離を壊さず current state interpretation に必要な最小 signal だけを補助表示に使うべきである。
- current repo には internal operator 用 allowlist / role seam が存在しないため、Story 4.1 実装で organization owner/admin を internal support substitute にしない guardrail が重要である。

### Git Intelligence Summary

- 直近の relevant commits:
  - `d0d0e34 feat: webhookの実装`
  - `be1cbbd feat(billing): add trial payment method registration`
  - `8202b6d chore(config): set Stripe billing catalog IDs`
  - `03f928f feat(contracts): add premium trial lifecycle UI`
  - `291f3f5 feat(billing): add owner-only premium trials`
- guardrail:
  - recent billing work は `billing/` helper、`auth-routes.ts`、`app.test.ts` に集約されているため、Story 4.1 でも inspection composition は同じ seam に寄せる
  - append-only history と current summary はすでに分離されているため、inspection response でそれを再び曖昧に混ぜない
  - internal support seam は未導入なので、Story 4.1 では auth design を story scope として明示し、隠れた assumptions で実装を始めない

### Latest Technical Notes

- current backend には `selectOrganizationBillingSummary(...)`, `readOrganizationPremiumEntitlementPolicy(...)`, `readOrganizationBillingObservationSnapshot(...)` があり、current state を read-only に組み立てる材料は揃っている。 [Source: apps/backend/src/billing/organization-billing.ts]
- Story 2.5 で `organization_billing_audit_event` と `organization_billing_signal` が `sequence_number` 付き append-only records として追加済みであり、recent context を chronological に返す基盤はすでにある。 [Source: apps/backend/src/db/schema.ts]
- current codebase には internal support access を示す env/config や role 名が存在しない。したがって Story 4.1 では auth seam を最小で導入し、テストで明示的に守る必要がある。
- Story 4.1 は FR34 の base inspection story であり、FR35-37 を先取りして notification history 全量、mismatch diagnosis 全量、timeline 全量を初回 response に押し込まない方がよい。

### Project Context Reference

- `403` は想定内の権限制御分岐として扱い、generic failure と混同しない。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- UI 表示用フィールドを authorization の根拠にせず、backend policy / explicit internal access rule を正本にする。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- D1 schema 変更で migration や既存データ互換の検討を飛ばさない。ただし Story 4.1 は既存 schema 再利用を優先する。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- backend の高リスク変更は `apps/backend/src/app.test.ts` の統合テストを最優先にする。 [Source: _bmad-output/project-context.md#テストルール]

### Project Structure Notes

- current `/api/webhooks/stripe` と billing reliability seams は backend billing domain に寄っているが、internal inspection consumer はまだ存在しない
- current billing current-state sources は `organization_billing` summary と `organization-billing-policy.ts`
- current append-only support data sources は:
  - `organization_billing_audit_event`
  - `organization_billing_signal`
  - `organization_billing_notification`
- Story 4.1 ではこのうち `current summary + recent audit context (+ minimal signal summary)` を対象にし、notification history と mismatch detail は後続 story に渡す

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3]
- [Source: _bmad-output/planning-artifacts/prd.md#Support & Internal Operations]
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns]
- [Source: _bmad-output/planning-artifacts/architecture.md#File Organization Patterns]
- [Source: _bmad-output/project-context.md]
- [Source: _bmad-output/implementation-artifacts/2-5-billing-audit-trail-and-state-reconciliation-signals.md]
- [Source: _bmad-output/implementation-artifacts/3-4-premium-capability-coverage-across-core-feature-areas.md]
- [Source: apps/backend/src/billing/organization-billing-observability.ts]
- [Source: apps/backend/src/billing/organization-billing-policy.ts]
- [Source: apps/backend/src/db/schema.ts]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Loaded `bmad-create-story` workflow and sprint tracking, then selected the first backlog story in order: `4-1-internal-billing-inspection-view`.
- Reviewed Epic 4 story definitions and FR34-FR37 to position Story 4.1 as the base internal inspection read story rather than a full support console.
- Re-read Story 2.5 to connect the new inspection story to existing append-only audit/signal tables and deterministic chronology.
- Checked the current backend for internal support auth seams and found no existing internal-only role or env allowlist, so recorded that gap as an implementation guardrail.
- Inspected current billing summary, entitlement policy, and observability helpers to anchor likely file targets and keep Story 4.1 schema-light and read-only.

### Completion Notes List

- 2026-04-10: Created Story 4.1 as the next implementation artifact in sprint order.
- 2026-04-10: Scoped the story to a read-only internal billing inspection endpoint / consumer seam using existing billing summary and recent audit context.
- 2026-04-10: Explicitly separated internal inspection authorization from organization owner/admin/member roles because no current internal support seam exists in the repo.
- 2026-04-10: Anchored the story on Story 2.5 observability records so Story 4.2-4.4 can extend the same inspection shape later.

### File List

- _bmad-output/implementation-artifacts/4-1-internal-billing-inspection-view.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-04-10: Story 4.1 created and moved to `ready-for-dev`.
