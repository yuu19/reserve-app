# reserve-app 通知Outboxパターン MVP仕様書 v2

- 作成日: 2026-06-06
- 想定配置: `docs/current/notification-outbox-mvp.md`
- 前提: Cloudflare Workers + D1。現在は予約作成・キャンセル・日程変更・No-show・リマインドなどのメール通知が一部実装済み。通知処理を業務APIから分離し、`notification_outbox` を中心に再整理する。

---

## 0. 結論

予約作成・キャンセル・日程変更・No-show・リマインドなどの処理中に、メール送信関数を直接呼ばない。

代わりに、業務データの更新と同じトランザクションで `notification_outbox` に通知ジョブを作成し、別処理で送信する。

```txt
予約作成API
  ↓
booking 作成・更新
  ↓
notification_outbox 作成
  ↓
transaction commit
  ↓
APIレスポンス返却
  ↓
scheduled handler / ctx.waitUntil が due outbox を処理
  ↓
メール送信
  ↓
notification_log 記録
  ↓
notification_outbox 更新
```

MVPでは通知チャネルは `email` のみとする。

```txt
MVP対象:
  email

MVP対象外:
  LINE
  Slack
  SMS
  Webhook
  Push通知
```

重要な前提として、MVPの配送保証は **at-least-once** とする。

```txt
保証する:
  - 同じ業務イベントに対する outbox job の二重作成を防ぐ
  - 失敗したジョブを再試行する
  - 送信状態・失敗理由を追跡できる

保証しない:
  - メール配送の exactly-once
  - Worker 障害時の完全な重複送信防止
  - メールプロバイダ側で送信成功したがDB更新前に落ちた場合の自動判定
```

---

## 1. 目的

## 1.1 現在の課題

業務API内で直接メールを送ると、以下の問題が起きやすい。

```txt
- 予約は作成できたが通知だけ失敗した状態を追いにくい
- メール送信失敗時に予約作成まで失敗させるべきか判断が難しい
- リトライがしづらい
- リマインドと通常通知の仕組みが分散する
- 送信ログと実送信状態が一致しづらい
- scheduled handler の重複実行時に二重送信しやすい
```

## 1.2 Outbox導入後の目的

```txt
- 予約などの業務データ更新と通知ジョブ作成を同一トランザクションにする
- 外部メール送信をAPIレスポンスから分離する
- 失敗時に自動リトライできる
- ジョブ作成の重複を idempotency_key で防ぐ
- 通常通知とリマインドを同じ仕組みに統合する
- 管理画面・ログから通知状態を確認できるようにする
```

---

## 2. 設計方針

## 2.1 Outboxを通知予定の正本にする

通知予定・送信待ち・再試行待ち・送信済みの現在状態は `notification_outbox` を正本にする。

```txt
notification_outbox:
  通知ジョブの現在状態

notification_log:
  各送信試行・成功・失敗・スキップ・手動処理の履歴
```

既存の `notification_log` は維持し、Outbox送信結果の履歴として利用する。

既存の `reminder_log` は新規利用しない。リマインドも `notification_outbox` + `notification_log` に統合する。

## 2.2 業務APIで直接送信しない

以下の処理ではメール送信関数を直接呼ばない。

```txt
予約作成
予約申込受付
予約承認
予約キャンセル
予約日程変更
No-show登録
リマインド対象予約の検出
```

業務APIでは `notification_outbox` を作るだけにする。

## 2.3 idempotency_key はジョブ作成重複の防止に使う

すべての通知ジョブに `idempotency_key` を持たせる。

```txt
同じ idempotency_key の notification_outbox は1件だけ作成できる
```

ただし、`idempotency_key` が防ぐのは **ジョブ作成の重複** であり、メール配送の重複ではない。

```txt
防げる:
  - 同じ予約作成イベントで同じ outbox job が2件作られる
  - APIリトライで同じ outbox job が2件作られる

防げない:
  - claim 後にメール送信が成功し、sent 更新前に Worker が落ちるケース
  - メールプロバイダ側は受信したが、DBには失敗・未完了として残るケース
  - retry による同一メールの再送
```

## 2.4 配送保証は at-least-once と明記する

MVPでは、メール送信は at-least-once とする。

```txt
at-least-once:
  少なくとも1回送ろうとする
  障害時には再試行する
  結果として同じ宛先に同じ通知が複数回届く可能性がある
```

重複送信を完全には防がない代わりに、以下を行う。

