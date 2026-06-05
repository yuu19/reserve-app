# reserve-app フォーム管理機能 MVP仕様書 v4

作成日: 2026-06-05
実装反映日: 2026-06-06
配置: `docs/current/form-management-mvp.md`
前提: 開発中・1人開発のため、旧カスタム入力機能との後方互換は維持しない。破壊的変更を許容する。

実装状況: MVP 実装済み。
新フォーム基盤の DB migration、管理 API、公開予約 API、スタッフ代理予約、管理画面、公開予約画面、予約詳細表示へ反映済み。
旧カスタム入力の管理 UI/API と回答テーブルは、互換導線を残さず廃止する。

実装メモ:

- DB は `0036_form_management_mvp.sql` で新フォーム6テーブルを作成し、旧2テーブルを削除する。
- 公開予約は `formContextHash` と `formSubmissions` を受け取り、予約作成時に必要フォームを再解決する。
- スタッフ代理予約はフォーム回答を任意入力として扱い、送信された回答だけを保存する。
- 回答確認は予約詳細とフォーム別回答一覧で行う。

---

## 0. この仕様書の目的

reserve-app に、予約時の追加質問・事前アンケート・同意事項を扱うための **新しいフォーム基盤** を導入する。

MVPでは、既存の `public_site_intake_field` / `booking_answer` を拡張するのではなく、次の新テーブル群を正本にする。

```txt
form_templates
form_template_versions
form_fields
form_assignments
form_submissions
form_answers
```

旧カスタム入力機能は廃止対象とする。

```txt
廃止対象:
  public_site_intake_field
  booking_answer
  /{orgSlug}/{storeSlug}/admin/intake-fields
  GET/PATCH /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/intake-fields
```

---

## 1. 決定事項

### 1.1 スコープ

`classroom` / `menu` / `event` という旧称は使わない。

```txt
organization:
  組織・契約・請求単位

store:
  店舗・教室・拠点単位

service:
  提供メニュー・予約対象サービス

slot:
  予約枠・単発イベント枠

booking:
  予約

participant:
  ログイン済み参加者レコード
```

新規仕様では、常に以下の用語を使う。

```txt
store
storeId
storeSlug
service
serviceId
slot
slotId
```

### 1.2 旧カスタム入力との関係

MVPでは旧カスタム入力と新フォーム基盤を並行運用しない。

```txt
旧:
  public_site_intake_field
  booking_answer

新:
  form_templates
  form_template_versions
  form_fields
  form_assignments
  form_submissions
  form_answers
```

方針:

```txt
- 新規フォーム定義は form_templates / form_fields に保存する
- 公開予約で表示するフォームは form_assignments から解決する
- 新規回答は form_submissions / form_answers に保存する
- booking_answer への新規書き込みは行わない
- public_site_intake_field の管理UI/APIは削除する
```

既存データを移行する場合は、一度だけ手動またはマイグレーションで取り込む。

```txt
public_site_intake_field.visible_on_public = true
  → form_fields に移行してよい

public_site_intake_field.visible_on_public = false
  → 移行しない
```

開発DBのデータを捨ててよい場合は、移行せずに旧テーブルを drop してよい。

### 1.3 ゲスト公開予約

公開予約はログイン不要のため、`participant_id` を必須にしない。

```txt
ゲスト予約:
  booking_id 必須
  participant_id 任意/null
  customer_name_snapshot 必須
  customer_email_snapshot 必須

ログイン済み参加者予約:
  booking_id 必須
  participant_id 任意/存在する場合あり
```

MVPのフォーム回答は、原則として `booking_id` に紐づける。

### 1.4 MVPで扱うフォーム種別

MVPで実装するフォーム種別は以下の3つ。

```txt
reservation_input:
  予約時入力フォーム

pre_survey:
  事前アンケート

consent:
  同意事項フォーム
```

`initial_registration` は将来拡張として enum 予約はしてもよいが、MVPでは画面・API・予約フローに出さない。

```txt
MVP対象外:
  initial_registration
```

