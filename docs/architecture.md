# 予約管理システム: 招待機能アーキテクチャ（2026-02-18）

スクール／教室向け予約管理サイトを作成する。

## 1. このドキュメントの対象

このリポジトリの招待機能は 2 系統で構成する。

1. 管理者招待: Better Auth organization plugin の invitation モデル
2. 参加者招待: 予約管理向けに独立実装した participant invitation モデル

本フェーズでは「参加者招待（organization 単位）」まで実装済みとし、class/event/slot への紐付けは次フェーズに分離する。

## 2. 管理者招待（organization invitation）

### 2.1 モデル

- 役割: `admin` / `member`
- ステータス: `pending` / `accepted` / `rejected` / `canceled`
- 有効期限: 48時間（`invitationExpiresIn: 172800`）

### 2.2 ポリシー

- `owner` 招待は禁止
- 再送は同一 pending 招待につき最大 3 回

### 2.3 API

- `POST /api/v1/auth/organizations/invitations`
- `GET /api/v1/auth/organizations/invitations`
- `GET /api/v1/auth/organizations/invitations/user`
- `GET /api/v1/auth/organizations/invitations/detail`
- `POST /api/v1/auth/organizations/invitations/accept`
- `POST /api/v1/auth/organizations/invitations/reject`
- `POST /api/v1/auth/organizations/invitations/cancel`

### 2.4 監査ログ

`invitation_audit_log` に以下を記録する（成功時のみ）。

- `invitation.created`
- `invitation.resent`
- `invitation.accepted`
- `invitation.rejected`
- `invitation.canceled`

## 3. 参加者招待（participant invitation）

### 3.1 モデル

参加者招待は Better Auth invitation と分離し、予約管理用途の独立テーブルで管理する。

- スコープ: organization 単位
- 必須項目: `email`, `participantName`
- ステータス: `pending` / `accepted` / `rejected` / `canceled`
- 有効期限: 48時間

### 3.2 権限・セキュリティ

- 作成/再送/取消/一覧（organization側）は `admin` / `owner` のみ
- 受諾/辞退/詳細はログイン必須
- 受諾/辞退/詳細は「招待先メール」と「ログイン中メール」の一致が必須
- 再送は同一 pending 招待につき最大 3 回
- `resend: false` で同一 organization + email の pending 招待があれば `409`

### 3.3 API

- `GET /api/v1/auth/organizations/participants`
- `POST /api/v1/auth/organizations/participants/invitations`
- `GET /api/v1/auth/organizations/participants/invitations`
- `GET /api/v1/auth/organizations/participants/invitations/user`
- `GET /api/v1/auth/organizations/participants/invitations/detail`
- `POST /api/v1/auth/organizations/participants/invitations/accept`
- `POST /api/v1/auth/organizations/participants/invitations/reject`
- `POST /api/v1/auth/organizations/participants/invitations/cancel`

### 3.4 監査ログ

`participant_invitation_audit_log` に以下を記録する（成功時のみ）。

- `participant-invitation.created`
- `participant-invitation.resent`
- `participant-invitation.accepted`
- `participant-invitation.rejected`
- `participant-invitation.canceled`

## 4. データモデル

### 4.1 既存

- `invitation`（Better Auth organization invitation）
- `invitation_audit_log`

### 4.2 追加

- `participant`
  - `id`, `organization_id`, `user_id`, `email`, `name`, `created_at`, `updated_at`
  - unique: `(organization_id, user_id)`, `(organization_id, email)`

- `participant_invitation`
  - `id`, `organization_id`, `email`, `participant_name`, `status`, `expires_at`, `created_at`, `invited_by_user_id`, `responded_by_user_id`, `responded_at`

- `participant_invitation_audit_log`
  - `id`, `participant_invitation_id`, `organization_id`, `actor_user_id`, `target_email`, `action`, `metadata`, `ip_address`, `user_agent`, `created_at`

## 5. 画面 / 導線

### 5.1 Web 画面構成

`/`（認証LP）:

- サインイン / サインアップ / Google ログイン

ログイン後の業務導線:

- `/dashboard`:
  - KPIサマリー（利用中組織、参加者数、保留中参加者招待数）
  - organization 管理（作成・active 切り替え）
- `/bookings`:
  - 予約タブ（運営 / 参加者）
  - 運営: Service 作成、単発 Slot 作成、定期 RecurringSchedule 作成
  - 参加者: 空き枠検索、申込、マイ予約一覧、マイ予約キャンセル