```txt
- 同じ idempotency_key の job を重複作成しない
- notification_log に attempt_started / sent / failed を append-only で記録する
- 送信成否が不明な場合は notification_outbox.status = ambiguous として手動確認対象にする
- retry 発生時に attempt_count を増やす
- provider_message_id を保存する
- 管理画面やログで同一 outbox の複数成功・複数試行を確認できるようにする
```

## 2.5 重複送信の扱い

MVPでは、メールの重複送信は低頻度の運用上の例外として許容する。

重複が起こりうる代表例:

```txt
1. Worker が outbox を processing にする
2. メールプロバイダへ送信する
3. プロバイダ側では送信成功
4. notification_log / outbox.sent 更新前に Worker が落ちる
5. lock timeout 後に同じ job が retry される
6. 同じメールが再送される可能性がある
```

検知方針:

```txt
- 同一 outbox_id に複数の sent log がある
- 同一 idempotency_key に対して複数 provider_message_id がある
- attempt_started のまま完了ログがない
- ユーザー・運営から重複受信の問い合わせがある
```

手動照合方針:

```txt
- notification_outbox と notification_log を確認する
- provider_message_id がある場合はメールプロバイダ側の送信履歴と照合する
- 重複が確認された場合は duplicate_detected として notification_log に記録する
- 必要に応じて outbox を sent / cancelled / dead に手動更新する
```

MVPでは、重複送信を自動で取り消す・送信先に自動謝罪メールを送るなどの処理は行わない。

---

## 3. 現行イベントとの対応

## 3.1 現行イベントキー

現行実装では、少なくとも以下の通知イベントが存在する。

```txt
booking_confirmed
booking_application_received
booking_cancelled_by_participant
booking_cancelled_by_staff
booking_rescheduled
booking_no_show
booking_reminder
```

Outbox導入後も、MVPではこの意味を落とさない。

## 3.2 新 event_type と既存 template_key の分離

新Outboxでは、`event_type` と `template_key` を分ける。

```txt
event_type:
  Outbox内部でのイベント分類
  dotted形式を使う

template_key:
  既存メールテンプレート・既存イベント名との互換キー
  現行の booking_confirmed などを使える
```

これにより、Outbox内部のイベント名を整理しつつ、既存テンプレート名は落とさず移行できる。

## 3.3 対応表

| 現行イベント / template_key        | 新 event_type                      | 主な recipient_type | 用途                                                                 |
| ---------------------------------- | ---------------------------------- | ------------------- | -------------------------------------------------------------------- |
| `booking_confirmed`                | `booking.confirmed`                | `customer`, `store` | 予約確定通知。公開予約の即時確定では予約者向け・運営向けの両方を作成 |
| `booking_application_received`     | `booking.application_received`     | `customer`, `store` | 承認制予約の申込受付通知。予約者向け・運営向けの両方を作成           |
| `booking_cancelled_by_participant` | `booking.cancelled_by_participant` | `customer`, `store` | 参加者操作によるキャンセル通知                                       |
| `booking_cancelled_by_staff`       | `booking.cancelled_by_staff`       | `customer`, `store` | スタッフ操作によるキャンセル通知                                     |
| `booking_rescheduled`              | `booking.rescheduled`              | `customer`, `store` | 日程変更通知                                                         |
| `booking_no_show`                  | `booking.no_show`                  | `customer`          | No-show登録通知。現行実装に合わせ、予約者向け通知をMVP必須とする     |
| `booking_reminder`                 | `booking.reminder`                 | `customer`          | 予約前リマインド                                                     |

## 3.4 公開予約時の通知

公開予約で予約が作成された場合、予約者向けと運営向けの両方の通知を作る。

即時確定予約:

```txt
booking.confirmed / customer
booking.confirmed / store
```

現行実装では、公開予約が即時確定の場合、予約者向け・運営向けの両方で `booking_confirmed` 相当の通知を送る。Outbox化後も、store側だけ `booking.application_received` に変えない。

承認制予約:

```txt
booking.application_received / customer
booking.application_received / store
```

承認後:

```txt
booking.confirmed / customer
```

MVPでは、運営向けの「承認後確定通知」は任意。既に申込受付時に運営へ通知している場合は重複させない。

## 3.5 approved は booking.status として使わない

現行の予約ステータスに `approved` は存在しない。承認後の予約状態は `confirmed` とする。

したがって、Outbox仕様では以下を禁止する。

