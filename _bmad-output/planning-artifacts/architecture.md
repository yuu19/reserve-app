---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - docs/research/main.md
  - docs/research/coupon.md
  - docs/research/organization.md
  - docs/README.md
  - docs/architecture.md
  - docs/authorization.md
  - docs/database-er.md
  - docs/test-strategy.md
  - _bmad-output/project-context.md
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-04-08'
project_name: 'reserve-app'
user_name: 'Yusuke'
date: '2026-04-08'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
本件は `49` 個の機能要件を持つが、MVP の中心はそのうち organization 単位の課金状態管理、7 日間 trial、payment method 登録、3 日前 reminder email、Stripe webhook 同期、owner 向け billing status 表示、trial 終了時の paid 継続または free 戻しに集中している。  
要件は大きく、`plan / eligibility management`、`trial lifecycle`、`billing authority`、`payment method & paid conversion`、`notifications`、`billing state synchronization`、`support/internal operations`、`premium capability gating` に分かれる。  
アーキテクチャ上の本質は「決済機能の追加」ではなく、「organization スコープの subscription state を既存の authorization / classroom / booking / invitation モデルに整合させること」にある。

既存コードにはすでに `organization_billing` テーブル、Stripe Checkout / Billing Portal エンドポイント、契約画面、Webhook 処理が存在するため、完全新規設計ではなく、既存 Premium フローを `free -> premium trial -> premium paid` に拡張する brownfield 変更として扱う必要がある。  
また、premium entitlement は複数教室管理、スタッフ招待と権限管理、定期スケジュール、承認制予約、回数券、CSV 出力、分析・監査ログなど複数ドメインへ横断的に作用するため、課金状態の正本と利用可否判定の境界を明確にする必要がある。

**Non-Functional Requirements:**
非機能要件はこの設計の骨格を強く制約する。Billing status page は通常利用で 3 秒以内、trial 開始や payment method 登録導線は体感的に即時、Stripe イベントによる entitlement 反映は通常 1 分程度、遅くとも数分以内が期待される。  
Security 面では billing state change を owner-only に限定し、Webhook authenticity を検証し、billing state change と entitlement change に監査証跡を残し、支払い詳細は Stripe にとどめる必要がある。  
Reliability 面では reminder email の retry、duplicate / out-of-order webhook 耐性、Stripe 一時障害からの safe recovery と resync が必須である。  
Integration 面では MVP は Stripe と email のみを外部依存とし、Accessibility 面では billing/status flow に basic WCAG-minded な配慮が必要になる。

**Scale & Complexity:**
本件は PRD 上の分類では `medium` だが、実装観点では既存システムの認可・契約・通知・UI・Webhook をまたぐため `medium-high` の複雑性を持つ。  
単純な CRUD 追加ではなく、組織課金、イベント駆動同期、owner-only 権限制御、premium entitlement 横断適用という cross-cutting concern が多い。  
また、repo 全体が `organization + classroom` 2階層への段階移行中であり、課金設計もその staged migration 前提と矛盾してはならない。

- Primary domain: `full-stack SaaS billing extension on top of org/classroom operations`
- Complexity level: `medium-high`
- Estimated architectural components: `8`
  - organization billing domain model
  - Stripe integration service
  - webhook ingestion/synchronization
  - owner billing application service
  - premium entitlement policy layer
  - billing UI / route integration
  - email reminder pipeline
  - internal audit/ops visibility path

### Technical Constraints & Dependencies

- 既存 backend は Cloudflare Workers + Hono + Better Auth + D1 であり、billing もこの制約下で実装する必要がある。
- 既存 DB には `organization_billing` があり、`organization` ごとに 1 レコードを前提とするユニーク制約がすでに存在する。
- 認可モデルは `organization` と `classroom` の 2 階層であり、サーバ/クライアントの権限判定正本は `display` ではなく `effective` である。
- billing authority は PRD 上も既存 UI 上も owner-only を前提としており、admin は閲覧のみで契約操作不可とする必要がある。
- premium gating は classroom ごとの契約分岐ではなく organization 単位で一貫して適用しなければならない。
- 既存 Web は `authRpc` ベースの取得/操作パターンと `features/*.svelte.ts` の状態管理を使っており、Remote Functions への全面移行を前提にしない。
- 通知チャネルは MVP では email のみで、既存メール送信基盤は Resend 前提である。
- backend deploy には D1 migration と Cloudflare Workers deploy が含まれるため、billing schema 変更は migration と一体で扱う必要がある。
- テスト戦略上、高リスク変更は backend integration test を最優先にし、Web は server test、必要に応じて browser test で補完する。mobile は自動テスト未整備のため、課金 UI の責務は当面 Web 中心になる可能性が高い。

