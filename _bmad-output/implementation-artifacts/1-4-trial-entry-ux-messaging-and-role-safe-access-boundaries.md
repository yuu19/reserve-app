# Story 1.4: Trial Entry UX Messaging and Role-Safe Access Boundaries

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an organization owner,
I want trial entry messaging and access boundaries to be clear,
so that I understand what I can do now and what other roles cannot do.

## Acceptance Criteria

1. owner が trial 開始可能な状態で contracts page を見たとき、UI が Premium の価値と 7 日 trial の意味を明確に説明し、action が owner billing workspace に置かれていること。
2. non-owner が organization billing status を見たとき、UI が billing を変更できるかのように示唆せず、billing authority と operational authority が明確に分離されていること。
3. organization がすでに trial または paid state のとき、contracts page が無効な duplicate trial action を出さず、current lifecycle state を分かりやすく説明すること。
4. keyboard または assistive technology で billing workspace を使ったとき、core status と action が理解可能かつ操作可能で、曖昧な visual-only cue に依存しないこと。

## Tasks / Subtasks

- [x] contracts page の owner trial entry messaging を明確化し、Premium の価値と trial の意味を言語化する (AC: 1, 3)
  - [x] `apps/web/src/routes/contracts/+page.svelte` の free-plan owner セクションで、「何が trial できるのか」「いつまで試せるのか」「この時点では何をまだしていないのか」を短く理解できる copy に整理する
  - [x] owner billing workspace の action と explanatory copy の関係を明示し、trial action が generic admin operation ではなく billing action であることを分かる構成にする
  - [x] trial 中 / paid 中は duplicate trial CTA を見せず、現在の lifecycle と次に取れる行動または待つべき状態を説明する

- [x] role-safe access boundaries を contracts page 上の wording / affordance で明示する (AC: 2, 3)
  - [x] read-only admin 表示では「閲覧できるが課金操作できない」ことを今より明確にし、billing authority と classroom / participant 運用権限が別であると伝える
  - [x] manager / staff / participant への access boundary はこの story でも拡張しない。`hasOrganizationAdminAccess` を崩さず、member 以下に billing workspace を広げない
  - [x] non-owner 向けには disabled owner button を並べず、role-safe な説明テキストで権限境界を表現する

- [x] keyboard / assistive technology で理解しやすい status / action presentation に整える (AC: 4)
  - [x] status badge や色だけに依存せず、本文テキストだけ読んでも free / trial / paid と owner-only action の意味が把握できるようにする
  - [x] status notice や lifecycle explanation が更新されたとき、screen reader / keyboard user にとって意味が通る semantic structure または live region を検討し、必要なら導入する
  - [x] CTA / helper copy / loading text の語彙をそろえ、「開始できる」「開始済み」「反映待ち」「閲覧専用」の区別が曖昧にならないようにする

- [x] web helper / page 責務分離を保ちながら message state を必要最小限で整える (AC: 1, 2, 3, 4)
  - [x] `apps/web/src/lib/features/organization-context.svelte.ts` は API 呼び出しと error message 正規化に留め、presentation-specific な role copy を持ち込みすぎない
  - [x] `apps/web/src/routes/contracts/+page.svelte` は current `planState`, `trialEndsAt`, `canManageBilling`, local status notice を使い、message branching を UI 層に閉じる
  - [x] Story 1.3 で追加した `/billing/trial` action や success refresh を置き換えず、その上で UX clarity を改善する

- [x] regression test を更新し、trial entry messaging と role-safe boundary を固定する (AC: 1, 2, 3, 4)
  - [x] `apps/web/src/routes/contracts/page.svelte.spec.ts` に owner free-plan message、read-only admin wording、trial / paid state で duplicate trial CTA が出ないことを追加・更新する
  - [x] keyboard / assistive technology 観点では、少なくとも主要 heading / button / explanatory text の存在を browser test で固定し、badge 色だけに依存しない状態説明を確認する
  - [x] message branching が helper 化または純粋関数化された場合のみ、`apps/web/src/lib/features/*.spec.ts` などへ小さな unit/server test を追加する

## Dev Notes

- Story 1.4 は Story 1.3 の trial-start flow を前提に、その entry messaging と role-safe boundary を磨く story である。trial lifecycle 自体や Stripe integration の新規実装は含めない。
- current codebase では `/api/v1/auth/organizations/billing/trial` と `planState` / `trialEndsAt` / `canManageBilling` がすでに存在する。Story 1.4 はこの contract を再利用し、page copy / semantics / access boundary clarity に集中する。
- payment method registration handoff、trial-to-paid conversion、reminder email は Epic 2 以降の責務である。free-plan owner に対してこの story で checkout や payment method CTA を先行導入しない。
- contracts page はすでに comparison cards、trial status notice、read-only admin branch を持つ。Story 1.4 はそれらを大きく組み替えるのではなく、「誰が何をできるか」「今の状態で何が起きているか」の理解を高める方向で調整する。
- `hasOrganizationAdminAccess` により member / participant は contracts page から離れている。Story 1.4 でも page access boundary は維持し、admin read-only と owner billing authority の差をより明確にする。