理由:

```txt
- ゲスト予約では participant_id がない
- 初回判定や再回答条件が複雑になる
- 予約成立MVPには必須ではない
```

### 1.5 破壊的変更の扱い

開発中のため、次は不要。

```txt
不要:
  旧UIとの並行運用
  旧API互換
  booking_answer と form_answers の二重読み取り
  public_site_intake_field と form_fields の同期
  feature flag による段階切替
```

---

## 2. MVPの到達点

MVP完了時点では、以下ができる状態を目標にする。

```txt
1. 店舗管理者がフォーム管理画面でフォームを作成できる
2. フォームに入力項目を追加・並び替えできる
3. フォームを store / service / slot に紐づけられる
4. 公開予約ページで、対象予約に必要なフォームが表示される
5. 予約作成時にフォーム回答が booking と同時に保存される
6. 同意事項の文言・バージョン・同意日時が保存される
7. 管理画面の予約詳細でフォーム回答を確認できる
8. 旧 intake-fields UI/API を使わない
```

---

## 3. MVP対象外

以下はMVP対象外とする。

```txt
初回登録フォーム
Stripe Checkout 連携
決済前のフォーム仮保存
ファイル添付
条件分岐
複数ページフォーム
回答後編集
回答リマインド
フォーム単体公開URL
回答CSV出力
スコア集計
健康情報・医療情報の取得
アレルギー・既往歴などセンシティブ情報の取得
項目単位の閲覧権限
監査ログ
保存期限管理
```

ただし、将来的に拡張できるよう、`form_type` や `form_template_versions` は拡張可能な形にしておく。

---

## 4. 画面仕様

## 4.1 管理画面URL

現行の店舗スコープ付き画面URLに合わせる。

```txt
フォーム一覧:
  /{orgSlug}/{storeSlug}/admin/forms

フォーム新規作成:
  /{orgSlug}/{storeSlug}/admin/forms/new

フォーム編集:
  /{orgSlug}/{storeSlug}/admin/forms/{formId}

フォーム割り当て:
  /{orgSlug}/{storeSlug}/admin/forms/{formId}/assignments

フォーム回答一覧:
  /{orgSlug}/{storeSlug}/admin/forms/{formId}/submissions

予約詳細内の回答表示:
  /{orgSlug}/{storeSlug}/admin/bookings/{bookingId}
```

旧画面は削除する。

```txt
削除:
  /{orgSlug}/{storeSlug}/admin/intake-fields
```

必要であれば、開発中はリダイレクトしてよい。

```txt
/{orgSlug}/{storeSlug}/admin/intake-fields
  → /{orgSlug}/{storeSlug}/admin/forms
```

## 4.2 フォーム一覧

表示項目:

```txt
フォーム名
フォーム種別
ステータス
公開バージョン
割り当て先
更新日時
```

フィルタ:

```txt
form_type
status
target_type
```

フォーム種別の表示名:

```txt
reservation_input:
  予約時入力フォーム

pre_survey:
  事前アンケート

consent:
  同意事項フォーム
```

## 4.3 フォーム作成・編集

入力項目:

```txt
フォーム名
説明
フォーム種別
項目一覧
```

MVPで対応する項目タイプ:

```txt
text:
  短文入力

textarea:
  長文入力

radio:
  単一選択

checkbox:
  複数選択

select:
  プルダウン選択

date:
  日付

consent:
  同意チェック
```

MVPでは `email` / `phone` / `number` は独立型にしない。必要なら `text` として扱う。

### 4.3.1 項目設定

各項目に設定できる値:

```txt
field_key
label
description
placeholder
field_type
required
options
sort_order
```

`field_key` はフォーム内で一意とする。

```txt
例:
  experience
  purpose
  remarks
  cancel_policy_agreement
```

`radio` / `checkbox` / `select` は `options_json` を持つ。

```json
[
  { "value": "beginner", "label": "未経験" },
  { "value": "experienced", "label": "経験あり" }
]
```

## 4.4 フォーム公開