- `/participants`:
  - 参加者一覧
  - 参加者招待作成（メール + 氏名）
  - 送信済み参加者招待（再送/取消）
  - 受信参加者招待（承諾/辞退）
- `/admin-invitations`:
  - 管理者招待作成
  - 送信済み管理者招待（再送/取消）
  - 受信管理者招待（承諾/辞退）

未ログインで業務画面に直接アクセスした場合は `/?next=<current-url>` へ誘導し、ログイン後に復帰する。

### 5.2 専用受諾ページ

- 管理者招待: `/invitations/accept?invitationId=...`
- 参加者招待: `/participants/invitations/accept?invitationId=...`

未ログイン時は `/?next=<current-url>` に誘導し、ログイン後に同一 URL へ復帰する。

### 5.3 招待メールリンク

- `INVITATION_ACCEPT_URL_BASE`:
  - 管理者招待メールの着地先（例: `https://<web>/invitations/accept`）
- `PARTICIPANT_INVITATION_ACCEPT_URL_BASE`:
  - 参加者招待メールの着地先（例: `https://<web>/participants/invitations/accept`）

未設定時は `WEB_BASE_URL` から各パスを補完する。

## 6. 次フェーズ

以下は次フェーズの実装対象。

- class/event/slot に紐づく参加者招待
- CSV 一括招待
- OTP/SMS 本人確認
- 管理者 2FA 必須化

## 7. Cloudflare デプロイ構成

### 7.1 デプロイ先

- Backend Worker: `reserve-app-backend`
  - URL: `https://reserve-app-backend.yusuke-kusi1028.workers.dev`
- Web Worker: `reserve-app-web`
  - URL: `https://reserve-app-web.yusuke-kusi1028.workers.dev`

### 7.2 本番向け主要環境変数

- Backend (`apps/backend/wrangler.jsonc`)
  - `BETTER_AUTH_URL=https://reserve-app-backend.yusuke-kusi1028.workers.dev`
  - `BETTER_AUTH_TRUSTED_ORIGINS=https://reserve-app-web.yusuke-kusi1028.workers.dev,https://reserve-app-backend.yusuke-kusi1028.workers.dev`
  - `INVITATION_ACCEPT_URL_BASE=https://reserve-app-web.yusuke-kusi1028.workers.dev/invitations/accept`
  - `PARTICIPANT_INVITATION_ACCEPT_URL_BASE=https://reserve-app-web.yusuke-kusi1028.workers.dev/participants/invitations/accept`
  - `WEB_BASE_URL=https://reserve-app-web.yusuke-kusi1028.workers.dev`
- Web (`apps/web/wrangler.jsonc`)
  - `PUBLIC_BACKEND_URL=https://reserve-app-backend.yusuke-kusi1028.workers.dev`

### 7.3 デプロイコマンド

- Backend: `pnpm deploy:backend`
- Web: `pnpm deploy:web`
- 一括: `pnpm deploy:workers`



## 単発・定期の予約管理の仕様

### 8.1 サマリー

- 単発・定期は共通で `Service` / `Slot` / `Booking` を使用する。
- 定期は「枠の自動生成のみ」を行い、予約は都度 `Booking` を作成する。
- MVPの権利モデルは `Ticket（回数券）` のみ。`MonthlyPlan` は非スコープ。
- 予約作成主体は `participant` のみで、ログイン必須。
- APIはすべて `/api/v1/auth/organizations/...` 配下に追加する。

### 8.2 スコープ / 非スコープ

スコープ:

- `Service` / `Slot` / `RecurringSchedule` / `Booking` / `Ticket` のDB/API/状態遷移/権限/テストを確定する。
- 定期枠の自動生成（12週間先）と例外（休講・時間変更）ルールを確定する。
- 予約重複防止・満席防止・回数券の消費/戻しルールを確定する。

非スコープ:

- 月謝（`MonthlyPlan`）
- 非ログイン予約（ゲスト予約）
- セット講座（`Course` / `CourseSession` / `CourseEnrollment`）
- 外部決済連携（Stripe等）
- mobile UI拡張

### 8.3 API仕様（確定）

#### 8.3.1 Service（運営）

- `POST /api/v1/auth/organizations/services`
  - Body: `{ organizationId?: string; name: string; kind: 'single' | 'recurring'; durationMinutes: number; capacity: number; bookingOpenMinutesBefore?: number; bookingCloseMinutesBefore?: number; cancellationDeadlineMinutes?: number; timezone?: string; requiresTicket?: boolean; isActive?: boolean }`
