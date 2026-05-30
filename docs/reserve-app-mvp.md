## reserve-app 向け仕様案 v0.1

外部予約システムの仕様を見ると、MVPでも最低限必要なのは「公開予約ページ」「予約者情報入力」「通知」「リマインド」「運営側の代理登録」です。STORES予約は予約受付・管理、顧客管理、事前決済、回数券、前日リマインドやLINE連携を前面に出しており、フリーでも予約ページを公開できる一方、予約件数・公開ページ数・スタッフ数でプラン差を作っています。([STORES][1]) RESERVAもオンライン決済、QR受付・セルフチェックイン、予約時アンケート、回数券・月額サブスク、多店舗管理を備えています。([RESERVA（レゼルバ）][2]) hacomonoは会員管理・予約・振替・キャンセル・決済・請求・入退館まで一体化し、会員マイページとバックオフィスを明確に分けています。([ウェルネス向けオールインワンマネジメントシステム｜hacomono][3]) SelectTypeは予約受付、顧客管理、決済、通知、スタッフ別管理、キャンセル待ち、CSV出力、リマインドメールなどを広く提供しています。([SelectType(セレクトタイプ)][4])

reserve-app では、hacomono ほど大規模施設向けに広げず、**小規模スクール・教室・パーソナル系店舗向けに「公開ページから予約が入り、運営が気づき、当日運用できる」状態**をMVPの完成条件にするのがよいです。

---

# 1. MVP の到達点

MVP の完成状態は以下です。

> 店舗ごとの公開予約ページ `/{orgSlug}/{storeSlug}` から、参加者が必要情報を入力して予約できる。
> 予約が入ると参加者と運営側に通知され、前日または数時間前にリマインドが送られる。
> 電話・LINE・店頭で受けた予約は、スタッフが管理画面から代理登録できる。
> 当日は店舗単位の日次予約一覧で、連絡先・人数・備考・出欠を確認できる。

既存の reserve-app の前提に合わせると、`organization` は請求・契約単位、`store` は店舗・教室・拠点単位として扱います。UI でも内部実装でも「店舗」は `store` / `storeId` / `storeSlug` を正とします。過去文脈の `classroom` は旧称としてのみ扱い、新規仕様には持ち込みません。

---

# 2. 優先度

| 優先度 | 機能                    | MVPでの扱い                                  |
| ------ | ----------------------- | -------------------------------------------- |
| P0     | 店舗ごとの公開予約成立  | 必須                                         |
| P0     | 予約者情報入力          | 必須                                         |
| P0     | 運営側通知              | 必須                                         |
| P0     | 前日・当日リマインド    | 必須                                         |
| P0     | 管理者による代理予約    | 必須                                         |
| P0     | 日次運用ビュー          | 必須                                         |
| P1     | 公開/非公開制御         | 早期に入れる                                 |
| P1     | 管理者による予約変更    | 早期に入れる                                 |
| P2     | オンライン決済          | 回数券/有料予約を本格運用する段階            |
| P2     | キャンセル待ち          | 人気枠が出てから                             |
| P2     | スタッフ/設備の実体管理 | 複数スタッフ・複数部屋運用が必要になってから |

---

# 3. 機能仕様

## 3.1 店舗ごとの公開予約成立

### 目的

現在の課題は、公開ページは `/{orgSlug}/{storeSlug}` で見られるのに、自己参加登録 API が `PUBLIC_EVENTS_ORG_SLUG` の組織に縛られている点です。複数組織・複数店舗の予約 SaaS としては、公開予約の参加登録も URL の `orgSlug` / `storeSlug` を正として解決する必要があります。

### 仕様

公開予約では、次の順で解決します。

1. `orgSlug` から `organization` を取得
2. `storeSlug` から `store` を取得
3. `store.organizationId === organization.id` を検証
4. 公開サイト設定 `public_site_setting` を取得
5. 公開状態・受付状態を検証
6. 対象サービス・枠がその `store` に属していることを検証
7. 予約を作成

### URL

```txt
GET  /{orgSlug}/{storeSlug}
GET  /{orgSlug}/{storeSlug}/events
GET  /{orgSlug}/{storeSlug}/events/{slotId}

GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/site
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events/{slotId}
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings
```

### 予約作成時の必須チェック

