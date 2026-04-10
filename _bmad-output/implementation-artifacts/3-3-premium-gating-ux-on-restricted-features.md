# Story 3.3: Premium Gating UX on Restricted Features

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an organization member,
I want premium-restricted features to communicate access status clearly,
So that I understand why a feature is unavailable and what it depends on.

## Acceptance Criteria

1. user が web app で premium-restricted feature に遭遇したとき、organization に premium eligibility がなければ UI が premium required を明示し、その messaging は organization の current billing context と矛盾しないこと。
2. current user が owner ではないとき、premium restriction を表示しても owner-only billing action を露出せず、自分で subscription を変更できるような誤解を与えないこと。
3. current user が non-premium organization の owner で premium restriction を表示するとき、適切な billing workspace への導線を出せて、その guidance は contracts page の trial / billing flow と整合すること。
4. restricted status を keyboard / assistive technology で利用したとき、gating state が色だけに依存せず理解でき、generic error と unavailable premium feature を区別できること。

## Tasks / Subtasks

- [x] premium restriction 用の共通 UI model / helper を web 側に追加する (AC: 1, 2, 3, 4)
  - [x] Story 3.2 backend denial payload (`organization_premium_required`, `reason`, `entitlementState`, `planState`, `trialEndsAt`) を parse できる web-side type guard / mapper を追加する
  - [x] raw `403` message を各 page で個別解釈せず、shared helper から「premium required」「owner can act / non-owner read-only」「trial ends at」などの説明文へ変換する
  - [x] contracts page 既存文言と矛盾しない owner guidance / read-only guidance を再利用できる構造にする

- [x] premium-restricted surface の代表 UI に explanatory gating を適用する (AC: 1, 2, 3, 4)
  - [x] FR38 に対応する multi-classroom / classroom management 面で、作成 action unavailable を generic 権限エラーではなく premium restriction として説明する
  - [x] FR39 に対応する org/classroom invitation management 面で、premium restriction を role不足と区別して表示する
  - [x] FR40 / FR41 / FR42 に対応する bookings page 系（service create, recurring schedule, approval/ticket-related management）の representative mode で premium gating card / notice を表示する
  - [x] advanced management capability に相当する participant / ticket 管理面でも、premium restriction が発生したとき owner / non-owner で案内を分ける

- [x] owner-only billing authority と operational premium usage を UI で混同しない (AC: 2, 3)
  - [x] non-owner には contracts page への案内文は出しても、trial start / payment-method registration / billing portal の直接 action は出さない
  - [x] owner には contracts page への移動導線を出し、contracts page で開始される trial / payment-method flow と文言を揃える
  - [x] `planState === premium_paid` のような page-local shortcut を増やさず、backend denial payload と organization billing summary を組み合わせて表示する

- [x] accessibility と状態の区別を明示する (AC: 1, 4)
  - [x] premium restriction notice には見出し・本文・補足説明を持たせ、badge 色だけに頼らず screen reader で意味が取れる構造にする
  - [x] generic fetch failure / auth failure / role不足 / premium不足 を最低限 UI 上で識別できるようにする
  - [x] keyboard focus で restricted notice と次の action（または read-only explanation）が追えることを browser test で固定する

- [x] web regression test を追加して gating UX を固定する (AC: 1, 2, 3, 4)
  - [x] classrooms / invitations / bookings / participants の代表 route spec に premium restriction 表示ケースを追加する
  - [x] non-owner で owner-only CTA が出ないこと、owner で contracts 導線が出ることを browser test で固定する
  - [x] backend payload shape を変えない前提で、必要な server/remote helper test または page test を優先し、Story 3.4 の coverage 拡張を阻害しない

## Dev Notes

- Story 3.2 で backend deny/allow は入っているため、Story 3.3 の中心は `403 organization_premium_required` を人が理解できる説明へ変換することにある。
- Epic 3 の次 story である Story 3.4 は premium coverage の拡張であり、Story 3.3 は「共通 UX パターン」と「代表面での適用」を優先すべきである。ここで全画面フルカバーを狙って ad hoc 実装をばらまかない。
- owner-only billing authority と premium operational eligibility は別概念である。non-owner admin / manager / staff が premium restriction を見ても「自分で契約を変えられる」と見せてはいけない。
- contracts page にはすでに trial / payment-method / portal 導線と read-only wording がある。Story 3.3 ではその文脈を正本にし、restricted feature 側で別ルールを作らない。

