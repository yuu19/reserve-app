# pnpm + Turborepo モノレポ

このリポジトリは `pnpm` と `turborepo` を使ったモノレポ構成です。

## docs の見方

ルート直下の `docs/` は、現行仕様、運用・検証、履歴・計画、調査メモを分けて置く入口です。
現行挙動を確認するときは、履歴・計画メモではなく「現行仕様」と「課金」「AI」の文書を優先してください。

### 現行仕様

- [architecture.md](./current/architecture.md): 組織、店舗、参加者、招待、公開予約の全体構成。
- [authorization.md](./current/authorization.md): 組織、店舗、参加者の認可モデル。
- [reserve-app-mvp.md](./current/reserve-app-mvp.md): 公開予約 MVP の実装状況と残作業。
- [form-management-mvp.md](./current/form-management-mvp.md): フォーム管理機能の MVP 仕様。
- [saas-landing-page.md](./current/saas-landing-page.md): SaaS ランディングページの情報設計、コピー、CTA 方針。
- [database-er.md](./current/database-er.md): DB の概要と簡略 ER。
- [database-er-reference.html](./current/database-er-reference.html): 現行 DB のテーブル定義、リレーション、静的 ER 図。

### 運用・検証

- [test-strategy.md](./operations/test-strategy.md): テスト方針と CI の扱い。
- [playwright-report-r2.md](./operations/playwright-report-r2.md): Playwright レポート公開の運用。
- [cloudflare-access-development-sites.md](./operations/cloudflare-access-development-sites.md): 開発中の Web アプリとドキュメントを Cloudflare Access で制限する運用。
- [billing-verification-checklist.md](./operations/billing-verification-checklist.md): 課金確認のチェックリスト。
- [ai-agent-billing-verification.md](./operations/ai-agent-billing-verification.md): AI agent で課金確認を補助する場合の運用ガイド。
- [billing-test-clock-scenarios.md](./operations/billing-test-clock-scenarios.md): Billing API の Test Clock scenario を internal operator が使うための Phase 1 仕様。

### AI

- [ai-chat-reusable-architecture.md](./ai/ai-chat-reusable-architecture.md): 現行 AI チャットの責務境界。
- [AI チャットの公開マニュアル](../apps/docs/src/routes/manuals/common/ai-chatbot/+page.md): 利用者向けの操作説明。
- [AI Chatbot quickstart](../specs/004-ai-chatbot/quickstart.md): Speckit 由来の確認手順。

### 課金

- [billing.md](./billing/billing.md): 現行の組織単位課金仕様。
- [addon-specification.md](./billing/addon-specification.md): Premium addon の商品、数量変更、API、Stripe、監査、検証仕様。
- [shared-billing-api-architecture.md](./billing/shared-billing-api-architecture.md): Billing API の責務境界と同期アーキテクチャ。
- [plans/billing-api-maintainability.md](./billing/plans/billing-api-maintainability.md): Billing API と接続境界の保守性改善計画。実装完了までは現行仕様として扱わない。
- [plans/billing-api-maintainability-cutover-runbook.md](./billing/plans/billing-api-maintainability-cutover-runbook.md): 保守性改善計画の開発／preview環境向け切替手順。実装前は実行しない。
- [assets/billing-payment-flow.mmd](./billing/assets/billing-payment-flow.mmd): 課金フロー図の Mermaid ソース。
- [assets/billing-payment-flow.svg](./billing/assets/billing-payment-flow.svg): 課金フロー図。

### 履歴・計画

ここにある文書は、現行仕様の正本ではありません。
過去の計画、再利用化検討、移行メモとして読み、現行挙動は上の現行仕様文書で確認してください。

- [stripe-reusable.md](./history/stripe-reusable.md): Stripe 課金再利用化の旧実行計画。
- [stripe-reusable-v2.md](./history/stripe-reusable-v2.md): Billing v2 移行手順の旧メモ。
- [billing-schema-reuse-plan-db-per-saas.md](./history/billing-schema-reuse-plan-db-per-saas.md): SaaS 別 DB で課金 schema を使い回す検討。
- [directory-structure.md](./history/directory-structure.md): backend ディレクトリ再編の検討。
- [reserve-app-ai-chatbot-reusable-plan.md](./history/reserve-app-ai-chatbot-reusable-plan.md): AI チャット再利用化の旧実行計画。
- [ai-chat-proposal.md](./history/ai-chat-proposal.md): AI チャット初期提案と追記メモ。
- [wysiwyg-editor-introduction-proposal.md](./history/wysiwyg-editor-introduction-proposal.md): 予約サイト説明と同意事項本文への WYSIWYG エディタ導入案。

### 調査メモ