```txt
- organization が存在する
- store が存在する
- store が organization に属する
- public_site_setting.status = public
- public_site_setting.acceptBookings = true
- service.status = public
- slot.status = open
- slot.storeId が URL の storeId と一致する
- 残席数 >= participantsCount
- 締切時刻を過ぎていない
- キャンセル/予約停止期間ではない
```

`status` と `acceptBookings` は現行の `public_site_setting` には未追加のため、公開/非公開制御の実装時に migration で拡張します。

### 予約番号

参加者向けには DB の内部 ID を出さず、公開表示用の `bookingPublicId` を返します。

```txt
bookingPublicId: bk_ランダム文字列
```

`bookingPublicId` は予約番号として表示・問い合わせ照合に使います。ただし、これだけで予約確認やキャンセルを許可してはいけません。

キャンセル URL や確認 URL には、用途別の署名付きトークンを付けます。おすすめは、ランダムトークンを発行し、DB にはハッシュだけを保存する方式です。

```txt
booking_public_action_token
- id
- bookingId
- purpose: confirm | cancel
- tokenHash
- emailSnapshot
- expiresAt
- usedAt
- createdAt
```

URL 例:

```txt
/{orgSlug}/{storeSlug}/bookings/{bookingPublicId}/cancel?token=raw_token
```

キャンセル実行時は以下を確認します。

```txt
- tokenHash が一致する
- purpose = cancel
- expiresAt を過ぎていない
- usedAt が null
- bookingPublicId と bookingId が一致する
- booking.status がキャンセル可能
- rate limit に抵触していない
```

キャンセル成功後は `usedAt` を更新します。再利用や URL 流出による第三者操作を防ぐためです。

---

## 3.2 予約者情報入力

### 目的

Web から常に `participantsCount = 1` 固定だと、店舗運用では不足します。小規模スクール・教室・体験レッスンでは、電話番号、人数、同伴者名、備考、利用目的、経験有無などが必要になります。

### MVPで標準搭載する項目

| 項目           |                必須 | 備考                             |
| -------------- | ------------------: | -------------------------------- |
| 氏名           |                必須 | 参加者本人または代表者           |
| メールアドレス |                必須 | 予約確認・リマインド送信用       |
| 電話番号       | 任意/店舗設定で必須 | 当日連絡用                       |
| 人数           |                必須 | 初期値1、上限はサービス/枠で設定 |
| 同伴者名       |                任意 | 人数が2以上の場合のみ表示可      |
| 備考           |                任意 | 体験目的、連絡事項など           |
| 利用目的       |                任意 | セレクト式にできる               |
| 同意チェック   |         任意/設定可 | キャンセルポリシー等             |

### カスタム入力項目

サービス単位または予約ページ単位で `intakeFormSchema` を持たせます。

```ts
type IntakeFieldType = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'number' | 'date';

type IntakeField = {
  id: string;
  label: string;
  type: IntakeFieldType;
  required: boolean;
  options?: string[];
  helpText?: string;
  placeholder?: string;
  visibleOnPublic: boolean;
};
```

### 保存先

```txt
booking
- id
- organizationId
- storeId
- serviceId
- slotId
- status
- source
- participantsCount
- customerName
- customerEmail
- customerPhone
- note
- createdAt

booking_answer
- id
- bookingId
- fieldId
- labelSnapshot
- valueJson
- createdAt

booking_companion
- id
- bookingId
- name
- note
```

`labelSnapshot` を持つ理由は、後からフォーム項目名を変えても過去予約の意味が壊れないようにするためです。

---

## 3.3 運営側への予約通知

### 目的

MVPでは、参加者への確認メールよりも「運営が予約に気づける」ことが重要です。STORES予約や SelectType のように通知・メッセージ配信が予約システムの中核機能になっているため、reserve-app でも P0 として入れるべきです。([STORES][1])

### 通知イベント

```txt
booking.created
booking.pending_approval
booking.confirmed
booking.cancelled_by_participant
booking.cancelled_by_staff
booking.rescheduled
booking.reminder_sent
booking.no_show_marked
```

### 通知先

店舗単位で以下を設定します。

```txt
public_site_notification_setting
- storeId
- notifyOwner: boolean
- notifyAdmins: boolean
- notifyStoreManagers: boolean
- notifyStaff: boolean
- additionalEmailsJson: string[]
```

MVPではメールのみで十分です。LINE・Slack・Webhook は後回しでよいです。

