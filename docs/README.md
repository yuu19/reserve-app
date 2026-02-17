# pnpm + Turborepo モノレポ

このリポジトリは `pnpm` と `turborepo` を使ったモノレポ構成です。

## アプリ構成

- `apps/backend`: Hono（Cloudflare Workers + D1 / ローカル Miniflare）
- `apps/web`: SvelteKit（Cloudflare Workers）
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

GitHub 変数:

- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `PUBLIC_BACKEND_URL`

補足:

- backend デプロイ時に `wrangler d1 migrations apply --remote` を実行します。
- backend の `database_id` は、事前に `apps/backend/wrangler.jsonc` に設定してください。

詳細な設定手順:

- backend: `apps/backend/README.md`
- web: `apps/web/README.md`