### Cross-Cutting Concerns Identified

- **Tenant-scoped subscription state:** subscription は `organization` 単位で一意であり、配下の classroom 数や staff 利用可否へ波及する。
- **Authorization separation:** billing authority と operational authority を分離し、owner だけが billing action を実行できるようにする必要がある。
- **Entitlement enforcement:** paid/free の違いを UI 表示だけでなく backend capability 判定にも一貫して反映する必要がある。
- **Stripe state reconciliation:** `checkout.session.completed`、`customer.subscription.*`、将来の `trial_will_end` を含む event から organization billing state を整合的に保つ必要がある。
- **Reminder communication reliability:** 3 日前メールは revenue loop の中核なので、送達失敗や未送信を silent failure にしない設計が必要である。
- **Auditability and supportability:** billing state change、notification send history、Stripe/app state mismatch を後から追跡できることが必要である。
- **Brownfield compatibility:** 既存の contracts UI、billing table、Stripe integration、org/classroom 認可モデルを壊さず、段階拡張として設計しなければならない。
- **Testing and rollout safety:** webhook 冪等性、trial 終了時の downgrade / conversion、premium gating 境界は backend integration test の主要対象になる。

## Starter Template Evaluation

### Primary Technology Domain

`full-stack brownfield monorepo` based on project requirements analysis.

本件は greenfield の新規初期化ではなく、既存 `pnpm + Turborepo` モノレポ上で `Cloudflare Workers + Hono` backend、`SvelteKit` web、`Expo` mobile を維持したまま billing architecture を拡張する案件である。  
そのため、starter template の主目的は「新規プロジェクトの初期化」ではなく、「現行基盤をそのまま正本として扱うべきか」を判断することにある。

### Starter Options Considered

評価対象として、現行採用技術の公式 starter / bootstrap 手段を確認した。

- **Hono**
  - 公式の新規作成導線は `create-hono`
  - Cloudflare Workers template を選べる
  - 新規 API/back-end プロジェクトの立ち上げには妥当だが、既存 route/module 構成を持つ本 repo を置換する理由にはならない

- **Expo**
  - 公式の新規作成導線は `create-expo-app`
  - current docs では `npx create-expo-app@latest` と SDK 55 template guidance が提示されている
  - mobile app を greenfield で始めるなら有効だが、本件では既存 Expo app を再初期化する価値はない

- **SvelteKit / Svelte ecosystem**
  - 現行 ecosystem は SvelteKit を中心に、Svelte CLI/add-on で Tailwind, Drizzle, Vitest, Playwright などを追加する流れ
  - Cloudflare adapter も現役で保守されている
  - ただし本件の web は既に SvelteKit + Cloudflare adapter + app-specific feature patterns を持っているため、starter の再採用は不適切

### Selected Starter: Existing Brownfield Monorepo Baseline

**Rationale for Selection:**
本件では新しい starter を採用しない。既存 monorepo 自体を architectural baseline として採用する。

理由は次のとおり。

- 既存 repo はすでに backend / web / mobile の責務分離、deploy 経路、test 戦略、D1 migration、Better Auth、organization/classroom 認可モデルを持っている
- billing についても `organization_billing` テーブル、Stripe Checkout / Billing Portal、Webhook、contracts UI がすでに存在する
- 今回必要なのは bootstrap ではなく、既存 Premium 実装を `free -> premium trial -> premium paid` へ安全に進化させること
- 新しい starter を導入すると、既存の route 構造、feature state、RPC 層、Cloudflare deploy 前提、test strategy との整合が壊れやすい
- AI エージェント実装の一貫性を守る観点でも、既存 repo conventions を architectural source of truth にする方が適切

**Initialization Command:**

```bash
# No new starter initialization command.
# Existing monorepo baseline is the selected foundation.
```

**Architectural Decisions Provided by Existing Baseline:**

**Language & Runtime:**
- TypeScript strict
- Backend: Hono on Cloudflare Workers
- Web: SvelteKit on Cloudflare
- Mobile: Expo + React Native

**Styling Solution:**
- Web: Tailwind CSS + bits-ui / existing app components
- Mobile: NativeWind + HeroUI Native

**Build Tooling:**
- pnpm workspace
- Turborepo task orchestration
- Wrangler-based backend/web deploy

**Testing Framework:**
- Backend: Vitest integration-heavy testing
- Web: Vitest server project, optional browser tests
- Mobile: typecheck/lint + manual smoke