### 通知ログ

```txt
notification_log
- id
- organizationId
- storeId
- bookingId
- eventType
- channel: email
- recipientEmail
- status: pending | sent | failed | skipped
- dedupeKey
- errorMessage
- sentAt
- createdAt
```

`dedupeKey` を置き、再試行や Cron の重複実行でも同じ通知が二重送信されないようにします。

---

## 3.4 予約前日・当日リマインド

### 目的

No-show 対策として、前日または数時間前のリマインドは MVP に含めてよいです。STORES予約は前日のリマインドメールやLINE経由の来店前日メッセージを打ち出しており、SelectTypeも予約前日のリマインドメールを機能として掲げています。([STORES][1])

### MVP仕様

サービスまたは店舗単位で設定します。

```txt
reminder_policy
- id
- storeId
- enabled
- timingType: default | custom
- beforeStartMinutesJson: [1440, 180]
- sendToCustomer: boolean
- sendToStaff: boolean
```

初期値は以下でよいです。

```txt
前日 18:00 相当、または開始24時間前
開始3時間前
```

実装を簡単にするなら、`beforeStartMinutes` で統一します。

### 送信対象

```txt
- booking.status = confirmed
- slot.startAt が now より未来
- reminder_log に同一 bookingId + timing が存在しない
- customerEmail が存在する
```

### Cron

Cloudflare Workers の scheduled handler で、15分または1時間ごとに送信対象を探します。

```txt
scheduled()
  -> findDueReminders(now)
  -> create reminder_log pending
  -> send email
  -> mark sent / failed
```

---

## 3.5 管理者による代理予約

### 目的

スクール・教室系では、電話・LINE・店頭で受けた予約をスタッフが登録する導線が必須です。公開ページだけでは実運用に乗りません。

### 管理画面

```txt
/{orgSlug}/{storeSlug}/admin/bookings/new
```

### 入力項目

```txt
- サービス
- 日時/枠
- 既存参加者 or 新規参加者
- 氏名
- メール
- 電話番号
- 人数
- 同伴者
- 備考
- 受付経路: phone | line | storefront | admin | other
- 通知を送る: true/false
- 回数券を消費する: true/false
```

### 権限

```txt
organization owner/admin
store manager/staff
```

`member` は代理予約不可でよいです。

### 予約ソース

```ts
type BookingSource = 'public_web' | 'admin' | 'phone' | 'line' | 'storefront' | 'import';
```

### 監査ログ

代理予約は必ず audit log に残します。

```txt
audit_log
- actorUserId
- action: booking.create_by_staff
- targetBookingId
- organizationId
- storeId
- metadataJson
- createdAt
```

---

# 4. 次点機能の仕様

## 4.1 公開/非公開の制御

### 目的

URLを知っていれば常に見える状態は避けるべきです。公開予約ページには、最低限の公開状態と受付停止設定が必要です。

### 公開状態

```ts
type PublicStatus =
  | 'draft' // 管理者のみ閲覧
  | 'public' // 一般公開
  | 'unlisted' // URLを知っている人のみ、noindex
  | 'private' // 非公開
  | 'suspended'; // 受付停止・表示停止
```

### 受付状態

```txt
acceptBookings: boolean
bookingSuspendedReason: string | null
showSuspendedReason: boolean
```

### 適用単位

```txt
- 店舗公開サイト単位
- サービス単位
- 枠単位
```

MVPでは、まず「店舗公開サイト単位」と「サービス単位」で十分です。

---

## 4.2 予約変更・日程変更

### MVPでは運営側の日程変更を優先

参加者の自由な変更機能は複雑になりやすいため、まずは運営側が日程変更できる仕様にします。

### ステータス

現行の予約ステータスは維持します。
日程変更は `booking.status` を `confirmed` のままにし、変更履歴で `reschedule` として記録します。
キャンセルや却下は既存の `cancelled_by_staff` / `rejected_by_staff` を使います。

### 変更時の処理

```txt
1. 変更先 slot の空き確認
2. 旧 slot の予約人数を戻す
3. 新 slot の予約人数を確保
4. booking.slotId を更新
5. booking_change_log を作成
6. 参加者・運営に通知
```

### 変更ログ

```txt
booking_change_log
- id
- bookingId
- changedByUserId
- changeType: reschedule | cancel | update_info
- beforeJson
- afterJson
- reason
- createdAt
```

