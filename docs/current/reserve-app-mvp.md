## reserve-app 向け仕様案 v0.1

外部予約システムの仕様を見ると、MVPでも最低限必要なのは「公開予約ページ」「予約者情報入力」「通知」「リマインド」「運営側の代理登録」です。STORES予約は予約受付・管理、顧客管理、事前決済、回数券、前日リマインドやLINE連携を前面に出しており、フリーでも予約ページを公開できる一方、予約件数・公開ページ数・スタッフ数でプラン差を作っています。([STORES][1]) RESERVAもオンライン決済、QR受付・セルフチェックイン、予約時アンケート、回数券・月額サブスク、多店舗管理を備えています。([RESERVA（レゼルバ）][2]) hacomonoは会員管理・予約・振替・キャンセル・決済・請求・入退館まで一体化し、会員マイページとバックオフィスを明確に分けています。([ウェルネス向けオールインワンマネジメントシステム｜hacomono][3]) SelectTypeは予約受付、顧客管理、決済、通知、スタッフ別管理、キャンセル待ち、CSV出力、リマインドメールなどを広く提供しています。([SelectType(セレクトタイプ)][4])

reserve-app では、hacomono ほど大規模施設向けに広げず、**小規模スクール・教室・パーソナル系店舗向けに「公開ページから予約が入り、運営が気づき、当日運用できる」状態**をMVPの完成条件にするのがよいです。

---

# 0. 実装状況サマリー

2026-06-02 時点では、P0 として定義した公開予約の主要導線は実装済みです。
公開ページは、公開状態の店舗だけが表示されます。
予約者はログインせずに氏名・メール・電話番号・人数・同伴者・備考を入力して予約できます。
スタッフは管理画面から電話・LINE・店頭などの代理予約を作成できます。

2026-06-02 時点では、サービス単位の公開予約制御まで本番反映済みです。
管理画面では、サービスごとに「公開中」「表示するが予約受付を停止」「公開ページに表示しない」を選べます。
非公開のサービスは公開ページに表示されません。
受付停止中のサービスは公開ページには表示されますが、参加者は予約できません。
単発予約枠にも `slot.public_status` を追加済みです。
管理画面では、単発予約枠ごとに「公開中」「表示するが予約受付を停止」「公開ページに表示しない」を選べます。
この段階でまだ未実装なのは、下書き・限定公開、受付停止理由の表示です。

凡例:

- 実装済み: 利用できる状態です。
- 一部実装: 基本導線は利用できますが、設定 UI や派生機能が残っています。
- 未実装: 仕様案のままで、まだ利用できません。

| 項目                    | 状態     | 実装済みの範囲                                                                                                           | 残り作業                                                       |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 店舗ごとの公開予約成立  | 実装済み | `/{orgSlug}/{storeSlug}` と公開イベント詳細からログイン不要で予約できる                                                  | 回数券必須サービスはゲスト予約不可。参加者画面の予約導線を使う |
| 予約者情報入力          | 実装済み | 氏名、メール、電話番号、人数、同伴者、備考、フォーム回答を保存する                                                       | ファイル添付、条件分岐                                         |
| 運営側通知              | 一部実装 | 予約作成・キャンセル等で予約者向けメールと運営側メールを送る。通知先も店舗ごとに設定できる                               | LINE・Slack・Webhook                                           |
| 前日・当日リマインド    | 一部実装 | 15分間隔の scheduled handler で、店舗とサービス別の有効状態、24時間前/3時間前の設定に従って送る                          | 運営向けリマインド、任意タイミング                             |
| 管理者による代理予約    | 実装済み | `/admin/bookings/new` で電話・LINE・店頭・管理画面経由の確定予約を作成できる                                             | 代理予約専用の通知文面や、さらに細かい受付経路設定             |
| 日次運用ビュー          | 実装済み | `/admin/bookings` で日付絞り込み、連絡先、人数、備考、経路、出欠、承認/却下/No-show、日程変更、CSV出力、印刷用表示を扱う | 参加者へのメール再送                                           |
| 公開/非公開制御         | 一部実装 | 店舗公開サイト単位、サービス単位、単発予約枠単位で、公開中・非公開・受付停止を設定できる                                 | `draft` / `unlisted`、停止理由表示                             |
| 管理者による予約変更    | 一部実装 | 確定予約を同一店舗・同一サービスの将来枠へ日程変更できる。変更履歴と変更通知も記録する                                   | サービス変更、人数変更、参加者からの変更申請                   |
| オンライン決済          | 未実装   | 回数券購入は現地決済・銀行振込・承認運用が中心                                                                           | 予約時オンライン決済、返金、領収書                             |
| キャンセル待ち          | 未実装   | -                                                                                                                        | キャンセル待ち登録、手動/自動昇格                              |
| スタッフ/設備の実体管理 | 未実装   | 店舗メンバーとスタッフ権限は利用できる                                                                                   | スタッフ・設備を予約枠のリソースとして扱う衝突チェック         |

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