### Technical Requirements

- trial entry / lifecycle explanation は既存 billing summary の `planState`, `trialEndsAt`, `canManageBilling`, `canViewBilling` を UI truth として使うこと。`planCode` や Stripe provider status の生文字列に戻らない。 [Source: apps/web/src/routes/contracts/+page.svelte] [Source: apps/web/src/lib/rpc-client.ts]
- free owner の action は Story 1.3 で追加した `createOrganizationBillingTrial()` を再利用し、別の checkout/prompt flow を増やさないこと。 [Source: apps/web/src/lib/features/organization-context.svelte.ts] [Source: _bmad-output/implementation-artifacts/1-3-owner-trial-start-flow.md]
- read-only/non-owner 境界は backend の owner-only policy と一致させること。UI copy を変えても `canManageBilling` を無視して action を出さない。 [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- accessibility 改善は status badge の色や配置だけでなく、テキスト、heading、button label、必要なら live region で補うこと。 [Source: _bmad-output/planning-artifacts/architecture.md#Loading State Patterns]

### Architecture Compliance

- contracts page は owner billing workspace のまま拡張し、新しい billing page や parallel UX path を作らない。 [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- `organization-context.svelte.ts` に action helper を置き、`contracts/+page.svelte` は presentation と interaction wiring に集中する。presentation-specific copy を helper 側へ寄せすぎない。 [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]
- owner-only billing authority は web/backend 両方で維持される前提であり、この story では UI clarity を改善するが権限モデル自体は変更しない。 [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- stale reflection や intermediate state は残しつつ、trial entry messaging で誤解を増やさない。loading / busy text を削除せず、必要なら改善する。 [Source: _bmad-output/planning-artifacts/architecture.md#Loading State Patterns]

### Library / Framework Requirements

- Web は SvelteKit `2.50.1` + Svelte `5.48.2` の既存 page/feature pattern を維持する。新しい global state library や accessibility helper dependency は導入しない。 [Source: _bmad-output/project-context.md#Web]
- 既存 UI component (`Card`, `Badge`, `Button`) と Tailwind utility を使い、契約ページだけ別 UI system に寄せない。 [Source: apps/web/src/routes/contracts/+page.svelte]
- backend / Stripe / schema へ変更を入れないで済むなら、この storyでは web 側に限定する。 [Source: _bmad-output/implementation-artifacts/1-3-owner-trial-start-flow.md]

### File Structure Requirements

- 主変更候補:
  - `apps/web/src/routes/contracts/+page.svelte`
  - `apps/web/src/routes/contracts/page.svelte.spec.ts`
  - 必要に応じて `apps/web/src/lib/features/organization-context.svelte.ts`
  - 必要に応じて `apps/web/src/lib/rpc-client.ts`
- backend route / schema / migration は、この storyで API contract 追加が本当に必要にならない限り触らない。role-safe boundary の主責務は既存 `canManageBilling` / page branching の clarity 改善に置く。
- page copy や accessibility text のためだけに remote function へ移行しない。current `authRpc` + feature helper 構成を維持する。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]

### Testing Requirements

- 最低限必要:
  - `pnpm --filter @apps/web test`
  - `pnpm --filter @apps/web typecheck`
  - `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`
  - `pnpm --filter @apps/web exec eslint src/routes/contracts/+page.svelte src/routes/contracts/page.svelte.spec.ts`
- `.svelte` の表示分岐と role-safe messaging を変えるため、browser test を主軸にする。owner free / trial / paid / read-only admin の代表ケースを維持しつつ、message clarity と duplicate CTA 非表示を固定する。 [Source: docs/test-strategy.md#Web browser]
- helper 側へ純粋な message branching を抽出した場合だけ、小さい server/unit test を追加する。UI 表示そのものは browser test を優先する。 [Source: docs/test-strategy.md#Web server]
- backend を触った場合のみ `pnpm --filter @apps/backend test` と `pnpm --filter @apps/backend typecheck` を追加で実施する。

### Previous Story Intelligence

- Story 1.3 で owner-only `/api/v1/auth/organizations/billing/trial` が追加され、contracts page には `localStatusNotice` / `routeStatusNotice` を使った status messaging が入った。Story 1.4 はこの基盤を再利用し、message ambiguity を減らす方向で整える。
- Story 1.3 では free owner CTA が monthly/yearly upgrade から single trial CTA に変わった。Story 1.4 ではその CTA を再変更して別 billing flow に戻さず、「trial の意味」と「owner-only authority」の理解を高める copy を優先する。
- Story 1.2 ですでに comparison cards、read-only admin branch、text-based loading が導入済みである。Story 1.4 はそれらを削るのではなく、role-safe explanation と accessibility を前進させる。

### Git Intelligence Summary

- 直近の relevant commits:
  - `2720193 feat(web): add route transition progress bar`
  - `46b99af feat(stripe): add billing catalog bootstrap script`
  - `4b8ac61 feat(billing): add organization Stripe subscriptions`
  - `43b3be5 権限システムと招待管理の強化`
  - `3b26118 Implement access-tree redesign plan`
- guardrail:
  - route transition / busy state の最近の変更を壊さず、trial action 中の文言や二重送信防止を維持する
  - access-tree / role refactor 後の権限語彙に合わせ、billing authority と operational authority を混線させない
  - Stripe subscription 基盤はすでに存在するため、この storyでは UX clarity を理由に backend flow を増やさない

### Project Context Reference

- `display` 系フィールドを権限制御の根拠に使わず、`canManageBilling` や backend role policy を正本にする。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]
- staged migration 中の `authRpc` と Remote Functions の共存を壊さず、この storyでも billing action は既存 `authRpc` パターンを維持する。 [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- `.svelte` の重要分岐変更では browser test を省略しない。 [Source: _bmad-output/project-context.md#重要な見落とし禁止ルール]

### Project Structure Notes

- current `apps/web/src/routes/contracts/+page.svelte` には `currentPlanDescription`, `actionDescription`, `currentStatusNotice`, comparison cards, and read-only branch がすでにある。Story 1.4 はこの page 内の copy / semantics / visibility branching を整理するのが自然である。
- current `apps/web/src/routes/contracts/page.svelte.spec.ts` は owner free, owner trial, paid, read-only admin, loading/intermediate state をすでにカバーしている。Story 1.4 ではこの suite を拡張し、message clarity と duplicate CTA suppression を固定するのが最も低コストで確実である。
- current helper `createOrganizationBillingTrial()` は API action と error normalization を持っている。presentation-specific role copy を helper 側へ入れすぎないよう注意する。

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4]
- [Source: _bmad-output/planning-artifacts/prd.md#MVP - Minimum Viable Product]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 1: Owner / Operator - Happy Path]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 5: Billing Integration / Stripe Operational Flow]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Loading State Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines]
- [Source: _bmad-output/planning-artifacts/architecture.md#Pattern Examples]
- [Source: _bmad-output/project-context.md#フレームワーク固有ルール]
- [Source: _bmad-output/project-context.md#コード品質・スタイルルール]
- [Source: docs/test-strategy.md#Web browser]
- [Source: docs/test-strategy.md#Web server]
- [Source: apps/web/src/routes/contracts/+page.svelte]
- [Source: apps/web/src/routes/contracts/page.svelte.spec.ts]
- [Source: apps/web/src/lib/features/organization-context.svelte.ts]
- [Source: apps/web/src/lib/rpc-client.ts]
- [Source: _bmad-output/implementation-artifacts/1-3-owner-trial-start-flow.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Reviewed create-story workflow, sprint-status ordering, Epic 1 story definitions, PRD MVP/journeys, architecture sections for auth/API/frontend/loading/enforcement, current contracts page/spec, project context, and Story 1.3 implementation learnings.
- Confirmed Story 1.4 follows Story 1.3 and primarily targets contracts-page messaging/accessibility/role-safe boundary clarity rather than a new backend billing lifecycle.
- Validation: `pnpm --filter @apps/web test`, `pnpm --filter @apps/web typecheck`, `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`, targeted `eslint`, Svelte autofixer on `contracts/+page.svelte`.

### Completion Notes List

- 2026-04-08: create-story workflow により Story 1.4 の包括的な実装コンテキストを作成し、owner trial entry message clarity・read-only boundary・accessibility guardrail を整理した。
- 2026-04-08: contracts page の free / trial / paid / read-only 各分岐の説明文を見直し、owner-only billing authority と運用権限の分離を明示した。
- 2026-04-08: status notice と loading 文言に live region を追加し、badge 以外の本文や sr-only summary でも lifecycle を理解できるようにした。
- 2026-04-08: browser spec を更新し、free owner messaging、read-only admin wording、trial / paid 状態での duplicate trial CTA 非表示を固定した。

### File List

- _bmad-output/implementation-artifacts/1-4-trial-entry-ux-messaging-and-role-safe-access-boundaries.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apps/web/src/routes/contracts/+page.svelte
- apps/web/src/routes/contracts/page.svelte.spec.ts

## Change Log

- 2026-04-08: Story 1.4 を新規作成し、trial entry UX messaging と role-safe access boundary を contracts page 中心で改善するための実装ガイドを追加。
- 2026-04-08: contracts page の role-safe messaging / accessibility semantics を改善し、対応する browser test を更新。