参加者からの変更申請は P1.5 でよいです。

```txt
booking_change_request
- bookingId
- requestedBy: customer
- requestedSlotId
- message
- status: pending | approved | rejected | cancelled
```

---

## 4.3 日次運用ビュー

### 目的

当日の現場では、予約カレンダーよりも「今日誰が来るか」「電話番号は何か」「何人か」「支払い/回数券はどうなっているか」が重要です。SelectTypeもCSV出力を予約システム機能として出しているため、reserve-app でも日次一覧とCSVは早めに入れる価値があります。([SelectType(セレクトタイプ)][4])

### URL

```txt
/{orgSlug}/{storeSlug}/admin/operations/day?date=2026-05-30
```

### 表示項目

```txt
- 時刻
- サービス名
- 予約者名
- 人数
- 電話番号
- メール
- 備考
- 回数券残数
- 支払い状態
- 予約状態
- 出欠状態
```

### 操作

```txt
- 出席にする
- 欠席にする
- 無断欠席にする
- キャンセルする
- 日程変更する
- 参加者にメール再送
- CSV出力
- 印刷用表示
```

### 出欠ステータス

```ts
type AttendanceStatus = 'not_checked' | 'checked_in' | 'absent' | 'no_show';
```

---

# 5. P2 機能

## 5.1 オンライン決済

### 方針

MVP直後までは、現地決済・銀行振込・手動承認で十分です。既存方針どおり、決済は完全自作せず Stripe に寄せます。

### 支払い方式

```ts
type PaymentRequirement =
  | 'none' // 無料
  | 'pay_later' // 現地決済
  | 'bank_transfer' // 銀行振込
  | 'manual_approval' // 管理者確認後に有効化
  | 'online_required'; // 事前決済必須
```

### MVPでは入れる範囲

```txt
- 予約自体は無料/現地決済/銀行振込メモで受ける
- 回数券購入申請は pending
- 管理者が入金確認後に回数券を有効化
```

### Stripe対応時

```txt
payment_order
- id
- organizationId
- storeId
- customerId
- kind: booking | ticket_pack | monthly_fee
- amount
- currency
- status: pending | paid | failed | cancelled | refunded
- stripeCheckoutSessionId
- stripePaymentIntentId
- createdAt
```

オンライン決済を入れた段階で、特商法表示、返金ポリシー、領収書、住所・氏名等の取得範囲を整理します。住所入力は「無料予約」では不要にし、有料販売や請求・領収書が絡む導線で必要最小限にするのがよいです。

---

## 5.2 キャンセル待ち

### 方針

MVPでは不要です。ただしテーブル設計は後から足しやすくしておきます。

### 仕様

```txt
waitlist_entry
- id
- bookingSlotId
- customerName
- customerEmail
- customerPhone
- participantsCount
- status: waiting | offered | confirmed | expired | cancelled
- position
- offeredUntil
- createdAt
```

### 昇格方式

初期は手動昇格で十分です。

```txt
1. キャンセル発生
2. 管理画面でキャンセル待ち一覧を表示
3. スタッフが対象者を選ぶ
4. 確認メールを送る
5. 期限内に参加者が確定
```

自動昇格は後回しでよいです。SelectTypeはキャンセル待ちと自動昇格を打ち出していますが、reserve-app の初期段階では運用ミスを避けるため手動昇格の方が安全です。([SelectType(セレクトタイプ)][4])

---

## 5.3 スタッフ/設備の実体管理

### 方針

現在の `staffLabel` / `locationLabel` は MVP では許容できます。ただし、将来の衝突チェックに備えて `staff` / `resource` テーブルを用意できる形にします。

### 将来モデル

```txt
staff
- id
- organizationId
- storeId
- userId nullable
- displayName
- status

resource
- id
- organizationId
- storeId
- type: room | equipment | court | seat | other
- name
- capacity
- status

slot_assignment
- slotId
- staffId nullable
- resourceId nullable
```

### 衝突チェック

```txt
- 同一 staff が同じ時間に複数 slot に割り当てられていない
- 同一 resource が同じ時間に複数 slot に割り当てられていない
```

これは複数講師・複数部屋が必要になった段階で実装すればよいです。

---

# 6. 予約ステータス設計

