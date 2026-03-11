# pnpm + Turborepo モノレポ

このリポジトリは `pnpm` と `turborepo` を使ったモノレポ構成です。

## 設計ドキュメント

- [architecture.md](./architecture.md)
- [authorization.md](./authorization.md)
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
  - 予約画面でマイ回数券表示（active/exhausted/expired）に対応
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

# backend -> web を順番に実行
pnpm deploy:workers
```

## GitHub Actions による自動デプロイ

`main` ブランチへの push（または手動実行）で、`backend -> web` の順に Workers をデプロイします。  
ワークフロー: `.github/workflows/deploy-workers.yml`

GitHub シークレット:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `BETTER_AUTH_SECRET`
- `SENTRY_AUTH_TOKEN`（Web sourcemap upload 用）
- `SENTRY_DSN_BACKEND`
- `STRIPE_SECRET_KEY`（回数券 Stripe 決済を使う場合）
- `STRIPE_WEBHOOK_SECRET`（回数券 Stripe 決済を使う場合）

GitHub 変数:

- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `BETTER_AUTH_COOKIE_DOMAIN`
- `PUBLIC_BACKEND_URL`
- `SENTRY_ORG`
- `SENTRY_PROJECT_WEB`
- `PUBLIC_SENTRY_DSN_WEB`
- `PUBLIC_SENTRY_ENVIRONMENT`
- `SENTRY_ENVIRONMENT`

補足:

- backend デプロイ時に `wrangler d1 migrations apply --remote` を実行します。
- web デプロイ前ビルドで Sentry sourcemap upload を実行します（`SENTRY_RELEASE=${{ github.sha }}`）。
- Stripe webhook は `POST /api/webhooks/stripe` で受け付けます（`STRIPE_WEBHOOK_SECRET` 必須）。
- カスタムドメイン運用時は以下の値を推奨します。
  - Prod: `BETTER_AUTH_URL=https://api.wakureserve.com`, `PUBLIC_BACKEND_URL=https://api.wakureserve.com`, `BETTER_AUTH_COOKIE_DOMAIN=.wakureserve.com`
  - Staging: `BETTER_AUTH_URL=https://api.stg.wakureserve.com`, `PUBLIC_BACKEND_URL=https://api.stg.wakureserve.com`, `BETTER_AUTH_COOKIE_DOMAIN=.stg.wakureserve.com`
  - 現在の実運用は prod のみ適用済みで、staging は将来別 Worker で構築予定です。
- backend の `database_id` は、事前に `apps/backend/wrangler.jsonc` に設定してください。

詳細な設定手順:

- backend: `apps/backend/README.md`
- web: `apps/web/README.md`