- [research/main.md](./research/main.md)
- [research/coupon.md](./research/coupon.md)
- [research/organization.md](./research/organization.md)
- [個人開発のスクール・教室向け予約管理サイト 競合調査とトップページ要件抽出.pdf](./research/個人開発のスクール・教室向け予約管理サイト%20競合調査とトップページ要件抽出.pdf)

## 現在の移行ステータス（2026-06-02）

- Backend/DB は `organization + store` の2階層へ移行済みです。予約ドメインの主要データは `store_id` を持ちます。
- 公開予約ページと公開予約 API は、`/{orgSlug}/{storeSlug}` と `/api/v1/public/orgs/{orgSlug}/stores/{storeSlug}` を正として店舗を解決します。
- 管理・参加者画面は、組織と店舗のスコープ付き URL を基本導線にしています。
- 認証済みの予約 API は `/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}` 配下を正として店舗を解決します。公開イベント導線も `/{orgSlug}/{storeSlug}/events` 配下だけを提供します。
- 店舗公開サイトは `public_site_setting` で公開状態、予約受付、検索除外を管理します。
- サービス単位の公開制御は `service.public_status` で管理します。`public`、`private`、`suspended` を扱い、公開ページの表示と予約可否に反映します。
- 枠単位の公開制御は `slot.public_status` で管理します。単発予約枠ごとに公開中、非公開、受付停止を扱えます。
- 組織単位課金の正本は [billing.md](./billing/billing.md) です。AI チャットの責務境界は [ai-chat-reusable-architecture.md](./ai/ai-chat-reusable-architecture.md) です。

## アプリ構成

- `apps/backend`: Hono（Cloudflare Workers + D1 / ローカル Miniflare）
- `apps/web`: SvelteKit（Cloudflare Workers）
  - 参加者管理画面で回数券種別作成・回数券付与に対応
  - 予約画面でマイ回数券表示（active/exhausted/expired）と現地決済・銀行振込の購入申請に対応
  - サービス作成時の `requiresTicket` UI 設定に対応
  - 管理側 3 作成フォーム（サービス/単発/定期）で必須表示・sticky 主要アクション・送信不可理由表示を統一
  - 単発作成で `日付1つ + 終了日トグル` と時刻整合性チェック（終了<=開始の送信防止）に対応
- `apps/mobile`: React Native (Expo)
  - EAS Build による実機インストール対応

## 使用技術一覧

- モノレポ: `pnpm`, `Turborepo`
- バックエンド:
  - `Hono`
  - `Better Auth`（メール/パスワード、Google OIDC、organization plugin、Expo plugin）
  - `Drizzle ORM`
  - `Cloudflare Workers`, `Cloudflare D1`
  - `Miniflare`（ローカル D1）
  - `@hono/zod-openapi`, `Swagger UI`
  - `Resend`（招待メール送信）
- Web:
  - `SvelteKit`（Svelte 5）
  - `hono/client`（RPC 接続）
  - `shadcn-svelte`
  - `svelte-sonner`
- 監視:
  - `Sentry`（Web / Backend 分離運用、低サンプルTracing）
- モバイル:
  - `React Native`, `Expo`
  - `Better Auth` + `@better-auth/expo`
  - `NativeWind`
  - `HeroUI Native`
- テスト / 品質:
  - `TypeScript`
  - `ESLint`, `Prettier`
  - `Vitest`
- CI/CD:
  - `GitHub Actions`
  - `Wrangler`（Cloudflare Workers デプロイ）

## セットアップ

```bash
pnpm install
```

## 開発

```bash
# 全アプリの dev タスクを並列実行
pnpm dev
```

個別実行:

```bash
pnpm --filter @apps/backend dev
pnpm --filter @apps/web dev
pnpm --filter @apps/mobile dev
```

## 品質チェック

```bash
pnpm typecheck
pnpm lint
pnpm format:check
```

## ビルド

```bash
pnpm build
```

`build` は現在 `backend` と `web` が対象です。

## テスト

```bash
pnpm test
pnpm test:watch
```

- `backend`: Vitest
- `web`: Vitest（server project）
- `mobile`: テスト未設定（要件どおり）

## GitHub Actions によるテストCI

`pull_request` と `main` への push で、backend + web(server) のテストを実行します。  
ワークフロー: `.github/workflows/ci-tests.yml`

- 実行対象:
  - `pnpm --filter @apps/backend test`
  - `pnpm --filter @apps/web test`
- web client/browser（Playwright）テストは対象外（次フェーズ）

ブランチ保護で必須チェックにする手順:

1. GitHub の `Settings > Branches > Branch protection rules` を開く
2. 対象ブランチ（例: `main`）のルールを編集
3. `Require status checks to pass before merging` を有効化
4. `CI Tests / test` を Required status checks に追加

## Cloudflare Workers デプロイ