MVPでは現行ステータスを維持します。
新しい状態名へ置き換える必要はありません。

```ts
type BookingStatus =
  | 'pending_approval' // 承認待ち
  | 'confirmed' // 確定
  | 'cancelled_by_participant' // 参加者キャンセル
  | 'cancelled_by_staff' // 運営キャンセル
  | 'rejected_by_staff' // 運営却下
  | 'no_show'; // 無断欠席
```

### 即時確定フロー

```txt
public_web booking
-> confirmed
-> confirmation email to customer
-> notification email to staff
-> reminder email
-> checked_in / no_show
```

### 承認制フロー

```txt
public_web booking
-> pending_approval
-> staff notification
-> staff approve
-> confirmed
-> confirmation email to customer
-> reminder email
```

### 代理予約フロー

```txt
admin booking
-> confirmed or pending_approval
-> optional customer email
-> audit log
```

---

# 7. 推奨データモデル

## 7.1 公開サイト

```txt
public_site_setting
- id
- organizationId
- storeId
- orgSlugSnapshot
- storeSlug
- siteName
- description
- address
- phone
- status: draft | public | unlisted | private | suspended
- acceptBookings
- noindex
- coverImageUrl
- createdAt
- updatedAt
```

`orgSlugSnapshot` は必須ではありませんが、slug変更時の調査やログ確認に便利です。正規解決は `organization.slug` と `store.slug` で行います。

## 7.2 予約ページ/サービス

既存の service に寄せてもよいですが、公開ページ設定を分離するなら以下です。

```txt
booking_page
- id
- organizationId
- storeId
- publicSiteId
- serviceId
- slug
- bookingType: menu | lesson_event | school
- status: draft | public | private
- intakeFormSchemaJson
- bookingPolicyJson
- reminderPolicyId
- notificationPolicyId
- createdAt
- updatedAt
```

## 7.3 予約

```txt
booking
- id
- publicId
- organizationId
- storeId
- serviceId
- slotId
- customerId nullable
- status
- source
- participantsCount
- customerName
- customerEmail
- customerPhone
- note
- paymentRequirement
- paymentStatus
- attendanceStatus
- createdByUserId nullable
- createdAt
- updatedAt
```

## 7.4 通知・リマインド

```txt
notification_log
- id
- organizationId
- storeId
- bookingId
- eventType
- channel
- recipient
- status
- dedupeKey
- errorMessage
- sentAt
- createdAt

reminder_log
- id
- bookingId
- reminderPolicyId
- beforeStartMinutes
- status
- sentAt
- createdAt
```

---

# 8. API案

## Public API

現行の公開 API に合わせます。
公開ページの閲覧はログイン不要です。
予約作成・キャンセルは現行では認証済み API に寄せ、公開キャンセルを追加する場合だけ署名付きトークン API を増やします。

```txt
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/site
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events/{slotId}
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/ticket-types/{ticketTypeId}

POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/cancel

追加候補:
POST /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/bookings/{bookingPublicId}/cancel
```

`/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/...` は現行の店舗スコープ付き facade として扱います。backend 内部では `/api/v1/auth/organizations/...` に `organizationId` と `storeId` を付与して転送されます。

### 予約作成リクエスト

以下は予約者情報入力を追加した後のリクエスト案です。現行の予約作成 API は `slotId` と `participantsCount` を中心に受け取ります。

```json
{
  "serviceId": "svc_xxx",
  "slotId": "slot_xxx",
  "customerName": "山田太郎",
  "customerEmail": "taro@example.com",
  "customerPhone": "090-xxxx-xxxx",
  "participantsCount": 2,
  "companions": [{ "name": "山田花子" }],
  "note": "体験希望です",
  "answers": [
    {
      "fieldId": "purpose",
      "value": "体験レッスン"
    }
  ]
}
```

## Admin API

現行の店舗スコープ付き API に合わせます。
代理予約・日程変更・出欠確認は追加候補として扱います。

```txt
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/cancel-by-staff
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/approve
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/reject
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/no-show

追加候補:
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/staff-create
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/reschedule
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/check-in
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/operations/day?date=YYYY-MM-DD
```

---

# 9. 画面仕様

## 公開予約ページ

```txt
/{orgSlug}/{storeSlug}
```

表示内容:

```txt
- 店舗名
- 説明
- 住所
- 電話番号
- サービス一覧
- 予約可能日時
- 予約者情報入力
- 確認画面
- 完了画面
```

## 管理画面

```txt
/{orgSlug}/{storeSlug}/admin/bookings
/{orgSlug}/{storeSlug}/admin/bookings/new
/{orgSlug}/{storeSlug}/admin/operations/day
/{orgSlug}/{storeSlug}/admin/public-site
/{orgSlug}/{storeSlug}/admin/notification-settings
```

---

# 10. 課金境界案

既存方針どおり、`1 organization = 1 subscription` を維持します。店舗ごとの請求ではなく、組織に対して請求する設計でよいです。

### Free

```txt
- 1 organization
- 1 store
- 公開予約ページ 1〜2
- 月間予約 50件程度
- 予約者情報入力
- 運営通知
- 前日リマインド
```

### Premium

```txt
- 複数 store
- 公開予約ページ複数
- スタッフ招待
- 承認制予約
- 回数券
- CSV出力
- 日次運用ビュー
- カスタム入力項目
```

STORES予約もフリーでは月間予約件数・公開ページ数を小さくし、有料プランでページ数・スタッフ数・予約件数を増やす構造になっているため、reserve-app でも「複数店舗」「スタッフ管理」「回数券」「承認制」を Premium に寄せる設計が自然です。([STORES][1])

---

# 11. 実装順

## Step 1: 公開予約 API の store 化

最初に直すべきです。

```txt
- PUBLIC_EVENTS_ORG_SLUG 依存をなくす
- orgSlug/storeSlug から organization/store を解決
- service/slot が store に属することを検証
- public booking 作成を store 必須にする
```

## Step 2: 予約者情報入力

```txt
- participantsCount をWebフォームから入力可能にする
- phone/note/answers を追加
- booking_answer を保存
- 人数による残席チェックを修正
```

## Step 3: 運営通知

```txt
- booking.created イベントを発火
- notification_log を作成
- store manager / staff / additionalEmails に送信
- 失敗時にログで確認可能にする
```

## Step 4: リマインド

```txt
- reminder_policy
- reminder_log
- scheduled handler
- 二重送信防止
```

## Step 5: 管理者代理予約

```txt
- 管理画面から予約作成
- source を admin/phone/line/storefront で保存
- 通知送信有無を選択
- audit log に記録
```

## Step 6: 日次運用ビュー

```txt
- 当日予約一覧
- 連絡先/人数/備考/回数券/支払い状態
- 出席/欠席/no-show
- CSV出力
```

---

# 12. MVPの受け入れ条件

以下を満たせば、予約 SaaS として最低限の実運用に乗ります。

```txt
1. /{orgSlug}/{storeSlug} から店舗ごとの予約ページが表示できる
2. 別 organization / 別 store の slot を予約できない
3. 参加者が氏名・メール・電話・人数・備考を入力して予約できる
4. participantsCount が残席計算に反映される
5. 予約完了時に参加者へ確認メールが送られる
6. 予約完了時に運営側へ通知メールが送られる
7. 前日または数時間前にリマインドが一度だけ送られる
8. スタッフが電話/LINE/店頭予約を代理登録できる
9. 管理画面の日次ビューで当日の予約者・連絡先・人数・出欠を確認できる
10. 公開停止中の店舗/サービスには予約できない
```

---

# 結論

reserve-app の次実装は、次の順番が最も費用対効果が高いです。

```txt
1. 店舗ごとの公開予約成立
2. 予約者情報入力
3. 運営通知
4. リマインド
5. 管理者代理予約
6. 日次運用ビュー
7. 公開/非公開制御
```

オンライン決済、キャンセル待ち、スタッフ/設備の実体管理は重要ですが、最初から入れると MVP が重くなります。まずは「公開ページから予約が入り、店舗が気づき、当日対応できる」状態を完成させるのがよいです。

[1]: https://stores.jp/reserve '予約システム 無料プランあり・24時間ネット予約受付｜STORES 予約（ストアーズ）'
[2]: https://reserva.be/ '予約システム RESERVA(レゼルバ) | 無料で予約管理'
[3]: https://www.hacomono.jp/feature/ 'hacomonoとは｜オールインワンマネジメントシステム｜hacomono'
[4]: https://select-type.com/ '予約システムを中心に業務を一元化｜無料で使えるSelectType'