```txt
禁止:
  booking.status = approved
  reminder eligibility に approved を含める
```

承認という業務イベントは、通知イベントまたは操作ログとして扱う。

```txt
承認操作:
  booking.status を confirmed にする
  booking.confirmed / customer の outbox を作る
```

---

## 4. MVP対象通知

MVPで扱う通知は以下。

## 4.1 予約確定

```txt
event_type:
  booking.confirmed

template_key:
  booking_confirmed

recipient_type:
  customer
  store
```

公開予約が即時確定の場合は、予約者向け・運営向けの両方で `booking.confirmed` を作成する。承認制予約の申込受付では `booking.application_received` を使う。

## 4.2 予約申込受付

```txt
event_type:
  booking.application_received

template_key:
  booking_application_received

recipient_type:
  customer
  store
```

用途:

```txt
- 承認制予約で、予約者へ「申込を受け付けました」と通知する
- 公開予約で、運営へ新規予約・新規申込を通知する
```

## 4.3 参加者キャンセル

```txt
event_type:
  booking.cancelled_by_participant

template_key:
  booking_cancelled_by_participant

recipient_type:
  customer
  store
```

## 4.4 スタッフキャンセル

```txt
event_type:
  booking.cancelled_by_staff

template_key:
  booking_cancelled_by_staff

recipient_type:
  customer
  store
```

## 4.5 日程変更

```txt
event_type:
  booking.rescheduled

template_key:
  booking_rescheduled

recipient_type:
  customer
  store
```

## 4.6 No-show

```txt
event_type:
  booking.no_show

template_key:
  booking_no_show

recipient_type:
  customer
```

MVPでは、現行実装に合わせて No-show 登録時に予約者向け `booking_no_show` 相当の通知を作成する。運営向け No-show 通知は将来拡張とし、MVP必須にはしない。

## 4.7 リマインド

```txt
event_type:
  booking.reminder

template_key:
  booking_reminder

recipient_type:
  customer
```

---

## 4.8 store宛先のfan-out

`notification_outbox` は **1行 = 1通 = 1 recipient_email** とする。

そのため、`recipient_type = store` の通知は、ジョブ作成時に運営宛先を解決し、宛先メールアドレスごとに複数の outbox を作成する。

```txt
booking.confirmed / store
  ↓
運営宛先を解決
  ↓
owner@example.com 向け outbox
admin@example.com 向け outbox
manager@example.com 向け outbox
additional@example.com 向け outbox
```

宛先は `public_site_notification_setting` の設定に従って解決する。

```txt
対象候補:
  - owner
  - admin
  - store manager
  - staff
  - additional emails
```

MVPでは、以下のルールで展開する。

```txt
1. public_site_notification_setting から有効な運営通知先を取得する
2. 対象 role に属するユーザーの email を取得する
3. additional emails を追加する
4. email を小文字・trim して重複排除する
5. recipient_email ごとに notification_outbox を1行作る
```

同じメールアドレスが複数 role に含まれる場合も、送信は1通だけにする。

```txt
owner@example.com が owner と store manager の両方に該当
  → outbox は1行だけ作成
```

`recipient_type` は `store` とし、必要であれば `recipient_role` または `payload_json.recipientRole` に解決元を保存する。

```txt
recipient_type = store
recipient_email = owner@example.com
recipient_role = owner
```

`idempotency_key` は recipient_email を含めるため、fan-out 後の各宛先単位で重複作成を防ぐ。

```txt
booking.confirmed:booking_123:store:owner@example.com:v1
booking.confirmed:booking_123:store:admin@example.com:v1
```

設定変更後も、既に作成済みの即時通知 outbox は原則変更しない。

```txt
即時通知:
  作成時点の運営宛先スナップショットで送る

未来のリマインド:
  顧客向けのみのため store fan-out 対象外
```

## 5. DB設計

## 5.1 notification_outbox

通知ジョブの現在状態を保持する。

```sql
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY NOT NULL,

  organization_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  booking_id TEXT,
  participant_id TEXT,

  event_type TEXT NOT NULL,
  template_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,

  subject_snapshot TEXT,
  payload_json TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_for INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,

  idempotency_key TEXT NOT NULL,

  locked_at INTEGER,
  locked_by TEXT,
  lock_expires_at INTEGER,

  provider TEXT,
  provider_message_id TEXT,
  last_error TEXT,

  sent_at INTEGER,
  cancelled_at INTEGER,
  dead_at INTEGER,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### status

```txt
pending:
  送信待ち