| 優先度 | 機能                    | MVPでの扱い                                  | 実装状況 |
| ------ | ----------------------- | -------------------------------------------- | -------- |
| P0     | 店舗ごとの公開予約成立  | 必須                                         | 実装済み |
| P0     | 予約者情報入力          | 必須                                         | 実装済み |
| P0     | 運営側通知              | 必須                                         | 一部実装 |
| P0     | 前日・当日リマインド    | 必須                                         | 一部実装 |
| P0     | 管理者による代理予約    | 必須                                         | 実装済み |
| P0     | 日次運用ビュー          | 必須                                         | 実装済み |
| P1     | 公開/非公開制御         | 早期に入れる                                 | 一部実装 |
| P1     | 管理者による予約変更    | 早期に入れる                                 | 一部実装 |
| P2     | オンライン決済          | 回数券/有料予約を本格運用する段階            | 未実装   |
| P2     | キャンセル待ち          | 人気枠が出てから                             | 未実装   |
| P2     | スタッフ/設備の実体管理 | 複数スタッフ・複数部屋運用が必要になってから | 未実装   |

---

# 3. 機能仕様

## 3.1 店舗ごとの公開予約成立

実装状況: 実装済み。
公開状態の店舗では、公開イベント詳細ページからログイン不要で予約できます。
店舗が非公開、停止中、または公開サイト設定が未作成の場合、公開ページと公開予約 API は表示・実行できません。

### 目的

公開ページ、公開予約、ログイン済み利用者の参加者登録は、URL の `orgSlug` / `storeSlug` を正として組織と店舗を解決します。
未スコープの公開イベント導線と、`organizationId` / `storeId` を受け取る予約ドメイン API は提供しません。

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
POST /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/bookings
POST /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/bookings/{bookingPublicId}/cancel
```

### 予約作成時の必須チェック

```txt
- organization が存在する
- store が存在する
- store が organization に属する
- public_site_setting.status = public
- public_site_setting.acceptBookings = true
- service が有効
- service.public_status = public
- 回数券必須サービスではない
- slot.status = open
- slot.public_status = public
- slot.storeId が URL の storeId と一致する
- 残席数 >= participantsCount
- 締切時刻を過ぎていない
- キャンセル/予約停止期間ではない
```

`status`、`acceptBookings`、`noindex` は `public_site_setting` に追加済みです。
実装済みの公開状態は `public`、`private`、`suspended` です。
サービス単位の公開状態は `service.public_status` に追加済みです。
枠単位の公開状態は `slot.public_status` に追加済みです。

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

実装状況: 一部実装。
公開予約フォームでは、氏名、メールアドレス、電話番号、人数、同伴者、備考を入力できます。
予約者情報は予約行にスナップショットとして保存され、ゲスト予約では参加者 ID を持たない予約として扱います。

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

### フォーム管理

実装状況: 実装済み。

店舗は、予約時入力、事前アンケート、同意事項の3種類のフォームを管理できます。
フォームは店舗全体、サービス、予約枠へ割り当てられます。
予約画面では、予約枠、サービス、店舗の順で対象フォームを解決し、必要な質問を表示します。

公開予約では、表示時点のフォーム構成をハッシュで送信します。
予約作成時にサーバーがフォームを再解決し、構成の差分、必須未回答、選択肢不正、同意漏れを検証します。
スタッフの代理予約では、フォーム回答は任意です。
回答された内容だけをスタッフ入力として保存します。

予約詳細では、回答時点のフォーム名、公開版、項目ラベル、同意日時を確認できます。

```ts
type FormType = 'reservation_input' | 'pre_survey' | 'consent';
type FormFieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'consent';

