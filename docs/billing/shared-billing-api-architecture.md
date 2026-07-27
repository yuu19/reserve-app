# 共有 Billing API 設計メモ

最終更新: 2026-07-25

## この文書の扱い

この文書は、複数 SaaS で使い回す Billing API の設計決定メモです。
現行の reserve-app 組織単位課金仕様は、移行が完了するまで [billing.md](./billing.md) を正とします。

この文書では、reserve-app の課金実装をそのまま巨大な共通サービスへ移すのではなく、まず課金の正本を扱う API 境界を切る方針をまとめます。

## 背景

reserve-app はまだ公開前です。
同時に他の SaaS も作成しているため、reserve-app 専用の課金実装を増やし続けると、後から Stripe webhook、契約状態、通知、冪等性、請求履歴を SaaS ごとに移植する負担が大きくなります。

そのため、この時点で Billing API を作り、契約状態と利用可能な機能の正本を共通化します。

## 結論

複数 SaaS で共有する前提があるため、Billing API を分離します。

Billing API は、顧客、契約、プラン、addon、請求、支払い、Stripe webhook、entitlements の正本を持ちます。
各 SaaS は、Billing API から取得した契約状態と利用可能な機能を、自分の業務画面や業務 API に適用します。

reserve-app の予約枠、店舗、スタッフ、メニュー、予約ページ公開状態などの業務判断は、Billing API に入れません。
Billing API は「何が利用可能か」を返します。
reserve-app は「その結果を予約業務でどう扱うか」を決めます。

## 責務分担

### reserve-app

reserve-app は予約管理の業務を扱います。

- 店舗、スタッフ、メニュー、予約枠を管理する。
- 管理画面と公開予約画面を提供する。
- Billing API から受け取った利用可能な機能を見て、操作の許可や UI 表示を決める。
- スタッフ追加、店舗追加、オンライン決済、リマインド通知などの最終的な業務制御を行う。

reserve-app は、Stripe webhook を直接処理して契約状態を更新する役割から段階的に外します。

### Billing API

Billing API は課金状態の正本を扱います。

- SaaS ごとの課金対象を登録する。
- 顧客、契約、プラン、価格、addon、請求状態を管理する。
- Stripe Checkout、Customer Portal、支払い方法登録の手続きを開始する。
- Stripe billing webhook を受け取り、契約状態へ反映する。
- 契約状態から利用可能な機能を生成する。
- API key 認証、冪等性、webhook 重複排除、処理履歴を管理する。
- 必要な通知を後続処理へ渡せるようにする。

### Notification API / Worker

通知は将来 Billing API から分離できます。
初期段階では、Billing API が通知予定の最小情報を保存します。

将来の Notification API / Worker は、次を扱います。

- 決済失敗メールを送る。
- 契約更新やトライアル終了を通知する。
- onboarding 未完了を通知する。
- 通知の再試行と配信結果を記録する。

## Better Auth Stripe plugin の扱い

現行コードでは、Better Auth は認証と organization を扱っています。
Better Auth の Stripe plugin は使っていません。

共有 Billing API では、課金の正本を Better Auth plugin に寄せません。
Better Auth はログイン、セッション、組織参加者などの認証境界を担当します。
Billing API は契約、支払い、Stripe webhook、entitlements を担当します。

この分離により、reserve-app 以外の SaaS でも同じ Billing API を使えます。

## 対象の単位

Billing API は、SaaS と課金対象を組み合わせて契約を識別します。

```txt
appId + subjectType + subjectId
```

reserve-app では、初期の課金対象は組織です。

```txt
appId: reserve
subjectType: organization
subjectId: org_123
```

将来、別 SaaS では `workspace`、`team`、`school` などを課金対象にできます。
Billing API は subject の具体的な業務意味を持ちません。

## データ配置

初期方針は、単一の Billing API と単一の Billing D1 です。
すべての billing table に `app_id` を持たせます。

課金対象は、`app_id`、`subject_type`、`subject_id` の組み合わせで一意にします。
API key も app ごとのアクセス権を持ちます。

初期は、課金対象ごとに Stripe Customer を 1 つ持ちます。
ただし、将来の請求先統合に備えて、`billing_party` を最初から持ちます。
初期運用では、課金対象と請求先は 1 対 1 として扱います。

## 主な保存対象

Billing API には、次の情報を置きます。

- billing app
- app credential
- billing party
- billing subject
- billing account
- subscription
- subscription item
- product
- plan
- price
- addon
- entitlement rule
- entitlement
- invoice
- payment
- usage event
- usage summary
- webhook event
- operation attempt
- redirect template
- notification outbox

初期実装では、MVP に必要な範囲から始めます。
usage metering、Connect payments、詳細な請求書管理、管理画面は後続に回します。

## entitlements

Billing API は、契約状態とカタログから利用可能な機能を生成します。
各 SaaS は、その結果を自分の業務制御へ適用します。

reserve-app では、次のような応答を想定します。

