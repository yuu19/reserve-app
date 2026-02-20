# Web (SvelteKit + Hono RPC)

## Local development

```bash
cp .env.example .env
# (Cloudflare dev を使う場合)
cp .dev.vars.example .dev.vars
pnpm install
pnpm --filter @apps/web dev
```

`PUBLIC_BACKEND_URL` points to backend URL (default: `http://localhost:3000`).

Sentry 連携用 public 変数:

- `PUBLIC_SENTRY_DSN_WEB`
- `PUBLIC_SENTRY_ENVIRONMENT` (default: `production`)
- `PUBLIC_SENTRY_RELEASE`

## 回数券関連の画面仕様

### `/participants`（admin / owner）

- 回数券管理セクションを追加
- 回数券種別作成:
  - `name`, `totalCount`, `expiresInDays?`, `serviceIds?` を指定して作成
- 回数券付与:
  - `participantId`, `ticketTypeId`, `count?`, `expiresAt?` を指定して付与
- 回数券種別一覧:
  - `name`, `totalCount`, `expiresInDays`, 対象サービス数, `isActive`, 作成日時を表示

### `/bookings`（参加者タブ）

- 「マイ回数券」カードを表示
- 全パック（`active` / `exhausted` / `expired`）を表示
- 表示項目:
  - `ticketTypeId` の短縮表示
  - `remainingCount / initialCount`
  - `status`
  - `expiresAt`（未設定は無期限）

### `/bookings`（運営タブ）

- サービス作成フォームに `requiresTicket` チェックボックスを追加
- 回数券必須サービスを UI から設定可能
- リソース管理セクションを追加（Service / Slot / Recurring）
- 接続済み API:
  - `updateService` / `archiveService`
  - `cancelSlot`（表示月の slot を対象）
  - `updateRecurringSchedule`
  - `upsertRecurringScheduleException`
  - `generateRecurringSlots`
- 一覧選択 + 行操作で更新・停止を実行

### 補足

- 回数券不足時の予約エラーは「このサービスの予約には有効な回数券が必要です。」を表示
- `ticketType.serviceIds` は UI で設定可能だが、現在のバックエンド予約消費判定では未使用

## Cloudflare Workers deploy setup

1. Set backend URL in `wrangler.jsonc`:

- `vars.PUBLIC_BACKEND_URL`
- `vars.PUBLIC_SENTRY_DSN_WEB`
- `vars.PUBLIC_SENTRY_ENVIRONMENT`
- `vars.PUBLIC_SENTRY_RELEASE`

2. Deploy:

```bash
pnpm --filter @apps/web run cf:deploy
```

## Cloudflare Workers local dev

```bash
pnpm --filter @apps/web run cf:dev
```

## GitHub Actions deploy

`.github/workflows/deploy-workers.yml` で web Worker をデプロイします。  
`PUBLIC_BACKEND_URL` と `PUBLIC_SENTRY_*` は GitHub Variables から `wrangler deploy --var ...` で注入されます。

Sentry sourcemap upload のために以下が必要です:

- Secret: `SENTRY_AUTH_TOKEN`
- Variable: `SENTRY_ORG`
- Variable: `SENTRY_PROJECT_WEB`

release は workflow で `github.sha` が設定されます。