**Code Organization:**
- Backend modules under `routes` / `booking` / `db` / `payment` / `email`
- Web modules under `routes` / `lib/features` / `lib/remote` / `lib/components`
- Billing additions should extend those existing slices instead of creating a parallel architecture

**Development Experience:**
- Existing monorepo commands, CI, D1 migration flow, and Cloudflare deployment pipeline are already established
- The first implementation story should extend the existing billing baseline, not initialize a fresh app

**Note:** 本案件では project initialization 自体は implementation story にならない。最初の implementation story は、既存 baseline 上で organization billing lifecycle と premium entitlement を trial-first に再設計する作業になる。

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- subscription state の正本を `organization_billing` に置き、1 organization = 1 subscription を維持する
- plan lifecycle を `free -> premium_trial -> premium_paid` として明示し、Stripe status と app 内 billing status を橋渡しする状態モデルを定義する
- premium entitlement を organization 単位の policy として扱い、各機能の利用可否へ一貫反映する
- billing authority を owner-only とし、admin/staff から契約操作を完全に分離する
- Stripe webhook を冪等・順不同耐性ありの同期パイプラインとして扱う
- trial 終了 3 日前メールと trial 終了時の paid/free 分岐をイベント駆動で扱う

**Important Decisions (Shape Architecture):**
- Web contracts UI を trial-first UX に拡張するが、既存 route / feature structure を維持する
- billing event / notification / entitlement change に監査可能な履歴を残す
- support 向け可視化は MVP では最小 internal visibility にとどめ、専用 UI は後続に送る
- migration は既存 `organization_billing` 拡張を基本とし、別 billing aggregate への全面移行は行わない

**Deferred Decisions (Post-MVP):**
- 複数 paid tier
- self-serve upgrade / downgrade の高度化
- 独自請求書 / 領収書
- in-app billing notifications
- 専用の support/admin billing console

### Data Architecture

**Primary billing aggregate**
- billing aggregate の正本は既存 `organization_billing` テーブルとする
- subscription ownership は `organizationId` に固定し、`classroom` 単位の契約状態は導入しない
- 既存 unique 制約 `organization_billing_organization_uidx` を前提に 1 organization 1 billing row を維持する

**State model decision**
- app 内の論理状態は `free`, `premium_trial`, `premium_paid` を中心に設計する
- Stripe の `trialing`, `active`, `past_due`, `unpaid`, `incomplete`, `canceled` は provider state として保持しつつ、アプリ側 entitlement 判定とは分離する
- つまり `provider subscription status` と `product plan state` を分けて扱う