### Technical Requirements

- premium gating explanation UI は backend 由来 state を表示するだけに留める。page 側で Stripe status や billing truth を再解釈しない。 [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- user が premium-restricted feature に遭遇したとき、UI は premium required を明示し、organization の current billing context と整合する必要がある。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]
- current user が owner ではないとき、owner-only billing actions を露出しない。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]
- current user が owner で non-premium organization のとき、guidance は contracts page の trial / billing flow と一致する必要がある。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]
- restricted status は keyboard / assistive technology でも generic error と区別可能である必要がある。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]

### Architecture Compliance

- premium gating を各 route/page で個別の `if` 文にばらまく anti-pattern を避け、shared helper / shared UI block に寄せる。 [Source: _bmad-output/planning-artifacts/architecture.md#Requirements Coverage Validation]
- `organization-context.svelte.ts` や feature helper に billing fetch/action helper を置き、page は presentation に集中させる既存方針を維持する。 [Source: _bmad-output/planning-artifacts/architecture.md#Requirements Coverage Validation]
- contracts page は billing workspace の正本であり、restricted feature 側は billing state の consumer として説明を出すだけにする。 [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- Story 3.2 backend gate の denial payload shape を UI の single source とし、frontend 独自の premium feature map や plan shortcut を増やさない。 [Source: _bmad-output/implementation-artifacts/3-2-premium-feature-enforcement-in-backend-operational-flows.md]

### Library / Framework Requirements

- Web は SvelteKit `2.22.0` + Svelte `5.38.6` の既存構成を維持し、`.svelte` 変更時は current component patterns と a11y-friendly markup を優先する。 [Source: _bmad-output/project-context.md#Web]
- client/server remote helper は既存の `query(...)` と feature module パターンに合わせ、新規 dependency 追加は原則不要。 [Source: _bmad-output/project-context.md#Frontend]
- backend denial payload を扱う型追加が必要なら `apps/web/src/lib/rpc-client.ts` と corresponding feature helper に最小限で反映する。 [Source: _bmad-output/project-context.md#開発ワークフロールール]
- `.svelte` を編集するため、Svelte UI test と page spec の更新を前提にする。 [Source: docs/test-strategy.md#Web browser]

### File Structure Requirements

- 主変更候補:
  - `apps/web/src/lib/features/organization-context.svelte.ts`
  - `apps/web/src/lib/features/bookings.svelte.ts`
  - `apps/web/src/lib/features/invitations-admin.svelte.ts`
  - `apps/web/src/lib/features/participants-page.svelte.ts`
  - `apps/web/src/lib/pages/bookings-page.svelte`
  - `apps/web/src/routes/admin/classrooms/+page.svelte`
  - `apps/web/src/routes/admin-invitations/+page.svelte`
  - `apps/web/src/routes/participants/+page.svelte`
  - `apps/web/src/routes/contracts/+page.svelte`
  - 対応する `page.svelte.spec.ts`
- 共通 premium restriction UI が必要なら `apps/web/src/lib/components/` または `apps/web/src/lib/features/` に reusable block を追加し、page ごとに同文面を重複させない。
- Story 3.3 では backend entitlement policy や route authorization を変更しない。必要な backend 変更が出る場合でも、payload exposure の補助に限定する。
- Story 3.4 が後続にあるため、coverage を広げやすい shared mapper / component を先に作る。

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
  - `pnpm --filter @apps/web exec vitest run --project client` の対象 page spec
  - edited web files に対する `eslint`
- Story 3.3 は UI messaging story なので、browser/page spec を主検証手段にする。 [Source: docs/test-strategy.md#Web browser]
- owner と non-owner の表示差、generic error と premium restriction の区別、contracts page への導線有無を最低限固定する。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]
- backend contract を増やさない限り backend test の追加は原則不要。ただし denial payload parse のために contract 補助が入る場合のみ限定的に確認する。

### Previous Story Intelligence

- Story 3.2 で `organization_premium_required` denial payload と representative backend enforcement が入った。Story 3.3 はこの payload を UI explanation へ変換する最初の consumer になる。
- Story 3.1 で shared entitlement policy が導入され、expired trial は `premium_trial` 表示のままでも entitlement は `free_only` になり得る semantics が定着した。UI 側は `planState` だけで availability を判断してはいけない。
- Story 2.1-2.4 と contracts page 実装で、owner / read-only admin 向け billing wording、trial start、payment-method registration、portal 導線が整理済みである。restricted feature から owner を案内する場合は contracts page を使うのが安全である。
- current web helpers は `403` を generic permission error に落とす箇所があり、premium restriction と role不足を区別できていない。Story 3.3 はこの粗い error flattening を整理する必要がある。

### Git Intelligence Summary

- 直近の relevant commits:
  - `d0d0e34 feat: webhookの実装`
  - `be1cbbd feat(billing): add trial payment method registration`
  - `8202b6d chore(config): set Stripe billing catalog IDs`
  - `03f928f feat(contracts): add premium trial lifecycle UI`
  - `291f3f5 feat(billing): add owner-only premium trials`
- guardrail:
  - contracts page の billing UX はすでに owner / non-owner 差分が整理されているので、restricted feature からはそこへ寄せる
  - bookings / invitations / participants は現在 `403` を generic error または silent empty state に潰している箇所があり、Story 3.3 の主要改善点になる
  - Story 3.4 が full coverage 拡張なので、Story 3.3 は shared UX seam を作ることを優先する

### Latest Technical Notes

- Epic 3 Story 3.3 は premium-restricted feature で access status を clear に伝える UX story であり、backend enforcement そのものではない。 [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]
- architecture では premium gating explanation UI は backend 由来 state の表示に留めるべきで、page-local billing rule を増やしてはいけない。 [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- current web code には `403` を許容しつつ empty state に落とす remote helper が複数あり、premium restriction / role不足 / generic failure の判別が弱い。Story 3.3 はこの表現層の整理が中心になる。 [Source: apps/web/src/lib/remote/bookings-page.remote.ts]
- current representative restricted surfaces は classroom management、admin invitation、bookings page 系、participants / ticket management であり、Story 3.2 の backend gate 対象と対応している。 [Source: _bmad-output/implementation-artifacts/3-2-premium-feature-enforcement-in-backend-operational-flows.md]

### Project Context Reference

- UI 表示用フィールドを authorization の根拠にしない。判定の正本は backend policy / effective access に置く。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- brownfield 変更として既存 contracts flow や authorization path を壊さず、段階的に explanatory UX を重ねる。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- テストは web page spec を優先し、見た目だけでなく role / state 差分を明示的に固定する。 [Source: _bmad-output/project-context.md#テストルール]

### Project Structure Notes

- current billing workspace の正本 UI は `apps/web/src/routes/contracts/+page.svelte` にある。
- current bookings admin/participant flows は `apps/web/src/lib/pages/bookings-page.svelte` に集約されている。
- current invitation management は `apps/web/src/routes/admin-invitations/+page.svelte` と feature helper に分かれている。
- current participant / ticket management は `apps/web/src/routes/participants/+page.svelte` と `participants-page.remote.ts` を通っている。
- generic `403` flattening は `apps/web/src/lib/features/bookings.svelte.ts`、`apps/web/src/lib/features/invitations-admin.svelte.ts`、`apps/web/src/lib/remote/*` に点在している。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]
- [Source: _bmad-output/planning-artifacts/prd.md#Premium Capability Gating]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements Coverage Validation]
- [Source: _bmad-output/project-context.md]
- [Source: docs/test-strategy.md#Web browser]
- [Source: apps/backend/src/booking/authorization.ts]
- [Source: apps/web/src/routes/contracts/+page.svelte]
- [Source: apps/web/src/lib/pages/bookings-page.svelte]
- [Source: apps/web/src/routes/admin-invitations/+page.svelte]
- [Source: apps/web/src/routes/participants/+page.svelte]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Loaded `bmad-create-story` workflow and sprint tracking, then selected the first backlog story in order: `3-3-premium-gating-ux-on-restricted-features`.
- Reviewed Epic 3 definitions to keep Story 3.3 scoped to explanatory UX and avoid leaking full capability coverage work from Story 3.4.
- Re-read Story 3.2 to inherit the new backend denial payload and the owner-authority / operational-premium separation already established there.
- Inspected current contracts page wording and the major admin pages (`classrooms`, `admin invitations`, `bookings`, `participants`) to identify where generic `403` handling currently hides premium restriction context.
- Mapped the story to existing web feature / remote helper seams so the later dev pass can add one shared premium restriction explanation pattern instead of page-local ad hoc copy.
- Added a shared premium restriction mapper and reusable notice component so representative pages can render consistent owner/non-owner guidance from the Story 3.2 denial payload.
- Wired premium restriction state through the relevant remote helpers and page loaders, then fixed the recurring create path to preserve restriction state and billing summary loading.
- Re-ran web browser specs, `@apps/web` typecheck, server tests, and targeted eslint after correcting the recurring route regression and helper call-site type mismatches.

### Completion Notes List

- 2026-04-10: Created Story 3.3 as the next implementation artifact in sprint order.
- 2026-04-10: Scoped the story to premium restriction explanatory UX and billing-workspace guidance, leaving full feature-surface coverage expansion to Story 3.4.
- 2026-04-10: Anchored the story on Story 3.2 backend denial payload and existing contracts page copy so the UI can stay consistent with current billing truth.
- 2026-04-10: Added `premium-restrictions.ts` and `premium-restriction-notice.svelte` to centralize premium gating copy, current billing context, and owner-vs-read-only guidance.
- 2026-04-10: Applied shared premium gating UX to classroom creation, admin invitations, bookings management modes, and participant/ticket management representative surfaces without introducing page-local billing rules.
- 2026-04-10: Fixed the recurring create route to carry premium restriction state, then validated the story with targeted browser specs, `pnpm --filter @apps/web test`, `typecheck`, and targeted eslint.

### File List

- _bmad-output/implementation-artifacts/3-3-premium-gating-ux-on-restricted-features.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/web/src/lib/components/premium-restriction-notice.svelte
- apps/web/src/lib/features/premium-restrictions.ts
- apps/web/src/lib/features/bookings.svelte.ts
- apps/web/src/lib/features/invitations-admin.svelte.ts
- apps/web/src/lib/features/invitations-participant.svelte.ts
- apps/web/src/lib/features/organization-context.svelte.ts
- apps/web/src/lib/features/tickets.svelte.ts
- apps/web/src/lib/pages/bookings-page.svelte
- apps/web/src/lib/remote/admin-bookings-operations.remote.ts
- apps/web/src/lib/remote/admin-recurring-page.remote.ts
- apps/web/src/lib/remote/admin-services-page.remote.ts
- apps/web/src/lib/remote/admin-slots-page.remote.ts
- apps/web/src/lib/remote/bookings-page.remote.ts
- apps/web/src/lib/remote/participant-bookings-page.remote.ts
- apps/web/src/lib/remote/participants-page.remote.ts
- apps/web/src/routes/admin/classrooms/+page.svelte
- apps/web/src/routes/admin/classrooms/page.svelte.spec.ts
- apps/web/src/routes/admin-invitations/+page.svelte
- apps/web/src/routes/admin/invitations/+page.svelte
- apps/web/src/routes/admin/participants/+page.svelte
- apps/web/src/routes/admin-invitations/page.svelte.spec.ts
- apps/web/src/routes/admin/schedules/recurring/new/page.svelte.spec.ts
- apps/web/src/routes/admin/services/new/page.svelte.spec.ts
- apps/web/src/routes/dashboard/+page.svelte
- apps/web/src/routes/participant/invitations/+page.svelte
- apps/web/src/routes/participants/+page.svelte
- apps/web/src/routes/participants/page.svelte.spec.ts

## Change Log

- 2026-04-10: Story 3.3 created and moved to `ready-for-dev`.
- 2026-04-10: Implemented shared premium restriction UX, applied it to representative admin/participant surfaces, and moved Story 3.3 to `review`.
