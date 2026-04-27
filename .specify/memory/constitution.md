<!--
Sync Impact Report
Version change: 1.0.0 -> 1.0.1
Modified principles:
- Principle I を Existing Architecture 表現へ改称
Added sections: Core Principles; Project Constraints; Development Workflow and Quality Gates; Governance
Removed sections: なし
Templates requiring updates:
- ✅ updated: .specify/templates/plan-template.md
- ✅ updated: .specify/templates/spec-template.md
- ✅ updated: .specify/templates/tasks-template.md
- ✅ reviewed: .specify/templates/agent-file-template.md
- ✅ reviewed: .specify/templates/checklist-template.md
- ✅ reviewed: .specify/templates/commands/ は存在しない
Runtime guidance reviewed:
- ✅ reviewed: _bmad-output/project-context.md
- ✅ reviewed: AGENTS.md
- ✅ reviewed: docs/README.md
- ✅ reviewed: docs/architecture.md
- ✅ reviewed: docs/authorization.md
- ✅ reviewed: docs/test-strategy.md
- ✅ reviewed: DESIGN.md
Follow-up TODOs: なし
-->

# reserve-app Constitution

## Core Principles

### I. Existing Architecture を正本として拡張する

すべての変更は既存の pnpm/Turborepo モノレポ、Cloudflare Workers + Hono backend、
SvelteKit web、Expo mobile、Better Auth、Drizzle ORM、Cloudflare D1、Stripe、
Resend、Sentry の構成を前提に MUST 設計する。既存の app/module 境界、
`.js` 拡張子付き ESM import、Web の Remote Functions 段階移行、旧互換経路は
明示的な移行計画なしに置換してはならない。理想形への全面リライト、大規模整形、
責務再編は feature 実装に混ぜてはならない。

Rationale: 段階移行中の互換経路を壊す変更は、ユーザー導線と運用を同時に
破壊するため。

### II. Type Safety と API Boundary を緩めない

TypeScript strict を前提に、`any`、過剰な型アサーション、未検証の外部入力で問題を
隠してはならない。外部 API、`fetch` response、session、DTO、DB 由来の可変値は
`unknown` として受け、type guard、Zod、既存の parse helper、domain union、
正規化関数で絞り込んでから利用する MUST がある。role、status、source、billing state
などのドメイン語彙は docs と既存コードの用語を正本とし、似た別名を増殖させてはならない。

Rationale: API shape と権限・課金状態の誤判定は運用データ破壊につながるため、
境界での検証と語彙の一貫性を品質ゲートにする。

### III. Authorization と Scope の正本を守る

認可は `organization` と `classroom` の 2 階層を正本とし、`facts -> effective ->
sources -> display` の構造を MUST 維持する。サーバとクライアントの権限制御は
`effective` capability を根拠にしなければならず、`display.primaryRole` や badges を
判定に使ってはならない。booking domain の新規データと新規 API は `classroom_id`
必須運用を落としてはならない。Web/Mobile は同じ access-tree DTO と unified invitation
DTO を消費し、片方だけ独自 shape に分岐してはならない。

Rationale: organization-wide responsibility、classroom operation、participant access を
混同すると、管理権限と参加者導線の境界が破綻するため。

### IV. Risk-Based Verification を完了条件にする

実装完了の判断はコード作成ではなく、影響レイヤーの test、typecheck、lint、
必要な手動確認が揃った時点でのみ成立する。認可、招待、予約、D1 migration、
API response shape、UI の表示分岐、billing lifecycle、Stripe/webhook processing、
bug regression を変更する場合、対応する regression test を MUST 追加または更新する。
backend は API レベルの統合テストを優先し、web は feature/remote server test と
必要な browser test を選定する。mobile 変更では自動テスト未整備を理由に smoke test を
省略してはならない。

Rationale: このリポジトリのリスクは網羅率ではなく、認可・予約・課金・主要導線の
境界回帰として現れるため。

### V. Data, Billing, Deployment Safety を監査可能にする