フォームは、編集しただけでは公開予約ページに反映しない。

```txt
編集:
  form_fields を更新する

公開:
  form_template_versions を作成する
  fields_snapshot_json に公開時点の項目定義を保存する
  form_templates.current_published_version_id を更新する
```

公開済みフォームを編集して再公開した場合は、新しいバージョンを作る。

```txt
v1 公開
  ↓ 編集
v2 公開
```

過去回答は、回答時点の `form_template_version_id` に紐づける。

## 4.5 フォーム割り当て

フォームは以下に割り当てられる。

```txt
store:
  店舗全体

service:
  特定サービス

slot:
  特定予約枠
```

MVPでは、同じ対象・同じフォーム種別に割り当てられるフォームは1つだけとする。

```txt
同一 store に reservation_input は1つまで
同一 service に reservation_input は1つまで
同一 slot に reservation_input は1つまで
```

割り当て解除時は `form_assignments` を DELETE する。

```txt
enabled フラグは持たない
論理削除はしない
履歴はMVPでは保持しない
```

## 4.6 予約詳細での回答表示

予約詳細画面にフォーム回答を表示する。

```txt
予約詳細
  ├─ 予約情報
  ├─ 予約者情報
  ├─ 予約時入力フォーム回答
  ├─ 事前アンケート回答
  └─ 同意事項
```

表示する情報:

```txt
フォーム名
フォーム種別
回答バージョン
回答日時
質問ラベル
回答値
```

同意事項では以下も表示する。

```txt
同意日時
同意した文言
フォームバージョン
```

---

## 5. 公開予約フロー

## 5.1 表示順

公開予約フォームでは、以下の順で表示する。

```txt
1. 予約者基本情報
2. 予約時入力フォーム
3. 事前アンケート
4. 同意事項フォーム
5. 確認
6. 予約確定
```

予約者基本情報はフォーム基盤には含めない。

```txt
フォーム基盤に含めない標準項目:
  氏名
  メールアドレス
  電話番号
  人数
  同伴者名
  備考
```

これらは引き続き `booking` および関連テーブルのスナップショットとして扱う。

## 5.2 フォーム解決ルール

対象予約に対して、以下の割り当てを解決する。

```txt
store assignment
service assignment
slot assignment
```

同じ `form_type` で複数該当する場合は、より具体的な対象を優先する。

```txt
slot
  > service
  > store
```

例:

```txt
store に reservation_input A
service に reservation_input B
slot に reservation_input C
```

この場合、対象 slot の予約では `reservation_input C` を表示する。

別の `form_type` は併用できる。

```txt
reservation_input
pre_survey
consent
```

表示順は固定。

```txt
reservation_input
pre_survey
consent
```

## 5.3 必須制御

各項目の `required` に従ってサーバー側で検証する。

```txt
required = true:
  未回答なら予約作成不可

required = false:
  未回答可
```

`consent` 型の項目は、`required = true` の場合、値が `true` でなければ予約作成不可。

## 5.4 フォーム文脈の不一致

公開予約ページで取得したフォーム集合と、予約作成時点で再解決したフォーム集合が異なる場合はエラーにする。

検証対象:

```txt
form_type
form_template_id
form_template_version_id
required
field_key
field_type
required
options
sort_order
```

予約作成APIでは、送信された `formContextHash` と、サーバー側で再解決したフォーム文脈の hash を比較する。

```txt
HTTP 409
code: FORM_CONTEXT_OUTDATED
message: フォーム内容が更新されました。再読み込みしてください。
```

理由:

```txt
- 予約ページ表示後にフォーム割り当てが変わった場合に、古いフォーム集合で予約させないため
- 古い同意文言への同意を保存しないため
- 必須項目変更後の入力漏れを防ぐため
```

---

## 6. API仕様

## 6.1 管理API

現行の認証付き店舗スコープAPIに合わせる。