```json
{
  "appId": "reserve",
  "subjectType": "organization",
  "subjectId": "org_123",
  "planCode": "pro",
  "status": "active",
  "features": {
    "staffLimit": 10,
    "shopLimit": 3,
    "monthlyReservationLimit": 3000,
    "onlinePayment": true,
    "customDomain": true,
    "reminderNotification": true
  }
}
```

reserve-app は、この情報を見て、スタッフ追加、店舗追加、オンライン決済、リマインド通知を制御します。
ただし、予約枠を止める、スタッフを削除する、予約ページを非公開にする、画面表示をどう変える、という業務処理は reserve-app 側に残します。

## entitlement cache

各 SaaS backend は、Billing API から取得した entitlements をローカルに投影してよいです。
すべての操作で Billing API を直接呼ぶ設計にはしません。

ローカル投影は、`validUntil` と `syncedAt + maxStale` の範囲内だけ信頼します。
期限を超えた場合は、課金が必要な機能を fail closed にします。

これにより、Billing API の一時障害時でも短時間の読み取りは耐えられます。
一方で、古い契約状態を長時間信頼し続けることは避けます。

## SaaS backend との同期方向

組織情報は各 SaaS backend を正本とします。
契約、支払い、addon、entitlement は Billing API を正本とします。

| データ・処理                        | 同期方向              | 方式                                     |
| ----------------------------------- | --------------------- | ---------------------------------------- |
| 組織名、slug、請求担当者            | backend → Billing API | 組織変更時の同期と、課金操作前の存在確認 |
| Checkout、Portal、trial、addon 操作 | backend → Billing API | 同期 command API                         |
| 契約、支払い、addon、entitlement    | Billing API → backend | event outbox と非同期 Worker             |
| 課金画面の操作直後に表示する結果    | Billing API → backend | command response                         |

組織変更時の同期に失敗した場合や、初回同期より先に課金操作が届いた場合に備え、command 実行前の存在確認を残します。
同期要求の冪等性キーは同期本文から生成します。
組織名、slug、請求担当者が変わった場合は、新しい本文に対応する別のキーを使います。

Checkout、Portal、trial、addon はデータ複製ではなく、Billing API に状態変更を依頼する command として扱います。
backend は利用者の認証と組織権限を確認します。
契約状態による実行可否は、課金状態の正本である Billing API が判定します。

### backend へのイベント配送

Billing API は、契約状態が正常に変わったときに subject 単位のイベントを作成します。
backend は全イベントを順番どおりに受け取ります。
現段階では支払い問題通知だけを副作用として実行し、課金 projection は更新しません。

非同期イベントは、少なくとも次の識別情報を持ちます。

- event ID
- app ID
- subject type と subject ID
- subject ごとに単調増加する revision
- 変更理由と影響した課金対象
- 発生時刻
- Stripe と請求イベントの安全な識別情報

backend は受信済み event ID を記録し、同じ event の再送を重複適用しません。
保存済み revision 以下の event は無視します。
revision の欠落を検出した場合は、先行イベントが届くまで Queue で再試行します。

支払い失敗と追加認証要求では、通知前に Billing API の summary と請求イベントを取得します。
すでに支払いが回復している場合はメールを送りません。

Billing API は課金状態の更新と event outbox の作成を同じトランザクションで行います。
Worker は at-least-once で配送し、再試行上限を超えた event を dead-letter として残します。
配送と通知の詳細は [Billing API の課金イベント配送](./billing-api-event-outbox.md) を参照してください。

### 段階導入

現行実装では、event outbox、backend event inbox、subject revision、Queue consumer を実装しています。
支払い問題通知は機能フラグを有効にするまで送信しません。

共通 projector と backend 課金 projection の非同期更新はまだ実装していません。
課金画面の操作直後は、引き続き command response を利用します。
将来 projection を追加するときは、現在の inbox と subject revision を同じ順序制御境界として利用します。

## API 境界

app id は path に含めます。
API key も、その app id へのアクセス権を持つ必要があります。

```txt
/api/v1/apps/{appId}/...
```

初期 MVP で必要な API は次のとおりです。

```txt
PUT  /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}
GET  /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/summary
GET  /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/entitlements
GET  /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/invoice-events
POST /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/trial
POST /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/trial/complete
POST /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/checkout-sessions
POST /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/payment-method-setup-sessions
POST /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/billing-portal-sessions
POST /api/v1/webhooks/stripe/billing
```

課金対象は、先に SaaS backend から Billing API へ登録します。
Billing API は、登録されていない subject に対する課金操作を受け付けません。

## 認証と冪等性

初期の API 認証は、静的 API key で始めます。
API key は hash、prefix、scope、失効時刻を保存します。
API key の scope は、読み取り、課金対象同期、課金操作開始を分けて強制します。
読み取り専用 key で Checkout や Customer Portal を開始できないようにします。

状態を変える API は `Idempotency-Key` を要求します。
同じ key と同じ request body では、保存済みの応答を再利用します。
同じ key で異なる request body が届いた場合は、衝突として扱います。