processing:
  Worker が claim 済み

sent:
  送信成功として記録済み

retry:
  再試行待ち

cancelled:
  送信不要になった

dead:
  最大試行回数を超えて停止

skipped:
  送信直前条件で不要と判断した

ambiguous:
  送信成否が不明。手動確認が必要
```

MVPでは通常 `ambiguous` へ自動遷移しなくてもよいが、管理者が手動で設定できるようにしておくと運用しやすい。

### indexes

```sql
CREATE UNIQUE INDEX notification_outbox_idempotency_uidx
ON notification_outbox (idempotency_key);

CREATE INDEX notification_outbox_due_idx
ON notification_outbox (status, next_attempt_at, scheduled_for);

CREATE INDEX notification_outbox_booking_idx
ON notification_outbox (booking_id);

CREATE INDEX notification_outbox_store_idx
ON notification_outbox (organization_id, store_id, created_at);

CREATE INDEX notification_outbox_event_idx
ON notification_outbox (event_type, status, scheduled_for);
```

## 5.2 notification_log

各送信試行の履歴を append-only で残す。

`attempt_started` の行は、成功・失敗時に更新しない。成功・失敗・スキップなどの結果は別行として追加する。

```sql
CREATE TABLE notification_log (
  id TEXT PRIMARY KEY NOT NULL,

  outbox_id TEXT,
  organization_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  booking_id TEXT,

  event_type TEXT NOT NULL,
  template_key TEXT,
  channel TEXT NOT NULL,
  recipient_type TEXT,
  recipient_email TEXT,

  status TEXT NOT NULL,
  attempt_number INTEGER,
  provider TEXT,
  provider_message_id TEXT,
  error_message TEXT,
  response_json TEXT,

  created_at INTEGER NOT NULL
);
```

### notification_log.status

```txt
attempt_started:
  メール送信前に記録する

sent:
  プロバイダ送信成功後に記録する

failed:
  送信失敗時に記録する

skipped:
  送信直前条件で送らなかった

cancelled:
  pending outbox を送信前にキャンセルした

duplicate_detected:
  手動または検査で重複送信の可能性を検知した

manual_marked_sent:
  手動で送信済みに補正した

manual_marked_dead:
  手動でdead扱いにした
```

## 5.3 reminder_log

`reminder_log` は新規利用しない。

```txt
旧:
  reminder_log がリマインド送信履歴の正本

新:
  notification_outbox + notification_log が正本
```

MVP移行後は、リマインドも `event_type = booking.reminder` として扱う。

---

## 6. idempotency_key 設計

## 6.1 目的

`idempotency_key` は、同じ業務イベントから同じ通知ジョブが二重作成されることを防ぐために使う。

これは配送の完全重複防止ではない。

## 6.2 key形式

```txt
{event_type}:{booking_id}:{recipient_type}:{recipient_email}:{business_version}
```

例:

```txt
booking.confirmed:booking_123:customer:taro@example.com:v1
booking.application_received:booking_123:store:owner@example.com:v1
booking.cancelled_by_participant:booking_123:customer:taro@example.com:cancelled_at_1760000000
booking.rescheduled:booking_123:customer:taro@example.com:rescheduled_at_1760000000
booking.reminder:booking_123:customer:taro@example.com:1440:slot_start_1760000000
booking.reminder:booking_123:customer:taro@example.com:180:slot_start_1760000000
```

## 6.3 手動再送

手動再送は、元ジョブをそのまま再送するか、新しい job として作るかを明確に分ける。

### 元ジョブを再送する場合

```txt
同じ outbox_id を retry に戻す
idempotency_key は変えない
```

### 新しい通知として送る場合

```txt
idempotency_key に manual_retry を含める
```

例:

```txt
booking.confirmed:booking_123:customer:taro@example.com:v1:manual_retry_1
```

---

## 7. リマインド仕様

## 7.1 現行機能を維持する

MVPでも、現行の以下の考え方を維持する。

```txt
- 店舗単位のリマインド設定
- サービス単位の上書き設定
- 24時間前リマインド
- 3時間前リマインド
```

MVPでは、予約作成時または予約確定時に、未来の `booking.reminder` outbox job を作成する。

## 7.2 設定モデル

既存設定に合わせて、概念として以下を扱う。

```txt
store reminder setting:
  enabled
  offsets: [1440, 180]