type FormField = {
  fieldKey: string;
  fieldType: FormFieldType;
  label: string;
  required: boolean;
  options?: string[];
  description?: string;
  placeholder?: string;
  sortOrder: number;
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

form_templates
- id
- organizationId
- storeId
- formType
- name
- description
- status
- currentPublishedVersionId
- createdAt
- updatedAt

form_fields
- id
- formTemplateId
- fieldKey
- fieldType
- label
- description
- placeholder
- required
- optionsJson
- validationJson
- sortOrder
- createdAt
- updatedAt

form_template_versions
- id
- formTemplateId
- versionNumber
- nameSnapshot
- fieldsSnapshotJson
- publishedAt
- createdAt

form_assignments
- id
- organizationId
- storeId
- formType
- targetType
- targetId
- formTemplateId
- createdAt
- updatedAt

form_submissions
- id
- organizationId
- storeId
- formTemplateId
- formTemplateVersionId
- formType
- bookingId
- participantId
- customerNameSnapshot
- customerEmailSnapshot
- source
- submittedAt
- createdAt

form_answers
- id
- formSubmissionId
- fieldKey
- fieldType
- labelSnapshot
- valueJson
- sortOrder
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

実装状況: 一部実装。
予約作成・承認・却下・キャンセルなどの予約ライフサイクルで、予約者向けメールと運営側メールを送ります。
通知ログを作成し、同じ通知が重複送信されないようにしています。
店舗ごとの通知先設定 UI で、通知対象ロールと追加メールアドレスを管理できます。

### 目的

MVPでは、参加者への確認メールよりも「運営が予約に気づける」ことが重要です。STORES予約や SelectType のように通知・メッセージ配信が予約システムの中核機能になっているため、reserve-app でも P0 として入れるべきです。([STORES][1])

### 通知イベント

```txt
created
approved
rejected
cancelled_by_customer
cancelled_by_staff
rescheduled
checked_in
no_show_marked
payment_started
payment_confirmed
payment_expired
booking.reminder_sent
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

実装状況: 一部実装。
確定予約に対して、15分間隔の scheduled handler が予約者向けリマインドメールを一度だけ送ります。
店舗ごとにリマインドの有効/停止と、開始24時間前または開始3時間前の送信タイミングを管理画面から設定できます。
サービスごとに店舗全体の設定を使うか、専用の有効/停止と送信タイミングを使うかを選べます。
店舗設定が未作成の場合は、従来どおり開始24時間前のリマインドを送ります。

### 目的

No-show 対策として、前日または数時間前のリマインドは MVP に含めてよいです。STORES予約は前日のリマインドメールやLINE経由の来店前日メッセージを打ち出しており、SelectTypeも予約前日のリマインドメールを機能として掲げています。([STORES][1])

### MVP仕様

店舗単位の設定を基本にします。
サービス別設定がある場合は、サービス別の有効/停止と送信タイミングを優先します。

```txt
reminder_policy
- id
- storeId
- enabled
- serviceId: null
- minutesBefore: 1440 | 180
- channel: email
```

初期値は以下です。

```txt
開始24時間前
```

管理画面では、開始24時間前と開始3時間前を選択できます。
停止中も選択済みの送信タイミングは保存されます。

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

実装状況: 実装済み。
スタッフは `/admin/bookings/new` から、既存参加者または顧客情報の直接入力で代理予約を作成できます。
受付経路、人数、同伴者、備考、通知有無を保存できます。
作成された予約は確定予約として扱われます。

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
- 回数券必須サービスの場合は、既存参加者の回数券残数から消費する
```

### 権限

```txt
organization owner/admin
store manager/staff
```

`member` は代理予約不可でよいです。

### 予約ソース

```ts
type BookingSource =
  | 'participant'
  | 'public_site'
  | 'admin'
  | 'phone'
  | 'line'
  | 'storefront'
  | 'other';
```

### 監査ログ

代理予約、参加者操作、公開予約、運営操作は予約の操作イベントとして監査ログに残します。
予約状態は `booking.status` に保存し、誰がどの操作をしたかは `booking_audit_log.action` と `metadata` で確認します。

```txt
audit_log
- actorUserId
- action: created | approved | rejected | cancelled_by_customer | cancelled_by_staff | rescheduled | checked_in | no_show_marked | payment_started | payment_confirmed | payment_expired
- targetBookingId
- organizationId
- storeId
- metadataJson
- createdAt
```

---

# 4. 次点機能の仕様

## 4.1 公開/非公開の制御

実装状況: 一部実装。
店舗公開サイト単位で、公開状態、予約受付、検索除外を設定できます。
サービス単位では、公開ページに表示するか、表示したまま予約受付だけ止めるか、公開ページから隠すかを設定できます。
実装済みの公開状態は `public`、`private`、`suspended` です。
枠単位でも、公開ページに表示するか、表示したまま予約受付だけ止めるか、公開ページから隠すかを設定できます。
DB では、店舗公開サイトの状態を `public_site_setting.status`、サービス単位の状態を `service.public_status`、枠単位の状態を `slot.public_status` で保持します。
`draft`、`unlisted`、停止理由表示も未実装です。

### 目的

URLを知っていれば常に見える状態は避けるべきです。公開予約ページには、最低限の公開状態と受付停止設定が必要です。

### 公開状態

```ts
type PublicStatus =
  | 'public' // 一般公開
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
この範囲に加えて、単発予約枠単位の公開停止も実装済みです。
個別枠の休講や臨時受付停止では、既存予約を残したまま新規の公開予約だけを止められます。

---

## 4.2 予約変更・日程変更

実装状況: 運営側の日程変更は実装済み。
`/admin/bookings` の運営予約一覧から、予約確定済みの予約だけ日程変更できます。
変更先は同じ店舗・同じサービスの将来の受付中枠に限定します。
満席、停止済み、開始済み、別サービスの枠には変更できません。

変更後は、変更履歴を保存し、参加者と運営に予約日時変更の通知を送ります。

### MVPでは運営側の日程変更を優先

参加者の自由な変更機能は複雑になりやすいため、まずは運営側が日程変更できる仕様にします。

### ステータス

予約の状態は予約者・運営者・決済の理由を混ぜず、単一の lifecycle status として扱います。
日程変更は `booking.status` を `confirmed` のままにし、変更履歴と監査ログに記録します。
キャンセル理由や操作主体は `booking_audit_log.action` と `metadata` で確認します。

### 変更時の処理

```txt
1. 変更先 slot の空き確認
2. 新 slot の予約人数を確保
3. booking.slotId を更新
4. 旧 slot の予約人数を戻す
5. booking_change_log を作成
6. 参加者・運営に booking_rescheduled 通知を送る
```

### 変更ログ

```txt
booking_change_log
- id
- bookingId
- organizationId
- storeId
- changedByUserId
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

実装状況: 実装済み。
専用の `/admin/operations/day` ではなく、現在は `/admin/bookings` の運営予約一覧で日付を絞り込みます。
予約者名、連絡先、人数、備考、予約経路、出欠、予約状態を確認できます。
承認、却下、出席、欠席、未確認への戻し、運営キャンセル、No-show も同じ画面から操作できます。
CSV出力と印刷用表示も同じ画面から利用できます。

### 目的

当日の現場では、予約カレンダーよりも「今日誰が来るか」「電話番号は何か」「何人か」「支払い/回数券はどうなっているか」が重要です。SelectTypeもCSV出力を予約システム機能として出しているため、reserve-app でも日次一覧とCSVは早めに入れる価値があります。([SelectType(セレクトタイプ)][4])

### URL

```txt
/{orgSlug}/{storeSlug}/admin/bookings
```

### 表示項目

実装済みの表示項目:

```txt
- 時刻
- サービス名
- 予約者名
- 人数
- 電話番号
- メール
- 備考
- 予約経路
- 出欠
- 予約状態
```

### 操作

実装済みの操作:

```txt
- 無断欠席にする
- 出席にする
- 欠席にする
- 未確認に戻す
- キャンセルする
```

未実装の候補:

```txt
- 日程変更する
- 参加者にメール再送
```

### 出欠ステータス

実装状況: 実装済み。
予約確定後に、出席、欠席、未確認、No-show を出欠状態として確認できます。
No-show は予約状態にも反映されます。

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

予約の状態は状態遷移として扱います。
キャンセルした主体や操作理由は status に混ぜません。
それらは監査ログの action と metadata に残します。

```ts
type BookingStatus =
  | 'pending_approval' // 承認待ち
  | 'confirmed' // 確定
  | 'rejected' // 却下
  | 'cancelled' // キャンセル済み
  | 'no_show' // 無断欠席
  | 'completed' // 来店・出席完了
  | 'pending_payment' // 決済待ち
  | 'expired'; // 期限切れ
```

```ts
type BookingAuditAction =
  | 'created'
  | 'approved'
  | 'rejected'
  | 'cancelled_by_customer'
  | 'cancelled_by_staff'
  | 'rescheduled'
  | 'checked_in'
  | 'no_show_marked'
  | 'payment_started'
  | 'payment_confirmed'
  | 'payment_expired';
```

### 即時確定フロー

```txt
public_site booking
-> confirmed
-> confirmation email to customer
-> notification email to staff
-> reminder email
-> completed / no_show
```

### 承認制フロー

```txt
public_site booking
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
-> confirmed
-> optional customer email
-> audit log
```

---

# 7. 推奨データモデル

## 7.1 公開サイト

実装状況: 一部実装。
`public_site_setting` は店舗単位で作成・更新できます。
現在の実装では `status`、`acceptBookings`、`noindex` を持ちます。
`orgSlugSnapshot`、`draft`、`unlisted`、停止理由表示は未実装です。

```txt
public_site_setting
- id
- organizationId
- storeId
- siteName
- description
- address
- phone
- status: public | private | suspended
- acceptBookings
- noindex
- coverImageUrl
- createdAt
- updatedAt
```

`orgSlugSnapshot` は必須ではありませんが、slug変更時の調査やログ確認に便利です。正規解決は `organization.slug` と `store.slug` で行います。

## 7.2 予約ページ/サービス

実装状況: 未実装。
現在は既存の `service` と `slot` を公開予約の対象として使っています。
以下のような専用 `booking_page` モデルはまだ分離していません。
既存の `service` には公開予約用の公開状態を追加済みです。
公開中のサービスは公開予約に出ます。
非公開のサービスは公開ページに出ません。
受付停止のサービスは公開ページに出ますが、予約フォームからは予約できません。
既存の `slot` にも公開予約用の公開状態を追加済みです。
非公開の予約枠は公開ページに出ません。
受付停止の予約枠は公開ページに出ますが、予約フォームからは予約できません。

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

実装状況: 一部実装。
公開予約番号、予約経路、予約者情報、備考、作成者ユーザー ID は予約に保存します。
ゲスト予約では参加者 ID を空にできます。
出欠状態は予約に保存します。
支払い状態の専用カラムは未実装です。

```txt
booking
- id
- publicId
- organizationId
- storeId
- serviceId
- slotId
- participantId nullable
- status
- source
- participantsCount
- customerName
- customerEmail
- customerPhone
- note
- createdByUserId nullable
- noShowMarkedAt nullable
- attendanceStatus
- attendanceMarkedAt nullable
- attendanceMarkedByUserId nullable
- createdAt
- updatedAt
```

## 7.4 通知・リマインド

実装状況: 一部実装。
通知ログとリマインドログは追加済みです。
リマインド設定は店舗ごとに管理できます。
サービスごとの上書きも管理できます。
送信処理はサービス別設定、店舗設定、開始24時間前の既定値の順に参照します。

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

実装状況: 一部実装。
公開ページの閲覧、公開予約の作成、公開キャンセルはログイン不要の Public API で実装済みです。
公開キャンセルでは `bookingPublicId` だけでは操作できず、メールで送った期限付きトークンを検証します。
公開チケット種別の詳細取得もありますが、回数券必須サービスのゲスト予約は受け付けません。

```txt
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/site
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events/{slotId}
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/forms/required
GET  /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/ticket-types/{ticketTypeId}

POST /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/bookings
POST /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/bookings/{bookingPublicId}/cancel
```

認証済みの予約ドメイン API は `/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/...` を正とします。
予約、サービス、予約枠、定期スケジュール、参加者、回数券、回数券購入申請は、この URL の組織・店舗スコープで処理します。
旧 `/api/v1/auth/organizations/...` の予約ドメイン endpoint は提供しません。

### 予約作成リクエスト

実装状況: 実装済み。
公開予約作成 API は以下の項目を受け取ります。
`companions` は同伴者として保存します。
`formSubmissions` は公開済みフォームの定義に照合し、必須項目、選択肢、同意を検証してから保存します。

```json
{
  "serviceId": "svc_xxx",
  "slotId": "slot_xxx",
  "customer": {
    "name": "山田太郎",
    "email": "taro@example.com",
    "phone": "090-xxxx-xxxx"
  },
  "participantsCount": 2,
  "companions": [{ "name": "山田花子" }],
  "note": "体験希望です",
  "formContextHash": "sha256...",
  "formSubmissions": [
    {
      "formTemplateId": "form_xxx",
      "formTemplateVersionId": "formver_xxx",
      "answers": {
        "experience": "体験レッスン",
        "policy": true
      }
    }
  ]
}
```

## Admin API

実装状況: 一部実装。
店舗スコープ付き API で、予約一覧、フォーム管理、運営キャンセル、承認、却下、No-show、出席/欠席チェックイン、代理予約作成、運営側の日程変更を利用できます。
専用の日次運用 API は未実装です。

```txt
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}
PATCH /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/publish
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/archive
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments
DELETE /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments/{assignmentId}
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/submissions
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/submissions/{submissionId}
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/required
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/cancel-by-staff
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/approve
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/reject
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/no-show
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/check-in
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/staff-create
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/reschedule

追加候補:
GET  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/operations/day?date=YYYY-MM-DD
```

---

# 9. 画面仕様

## 公開予約ページ

実装状況: 一部実装。
公開サイト、イベント一覧、イベント詳細、予約フォーム、予約完了表示、公開キャンセルページは実装済みです。
対象フォームを予約フォームに表示できます。
サービス単位の公開状態により、非公開サービスは公開ページから隠し、受付停止サービスは予約不可として表示できます。
確認画面は未実装です。

```txt
/{orgSlug}/{storeSlug}
/{orgSlug}/{storeSlug}/events
/{orgSlug}/{storeSlug}/events/{slotId}
/{orgSlug}/{storeSlug}/bookings/{bookingPublicId}/cancel?token=...
```

実装済みの表示内容:

```txt
- 店舗名
- 説明
- 住所
- 電話番号
- サービス一覧
- 予約可能日時
- 予約者情報入力
- 予約時入力・事前アンケート・同意事項フォーム
- 完了画面
```

未実装の候補:

```txt
- 確認画面
- ファイル添付
- 条件分岐
```

## 管理画面

実装状況: 一部実装。
予約一覧、代理予約作成、予約詳細、公開サイト設定、フォーム管理、通知先設定は実装済みです。
専用の日次運用ページは未実装です。

```txt
/{orgSlug}/{storeSlug}/admin/bookings
/{orgSlug}/{storeSlug}/admin/bookings/new
/{orgSlug}/{storeSlug}/admin/bookings/{bookingId}
/{orgSlug}/{storeSlug}/admin/public-site
/{orgSlug}/{storeSlug}/admin/forms
/{orgSlug}/{storeSlug}/admin/forms/new
/{orgSlug}/{storeSlug}/admin/forms/{formId}
/{orgSlug}/{storeSlug}/admin/forms/{formId}/assignments
/{orgSlug}/{storeSlug}/admin/forms/{formId}/submissions
/{orgSlug}/{storeSlug}/admin/notification-settings

未実装:
/{orgSlug}/{storeSlug}/admin/operations/day
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
- フォーム管理
```

STORES予約もフリーでは月間予約件数・公開ページ数を小さくし、有料プランでページ数・スタッフ数・予約件数を増やす構造になっているため、reserve-app でも「複数店舗」「スタッフ管理」「回数券」「承認制」を Premium に寄せる設計が自然です。([STORES][1])

---

# 11. 実装順

## Step 1: 公開予約 API の store 化

実装状況: 実装済み。
最初に直すべきです。

```txt
- スコープ付き公開予約 API は orgSlug/storeSlug から organization/store を解決する
- service/slot が URL の store に属することを検証する
- public booking 作成を store 必須にする
- 自己参加登録 API の環境変数依存は互換導線として残す
```

## Step 2: 予約者情報入力

実装状況: 実装済み。
標準項目、人数による残席チェック、フォーム管理 UI を実装済みです。
フォームは管理画面で定義し、公開予約フォームで回答を受け取り、予約詳細で確認できます。

```txt
- participantsCount をWebフォームから入力可能にする
- customer.phone / note / formSubmissions を追加
- form_submissions / form_answers を保存
- 人数による残席チェックを修正
```

## Step 3: 運営通知

実装状況: 一部実装。
メール送信、通知ログ、重複送信防止は実装済みです。
通知先設定の管理 UI で、owner / admin / 店舗 manager / 店舗 staff と追加メールアドレスを店舗ごとに設定できます。

```txt
- `created` イベントを発火
- notification_log を作成
- store manager / staff / additionalEmails に送信
- 失敗時にログで確認可能にする
```

## Step 4: リマインド

実装状況: 一部実装。
15分間隔の scheduled handler、二重送信防止、店舗単位とサービス単位の有効/停止、送信タイミング設定は実装済みです。
運営向けリマインド、任意タイミングは未実装です。

```txt
- reminder_policy
- reminder_log
- scheduled handler
- 二重送信防止
```

## Step 5: 管理者代理予約

実装状況: 実装済み。

```txt
- 管理画面から予約作成
- source を admin/phone/line/storefront で保存
- 通知送信有無を選択
- audit log に記録
```

## Step 6: 日次運用ビュー

実装状況: 一部実装。
予約一覧で日付、連絡先、人数、備考、予約経路、No-show、CSV出力、印刷用表示を扱えます。
出席/欠席チェックインも同じ予約一覧で扱えます。

```txt
- 当日予約一覧
- 連絡先/人数/備考/予約経路
- no-show
```

---

# 12. MVPの受け入れ条件

実装状況: 一部実装。
予約 SaaS として最低限の実運用に必要な条件のうち、公開予約成立、代理予約、基本的な通知・リマインドは利用できる状態です。
サービス単位と単発予約枠単位の公開停止は利用できます。
下書き・限定公開、受付停止理由の公開表示は未実装です。

| 条件                                                               | 状態     | 補足                                                                           |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------ |
| `/{orgSlug}/{storeSlug}` から店舗ごとの予約ページが表示できる      | 実装済み | 公開状態の店舗だけ表示される                                                   |
| 別 organization / 別 store の slot を予約できない                  | 実装済み | URL の organization/store と service/slot の所属を検証する                     |
| 予約者が氏名・メール・電話・人数・備考を入力して予約できる         | 実装済み | 同伴者とフォーム回答も保存できる                                               |
| `participantsCount` が残席計算に反映される                         | 実装済み | 予約作成時に人数分の残席を確認する                                             |
| 予約完了時に予約者へ確認メールが送られる                           | 一部実装 | メール設定がある環境で送信する。送信失敗はログに残る                           |
| 予約完了時に運営側へ通知メールが送られる                           | 一部実装 | 店舗ごとの通知先設定に従って送信する。メール以外の通知は未実装                 |
| 前日または数時間前にリマインドが一度だけ送られる                   | 一部実装 | 店舗単位とサービス単位で24時間前/3時間前を設定できる                           |
| スタッフが電話/LINE/店頭予約を代理登録できる                       | 実装済み | `/admin/bookings/new` で受付経路と通知有無を指定できる                         |
| 管理画面の日次ビューで当日の予約者・連絡先・人数・出欠を確認できる | 実装済み | 日付絞り込み、連絡先、人数、出席/欠席/No-show、CSV出力、印刷用表示を利用できる |
| 公開停止中の店舗/サービス/予約枠には予約できない                   | 実装済み | 店舗公開サイト、サービス、単発予約枠の非公開・受付停止を検証する               |

---

# 結論

P0 のうち、公開予約成立、予約者情報入力、管理者代理予約は実装済みです。
通知、リマインド、日次運用ビュー、公開/非公開制御は基本導線まで入っています。
MVPとして残っている主な作業は、公開制御・フォーム項目・運用補助の拡張です。

```txt
1. フォーム項目のファイル添付・条件分岐
2. 参加者へのメール再送
3. 予約変更の対象拡大（サービス変更、人数変更、参加者からの変更申請）
4. 運営向けリマインド、任意タイミング、LINE/Slack/Webhook 通知
5. 下書き・限定公開、受付停止理由の表示
```

オンライン決済、キャンセル待ち、スタッフ/設備の実体管理は重要ですが、MVP の次段階でよいです。
まずは「公開ページから予約が入り、店舗が気づき、当日対応できる」状態を運用画面と設定 UI まで仕上げるのがよいです。

[1]: https://stores.jp/reserve '予約システム 無料プランあり・24時間ネット予約受付｜STORES 予約（ストアーズ）'
[2]: https://reserva.be/ '予約システム RESERVA(レゼルバ) | 無料で予約管理'
[3]: https://www.hacomono.jp/feature/ 'hacomonoとは｜オールインワンマネジメントシステム｜hacomono'
[4]: https://select-type.com/ '予約システムを中心に業務を一元化｜無料で使えるSelectType'