D1 schema、migration、billing aggregate、Stripe webhook、subscription lifecycle、
premium entitlement、notification history、audit/reconciliation signal を扱う変更は、
既存データ互換、冪等性、順不同耐性、失敗時の recovery path、append-only auditability を
MUST 明示する。`organization_billing` を billing aggregate の正本として扱い、webhook event、
notification、audit/signal 系の append-only tables を診断可能性のために維持する。
deploy や infra 変更では `docs/README.md` と各 app README の順序、環境変数、
Cloudflare/Stripe/Resend/Sentry の設定名を推測で変更してはならない。

Rationale: 課金と migration は失敗時の復旧コストが高く、成功状態だけではなく
観測・再処理・説明可能性が必要なため。

### VI. User-Facing UI は DESIGN.md と Accessibility を正本にする

ユーザーに見える UI を変更する場合、色、タイポグラフィ、spacing、component behavior は
`DESIGN.md` を MUST 正本とする。`preview.html` は実装イメージ確認には使えるが、
仕様の原典にしてはならない。状態、操作、エラー、成功、不可理由は色だけに依存せず、
テキスト、構造、フォーカス、無効理由、アクセシブルなラベルで伝える MUST がある。

Rationale: 業務 UI は高密度で状態が多く、視覚差分だけの表現は誤操作とサポート負荷を
増やすため。

## Project Constraints

- Monorepo tooling は `pnpm 10.27.0` と `Turborepo 2.5.8` を前提にする。
- Backend は Cloudflare Workers + Hono + Better Auth + Drizzle ORM + Cloudflare D1 を
  前提にし、API contract は Zod と `@hono/zod-openapi` に合わせる。
- Web は SvelteKit + Svelte 5 + Vite を前提にし、Remote Functions は段階移行中として
  `authRpc` との共存を維持する。
- Mobile は Expo + React Native + Better Auth + NativeWind/HeroUI Native を前提にする。
- Web は tabs、backend/mobile は spaces の既存 formatting を維持する。
- 新規 dependency、runtime service、deployment step は feature plan で理由、影響範囲、
  rollback または代替案を明示した場合のみ導入できる。

## Development Workflow and Quality Gates

- Feature specification は user story ごとの独立検証、scope boundary、認可影響、
  data/migration 影響、UI/design system 影響を明示する MUST がある。
- Implementation plan は Constitution Check を Phase 0 前と Phase 1 後に通過する MUST がある。
  違反がある場合は Complexity Tracking に理由と却下した単純案を記録する。
- Tasks は user story 単位で独立実装・独立検証できる粒度に分割し、同一ファイル競合や
  cross-story dependency を隠してはならない。
- 通常の検証コマンドは `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、
  `pnpm test` を基準にし、app 単位では `pnpm --filter @apps/backend ...`、
  `pnpm --filter @apps/web ...`、`pnpm --filter @apps/mobile ...` を使う。
- CI 必須対象は backend test と web server test であり、browser test と mobile smoke は
  影響範囲に応じて feature 完了条件へ明示的に追加する。

## Governance

この Constitution は reserve-app の feature planning、implementation、review における
最上位の開発規約である。矛盾がある場合、より具体的な運用手順は docs/README.md、
docs/architecture.md、docs/authorization.md、docs/test-strategy.md、各 app README に従うが、
Constitution の MUST を弱める解釈はできない。

Amendments MUST include:
- 変更理由と影響する principle または section
- version bump 種別と根拠
- 影響を受ける `.specify/templates/*`、runtime guidance、README/docs の同期結果
- 既存 feature artifacts への migration または適用不要の理由

Versioning policy:
- MAJOR: 原則の削除、互換性のない再定義、既存品質ゲートの弱体化
- MINOR: 新 principle/section の追加、既存 principle の実質的な拡張
- PATCH: 説明の明確化、誤字修正、非意味的な表現整理

Compliance review:
- `speckit.plan` は Constitution Check を通じて全 principle の適合を確認する MUST がある。
- `speckit.specify` と `speckit.tasks` は認可、data、testing、UI、deployment の影響を
  artifact に残す MUST がある。
- Code review では、実装が Constitution に違反する場合、テストが通っていても
  changes requested とする MUST がある。

**Version**: 1.0.1 | **Ratified**: 2026-04-27 | **Last Amended**: 2026-04-27