service reminder override:
  inherit
  disabled
  enabled with offsets: [1440, 180]
```

単位は分単位とする。

```txt
1440 = 24時間前
180 = 3時間前
```

## 7.3 設定解決ルール

リマインド設定は以下の優先順位で解決する。

```txt
service override
  > store default
```

例:

```txt
store:
  enabled: true
  offsets: [1440, 180]

service:
  inherit

結果:
  [1440, 180]
```

```txt
store:
  enabled: true
  offsets: [1440, 180]

service:
  disabled

結果:
  []
```

```txt
store:
  enabled: true
  offsets: [1440]

service:
  enabled
  offsets: [180]

結果:
  [180]
```

## 7.4 予約開始時刻の参照元

現行 schema では、予約開始・終了時刻は `booking` ではなく `slot` に保持される。

```txt
booking.slot_id
  ↓
slot.start_at
slot.end_at
```

したがって、Outbox仕様内でいう「予約開始時刻」は、常に `booking.slot_id -> slot.start_at` から導く。

```txt
予約開始時刻 = slot.start_at
予約終了時刻 = slot.end_at
```

`booking.start_at` / `booking.end_at` というカラムを前提にしない。

## 7.5 リマインド outbox 作成タイミング

以下のタイミングで pending の reminder outbox を作る。

```txt
- 即時確定予約が作成されたとき
- 承認制予約が confirmed になったとき
- 予約が rescheduled されたとき
```

対象条件:

```txt
booking.status = confirmed
予約開始時刻が未来
customer_email が存在する
解決後の reminder offsets が1つ以上ある
```

`approved` status は使わない。

## 7.6 scheduled_for

```txt
scheduled_for = slot.start_at - offset_minutes
```

例:

```txt
24時間前:
  slot.start_at - 1440 minutes

3時間前:
  slot.start_at - 180 minutes
```

`scheduled_for <= now` の場合は、MVPでは作成しない。

理由:

```txt
- 設定変更後に過去時刻のリマインドを後追い送信しない
- 予約直前に意図しない大量通知を出さない
```

## 7.7 キャンセル時

予約がキャンセルされた場合、未送信の reminder outbox を `cancelled` にする。

対象:

```txt
booking_id = 対象予約
status IN ('pending', 'retry', 'processing')
event_type = 'booking.reminder'
```

`processing` 中の job を確実に止められない場合があるため、送信直前にも booking.status を再確認する。

## 7.8 日程変更時

予約が日程変更された場合、既存の未送信 reminder outbox を cancel し、新しい開始時刻に基づいて作り直す。

```txt
1. pending/retry の booking.reminder を cancelled にする
2. 新しい slot.start_at で reminder offsets を再解決する
3. scheduled_for が未来の reminder outbox を作成する
```

idempotency_key には `slot_start`、つまり `booking.slot_id -> slot.start_at` から導いた開始時刻を含める。

## 7.9 リマインド設定変更時

店舗またはサービスのリマインド設定を変更した場合、未来の pending reminder outbox を更新する必要がある。

MVPでは、設定変更時に対象予約の pending reminder を再生成する。

### 対象予約

```txt
organization_id = current organization
store_id = current store
booking.status = confirmed
予約開始時刻 > now
```

サービス設定変更時は、対象 service の予約だけを対象にする。

```txt
booking.service_id = changed service_id
```

### 再生成手順

```txt
1. 対象予約の未送信 booking.reminder outbox を cancelled にする
2. 現在の設定から reminder offsets を再解決する
3. scheduled_for > now の reminder outbox を新規作成する
4. scheduled_for <= now の reminder は作成しない
```

### 対象 outbox status

```txt
cancel対象:
  pending
  retry

cancel対象外:
  processing
  sent
  dead
  cancelled
  skipped
```

`processing` 中の job は、送信直前の booking/status/settings 再チェックで止める。

## 7.9 送信直前の再チェック

リマインド送信前には、必ず最新状態を確認する。

```txt
- booking が存在する
- booking.status = confirmed
- 予約開始時刻が未来
- scheduled_for <= now
- 現在の reminder 設定でも同じ offset が有効
- customer_email が存在する
```

条件を満たさない場合は送信せず `skipped` にする。

---

## 8. 業務イベント別Outbox作成

## 8.1 公開予約作成

即時確定予約の場合:

```txt
booking.status = confirmed