```txt
GET    /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms
POST   /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms
GET    /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}
PATCH  /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}

POST   /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/publish
POST   /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/archive

GET    /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments
POST   /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments
DELETE /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments/{assignmentId}

GET    /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/submissions
GET    /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/form-submissions/{submissionId}
```

旧APIは削除する。

```txt
削除:
  GET   /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/intake-fields
  PATCH /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/intake-fields
```

フォーム本体の物理削除はMVPでは提供しない。

```txt
回答済みフォーム:
  archive のみ可能

公開済みフォーム:
  archive のみ可能

未公開かつ回答なしのフォーム:
  開発中に限り物理削除してよいが、公開APIとしては提供しない
```

## 6.2 公開API

公開予約ページで必要なフォームを取得する。

```txt
GET /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/forms/required?serviceId={serviceId}&slotId={slotId}
```

レスポンス例:

```json
{
  "formContextHash": "ctx_abc123",
  "forms": [
    {
      "formTemplateId": "form_123",
      "formTemplateVersionId": "formver_1",
      "formType": "reservation_input",
      "name": "体験レッスン入力フォーム",
      "versionNumber": 1,
      "fields": [
        {
          "fieldKey": "experience",
          "fieldType": "radio",
          "label": "経験はありますか？",
          "required": true,
          "options": [
            { "value": "first_time", "label": "初めて" },
            { "value": "experienced", "label": "経験あり" }
          ]
        }
      ]
    }
  ]
}
```

予約作成APIでは、フォーム回答を同時に送信する。

```txt
POST /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/bookings
```

リクエスト例:

```json
{
  "slotId": "slot_123",
  "serviceId": "svc_123",
  "customer": {
    "name": "山田太郎",
    "email": "taro@example.com",
    "phone": "090-0000-0000"
  },
  "participantsCount": 1,
  "note": "体験希望です",
  "formContextHash": "ctx_abc123",
  "formSubmissions": [
    {
      "formTemplateId": "form_123",
      "formTemplateVersionId": "formver_1",
      "answers": [
        {
          "fieldKey": "experience",
          "value": "first_time"
        }
      ]
    },
    {
      "formTemplateId": "form_456",
      "formTemplateVersionId": "formver_3",
      "answers": [
        {
          "fieldKey": "cancel_policy_agreement",
          "value": true
        }
      ]
    }
  ]
}
```

## 6.3 管理者による代理予約

代理予約APIでもフォーム回答を保存できるようにする。

```txt
POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/bookings/staff-create
```

MVPでは、スタッフによる代理予約ではフォーム回答を任意とする。

理由:

```txt
- 電話・LINE・店頭予約では、すべてのフォーム項目をその場で入力できない場合がある
- 同意事項は対面・口頭・別紙で取得する運用がありうる
```

ただし、回答を入力した場合は `form_submissions.source = staff` として保存する。

将来的には、代理予約でも同意事項を必須にする設定を追加できる。

---

## 7. DB設計

## 7.1 form_templates

フォームの論理単位。

```sql
CREATE TABLE form_templates (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  current_published_version_id TEXT,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);
```

`form_type`:

```txt
reservation_input
pre_survey
consent
```

MVPでは `initial_registration` は使わない。

`status`:

```txt
draft:
  未公開

published:
  公開済み

archived:
  利用停止
```

インデックス:

```sql
CREATE INDEX form_templates_store_type_idx
ON form_templates (organization_id, store_id, form_type, status);
```

フォームは、回答や公開済みバージョンから参照される可能性があるため、MVPでは物理削除しない。

```txt
削除相当の操作:
  status = archived
  archived_at = 現在時刻

公開予約:
  archived のフォームは解決対象にしない

管理画面:
  archived のフォームは過去回答確認用に表示してよい
```

## 7.2 form_fields

フォームの現在編集中の項目定義。

```sql
CREATE TABLE form_fields (
  id TEXT PRIMARY KEY NOT NULL,
  form_template_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  placeholder TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  validation_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (form_template_id) REFERENCES form_templates(id) ON DELETE CASCADE
);
```

制約:

```sql
CREATE UNIQUE INDEX form_fields_template_key_uidx
ON form_fields (form_template_id, field_key);

CREATE INDEX form_fields_template_order_idx
ON form_fields (form_template_id, sort_order);
```

`visible_on_public` は持たせない。

理由:

```txt
- 新フォーム基盤では、フォームに含まれる項目は表示対象とみなす
- 非表示にしたい項目はフォームから削除する
- 旧 visible_on_public は移行時のフィルタとしてだけ扱う
```

## 7.3 form_template_versions

公開時点のフォーム定義を保存する不変スナップショット。

```sql
CREATE TABLE form_template_versions (
  id TEXT PRIMARY KEY NOT NULL,
  form_template_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  name_snapshot TEXT NOT NULL,
  description_snapshot TEXT,
  fields_snapshot_json TEXT NOT NULL,
  published_by_user_id TEXT,
  published_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (form_template_id) REFERENCES form_templates(id) ON DELETE CASCADE
);
```

制約:

```sql
CREATE UNIQUE INDEX form_template_versions_template_version_uidx
ON form_template_versions (form_template_id, version_number);

CREATE INDEX form_template_versions_store_idx
ON form_template_versions (organization_id, store_id, form_type);
```

`fields_snapshot_json` の例:

```json
[
  {
    "fieldKey": "experience",
    "fieldType": "radio",
    "label": "経験はありますか？",
    "description": null,
    "placeholder": null,
    "required": true,
    "options": [
      { "value": "first_time", "label": "初めて" },
      { "value": "experienced", "label": "経験あり" }
    ],
    "sortOrder": 1
  }
]
```

## 7.4 form_assignments

フォームを `store` / `service` / `slot` に割り当てる。

```sql
CREATE TABLE form_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  form_template_id TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (form_template_id) REFERENCES form_templates(id) ON DELETE CASCADE
);
```

`enabled` は持たせない。解除時は DELETE する。

制約:

```sql
CREATE UNIQUE INDEX form_assignments_target_type_uidx
ON form_assignments (
  organization_id,
  store_id,
  form_type,
  target_type,
  target_id
);

CREATE INDEX form_assignments_template_idx
ON form_assignments (form_template_id);
```

### 7.4.1 所属検証

`target_id` は多態IDのため、DBのFKだけに頼らない。作成時・更新時・取得時にアプリ層で検証する。

```txt
target_type = store:
  target_id = current store.id

target_type = service:
  service.id = target_id
  service.organization_id = current organization.id
  service.store_id = current store.id

target_type = slot:
  slot.id = target_id
  slot.organization_id = current organization.id
  slot.store_id = current store.id
  slot.service_id が current store の service に属していること
```

フォーム側も同じ store に属することを検証する。

```txt
form_template.organization_id = current organization.id
form_template.store_id = current store.id
form_template.form_type = form_assignments.form_type
form_template.status = published
form_template.current_published_version_id IS NOT NULL
```

## 7.5 form_submissions

フォーム回答のヘッダ。

```sql
CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  form_template_id TEXT NOT NULL,
  form_template_version_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  booking_id TEXT,
  participant_id TEXT,
  customer_name_snapshot TEXT,
  customer_email_snapshot TEXT,
  source TEXT NOT NULL,
  submitted_by_user_id TEXT,
  submitted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (form_template_id) REFERENCES form_templates(id) ON DELETE RESTRICT,
  FOREIGN KEY (form_template_version_id) REFERENCES form_template_versions(id) ON DELETE RESTRICT,
  FOREIGN KEY (booking_id) REFERENCES booking(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participant(id) ON DELETE SET NULL
);
```

`source`:

```txt
public:
  ゲスト公開予約

participant:
  ログイン済み参加者

staff:
  管理者・スタッフ代理予約
```

制約:

```sql
CREATE UNIQUE INDEX form_submissions_booking_template_uidx
ON form_submissions (booking_id, form_template_id);

CREATE INDEX form_submissions_booking_idx
ON form_submissions (booking_id);

CREATE INDEX form_submissions_template_idx
ON form_submissions (form_template_id, submitted_at);

CREATE INDEX form_submissions_store_idx
ON form_submissions (organization_id, store_id, submitted_at);
```