**Recommended schema direction**
- 既存 `planCode`, `subscriptionStatus`, `billingInterval`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId` は維持する
- trial UX を明確にするため、必要であれば `trialStartedAt`, `trialEndsAt`, `lastStripeEventId`, `lastSyncedAt` のような同期/追跡補助カラムを追加する
- notification / audit 履歴は billing row に詰め込まず、別テーブルで append-only に持つ方針を採る
- 候補:
  - `organization_billing_event`
  - `organization_billing_notification`

**Migration approach**
- 既存 `organization_billing` を拡張する migration を採用する
- 新 billing subsystem への全面再構築は MVP では行わない
- D1 migration は backend deploy と一体で扱う

**Caching strategy**
- billing state は強い整合性優先で、MVP では専用キャッシュ層を導入しない
- 読み取りは DB 正本、更新は webhook/application service 経由で一元化する

### Authentication & Security

**Authentication**
- 認証は既存 Better Auth 基盤をそのまま利用する
- 新しい billing 用 auth provider は追加しない

**Authorization**
- billing authority は `member.role === owner` のみ
- `admin` は契約状態閲覧のみ可、plan/payment 操作不可
- `manager`, `staff`, `participant` は billing 文脈非対象
- billing 判定は既存 authorization の `effective` モデルとは別に、organization ownership と billing policy の組み合わせで行う

**Security middleware**
- Stripe webhook 署名検証を必須とする
- billing action endpoints は session 必須 + organization ownership 必須
- payment details は Stripe-hosted flow に閉じ、アプリでカード情報を保持しない

**Auditability**
- billing state change
- entitlement change
- reminder email send / retry / failure
- resync / manual recovery action
これらは監査対象イベントとして追跡可能にする

### API & Communication Patterns

**API design**
- organization billing 操作は既存 auth routes 配下に残す
- 既存 `/api/v1/auth/organizations/billing`
- 既存 `/api/v1/auth/organizations/billing/checkout`
- 既存 `/api/v1/auth/organizations/billing/portal`
を拡張する方針とする

**Service boundaries**
- route handler に Stripe detail と billing state transition を混在させすぎない
- 次の責務分離を採る
  - route layer: request validation / authz / response shaping
  - billing application service: lifecycle transition rules
  - Stripe adapter/service: Checkout, Portal, webhook payload normalization
  - entitlement policy: premium availability 判定
  - notification service: reminder email scheduling/sending

**Webhook handling**
- webhook は `/api/webhooks/stripe` を継続利用する
- ただし実装上は ticket purchase webhook と organization subscription webhook を責務分離する
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
を organization billing lifecycle の対象イベントとして扱う

**Error handling**
- provider failure と business denial を分ける
- `403` は owner-only denial
- `409` / `422` は trial lifecycle conflict or invalid state
- `5xx` は provider/infrastructure failure
- UI には「何が起きたか」と「次に何をすべきか」を出す

**Rate limiting**
- MVP では billing endpoints に専用 rate-limiter を新設しない
- ただし webhook idempotency と owner-only restrictions で誤更新を防ぐ

### Frontend Architecture

**State management**
- billing UI は既存 `apps/web/src/lib/features/organization-context.svelte.ts` と `contracts/+page.svelte` の延長で実装する
- 新しい global state library は導入しない

**UI architecture**
- contracts page は owner billing workspace として拡張する
- 表示責務:
  - current plan state
  - trial end date
  - payment method registration state
  - reminder context
  - downgrade consequence messaging
- 非owner には read-only state を見せ、操作ボタンは開放しない

**Entitlement UX**
- free vs premium の違いは contracts page だけでなく、対象機能近辺でも説明可能にする
- ただし MVP では full pricing site は不要
- gating UX は “blocked because premium required” を organization context と結びつけて表現する

**Performance**
- contracts page は server-roundtrip を増やしすぎず、既存 organization context の流れで取得する
- entitlement 反映は eventual consistency を許容するが、UI で stale ambiguity を減らす

### Infrastructure & Deployment

**Hosting**
- 現行どおり Cloudflare Workers / D1 / Wrangler を維持する
- billing architecture のために新しい app host は追加しない

**CI/CD**
- backend test と web server test を必須品質ゲートとする
- billing 変更では backend integration test を主、web server/browser test を従に追加する
- mobile は MVP billing の主戦場にしない

**Environment configuration**
- 既存の `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Resend 関連 env を前提にする
- trial reminder で必要な app URL / portal return URL などは environment-driven に統一する

**Monitoring and logging**
- billing webhook processing
- reminder scheduling/sending
- state mismatch detection
- failed conversion path
は構造化ログ対象にする
- Sentry は既存運用を利用し、billing 特有の例外を識別可能にする

**Scaling strategy**
- MVP は cache-heavy architecture にしない
- organization-scoped subscription model を維持したまま通常成長に耐える構成を優先する
- 将来 multi-tier が入っても aggregate 境界を壊さないように設計する

### Decision Impact Analysis

**Implementation Sequence:**
1. `organization_billing` の状態モデルと補助監査/通知モデルを確定する
2. Stripe webhook 正規化と idempotent synchronization を分離実装する
3. owner-only billing application service を定義する
4. premium entitlement policy を organization 単位で定義する
5. contracts UI を trial-first に拡張する
6. reminder email flow と retry/audit を追加する
7. mismatch detection と最小 internal visibility を追加する
8. backend integration tests と web tests で回帰境界を固定する

**Cross-Component Dependencies:**
- plan state model が entitlement policy と contracts UI を決める
- webhook design が reminder/audit/resync strategy を決める
- owner-only authz design が route shape と UI affordance を決める
- migration design が deploy order と test strategy を決める
- notification history design が support visibility の最小要件を決める

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:**
`10` 個の主要衝突点がある。特に AI エージェント間で差が出やすいのは、billing state の置き場所、Stripe event 正規化、entitlement 判定、notification/audit 記録、contracts UI の責務分離である。

### Naming Patterns

**Database Naming Conventions:**
- 既存 D1 / Drizzle 規約を踏襲し、table / column は `snake_case` を使う
- billing 拡張テーブル名は `organization_billing_*` の prefix で grouping する
- 例:
  - `organization_billing_event`
  - `organization_billing_notification`
  - `trial_started_at`
  - `last_stripe_event_id`
- 外部キーは既存通り `{target}_id` 形式に統一する
- index 名は既存の `table_column_idx` / `table_column_uidx` 規約に合わせる