作成する outbox:
  booking.confirmed / customer
  booking.confirmed / store
  booking.reminder / customer  ※設定に応じて 24h / 3h
```

承認制予約の場合:

```txt
booking.status = pending_approval

作成する outbox:
  booking.application_received / customer
  booking.application_received / store

作成しない:
  booking.reminder
```

## 8.2 承認

承認操作では、予約状態を `confirmed` にする。

```txt
booking.status = confirmed

作成する outbox:
  booking.confirmed / customer
  booking.reminder / customer  ※設定に応じて 24h / 3h
```

`booking.status = approved` は使わない。

## 8.3 参加者キャンセル

```txt
booking.status = cancelled
cancelled_by = participant

作成する outbox:
  booking.cancelled_by_participant / customer
  booking.cancelled_by_participant / store

更新する outbox:
  未送信 booking.reminder を cancelled
```

## 8.4 スタッフキャンセル

```txt
booking.status = cancelled
cancelled_by = staff

作成する outbox:
  booking.cancelled_by_staff / customer
  booking.cancelled_by_staff / store

更新する outbox:
  未送信 booking.reminder を cancelled
```

## 8.5 日程変更

```txt
booking.slot_id を新しい slot に更新

作成する outbox:
  booking.rescheduled / customer
  booking.rescheduled / store

更新する outbox:
  旧 booking.reminder を cancelled
  新 booking.reminder を作成
```

## 8.6 No-show

```txt
booking.status = no_show

作成する outbox:
  booking.no_show / customer
```

現行実装では No-show 登録時に予約者向け `booking_no_show` が送信されるため、MVPでも予約者向け通知を落とさない。運営向け No-show 通知は将来拡張とする。

---

## 9. トランザクション仕様

## 9.1 同一トランザクションを必須にする

以下の業務処理では、業務データ更新と outbox 作成を同一トランザクションで行う。

```txt
予約作成
予約承認
予約キャンセル
予約日程変更
No-show登録
```

例:

```txt
予約作成 transaction:
  booking insert
  booking_companion insert
  form_submissions insert
  notification_outbox insert
```

Outbox作成に失敗した場合は、業務処理全体を rollback する。

```txt
notification_outbox 作成失敗
  ↓
booking 作成も失敗
```

## 9.2 D1 transaction fallback を禁止する

現行 helper が D1 transaction 非対応時に通常実行へ fallback する場合、Outbox対象の業務処理ではその fallback を使わない。

MVPでは、Outboxを作成する usecase に対して以下を必須にする。

```txt
- transaction が利用できない場合は fail fast する
- fallback 通常実行で booking 作成と outbox 作成を分離しない
- create booking + create outbox の部分は必ず atomic にする
```

実装方針:

```txt
通常用途:
  transactionOrThrow を使う

禁止:
  transaction がなければ非transactionで順番に実行する fallback
```

ローカルテストで transaction が使えない場合は、テスト用の transaction mock を用意する。

## 9.3 例外

リマインド設定変更時の pending reminder 再生成は、対象件数が多くなる可能性がある。

MVPでは以下でよい。

```txt
- 設定更新自体は transaction で保存する
- pending outbox のキャンセル・再生成は同一リクエスト内で行う
- 途中失敗した場合は管理者が再実行できるようにする
```

将来的には、設定変更後の再生成自体も別 job にしてよい。

---

## 10. 送信Worker仕様

## 10.1 起動方法

MVPでは以下の2つを併用してよい。

```txt
ctx.waitUntil:
  予約作成などの直後に短い遅延で処理

scheduled handler:
  定期的に pending/retry/due の outbox を処理