MVPでは、予約に紐づかないフォーム回答は作らない。

```txt
booking_id はMVPでは必須運用
participant_id は任意
```

DB上は将来拡張のため nullable にしてもよいが、アプリ層ではMVP中 `booking_id` 必須として検証する。

## 7.6 form_answers

フォーム回答の明細。

```sql
CREATE TABLE form_answers (
  id TEXT PRIMARY KEY NOT NULL,
  form_submission_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL,
  label_snapshot TEXT NOT NULL,
  value_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (form_submission_id) REFERENCES form_submissions(id) ON DELETE CASCADE
);
```

制約:

```sql
CREATE UNIQUE INDEX form_answers_submission_field_uidx
ON form_answers (form_submission_id, field_key);

CREATE INDEX form_answers_submission_idx
ON form_answers (form_submission_id, sort_order);
```

---

## 8. バリデーション仕様

## 8.1 フォーム作成時

共通検証:

```txt
name は必須
form_type はMVP対象の3種のみ
field_key はフォーム内一意
field_type は対応タイプのみ
required は boolean
sort_order は数値
```

選択肢系:

```txt
radio/select:
  options が1件以上必要
  value は項目内で一意
  label は必須

checkbox:
  options が1件以上必要
```

同意事項:

```txt
form_type = consent の場合:
  field_type = consent を1つ以上含める

field_type = consent の場合:
  value は true/false
  required = true を推奨
```

## 8.2 フォーム公開時

公開前に以下を検証する。

```txt
フォーム名が存在する
項目が1つ以上存在する
field_key が重複していない
選択肢系の options が正しい
consent フォームに consent 項目が存在する
```

公開成功時:

```txt
1. version_number を採番
2. form_template_versions を作成
3. form_templates.current_published_version_id を更新
4. form_templates.status = published にする
```

## 8.3 公開予約時

予約作成時に以下を行う。

```txt
1. orgSlug / storeSlug から organization / store を解決
2. serviceId / slotId が current store に属することを検証
3. 対象フォームを再解決
4. formContextHash が現在のフォーム文脈と一致するか検証
5. 送信された formTemplateVersionId が現在公開版と一致するか検証
6. 必須フォームの送信有無を検証
7. 必須項目の回答有無を検証
8. 回答値の型・選択肢を検証
9. booking を作成
10. form_submissions / form_answers を作成
```

予約作成とフォーム回答保存は同一トランザクションで行う。

```txt
booking が作成されたがフォーム回答がない
フォーム回答があるが booking がない
```

という不整合を防ぐ。

---

## 9. 権限仕様

## 9.1 フォーム管理

フォームを作成・編集・公開・削除できる権限:

```txt
org owner
org admin
store manager
```

`store staff` はMVPではフォーム定義を変更できない。

## 9.2 回答閲覧

フォーム回答を閲覧できる権限:

```txt
org owner
org admin
store manager
store staff
```

理由:

```txt
- 予約運用で当日確認が必要
- MVPでは健康情報・医療情報を扱わない
```

センシティブ情報を扱う段階では、項目単位の閲覧制御・監査ログ・保存期限を追加する。

---

## 10. 旧機能削除・破壊的移行

## 10.1 削除対象

以下を削除または未使用化する。

```txt
DB:
  public_site_intake_field
  booking_answer

Backend:
  intake-fields の取得API
  intake-fields の更新API
  booking_answer への保存処理

Frontend:
  /{orgSlug}/{storeSlug}/admin/intake-fields
  旧カスタム入力設定画面
  公開予約フォーム内の旧 intake-fields 読み込み処理
```

## 10.2 既存データを捨てる場合

開発中で既存データが不要な場合は、旧データ移行を行わない。

```txt
1. public_site_intake_field を drop
2. booking_answer を drop
3. 新フォーム基盤を作成
4. 管理画面からフォームを作り直す
```