**API Naming Conventions:**
- organization billing API は既存 `/api/v1/auth/organizations/billing*` 配下を維持する
- 新 endpoint を増やす場合も plural REST path を維持する
- query/body field は既存 RPC/JSON 契約に合わせて `camelCase` を使う
- Stripe webhook endpoint は `/api/webhooks/stripe` を継続利用する
- provider event name は Stripe の原名を保持し、内部 event 名は別途 `snake_case` または定数化してもよいが、混線させない

**Code Naming Conventions:**
- Backend:
  - route file: `*-routes.ts`
  - billing service / policy / sync は責務名を含める
  - 例: `organization-billing-service.ts`, `organization-billing-policy.ts`, `organization-billing-sync.ts`
- Web:
  - state/feature logic は `*.svelte.ts`
  - route UI は `+page.svelte`
  - billing 固有 helper は `organization-context.svelte.ts` か billing feature module に寄せる
- 関数名は TypeScript 既存流儀どおり `camelCase`
- 型・schema・payload 名は `OrganizationBilling...` 系で既存命名に寄せる

### Structure Patterns

**Project Organization:**
- billing backend 実装は既存責務分離を尊重する
  - route: `apps/backend/src/routes`
  - payment provider adapter: `apps/backend/src/payment`
  - email sender/template: `apps/backend/src/email`
  - db schema/migration: `apps/backend/src/db` と `apps/backend/drizzle`
- billing domain logic を route handler に埋め込まない
- 推奨分離:
  - route layer
  - billing application service
  - Stripe adapter/normalizer
  - entitlement policy
  - notification recorder/sender

**File Structure Patterns:**
- migration は D1/Drizzle の既存連番フローに従う
- React Email template を追加する場合は `apps/backend/src/email/templates` 配下に置く
- billing test は backend integration test を主とし、純粋関数のみ近接 unit test を許容する
- Web の billing 表示/導線変更は `routes/contracts` と関連 feature spec に閉じる

### Format Patterns

**API Response Formats:**
- 既存レスポンス規約を維持し、成功時は endpoint schema に従う直接 payload、失敗時は既存 `toErrorMessage` で扱える payload を返す
- billing summary payload は既存 `OrganizationBillingPayload` を基準に拡張する
- owner-only denial は `403`
- state conflict / invalid transition は `409` または `422`
- provider/config failure は `5xx`

**Data Exchange Formats:**
- DB は `snake_case`
- API/RPC/TS payload は `camelCase`
- 日時は API では ISO string または既存 payload に合わせた serializable format に統一し、内部 DB は timestamp_ms を維持する
- nullability は曖昧にせず、`free` 状態では `stripeSubscriptionId`, `stripePriceId`, `billingInterval` などを `null` に戻す既存方針を維持する
- product plan state と provider subscription status は別概念として保持する

### Communication Patterns

**Event System Patterns:**
- Stripe raw event は `event.id` を idempotency key として扱う
- 受信 event はまず provider payload を正規化し、その後 billing service に渡す二段構成にする
- 内部で扱うイベントカテゴリ例:
  - `checkout_completed`
  - `subscription_trial_will_end`
  - `subscription_status_changed`
  - `billing_resynced`
  - `reminder_send_requested`
  - `reminder_send_succeeded`
  - `reminder_send_failed`
- internal event/audit payload には少なくとも次を含める
  - `organizationId`
  - `stripeCustomerId?`
  - `stripeSubscriptionId?`
  - `providerEventId?`
  - `previousState`
  - `nextState`
  - `occurredAt`

**State Management Patterns:**
- entitlement 判定は UI ローカル状態から導出しない
- backend billing state を正本とし、Web はその結果を表示する
- `hasActivePremiumSubscription` のような provider status helper と、premium capability 可否判定 helper は分離する
- state transition は ad hoc に散らさず、一箇所の billing service/policy を通す
- Web は loading/error/success の扱いを既存 feature helper パターンに揃える

### Process Patterns

**Error Handling Patterns:**
- Stripe API failure, webhook verification failure, invalid lifecycle transition, owner-only denial を別カテゴリとして扱う
- Resend 送信失敗は silent ignore せず、retry 対象として記録する
- user-facing message と internal diagnostic message を分離する
- webhook handler は一時失敗で全体 state を壊さず、再試行可能性を残す

**Loading State Patterns:**
- contracts page の loading は route/page 単位で扱い、ボタン単位の `busy` state を既存実装どおり併用する
- redirect action 中は二重送信を防ぐ
- stale な billing 反映を UI で誤解させないよう、checkout success 後は「反映まで数秒かかる場合があります」のような中間メッセージを維持/改善する