```

ただし、正本は常に `notification_outbox` とする。

## 10.2 claim 条件

処理対象:

```txt
status IN ('pending', 'retry')
next_attempt_at <= now
scheduled_for <= now
```

claim 時に以下を更新する。

```txt
status = processing
locked_at = now
locked_by = worker instance id
lock_expires_at = now + lock_timeout
attempt_count = attempt_count + 1
updated_at = now
```

## 10.3 processing timeout

`processing` のまま `lock_expires_at < now` になった job は、再試行対象に戻す。

```txt
status = retry
next_attempt_at = now
last_error = 'processing timeout'
```

この処理は重複送信の可能性があるため、at-least-once の範囲として扱う。

## 10.4 送信前ログ

メール送信前に `notification_log` に `attempt_started` を作る。

```txt
notification_log.status = attempt_started
attempt_number = outbox.attempt_count
```

これにより、Workerが送信途中で落ちた場合でも「未完了の試行」が残る。

## 10.5 成功時

プロバイダ送信成功後、以下を行う。

```txt
notification_log に status = sent の行を追加する
provider_message_id を保存
notification_outbox.status = sent
notification_outbox.sent_at = now
notification_outbox.provider_message_id = provider_message_id
```

## 10.6 失敗時

失敗時は `notification_log` に `status = failed` の行を追加する。

`attempt_started` の行は更新しない。

再試行可能なら:

```txt
notification_outbox.status = retry
notification_outbox.next_attempt_at = now + backoff
notification_outbox.last_error = error message
```

最大試行回数を超えたら:

```txt
notification_outbox.status = dead
notification_outbox.dead_at = now
```

## 10.7 送信直前条件

送信直前に、イベントごとの最新状態を確認する。

例:

```txt
booking.reminder:
  booking.status = confirmed
  予約開始時刻 > now
  現在の reminder setting でも対象

booking.confirmed:
  booking.status = confirmed

booking.cancelled_by_participant:
  booking.status = cancelled

booking.cancelled_by_staff:
  booking.status = cancelled

booking.no_show:
  booking.status = no_show
```

条件を満たさない場合は送信せず `skipped` にする。

---

## 11. retry仕様

## 11.1 max_attempts

MVPでは初期値を `5` とする。

```txt
max_attempts = 5
```

## 11.2 backoff

指数的に待ち時間を増やす。

```txt
1回目失敗: 1分後
2回目失敗: 5分後
3回目失敗: 15分後
4回目失敗: 60分後
5回目失敗: dead
```

## 11.3 retry対象エラー

```txt
retryする:
  provider timeout
  network error
  5xx
  rate limit

retryしない:
  invalid recipient email
  template not found
  payload invalid
  store notification disabled
```

retryしないエラーは `dead` または `skipped` にする。

---

## 12. 管理画面仕様

MVPでは、最低限の確認画面を用意する。

URL案:

```txt
/{orgSlug}/{storeSlug}/admin/notifications
/{orgSlug}/{storeSlug}/admin/bookings/{bookingId}
```

表示項目:

```txt
通知種別
宛先
ステータス
試行回数
次回試行時刻
送信時刻
最終エラー
provider_message_id
```

操作:

```txt
retry:
  dead/retry の通知を再試行に戻す

mark_sent:
  手動で送信済みにする

cancel:
  pending/retry の通知をキャンセルする

mark_duplicate:
  重複送信としてログに記録する
```

MVPでは一括操作は対象外。

---

## 13. 実装順序

## Phase 1: DB追加

```txt
notification_outbox を追加
notification_log に不足カラムがあれば追加
reminder_log の新規利用停止方針を決める
```

## Phase 2: transaction方針を確定

```txt
Outbox対象 usecase では transaction fallback を禁止
transactionOrThrow を導入
予約作成 + outbox 作成の atomic test を追加
```

## Phase 3: 現行イベント対応表を反映

```txt
booking_confirmed
booking_application_received
booking_cancelled_by_participant
booking_cancelled_by_staff
booking_rescheduled
booking_no_show
booking_reminder
```

を `event_type` + `template_key` にマッピングする。

## Phase 4: 予約作成通知をOutbox化

```txt
公開予約作成
  即時確定:
    customer booking.confirmed
    store booking.confirmed

  承認制:
    customer booking.application_received
    store booking.application_received