- `GET /api/v1/auth/organizations/services`
  - Query: `{ organizationId?: string; includeArchived?: boolean }`
- `POST /api/v1/auth/organizations/services/update`
  - Body: `{ serviceId: string; ...updatable fields }`
- `POST /api/v1/auth/organizations/services/archive`
  - Body: `{ serviceId: string }`

#### 8.3.2 Slot（運営 + 参加者閲覧）

- `POST /api/v1/auth/organizations/slots`
  - Body: `{ organizationId?: string; serviceId: string; startAt: string(ISO); endAt: string(ISO); capacity?: number; staffLabel?: string; locationLabel?: string }`
- `GET /api/v1/auth/organizations/slots`
  - Query: `{ organizationId?: string; serviceId?: string; from: string(ISO); to: string(ISO); status?: 'open' | 'canceled' | 'completed' }`
- `GET /api/v1/auth/organizations/slots/available`
  - Query: `{ organizationId?: string; serviceId?: string; from: string(ISO); to: string(ISO) }`
- `POST /api/v1/auth/organizations/slots/cancel`
  - Body: `{ slotId: string; reason?: string }`

#### 8.3.3 RecurringSchedule（運営）

- `POST /api/v1/auth/organizations/recurring-schedules`
  - Body: `{ organizationId?: string; serviceId: string; timezone?: string; frequency: 'weekly' | 'monthly'; interval: number; byWeekday?: number[]; byMonthday?: number; startDate: string(YYYY-MM-DD); endDate?: string(YYYY-MM-DD); startTimeLocal: string(HH:mm); durationMinutes?: number; capacityOverride?: number }`
- `GET /api/v1/auth/organizations/recurring-schedules`
  - Query: `{ organizationId?: string; serviceId?: string; isActive?: boolean }`
- `POST /api/v1/auth/organizations/recurring-schedules/update`
  - Body: `{ recurringScheduleId: string; ...updatable fields }`
- `POST /api/v1/auth/organizations/recurring-schedules/exceptions`
  - Body: `{ recurringScheduleId: string; date: string(YYYY-MM-DD); action: 'skip' | 'override'; overrideStartTimeLocal?: string; overrideDurationMinutes?: number; overrideCapacity?: number }`
- `POST /api/v1/auth/organizations/recurring-schedules/generate`
  - Body: `{ recurringScheduleId: string; from?: string(ISO); to?: string(ISO) }`

#### 8.3.4 Booking（参加者 + 運営）

- `POST /api/v1/auth/organizations/bookings`
  - Body: `{ slotId: string; participantsCount?: number }`
- `GET /api/v1/auth/organizations/bookings/mine`
  - Query: `{ organizationId?: string; from?: string(ISO); to?: string(ISO); status?: string }`
- `POST /api/v1/auth/organizations/bookings/cancel`
  - Body: `{ bookingId: string; reason?: string }`
- `GET /api/v1/auth/organizations/bookings`
  - Query: `{ organizationId?: string; serviceId?: string; from?: string(ISO); to?: string(ISO); participantId?: string; status?: string }`
- `POST /api/v1/auth/organizations/bookings/cancel-by-staff`
  - Body: `{ bookingId: string; reason?: string }`
- `POST /api/v1/auth/organizations/bookings/no-show`
  - Body: `{ bookingId: string }`

#### 8.3.5 Ticket（回数券）

- `POST /api/v1/auth/organizations/ticket-types`
  - Body: `{ organizationId?: string; name: string; serviceIds?: string[]; totalCount: number; expiresInDays?: number; isActive?: boolean }`
- `GET /api/v1/auth/organizations/ticket-types`
  - Query: `{ organizationId?: string; isActive?: boolean }`
- `POST /api/v1/auth/organizations/ticket-packs/grant`
  - Body: `{ organizationId?: string; participantId: string; ticketTypeId: string; count?: number; expiresAt?: string(ISO) }`
- `GET /api/v1/auth/organizations/ticket-packs/mine`
  - Query: `{ organizationId?: string }`

#### 8.3.6 エラーコード方針（全API共通）

- `401`: 未認証
- `403`: 権限不足 / 組織不一致
- `404`: 対象リソースなし
- `409`: 競合（重複予約、満席、状態不整合、受付時間外）
- `422`: バリデーションエラー
- `429`: 将来のレート制限拡張用

### 8.4 データモデル（Drizzle/SQLite）

#### 8.4.1 `service`

