# Backend (Hono + Better Auth + D1)

## Local development (Miniflare via Wrangler)

```bash
cp .env.example .env
cp .dev.vars.example .dev.vars
pnpm install
pnpm --filter @apps/backend run d1:migrate:local
pnpm --filter @apps/backend run dev
```

`dev` は `wrangler dev --local` を使用し、ローカル DB は D1 (Miniflare) で動作します。

最低限必要な環境変数:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`

任意 (Google OAuth):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

任意 (招待メールを Resend で送信):

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (例: `onboarding@resend.dev`)
- `INVITATION_ACCEPT_URL_BASE` (例: `https://your-web.example.com/invitations/accept`)
- `PARTICIPANT_INVITATION_ACCEPT_URL_BASE` (例: `https://your-web.example.com/participants/invitations/accept`)
- `WEB_BASE_URL` (`INVITATION_ACCEPT_URL_BASE` / `PARTICIPANT_INVITATION_ACCEPT_URL_BASE` 未指定時のフォールバック)

任意 (organization ロゴアップロード):

- `ORG_LOGO_MAX_UPLOAD_BYTES` (デフォルト: `5242880` = 5MB)
- `ORG_LOGO_PUBLIC_BASE_URL` (R2 カスタムドメインで直接配信する場合)

## API endpoints

- OpenAPI JSON: `/api/openapi.json`
- Swagger UI: `/api/docs`
- Better Auth routes: `/api/auth/*`
- RPC routes: `/api/v1/auth/*`
  - Google OIDC start endpoint: `/api/v1/auth/oidc/google`
  - Organization logo upload endpoint: `POST /api/v1/auth/organizations/logo` (multipart form-data)
  - Organization logo delivery endpoint: `GET /api/v1/auth/organizations/logo/:key`

`@better-auth/expo` server plugin を有効化しているため、Expo クライアントからの認証にも対応しています。

## Cloudflare Workers deploy setup

1. D1 を作成:

```bash
pnpm --filter @apps/backend exec wrangler d1 create reserve-app
```

2. R2 バケットを作成:

```bash
pnpm --filter @apps/backend exec wrangler r2 bucket create reserve-app-org-logos
```

3. 返却された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に設定。
   `r2_buckets[0].bucket_name` は作成したバケット名に合わせてください。
4. Cloudflare Images をアカウントで有効化（`wrangler.jsonc` の `images.binding = "IMAGES"` を使用）。
5. リモート D1 へ migration 適用:

```bash
pnpm --filter @apps/backend run d1:migrate:remote
```

6. シークレット設定:

```bash
pnpm --filter @apps/backend exec wrangler secret put BETTER_AUTH_SECRET
pnpm --filter @apps/backend exec wrangler secret put RESEND_API_KEY
```

7. 必要に応じて `wrangler.jsonc` の `vars` を更新:

- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS` (web の URL を含む)
- `INVITATION_ACCEPT_URL_BASE` (招待メールのリンク先。`/invitations/accept` を含める)
- `PARTICIPANT_INVITATION_ACCEPT_URL_BASE` (参加者招待メールのリンク先。`/participants/invitations/accept` を含める)
- `WEB_BASE_URL` (`INVITATION_ACCEPT_URL_BASE` / `PARTICIPANT_INVITATION_ACCEPT_URL_BASE` 未設定時のフォールバック)
- `RESEND_FROM_EMAIL`
- `ORG_LOGO_MAX_UPLOAD_BYTES`
- `ORG_LOGO_PUBLIC_BASE_URL`

8. デプロイ:

```bash
pnpm --filter @apps/backend run cf:deploy
```

## GitHub Actions deploy

このリポジトリの `.github/workflows/deploy-workers.yml` で backend をデプロイします。  
workflow 内では次を実行します。

1. `wrangler secret put BETTER_AUTH_SECRET`
2. `wrangler secret put RESEND_API_KEY` (招待メールを使う場合)
2. `wrangler d1 migrations apply ... --remote`
3. `wrangler deploy`