```

を `notification_outbox` 作成に置き換える。

## Phase 5: キャンセル・日程変更・No-showをOutbox化

```txt
booking.cancelled_by_participant
booking.cancelled_by_staff
booking.rescheduled
booking.no_show
```

を直接送信から Outbox へ移す。

## Phase 6: リマインドをOutbox化

```txt
24時間前
3時間前
store setting
service override
```

を反映し、予約作成・承認・日程変更時に pending reminder outbox を作る。

## Phase 7: scheduled handler をOutbox processorに変更

```txt
pending/retry/processing_timeout を処理
attempt_started / sent / failed を notification_log に記録
```

## Phase 8: 管理画面・ログ確認

```txt
通知一覧
予約詳細内の通知状態
手動 retry/cancel/mark_duplicate
```

---

## 14. 受け入れ条件

## 14.1 Outbox作成

```txt
- 予約作成時に notification_outbox が作成される
- 公開予約では予約者向けと運営向けの通知 job が作成される
- 同じ idempotency_key の outbox が二重作成されない
- 業務API内でメール送信関数を直接呼ばない
```

## 14.2 既存イベント維持

```txt
- booking_confirmed 相当の通知が作られる
- 承認制予約では booking_application_received 相当の通知が作られる
- booking_cancelled_by_participant 相当の通知が作られる
- booking_cancelled_by_staff 相当の通知が作られる
- booking_rescheduled 相当の通知が作られる
- No-show登録時に予約者向け booking_no_show 相当の通知が作られる
- booking_reminder 相当の通知が作られる
```

## 14.3 リマインド

```txt
- store の 24時間前 / 3時間前 reminder 設定が反映される
- service override が store default より優先される
- 予約作成時に未来の reminder outbox が作成される
- 承認制予約では confirmed になった時点で reminder outbox が作成される
- キャンセル時に未送信 reminder outbox が cancelled になる
- 日程変更時に未送信 reminder が再生成される
- reminder 設定変更時に pending reminder がキャンセル・再生成される
- scheduled_for <= now の reminder は後追い作成しない
- reminder は booking.status = confirmed の場合だけ送信される
- approved status を reminder 条件に使わない
```

## 14.4 送信処理

```txt
- scheduled handler が due outbox を claim できる
- claim 後に attempt_started log が残る
- 送信成功時に notification_log.sent が残る
- 送信成功時に notification_outbox.status = sent になる
- 送信失敗時に retry または dead になる
- processing timeout の job が retry に戻る
```

## 14.5 at-least-once明記

```txt
- 仕様書に exactly-once を保証しないことが明記されている
- idempotency_key は配送重複防止ではなくジョブ作成重複防止であることが明記されている
- Worker crash 後の retry による重複送信可能性が明記されている
- 重複検知・手動照合方針が明記されている
```

## 14.6 transaction

```txt
- 予約作成と notification_outbox 作成が同一 transaction で行われる
- outbox 作成に失敗した場合、予約作成も rollback される
- Outbox対象 usecase では transaction fallback を使わない
- transaction が利用できない場合は fail fast する
```

---

## 15. テスト観点

## 15.1 Unit Test

```txt
idempotency_key 生成
既存 template_key と event_type の対応
reminder setting 解決
service override 優先
scheduled_for 計算
retry backoff 計算
送信直前条件チェック
```

## 15.2 Integration Test

```txt
予約作成 + outbox 作成の transaction
outbox unique 制約
予約キャンセル時の reminder cancel
日程変更時の reminder 再生成
reminder 設定変更時の pending reminder 再生成
claim → attempt_started → sent
claim → failed → retry
processing timeout → retry
```

## 15.3 Failure Test

```txt
メール送信成功後、sent 更新前にWorkerが落ちる想定
  → retry により重複送信可能性があることを確認
  → attempt_started が残ることを確認

transaction 非対応 fallback が呼ばれた場合
  → Outbox対象 usecase では fail fast することを確認
```

---

## 16. 将来拡張

MVP後の候補:

```txt
Cloudflare Queues への移行
メールプロバイダ webhook による delivered/bounced/opened 取得
通知テンプレート管理
店舗別通知ON/OFF
顧客別通知停止
SMS / LINE / Slack / Webhook
通知失敗の管理者アラート
重複送信の自動検知強化
provider idempotency 対応
大量通知のrate limit制御
```

---

## 17. 最終方針まとめ

```txt
- 通知予定の正本は notification_outbox
- 送信履歴の正本は notification_log
- reminder_log は新規利用しない
- idempotency_key はジョブ作成重複防止に使う
- 配送保証は at-least-once
- exactly-once送信は保証しない
- 現行イベントは落とさず event_type + template_key で移行する
- 公開予約では予約者向け・運営向けの両方をOutbox化する
- 即時確定予約では運営向けも booking.confirmed としてOutbox化する
- 承認制予約では予約者向け・運営向けとも booking.application_received としてOutbox化する
- No-showは現行実装に合わせて予約者向け booking.no_show を必須にする
- リマインドは `booking.slot_id -> slot.start_at` を基準にする
- リマインドは 24時間前 / 3時間前、store設定 / service override を維持する
- reminder設定変更時は pending reminder をキャンセル・再生成する
- booking.status = approved は使わない
- 承認後は booking.status = confirmed
- Outbox対象 usecase では D1 transaction fallback を禁止する
- transaction が使えない場合は fail fast する
```