## 10.3 既存データを一度だけ移す場合

既存の店舗別カスタム入力を初期フォームとして取り込む場合は、以下のルールにする。

```txt
対象:
  public_site_intake_field.visible_on_public = true の項目のみ

対象外:
  visible_on_public = false の項目
```

移行先:

```txt
form_templates:
  form_type = reservation_input
  name = "予約時入力フォーム"
  store_id = public_site_intake_field.store_id

form_fields:
  field_key = public_site_intake_field.field_key
  label = public_site_intake_field.label
  field_type = public_site_intake_field.field_type
  required = public_site_intake_field.required
  options_json = public_site_intake_field.options_json
  description = public_site_intake_field.help_text
  placeholder = public_site_intake_field.placeholder
  sort_order = public_site_intake_field.sort_order

form_assignments:
  target_type = store
  target_id = store_id
```

移行後に publish し、`form_template_versions` を作成する。

`booking_answer` の旧回答は移行しない。開発中のため破棄してよい。

---

## 11. 実装順序

破壊的変更OKのため、段階的な互換運用はしない。

```txt
Phase 1:
  新フォーム基盤のDB migrationを作成する

Phase 2:
  旧 intake-fields UI/API と booking_answer 書き込みを削除する

Phase 3:
  フォーム管理APIを実装する

Phase 4:
  フォーム管理画面を実装する

Phase 5:
  公開予約フォームの読み取り元を form_templates に変更する

Phase 6:
  予約作成APIで form_submissions / form_answers を保存する

Phase 7:
  予約詳細画面にフォーム回答を表示する

Phase 8:
  docs/current/form-management-mvp.md と docs/README.md を更新する
```

既存データを移行する場合は、Phase 1 と Phase 2 の間で一度だけ移行する。

```txt
Phase 1.5:
  visible_on_public = true の旧項目のみ form_templates 系へ移行する
```

Phase 1〜7 は同じ作業ブランチでまとめて反映する。
途中状態を本番へデプロイしない。

```txt
途中デプロイ禁止:
  旧 intake-fields を削除したが、新フォーム保存がまだない状態
  公開予約が form_templates を読むが、予約作成時に form_submissions を保存しない状態
  予約作成が form_submissions を受け取るが、管理画面で回答確認できない状態
```

---

## 12. エラー仕様

代表的なエラー:

```txt
FORM_NOT_FOUND:
  フォームが存在しない

FORM_NOT_PUBLISHED:
  フォームが公開されていない

FORM_VERSION_OUTDATED:
  送信されたフォームバージョンが古い

FORM_CONTEXT_OUTDATED:
  表示時点と予約作成時点で必要なフォーム集合が異なる

FORM_REQUIRED_FIELD_MISSING:
  必須項目が未回答

FORM_INVALID_FIELD:
  存在しない field_key が送信された

FORM_INVALID_VALUE:
  回答値が型または選択肢に合わない

FORM_ASSIGNMENT_CONFLICT:
  同じ対象・同じ form_type に既にフォームが割り当てられている

FORM_ASSIGNMENT_TARGET_INVALID:
  service / slot が現在の store に属していない
```

HTTPステータス:

```txt
400:
  入力値不正

403:
  権限なし

404:
  対象なし

409:
  バージョン不一致・割り当て競合
```

---

## 13. 受け入れ条件

### 13.1 管理画面

```txt
- 店舗管理者が /{orgSlug}/{storeSlug}/admin/forms を開ける
- フォーム一覧を表示できる
- 予約時入力フォームを作成できる
- 事前アンケートを作成できる
- 同意事項フォームを作成できる
- フォームに項目を追加できる
- radio/select/checkbox の選択肢を設定できる
- フォームを公開できる
- 公開時に form_template_versions が作成される
- フォームを store / service / slot に割り当てられる
- 同一対象・同一 form_type の重複割り当てができない
```

### 13.2 公開予約

