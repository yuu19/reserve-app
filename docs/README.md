# pnpm + Turborepo モノレポ

このリポジトリは `pnpm` と `turborepo` を使ったモノレポ構成です。

## 設計ドキュメント

- [architecture.md](./architecture.md)
- [authorization.md](./authorization.md)
- [billing.md](./billing.md)
- [database-er.md](./database-er.md)
- [test-strategy.md](./test-strategy.md)

## 現在の移行ステータス（2026-03）

- Backend/DB は `organization + classroom` の2階層へ移行済み（`classroom_id` 必須）。
- 認可/招待/Public Events API は classroom スコープ API を導入済み。
- booking API / 一部Webルートは段階移行中（互換エンドポイントを一時併用）。
- Mobile は access/invitation DTO の新モデルに追従済み。自動テストは未設定。

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
# backend
pnpm deploy:backend

# web
pnpm deploy:web

# docs
pnpm deploy:docs

# backend -> web -> docs を順番に実行
pnpm deploy:workers
```

## GitHub Actions による自動デプロイ

`main` ブランチへの push（または手動実行）で、本番の `backend` / `web` / `docs` を毎回まとめてデプロイします。
ワークフロー: `.github/workflows/deploy-workers.yml`

デプロイ前に次の検証を必ず実行します。

- backend 統合テスト
- web server test
- backend / web / docs の production build

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

- backend デプロイ前に `wrangler d1 migrations apply --remote` を実行します。
- deploy job では `backend -> web -> docs` の順に反映します。
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
