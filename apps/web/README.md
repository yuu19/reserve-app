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
custom domain 運用の推奨:

- Prod: `https://api.wakureserve.com`
- Staging: `https://api.stg.wakureserve.com`

Sentry 連携用 public 変数:

- `PUBLIC_SENTRY_DSN_WEB`
- `PUBLIC_SENTRY_ENVIRONMENT` (default: `production`)
- `PUBLIC_SENTRY_RELEASE`

## Org + Classroom スコープ（2026-03）

- 認可判定は `org + classroom` コンテキストを利用します。
- 公開イベントは `/api/v1/public/orgs/:orgSlug/classrooms/:classroomSlug/events*` を利用します。
- 一部画面/API は旧 organization スコープとの互換経路を段階的に縮退中です。
- Mobile は今回移行の対象外です。

## 回数券関連の画面仕様

### `/participants`（admin / owner）

- 回数券管理セクションを追加
- 回数券種別作成:
  - `name`, `totalCount`, `expiresInDays?`, `serviceIds?` を指定して作成
- 回数券付与:
  - `participantId`, `ticketTypeId`, `count?`, `expiresAt?` を指定して付与
- 回数券種別一覧:
  - `name`, `totalCount`, `expiresInDays`, 対象サービス数, `isActive`, 作成日時を表示

### `/participant/bookings`

- 「回数券購入」カードを表示
- 購入方式:
  - `stripe`: Checkout へ遷移（Webhook確定後に利用可能化）
  - `cash_on_site` / `bank_transfer`: 申請後は運営承認待ち
- 購入申請履歴（status / paymentMethod / 申請日時 / 取り下げ）を表示
- 「マイ回数券」カードを表示
- 全パック（`active` / `exhausted` / `expired`）を表示
- 表示項目:
  - `ticketTypeId` の短縮表示
  - `remainingCount / initialCount`
  - `status`
  - `expiresAt`（未設定は無期限）

### `/admin/bookings`

- 予約運用専用（承認/却下/運営キャンセル/No-show）
- 予約ステータス・サービス・参加者でのフィルタ

### `/admin/services`

- サービス作成フォームに `requiresTicket` チェックボックスを追加
- 回数券必須サービスを UI から設定可能
- Service 一覧で行アクションから停止/再開を実行可能
- 接続済み API:
  - `updateService` / `archiveService`

### `/admin/services/new`

- サービス作成フォーム専用
- 必須項目はラベル末尾 `*` で表示
- 送信ボタンは sticky 表示で、送信不可時は理由を表示
- 作成後は `/admin/services` へ遷移

### `/admin/schedules/slots`

- 単発 Slot 一覧と停止アクション
- 接続済み API:
  - `cancelSlot`（表示月の slot を対象）

### `/admin/schedules/slots/new`

- 単発 Slot 作成フォーム専用
- 入力は `日付 + 開始時刻 + 終了時刻` を基本とし、必要時のみ「終了日を別日にする」を展開
- 日付未選択時は時刻入力を disabled
- 時刻入力は 15 分刻み（`step=900`）
- サービス選択 + 開始時刻入力時、所要時間から終了時刻を自動計算（終了時刻を手動変更後は固定）
- `終了日時 <= 開始日時` はリアルタイムで警告表示し、作成ボタンを disabled
- 送信ボタンは sticky 表示で、送信不可時は理由を表示
- 作成後は `/admin/schedules/slots` へ遷移

### `/admin/schedules/recurring`

- 定期 Schedule 一覧・更新・停止/再開・例外登録・枠再生成
- 接続済み API:
  - `updateRecurringSchedule`
  - `upsertRecurringScheduleException`
  - `generateRecurringSlots`

### `/admin/schedules/recurring/new`

- 定期 Schedule 作成フォーム専用
- 必須項目はラベル末尾 `*` で表示
- 送信ボタンは sticky 表示で、送信不可時は理由を表示
- 作成後は `/admin/schedules/recurring` へ遷移

### `/participants`（回数券購入管理）

- 「回数券購入管理」セクションを追加
- pending 申請に対して `承認` / `却下（理由任意）` を実行可能

### 補足

- 回数券不足時の予約エラーは「このサービスの予約には有効な回数券が必要です。」を表示
- `ticketType.serviceIds` は UI で設定可能だが、現在のバックエンド予約消費判定では未使用

## Cloudflare Workers deploy setup

1. Set backend URL in `wrangler.jsonc`:

- `vars.PUBLIC_BACKEND_URL`
- `vars.PUBLIC_SENTRY_DSN_WEB`
- `vars.PUBLIC_SENTRY_ENVIRONMENT`
- `vars.PUBLIC_SENTRY_RELEASE`

推奨 URL:

- Web: `https://web.wakureserve.com` / `https://web.stg.wakureserve.com`
- API: `https://api.wakureserve.com` / `https://api.stg.wakureserve.com`
- 現在は prod (`web.wakureserve.com` / `api.wakureserve.com`) のみ適用済みです。

2. Deploy:

```bash
pnpm --filter @apps/web run cf:deploy
```

## Cloudflare Workers local dev

```bash
pnpm --filter @apps/web run cf:dev
```

## Full-stack E2E

web の E2E は、実ブラウザで管理者の初回登録から組織・教室作成までを確認します。
テスト実行時に backend Worker と web の Vite dev server を起動します。
backend は local D1 を使い、永続化先はリポジトリ直下の `.wrangler/e2e` です。

使用ポート:

- backend: `http://localhost:3000`
- web: `http://localhost:5173`

実行:

```bash
pnpm --filter @apps/web run test:e2e
```

テスト一覧だけを確認する場合:

```bash
pnpm --filter @apps/web run test:e2e -- --list
```

ブラウザを表示して確認する場合:

```bash
pnpm --filter @apps/web run test:e2e:headed
```

UI モードを使う場合:

```bash
pnpm --filter @apps/web run test:e2e:ui
```

DB と Playwright の出力を消す場合:

```bash
pnpm --filter @apps/web run clean:e2e
```

CI では pull request と `main` push で Chromium の E2E を実行します。
失敗時の調査に使う `playwright-report` と `test-results` は GitHub Actions artifact に保存されます。

## GitHub Actions deploy

`.github/workflows/deploy-workers.yml` で web Worker をデプロイします。  
`PUBLIC_BACKEND_URL` は `apps/web/wrangler.jsonc` を正とします。
`PUBLIC_SENTRY_DSN_WEB` / `PUBLIC_SENTRY_ENVIRONMENT` / `PUBLIC_SENTRY_RELEASE` は workflow がデプロイ時に `wrangler deploy --var ...` で注入します。

Google OIDC callback は API 側に固定します:

- `https://api.wakureserve.com/api/auth/callback/google`
- `https://api.stg.wakureserve.com/api/auth/callback/google`

Sentry sourcemap upload のために以下が必要です:

- Secret: `SENTRY_AUTH_TOKEN`
- Variable: `SENTRY_ORG`
- Variable: `SENTRY_PROJECT_WEB`
- Variable: `PUBLIC_SENTRY_DSN_WEB`
- Variable: `PUBLIC_SENTRY_ENVIRONMENT`

release は workflow で `github.sha` が設定されます。