```txt
- 公開予約ページで対象フォームが表示される
- slot 割り当てが service/store より優先される
- service 割り当てが store より優先される
- 必須項目未回答では予約できない
- consent 必須項目が false の場合は予約できない
- 予約作成時に form_submissions が作成される
- 回答ごとに form_answers が作成される
- ゲスト予約では participant_id が null でも保存できる
- booking とフォーム回答が同一トランザクションで保存される
```

### 13.3 回答閲覧

```txt
- 管理画面の予約詳細で回答を確認できる
- 回答時点のフォーム名・バージョンを確認できる
- 回答時点の質問ラベルを確認できる
- 同意事項の同意日時を確認できる
```

### 13.4 旧機能削除

```txt
- /admin/intake-fields を使わない
- /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/intake-fields を使わない
- public_site_intake_field への新規書き込みがない
- booking_answer への新規書き込みがない
```

---

## 14. テスト方針

## 14.1 Backend

テスト対象:

```txt
フォーム作成
フォーム編集
フォーム公開
フォーム割り当て
フォーム解決
予約作成時の回答保存
必須項目検証
選択肢検証
consent 検証
バージョン不一致
所属検証
権限検証
```

特に重要なテスト:

```txt
- service が別 store に属する場合、割り当て作成できない
- slot が別 store に属する場合、割り当て作成できない
- 古い form_template_version_id で予約作成すると 409
- ゲスト予約で participant_id が null でも form_submissions を保存できる
- 同一 booking に同じ form_template の submission を重複作成できない
```

## 14.2 Frontend

テスト対象:

```txt
フォーム一覧
フォーム作成
項目追加・削除・並び替え
選択肢入力
公開操作
割り当て操作
公開予約フォーム表示
必須エラー表示
同意チェック未入力エラー
予約詳細での回答表示
```

---

## 15. 将来拡張

MVP後の候補:

```txt
初回登録フォーム
回答CSV出力
回答後編集
予約後アンケート
未回答リマインド
ファイル添付
条件分岐
項目単位の閲覧制限
監査ログ
保存期限
Stripe Checkout の pending booking 連携
フォーム単体公開URL
```

### 15.1 初回登録フォームを追加する場合

将来的に `initial_registration` を実装する場合は、回答済み判定を次の単位にする。

```txt
store_id
participant_id
form_template_id
```

再回答ポリシーを追加する。

```txt
reanswer_policy:
  never
  on_new_version
```

MVPでは実装しない。

### 15.2 Stripe Checkout と連携する場合

将来的に予約時オンライン決済を行う場合は、次のどちらかを選ぶ。

```txt
案A:
  pending_booking を作成し、決済成功後に confirmed にする

案B:
  booking を pending_payment で作成し、決済成功後に confirmed にする
```

フォーム回答は決済前に `booking_id` に紐づける必要があるため、MVPのような「予約作成と同時保存」だけでは不足する。

MVPでは対象外。

---

## 16. 推奨ファイル配置

この仕様書は現行仕様として扱うため、以下に配置する。

```txt
docs/current/form-management-mvp.md
```

`docs/README.md` の「現行仕様」に以下を追加する。

```md
- [form-management-mvp.md](./current/form-management-mvp.md): フォーム管理機能のMVP仕様。
```

---

## 17. 最終方針まとめ

```txt
- 新フォーム基盤をMVPから正本にする
- public_site_intake_field / booking_answer は廃止する
- 旧UI / 旧APIとの互換は持たない
- 必要な場合のみ visible_on_public = true の旧項目を一度移行する
- form_fields に visible_on_public は持たせない
- 管理画面URLは /{orgSlug}/{storeSlug}/admin/forms
- 管理APIは /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms
- form_assignments は enabled を持たず、解除時 DELETE
- target_type の所属検証はアプリ層で必須
- 回答は booking_id 主体で form_submissions / form_answers に保存する
- participant_id は nullable
- 初回登録フォームはMVP外
- 健康情報・医療情報はMVP外
- Stripe Checkout 連携はMVP外
```