### Enforcement Guidelines

**All AI Agents MUST:**
- `organization_billing` を organization 単位課金の正本として扱い、classroom 単位契約を導入しない
- owner-only billing authority を backend と web の両方で強制する
- premium entitlement 判定を provider status の単純分岐にせず、明示的 policy を通して実装する
- webhook 処理を冪等・順不同耐性ありで実装する
- billing reminder / audit / sync を append-only 履歴で追跡可能にする
- 既存 route / feature / payment / email 分離を壊さない

**Pattern Enforcement:**
- backend integration test で lifecycle, webhook duplicate, downgrade, owner-only denial を固定する
- web server/browser test で contracts page の表示分岐と read-only/owner action 差分を固定する
- PR レビューでは「state transition が一箇所に集約されているか」を確認する
- pattern 違反は architecture doc を先に更新してから例外導入する

### Pattern Examples

**Good Examples:**
- Stripe raw payload を route/app 層で直接 DB に書かず、正規化 helper + billing service を経由する
- `subscriptionStatus = trialing` と `planCode = premium` をそのまま entitlement の唯一条件にせず、trial period や payment method 状態も含む policy を通す
- `organization-context.svelte.ts` に billing fetch/action helper を置き、`contracts/+page.svelte` は UI 表示に集中する
- email send 結果を warning だけで終わらせず、再試行可能な履歴に残す

**Anti-Patterns:**
- webhook handler の中で各 event ごとに ad hoc に `organization_billing` を更新する
- admin UI 側でボタンを隠すだけで backend 側 owner-only check を省略する
- premium gating を各 route/page で個別の if 文にばらまく
- Stripe status 文字列を UI, backend, tests でそれぞれ別解釈する
- migration なしで billing schema 前提コードだけ先に変える

## Project Structure & Boundaries

### Complete Project Directory Structure

