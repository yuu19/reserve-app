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
- `BETTER_AUTH_COOKIE_DOMAIN` (例: `.wakureserve.com`, staging は `.stg.wakureserve.com`)
- `INTERNAL_OPERATOR_EMAILS` (Epic 4 の internal billing inspection を許可するカンマ区切りメールアドレス)

任意 (招待メールを Resend で送信):

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (例: `onboarding@resend.dev`)
- `INVITATION_ACCEPT_URL_BASE` (例: `https://your-web.wakureserve.com/invitations/accept`)
- `PARTICIPANT_INVITATION_ACCEPT_URL_BASE` (例: `https://your-web.wakureserve.com/participants/invitations/accept`)
- `WEB_BASE_URL` (`INVITATION_ACCEPT_URL_BASE` / `PARTICIPANT_INVITATION_ACCEPT_URL_BASE` 未指定時のフォールバック)

予約通知メールも同じ `RESEND_API_KEY` / `RESEND_FROM_EMAIL` を利用します。  
通知メール内の予約一覧リンクは `WEB_BASE_URL` を使って `/bookings` を生成します。

任意 (Premium 課金の Stripe 連携):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PREMIUM_MONTHLY_PRICE_ID`
- `STRIPE_PREMIUM_YEARLY_PRICE_ID`
- `STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED` (`true` の場合、trial 開始時に Stripe subscription も作成)
- `STRIPE_BILLING_PRODUCT_NAME` (default: `WakureServe Premium`)
- `STRIPE_BILLING_MONTHLY_LOOKUP_KEY` (default: `wakureserve_premium_monthly`)
- `STRIPE_BILLING_YEARLY_LOOKUP_KEY` (default: `wakureserve_premium_yearly`)

任意 (organization ロゴアップロード):

- `ORG_LOGO_MAX_UPLOAD_BYTES` (デフォルト: `5242880` = 5MB)
- `ORG_LOGO_PUBLIC_BASE_URL` (R2 カスタムドメインで直接配信する場合)

任意 (サービス画像アップロード / 署名付き URL):

- `SERVICE_IMAGE_MAX_UPLOAD_BYTES` (デフォルト: `8388608` = 8MB)
- `SERVICE_IMAGE_UPLOAD_TOKEN_TTL_SECONDS` (デフォルト: `300`)
- `SERVICE_IMAGE_UPLOAD_SIGNING_SECRET` (未設定時は `BETTER_AUTH_SECRET` を使用)
- `SERVICE_IMAGE_PUBLIC_BASE_URL` (R2 カスタムドメインで直接配信する場合)

任意 (Sentry):

- `SENTRY_DSN_BACKEND`
- `SENTRY_ENVIRONMENT` (default: `production`)
- `SENTRY_RELEASE`

任意 (公開イベント固定コンテキスト):

- `PUBLIC_EVENTS_ORG_SLUG`
- `PUBLIC_EVENTS_CLASSROOM_SLUG`

## API endpoints

- OpenAPI JSON: `/api/openapi.json`
- Swagger UI: `/api/docs`
- Better Auth routes: `/api/auth/*`
- RPC routes: `/api/v1/auth/*`
  - Stripe webhook endpoint: `POST /api/webhooks/stripe`
  - Google OIDC start endpoint: `/api/v1/auth/oidc/google`
  - Organization logo upload endpoint: `POST /api/v1/auth/organizations/logo` (multipart form-data)
  - Organization logo delivery endpoint: `GET /api/v1/auth/organizations/logo/:key`
  - Service image signed upload URL endpoint: `POST /api/v1/auth/organizations/services/images/upload-url`
  - Service image upload endpoint: `PUT /api/v1/auth/organizations/services/images/upload/:token`
  - Service image delivery endpoint: `GET /api/v1/auth/organizations/services/images/:key`
  - Access tree endpoint: `GET /api/v1/auth/orgs/access-tree`
  - Organization invitation endpoint: `POST/GET /api/v1/auth/orgs/{orgSlug}/invitations`
  - Classroom invitation endpoint: `POST/GET /api/v1/auth/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations`
  - User invitation endpoint: `GET /api/v1/auth/invitations/user`
  - Invitation detail endpoint: `GET /api/v1/auth/invitations/{invitationId}`
  - Invitation action endpoints: `POST /api/v1/auth/invitations/{invitationId}/{accept|reject|cancel}`
  - Internal billing inspection endpoint: `GET /api/v1/auth/internal/organizations/{organizationId}/billing-inspection`
- Public events routes: `/api/v1/public/orgs/{orgSlug}/classrooms/{classroomSlug}/events*`

`@better-auth/expo` server plugin を有効化しているため、Expo クライアントからの認証にも対応しています。

## 予約通知メール

予約ライフサイクルの以下イベントで、参加者に即時メール通知を送信します。

- 予約確定 (`booking_confirmed`)
- 参加者キャンセル (`booking_cancelled_by_participant`)
- 運営キャンセル (`booking_cancelled_by_staff`)
- No-show (`booking_no_show`)

送信失敗時はベストエフォートです。予約 API 自体は成功のまま、Worker ログに警告を出します。

## 回数券購入フロー

- participant は `ticket-types/purchasable` から券種を選択して購入申請できます。
- `paymentMethod=cash_on_site|bank_transfer`: `pending_approval` で作成され、admin/owner の承認時に回数券が付与されます。
- `paymentMethod=stripe`: 現在は受け付けません。回数券のアプリ内 Stripe 決済は、将来の Stripe Connect 対応まで保留です。
- 既存の Stripe Checkout 完了通知を処理する経路は、過去に作成済みの checkout session を完了させるためだけに残します。新しい回数券購入では checkout session を作成しません。

## Premium サブスクリプション用の Stripe カタログ作成

`premium` 用の Stripe Product 1件と recurring Price 2件を作成または再利用できます。

```bash
STRIPE_SECRET_KEY=sk_test_xxx pnpm --filter @apps/backend run stripe:catalog:create
```

既定では次を作成します。

- Product: `WakureServe Premium`
- Monthly price: `¥1,500 / month`
- Yearly price: `¥15,800 / year`

出力された値を backend 環境変数に設定してください。

- `STRIPE_PREMIUM_MONTHLY_PRICE_ID`
- `STRIPE_PREMIUM_YEARLY_PRICE_ID`

Paid 契約後のプラン変更は Stripe Customer Portal の subscription update flow を使います。Stripe Dashboard の Customer Portal configuration で subscription update を有効化し、対象 product / price（monthly / yearly の Premium prices）を `features.subscription_update.products` に含めてください。Portal 側の設定が不足している場合、アプリは provider-backed handoff を開始できません。

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
pnpm --filter @apps/backend exec wrangler secret put RESEND_FROM_EMAIL
pnpm --filter @apps/backend exec wrangler secret put STRIPE_SECRET_KEY
pnpm --filter @apps/backend exec wrangler secret put STRIPE_WEBHOOK_SECRET
pnpm --filter @apps/backend exec wrangler secret put SENTRY_DSN_BACKEND
```

7. 必要に応じて `wrangler.jsonc` の `vars` を更新:

- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS` (web の URL を含む)
- `BETTER_AUTH_COOKIE_DOMAIN` (cross-subdomain cookie 共有)
- `INTERNAL_OPERATOR_EMAILS` (internal billing inspection を許可するカンマ区切りメールアドレス)
- `INVITATION_ACCEPT_URL_BASE` (招待メールのリンク先。`/invitations/accept` を含める)
- `PARTICIPANT_INVITATION_ACCEPT_URL_BASE` (参加者招待メールのリンク先。`/participants/invitations/accept` を含める)
- `WEB_BASE_URL` (`INVITATION_ACCEPT_URL_BASE` / `PARTICIPANT_INVITATION_ACCEPT_URL_BASE` 未設定時のフォールバック)
- `STRIPE_PREMIUM_MONTHLY_PRICE_ID`
- `STRIPE_PREMIUM_YEARLY_PRICE_ID`
- `STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED`
- `ORG_LOGO_MAX_UPLOAD_BYTES`
- `ORG_LOGO_PUBLIC_BASE_URL`
- `SERVICE_IMAGE_MAX_UPLOAD_BYTES`
- `SERVICE_IMAGE_UPLOAD_TOKEN_TTL_SECONDS`
- `SERVICE_IMAGE_PUBLIC_BASE_URL`
- `SENTRY_ENVIRONMENT`

`SERVICE_IMAGE_UPLOAD_SIGNING_SECRET` を個別に使う場合は、`wrangler secret put` で secret として設定します。

8. デプロイ:

```bash
pnpm --filter @apps/backend run cf:deploy
```

推奨ドメイン構成:

- Prod: `web.wakureserve.com` / `api.wakureserve.com`
- Staging: `web.stg.wakureserve.com` / `api.stg.wakureserve.com`
- 現在は prod のみ適用済みで、staging は将来別 Worker として構築予定です。
- Google OIDC redirect URI:
  - `https://api.wakureserve.com/api/auth/callback/google`
  - `https://api.stg.wakureserve.com/api/auth/callback/google`
  - `http://localhost:3000/api/auth/callback/google`

## GitHub Actions deploy

このリポジトリの `.github/workflows/deploy-workers.yml` で本番 Worker をまとめてデプロイします。
`main` への push または手動実行で、検証後に `backend -> web -> docs` の順に反映します。
通常の環境変数は `wrangler.jsonc` を正とし、workflow は secrets と release だけを注入します。

workflow 内では backend について次を実行します。

1. `wrangler secret put BETTER_AUTH_SECRET`
2. `wrangler secret put RESEND_API_KEY`
3. `wrangler secret put RESEND_FROM_EMAIL`
4. `wrangler secret put STRIPE_SECRET_KEY`
5. `wrangler secret put STRIPE_WEBHOOK_SECRET`
6. `wrangler secret put SENTRY_DSN_BACKEND`
7. `wrangler d1 migrations apply ... --remote`
8. `wrangler deploy` (`SENTRY_RELEASE` を `--var` で注入)