Stripe に手続きを渡す操作では、API レベルの冪等性と別に、Stripe handoff 用の operation attempt を持ちます。
これにより、同じ owner 操作で Checkout Session や Portal Session が乱立しないようにします。

## カタログ

プラン、価格、addon、entitlement rule は、初期は code / seed 管理にします。
実行時の参照元は Billing API の DB です。
addon catalog は、スタッフ数や店舗数の追加購入を表現できるように、addon、addon price、addon entitlement rule を分けて持ちます。
addon の subscription item 同期と entitlement 合成は実装済みです。
reserve-app の詳細な addon 契約は [Premium addon 仕様](./addon-specification.md) を参照してください。

これにより、デプロイ済み API は DB の catalog を見て契約状態を判定できます。
一方で、管理画面から自由に価格を変えるような運用は初期対象外にします。

## 戻り先 URL

Checkout や Customer Portal から戻る URL は、Billing API が redirect template key で管理します。

初期の dev / test では allowlist 付きの override を許可する余地を残します。
本番では、各 SaaS が任意の URL を直接渡してリダイレクト先を広げないようにします。

## Stripe webhook

Stripe billing webhook は Billing API が受け取ります。
SaaS 固有のアプリ内決済や Connect payment の webhook とは endpoint を分けます。

webhook から対象を見つける順序は次のとおりです。

1. metadata の `appId`、`subjectType`、`subjectId` を優先する。
2. Stripe customer id から billing account を探す。
3. Stripe subscription id から subscription を探す。
4. どれにも一致しない event は、unknown として保存し、契約状態は変えない。

署名検証に失敗した通知では、契約状態を変更しません。
署名検証済みの event は、重複排除できる形で保存します。

## Stripe Connect

Stripe Connect は初期対象外です。

reserve-app では、将来的にオンライン決済手数料や店舗側の入金が必要になる可能性があります。
そのため、Billing API の設計では Connect 用の余地を残します。

ただし、初期の Billing API は、SaaS 利用料の subscription billing に集中します。
参加者から店舗への支払い、Connect onboarding、Connect payment は後続の独立した設計で扱います。

## 実装配置

最初は monorepo 内に Billing API を置きます。
ただし、Billing API と共有 package は reserve-app の業務コードを import しません。

```txt
apps/
  reserve-app/
  billing-api/
  notification-api/
  notification-worker/

packages/
  billing-client/
  billing-types/
  product-billing-config/
```

現在の初期実装では、次の配置を使います。

```txt
apps/billing-api
packages/billing-client
packages/billing-types
```

## 移行方針

公開前のため、既存 reserve-app 課金データの本番移行は行いません。
既存の課金実装を守りながら、段階的に Billing API へ寄せます。

実施順序は次のとおりです。

1. reserve-app 内の課金処理を billing module に寄せる。
2. reserve-app は BillingClient 経由でだけ課金状態を触るようにする。
3. DB model を Billing API 前提にする。
4. Stripe billing webhook を Billing API 側へ移す。
5. entitlements API を作る。
6. reserve-app は entitlements を参照して業務制御する。
7. 他 SaaS が出てきたら、同じ Billing API を使う。

初期構築では、先に `apps/billing-api` を作り、reserve-app の adapter / client 移行を後続で進めます。

## 初期スコープ

最初に作る範囲は次のとおりです。

- app id
- billing account
- subject sync
- subscription
- plan
- addon
- addon price
- addon entitlement rule
- Stripe billing webhook
- entitlements
- checkout session
- payment method setup session
- billing portal session
- customer / account summary

後で追加する範囲は次のとおりです。

- usage metering
- subscription schedule
- Stripe Connect payments
- invoice detail management
- Notification API
- internal admin UI

## reserve-app で最初に扱う機能

reserve-app では、まず次を Billing API で扱えるようにします。

- 組織単位の契約
- 月額プラン
- スタッフ数 addon
- 店舗数 addon
- 予約数の上限
- オンライン決済の ON / OFF
- リマインド通知の ON / OFF
- Stripe Connect onboarding 状態の参照余地

Connect onboarding の実処理は初期対象外です。
ただし、entitlements や状態表示で将来扱えるように、設計上の余地は残します。

## 非ゴール

初期 Billing API では、次を行いません。

- reserve-app 固有の予約業務ロジックを Billing API に入れる。
- 予約枠を自動停止する。
- スタッフを自動削除する。
- 予約ページを自動で非公開にする。
- Stripe Connect payment を扱う。
- Billing UI を共通化する。
- すべての請求書詳細や返金を最初から管理する。
- runtime 管理画面で catalog を自由編集できるようにする。

## 判断

今 Billing API を作る判断は妥当です。

理由は、reserve-app がまだ公開前で、他 SaaS への展開も見えているためです。
Stripe webhook、契約状態、冪等性、entitlements、通知連携は、後から SaaS ごとに分離するより、先に境界を切った方が手戻りが少なくなります。

ただし、Billing API は課金の正本に徹します。
reserve-app の予約業務ロジックは Billing API に入れません。