```text
reserve-app/
├── _bmad-output/
│   └── planning-artifacts/
│       ├── prd.md
│       ├── architecture.md
│       └── implementation-readiness-report-2026-04-08.md
├── docs/
│   ├── README.md
│   ├── architecture.md
│   ├── authorization.md
│   ├── database-er.md
│   ├── test-strategy.md
│   └── research/
│       ├── main.md
│       ├── coupon.md
│       └── organization.md
├── apps/
│   ├── backend/
│   │   ├── drizzle/
│   │   │   ├── 0012_organization_billing.sql
│   │   │   └── 00xx_billing_trial_lifecycle.sql
│   │   └── src/
│   │       ├── app.ts
│   │       ├── app.test.ts
│   │       ├── db/
│   │       │   └── schema.ts
│   │       ├── routes/
│   │       │   ├── auth-routes.ts
│   │       │   ├── booking-routes.ts
│   │       │   └── public-routes.ts
│   │       ├── payment/
│   │       │   ├── stripe.ts
│   │       │   ├── organization-billing-service.ts
│   │       │   ├── organization-billing-policy.ts
│   │       │   ├── organization-billing-sync.ts
│   │       │   └── organization-billing-types.ts
│   │       └── email/
│   │           ├── resend.ts
│   │           └── templates/
│   │               └── organization-billing-reminder-email.tsx
│   ├── web/
│   │   └── src/
│   │       ├── routes/
│   │       │   └── contracts/
│   │       │       ├── +page.server.ts
│   │       │       ├── +page.svelte
│   │       │       └── page.svelte.spec.ts
│   │       └── lib/
│   │           ├── features/
│   │           │   ├── organization-context.svelte.ts
│   │           │   └── organization-billing.svelte.ts
│   │           ├── remote/
│   │           ├── components/
│   │           └── rpc-client.ts
│   └── mobile/
│       └── src/
│           └── lib/
│               ├── auth-client.ts
│               ├── mobile-api.ts
│               ├── gesture-root.tsx
│               └── ui.tsx
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### Architectural Boundaries

**API Boundaries:**
- owner-facing billing API は `apps/backend/src/routes/auth-routes.ts` 配下に残す
- Stripe ingress は `apps/backend/src/app.ts` の `/api/webhooks/stripe` を継続利用する
- Web は Stripe と直接通信せず、backend から redirect URL を受け取る
- Mobile は MVP の billing management を持たない

**Component Boundaries:**
- `contracts/+page.svelte` は presentation と interaction に限定する
- web 側の fetch/action helper は `organization-context.svelte.ts` か billing feature module に集約する
- premium gating の説明 UI は backend 由来 state を表示するだけに留める

**Service Boundaries:**
- `auth-routes.ts`: validation / authz / response shaping
- `organization-billing-service.ts`: trial 開始、paid 移行、free 戻し
- `organization-billing-policy.ts`: entitlement 判定
- `organization-billing-sync.ts`: webhook reconciliation / resync
- `stripe.ts`: provider API, signature verify, payload normalize
- `resend.ts` + reminder template: email delivery と送信結果記録

**Data Boundaries:**
- `db/schema.ts` をテーブル定義の正本にする
- `organization_billing` を aggregate root にする
- 新規 billing history テーブルは append-only とする
- booking / invitation / participant / classroom は billing state の consumer であり owner ではない

### Requirements to Structure Mapping

**Feature / FR Mapping:**
- Plan & Eligibility Management: backend policy + auth routes + contracts UI
- Trial Lifecycle: billing service + sync + migration
- Billing Authority & Access Control: auth routes + owner-only checks + contracts UI
- Payment Method & Paid Conversion: Stripe adapter + billing service + contracts flow
- Notifications & Billing Communication: resend + reminder template + notification history
- Billing State Synchronization & Reliability: webhook ingress + sync service + backend integration tests
- Support & Internal Operations: 最小 internal visibility + audit/event history
- Premium Capability Gating: backend policy + web explanatory UX + existing operational modules

**Cross-Cutting Concerns:**
- owner-only authority: backend route checks + web button exposure rules
- Stripe/app reconciliation: `app.ts` + sync service
- auditability: schema + history tables + structured logs
- reminder reliability: resend integration + retry-aware recording
- test enforcement: backend integration first, web route/feature tests second

### Integration Points

**Internal Communication:**
- Web route -> feature helper -> RPC client -> backend auth route
- Backend auth route -> billing service -> Stripe adapter / policy / DB
- Stripe webhook -> app ingress -> sync service -> billing aggregate update
- Billing service -> email sender -> notification history append

**External Integrations:**
- Stripe Checkout Session
- Stripe Billing Portal Session
- Stripe subscription lifecycle webhooks
- `customer.subscription.trial_will_end`
- Resend owner reminder email
- Cloudflare Workers / D1 / Wrangler

**Data Flow:**
1. Owner opens contracts page
2. Web loads organization billing summary
3. Owner starts trial or payment registration
4. Backend creates Stripe Checkout/Portal session
5. Stripe emits lifecycle events
6. Webhook normalizes and reconciles into `organization_billing`
7. Billing policy updates entitlement
8. Web and backend-gated features reflect organization state
9. Reminder email flow runs before trial end and records send outcome

### File Organization Patterns

**Configuration Files:**
- billing env namesは既存 README / env example に追記し、別文書へ分散させない
- migration は `apps/backend/drizzle` に置く

**Source Organization:**
- billing domain code は backend `payment/` に寄せる
- route schema は既存どおり `auth-routes.ts` に置き、必要になれば billing route file を後続で分割する
- web billing helper は `lib/features` に置き、MVP では `lib/remote` へ寄せない

**Test Organization:**
- backend lifecycle test は `apps/backend/src/app.test.ts` を主戦場にする
- 純粋関数だけ近接 unit test を許容する
- web billing UI 回帰は `apps/web/src/routes/contracts/page.svelte.spec.ts`

**Asset Organization:**
- reminder email template は backend email templates 配下に置く
- MVP で専用 billing asset bucket は作らない

### Development Workflow Integration

**Development Server Structure:**
- 既存 `pnpm --filter @apps/backend dev` と `pnpm --filter @apps/web dev` を継続利用する
- sidecar billing service は導入しない

**Build Process Structure:**
- backend と web を MVP billing delivery の対象にする
- schema change は既存 D1 migration 流れに乗せる
- backend/web 間に新たな build-time dependency を作らない

**Deployment Structure:**
- billing API shape 変更時は `backend -> web` の順で deploy する
- webhook, migration, UI assumptions は既存 deploy order に合わせる

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
既存 monorepo、Cloudflare Workers + Hono backend、SvelteKit web、Expo mobile という現行構成と整合している。  
`organization_billing` を正本に維持しつつ trial-first lifecycle を重ねる設計は、既存 contracts UI、Stripe Checkout / Portal、Webhook 処理と矛盾しない。  
provider state と product plan state を分離したことで、Stripe status と premium entitlement 判定を混同しない構成になっている。

**Pattern Consistency:**
- route / service / adapter / policy 分離
- owner-only authority の backend/web 両側 enforcement
- append-only な billing 履歴・通知履歴
- webhook の冪等・順不同耐性
- read-only / actionable state の UI 分離

**Structure Alignment:**
backend に billing domain/service/sync を追加し、web は `contracts` と feature helper を拡張する構成は、現状コードベースの境界と一致している。  
mobile を MVP billing 管理の主責務から外した点も、現在のテスト戦略と UI 責務分担に整合している。

### Requirements Coverage Validation ✅

**Feature Coverage:**
- Plan & Eligibility Management: `organization_billing` + entitlement policy
- Trial Lifecycle: billing service + sync + migration
- Billing Authority & Access Control: auth route + owner-only checks + contracts UI
- Payment Method & Paid Conversion: Stripe adapter + billing service + contracts flow
- Notifications & Billing Communication: resend integration + reminder template + notification history
- Billing State Synchronization & Reliability: webhook ingestion + sync service + app tests
- Support & Internal Operations: internal visibility, audit/event history, structured logs
- Premium Capability Gating: backend policy + web explanatory UX + existing operational modules

**Functional Requirements Coverage:**
`FR1` から `FR49` までの受け皿は architecture component 上に用意されている。  
Post-MVP FR も deferred decision と future structure の中で扱える。

**Non-Functional Requirements Coverage:**
- Performance: contracts page / action latency / eventual consistency target を反映済み
- Security: owner-only, webhook verification, payment-detail non-retention, auditability を反映済み
- Reliability: retry, duplicate/out-of-order tolerance, safe resync を反映済み
- Accessibility: billing/status flows の基本 accessibility を反映済み
- Integration: Stripe + email only の MVP 境界を反映済み
- Scalability: organization-scoped aggregate を維持しつつ将来 tier expansion を阻害しない

### Implementation Readiness Validation ✅

**Decision Completeness:**
critical decisions は十分に明文化されている。特に次が固定された。
- plan state vs provider state
- owner-only authority
- webhook normalization vs lifecycle transition
- entitlement policy centralization
- append-only audit/notification recording

**Structure Completeness:**
project structure は file/directory レベルまで十分に定義されている。  
backend 側の billing code 配置と、web 側の contracts / feature helper の延長方針が明確である。

**Pattern Completeness:**
AI agent conflict を起こしやすい naming / structure / format / event / process pattern は一通り定義済みである。

### Gap Analysis Results

**Critical Gaps:**
- なし

**Important Gaps:**
- `customer.subscription.trial_will_end` と notification history / retry policy の実装詳細は story/implementation で詰める必要がある
- premium entitlement をどの route / operation から順に適用するかは epic/story breakdown で優先順位化が必要
- minimal internal visibility を UI にするか log/query ベースにするかは implementation planning で具体化が必要

**Nice-to-Have Gaps:**
- support console の将来像
- billing event taxonomy の細分化
- trial/premium comparison UI の詳細コピー・UX spec
- future multi-tier 拡張の plan catalog 戦略

### Validation Issues Addressed

- Starter ambiguity: 既存 monorepo baseline を正式な architectural foundation にした
- Brownfield ambiguity: 既存 billing 実装を捨てずに進化させる方針を固定した
- State ambiguity: provider subscription status と product plan state を分離した
- Authority ambiguity: owner-only billing authority を backend/web 両方で固定した
- Structure ambiguity: backend/payment, backend/email, web/contracts, web/features の責務境界を明確化した

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**
- [x] Critical decisions documented
- [x] Baseline technology stack confirmed
- [x] Integration patterns defined
- [x] Performance and reliability considerations addressed

**✅ Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- brownfield 制約を正面から扱っている
- billing source of truth と entitlement policy の境界が明確
- owner-only, webhook sync, auditability という高リスク領域が明文化されている
- AI agent が衝突しやすい責務分離と命名規約が固定されている
- backend/web/test/deploy 順序まで含めて handoff しやすい

**Areas for Future Enhancement:**
- support/admin visibility の専用 UI
- multi-tier plan 拡張
- richer pricing/comparison UX
- invoice/receipt and in-app billing notification support

### Implementation Handoff

**AI Agent Guidelines:**
- Follow the architecture document as the single source of truth for billing implementation
- Treat `organization_billing` as the aggregate root for organization-scoped billing
- Keep billing lifecycle transitions centralized
- Do not spread entitlement rules across routes/pages ad hoc
- Enforce owner-only authority in both backend and web
- Add tests at the backend integration boundary first

**First Implementation Priority:**
`organization_billing` lifecycle を trial-first に拡張する schema + service + webhook synchronization の実装を最初の優先事項とする。