- columns: `id`, `organizationId`, `name`, `kind`, `durationMinutes`, `capacity`, `bookingOpenMinutesBefore`, `bookingCloseMinutesBefore`, `cancellationDeadlineMinutes`, `timezone`, `requiresTicket`, `isActive`, `createdAt`, `updatedAt`
- indexes: `(organizationId, isActive)`, `(organizationId, kind)`

#### 8.4.2 `recurring_schedule`

- columns: `id`, `organizationId`, `serviceId`, `timezone`, `frequency`, `interval`, `byWeekdayJson`, `byMonthday`, `startDate`, `endDate`, `startTimeLocal`, `durationMinutes`, `capacityOverride`, `isActive`, `lastGeneratedAt`, `createdAt`, `updatedAt`
- indexes: `(organizationId, serviceId, isActive)`

#### 8.4.3 `recurring_schedule_exception`

- columns: `id`, `recurringScheduleId`, `organizationId`, `date`, `action`, `overrideStartTimeLocal`, `overrideDurationMinutes`, `overrideCapacity`, `createdAt`, `updatedAt`
- unique: `(recurringScheduleId, date)`
- indexes: `(organizationId, date)`

#### 8.4.4 `slot`

- columns: `id`, `organizationId`, `serviceId`, `recurringScheduleId(nullable)`, `startAt`, `endAt`, `capacity`, `reservedCount`, `status`, `staffLabel`, `locationLabel`, `bookingOpenAt`, `bookingCloseAt`, `createdAt`, `updatedAt`
- unique: `(organizationId, recurringScheduleId, startAt)`（定期生成重複防止）
- indexes: `(organizationId, startAt, status)`, `(organizationId, serviceId, startAt)`

#### 8.4.5 `booking`

- columns: `id`, `organizationId`, `slotId`, `serviceId`, `participantId`, `participantsCount`, `status`, `cancelReason`, `cancelledAt`, `cancelledByUserId`, `noShowMarkedAt`, `ticketPackId(nullable)`, `createdAt`, `updatedAt`
- unique: `(slotId, participantId)`（同一枠の二重予約防止）
- indexes: `(organizationId, participantId, createdAt)`, `(organizationId, serviceId, createdAt)`, `(organizationId, status, createdAt)`

#### 8.4.6 `ticket_type`

- columns: `id`, `organizationId`, `name`, `serviceIdsJson(nullable)`, `totalCount`, `expiresInDays`, `isActive`, `createdAt`, `updatedAt`
- indexes: `(organizationId, isActive)`

#### 8.4.7 `ticket_pack`

- columns: `id`, `organizationId`, `participantId`, `ticketTypeId`, `initialCount`, `remainingCount`, `expiresAt`, `status('active'|'exhausted'|'expired')`, `createdAt`, `updatedAt`
- indexes: `(organizationId, participantId, status)`, `(organizationId, expiresAt)`

#### 8.4.8 `ticket_ledger`

- columns: `id`, `organizationId`, `ticketPackId`, `bookingId(nullable)`, `action('grant'|'consume'|'restore'|'expire'|'adjust')`, `delta`, `balanceAfter`, `actorUserId`, `reason`, `createdAt`
- indexes: `(ticketPackId, createdAt)`, `(organizationId, createdAt)`

#### 8.4.9 `booking_audit_log`

- columns: `id`, `bookingId`, `organizationId`, `actorUserId`, `action`, `metadata`, `ipAddress`, `userAgent`, `createdAt`
- indexes: `(bookingId, action)`, `(organizationId, createdAt)`

### 8.5 状態遷移

#### 8.5.1 Slot

- 初期: `open`
- `open -> canceled`（運営キャンセル）
- `open -> completed`（開始時刻経過後のバッチ更新）
- `canceled`/`completed` では新規予約不可

#### 8.5.2 Booking

- 初期: `confirmed`
- `confirmed -> cancelled_by_participant`
- `confirmed -> cancelled_by_staff`
- `confirmed -> no_show`
- `cancelled_*` と `no_show` は終端状態

#### 8.5.3 TicketPack

- 初期: `active`
- `active -> exhausted`（`remainingCount = 0`）
- `active -> expired`（`expiresAt` 超過）
- `exhausted`/`expired` は消費不可
- 戻し対象は `cancelled_by_participant` かつキャンセル期限内のみ

### 8.6 権限・認可

- `owner` / `admin`: Service/Slot/RecurringSchedule/TicketType/TicketPack付与/運営向けBooking操作
- `member`: 管理系API禁止
- `participant`: `slots/available`, `bookings` 作成, `bookings/mine`, `bookings/cancel`, `ticket-packs/mine` のみ
- 全予約系APIで `organizationId` 一致 + 参加者所属一致を必須とする
- 参加者予約作成時は `participant.userId == session.user.id` を必須とする
- 参加者は本ドキュメントの招待仕様（`participant_invitation`）で作成された所属を前提とする