```bash
# Billing API (remote D1 migration -> Worker deploy)
pnpm deploy:billing-api

# backend (remote D1 migration -> Worker deploy)
pnpm deploy:backend

# web
pnpm deploy:web

# docs
pnpm deploy:docs

# Billing API -> backend -> web -> docs を順番に実行
pnpm deploy:workers
```

## GitHub Actions による自動デプロイ

`main` ブランチへの push（または手動実行）で、本番の `Billing API` / `backend` / `web` / `docs` を毎回まとめてデプロイします。
ワークフロー: `.github/workflows/deploy-workers.yml`

デプロイ前に次の検証を必ず実行します。

- Billing API の test / typecheck / build
- backend 統合テスト
- web server test
- Billing API / backend / web / docs の production build

通常の Worker 環境変数は各 app の `wrangler.jsonc` を正とします。
GitHub Actions は Cloudflare secrets の同期、D1 migration、Sentry release 注入、Worker デプロイを担当します。

GitHub シークレット:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `BETTER_AUTH_SECRET`
- `RESEND_FROM_EMAIL`
- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SENTRY_DSN_BACKEND`
- `SENTRY_AUTH_TOKEN`（web sourcemap upload 用）

任意の GitHub シークレット:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SERVICE_IMAGE_UPLOAD_SIGNING_SECRET`

GitHub 変数:

- `SENTRY_ORG`
- `SENTRY_PROJECT_WEB`
- `PUBLIC_SENTRY_DSN_WEB`
- `PUBLIC_SENTRY_ENVIRONMENT`

補足:

- Billing API デプロイ前に Billing API D1 migration を、backend デプロイ前に backend D1 migration を実行します。
- deploy job では `Billing API -> backend -> web -> docs` の順に反映します。
- backend の `SENTRY_RELEASE` と web の `PUBLIC_SENTRY_RELEASE` は commit SHA を使います。
- web デプロイ前ビルドで Sentry sourcemap upload を実行します。
- Stripe webhook は `POST /api/webhooks/stripe` で受け付けます（`STRIPE_WEBHOOK_SECRET` 必須）。
- 回数券購入のアプリ内 Stripe 決済は、将来の Stripe Connect 対応まで保留です。現在は現地決済・銀行振込の承認フローのみ利用できます。
- カスタムドメイン運用時は以下の値を推奨します。
  - Prod: `BETTER_AUTH_URL=https://api.wakureserve.com`, `PUBLIC_BACKEND_URL=https://api.wakureserve.com`, `BETTER_AUTH_COOKIE_DOMAIN=.wakureserve.com`
  - Staging: `BETTER_AUTH_URL=https://api.stg.wakureserve.com`, `PUBLIC_BACKEND_URL=https://api.stg.wakureserve.com`, `BETTER_AUTH_COOKIE_DOMAIN=.stg.wakureserve.com`
  - 現在の実運用は prod のみ適用済みで、staging は将来別 Worker で構築予定です。
- docs の本番公開 URL は `https://docs.wakureserve.com` を想定しています。
- backend の `database_id` は、事前に `apps/backend/wrangler.jsonc` に設定してください。

### AI チャットの公開マニュアルを更新した場合

公開マニュアルは RAG のナレッジにも使います。
`apps/docs/src/routes/manuals/common/ai-chatbot/+page.md` を更新した場合は、main 反映後の Worker デプロイ完了を確認してから、対象ページだけを再投入します。

```bash
pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --dry-run --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
CF_AI_GATEWAY_TOKEN=... WRANGLER_CLOUDFLARE_API_TOKEN=... pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --apply --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
```

dry-run はリモート D1、Vectorize、Workers AI を更新しません。
apply は本番 D1 と Vectorize を更新し、同じ source path の古い chunk を stale として扱います。

### Premium 課金を含むデプロイ順

Premium 課金の変更を含む場合は、先に D1 migration を適用してから backend をデプロイします。
今回の課金強化では、既存の組織契約行を保持したまま、支払い問題、請求書参照、操作履歴、照合結果を保存する列と append-only table を追加します。

backend の後に web をデプロイします。
web は課金操作の共通レスポンス、支払い問題の状態、請求書・領収書の参照状態を利用します。

本番反映前に、Stripe Dashboard で次の状態を確認します。

- 月額と年額の Premium Price が環境変数と一致していること
- Customer Portal が契約管理と支払い方法更新に使えること
- Webhook endpoint が `checkout.session.completed`、`customer.subscription.*`、`invoice.*` の必要イベントを受け取れること
- `STRIPE_WEBHOOK_SECRET` が対象 endpoint の signing secret と一致していること
- owner 向け課金通知メールを検証する環境では Resend の送信元が有効であること
- Cloudflare scheduled trigger が対象限定照合と日次全体照合を実行できること

詳細な設定手順:

- backend: `apps/backend/README.md`
- docs: `apps/docs/README.md`
- web: `apps/web/README.md`