### 8.7 予約・定員・同時実行制御

- D1実装制約のため、予約作成は「条件付き更新 + 補償処理」で整合性を担保する
- `slot.status='open'` かつ `bookingOpenAt <= now <= bookingCloseAt` を満たさない場合は `409`
- 定員チェックは条件付き更新で原子的に実施する
  - `UPDATE slot SET reserved_count = reserved_count + ? WHERE id=? AND reserved_count + ? <= capacity`
- 更新件数0は `409`（満席）
- 予約取消時は `reservedCount` を減算し、0未満を禁止する
- 回数券消費後に予約作成が失敗した場合は、回数券残数と `reservedCount` を補償更新で巻き戻す
- 回数券の付与/消費/戻しは `ticket_ledger` とセットで記録する

### 8.8 定期枠生成ルール

- デフォルト timezone: `Asia/Tokyo`
- 生成ホライズン: `84日（12週間）`
- 生成トリガー:
  - `recurring-schedules` 作成時（即時）
  - `recurring-schedules/update` 時（差分再生成）
  - Cloudflare Scheduled（`10 18 * * *` / UTC、JST 03:10）で将来枠補充
- exceptions優先:
  - `skip`: 未生成維持、または「`open` かつ `reservedCount=0` の既存枠」を `canceled` 化
  - `override`: 未生成枠の生成時に時刻/所要時間/定員を上書き
- 既存枠は `(organizationId, recurringScheduleId, startAt)` 重複防止により再生成しないため、後から追加した `override` は既存枠には直接反映されない

### 8.9 テストケース（実装用）

#### 8.9.1 Backend（`apps/backend/src/app.test.ts` 拡張）

- 未認証の予約系APIは `401`
- `member` の管理系API実行は `403`
- 他人の `participantId` で予約作成は `403`
- 同一 participant + slot の重複予約は `409`
- 満席時予約は `409`
- 受付時間外予約は `409`
- 予約成功時に `slot.reservedCount` 増加
- 期限内参加者キャンセルで `reservedCount` 減算 + ticket restore
- 期限外参加者キャンセルは `409`
- 運営キャンセルは期限外でも成功（戻しなし）
- `no_show` は `confirmed` からのみ遷移可
- 定期生成で `(organizationId, recurringScheduleId, startAt)` 重複なし
- `exceptions skip` で対象枠予約不可
- `exceptions override` で新規生成枠に開始時刻/定員が反映
- booking/ticket台帳/監査ログは成功時のみ記録
- OpenAPIに新規path出力

#### 8.9.2 Web（最小検証）

- 参加者が空き枠一覧を取得できる
- 予約作成後にマイ予約へ反映される
- 参加者キャンセル時に確認導線が表示される
- 運営画面で定期作成後にSlot生成される
- 休講設定後に対象枠が予約不可表示となる

### 8.10 MVPデフォルト値

- 権利モデル: 回数券のみ
- 予約主体: participant（ログイン必須）
- API名前空間: `/api/v1/auth/organizations/...`
- timezoneデフォルト: `Asia/Tokyo`
- 定期生成ホライズン: 12週間
- キャンセル期限デフォルト: 24時間前
- 予約作成時状態: `confirmed`（pending paymentなし）

### 8.11 Web実装状況（2026-02-18時点）

- 実装済み画面:
  - `/`（認証LP）
  - `/dashboard`（サマリー・組織管理）
  - `/bookings`（予約運用 / 予約申込）
  - `/participants`（参加者管理）
  - `/admin-invitations`（管理者招待管理）
  - `/invitations/accept`（管理者招待受諾）
  - `/participants/invitations/accept`（参加者招待受諾）
- 実装済み入力UI:
  - DatePicker（`bits-ui` ベース）を以下で利用
    - 単発Slot作成: `startAt/endAt`
    - 定期Schedule作成: `startDate/endDate`
    - 空き枠検索: `from/to`
- 実装済み操作:
  - 運営: `createService`, `createSlot`, `createRecurringSchedule`
  - 参加者: `listAvailableSlots`, `createBooking`, `listMyBookings`, `cancelBooking`
- 今回未実装（次フェーズ）:
  - 例外編集（skip/override）のUI
  - 手動generateのUI
  - staff cancel / no-show のUI
