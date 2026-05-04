# 課金仕様

最終更新: 2026-05-04

## 1. 目的

組織ごとに契約状態を管理する。

契約状態によって、無料で使える機能とプレミアム機能の利用可否が決まる。  
契約の開始、支払い方法の登録、契約管理は組織の owner だけが実行できる。

admin、manager、staff、participant は契約状態を確認できる場合がある。  
ただし、プラン変更や支払い設定は実行できない。

回数券購入のアプリ内決済は、この文書の対象外とする。
現在の回数券購入は、現地決済または銀行振込の承認フローで扱う。

回数券の Stripe 決済は、将来 Stripe Connect で各組織の Stripe アカウントへ入金できる形を整えてから扱う。
ここでは、組織単位のプレミアム契約を扱う。

## 2. 契約状態

組織の契約状態は次の3つに分かれる。

| 状態                 | 意味                                | 主な挙動                           |
| -------------------- | ----------------------------------- | ---------------------------------- |
| 無料プラン           | プレミアム契約がない状態            | プレミアム機能は利用できない       |
| プレミアムトライアル | 7日間だけプレミアム機能を試せる状態 | 期間中はプレミアム機能を利用できる |
| プレミアム契約       | 有料契約が有効な状態                | プレミアム機能を継続して利用できる |

契約状態は組織に紐づく。  
教室ごとには契約を持たない。

1つの組織に複数の教室がある場合も、利用可否は組織の契約状態で決まる。  
教室ごとに異なるプレミアム状態にはしない。

支払い状態によって、プレミアム機能の扱いはさらに分かれる。

| 支払い状態          | プレミアム機能の扱い                       | owner への案内                         |
| ------------------- | ------------------------------------------ | -------------------------------------- |
| 初回決済未完了      | すぐに利用不可                             | 決済完了または支払い方法確認を案内する |
| 支払い遅延          | 遅延開始から7日間は継続し、その後停止する  | 猶予期限と支払い方法更新を案内する     |
| 未払い              | すぐに利用不可                             | 支払い方法更新またはサポートを案内する |
| 期間末解約予定      | 現在の契約期間が終わるまで利用できる       | 解約予定日を表示する                   |
| 解約済み            | すぐに利用不可                             | 既存データを保持したまま停止を伝える   |
| 未知の Stripe Price | 利用不可。調査対象として社内向けに記録する | owner にはサポートへの相談を案内する   |

## 3. 無料プラン

無料プランの組織では、基本機能だけを利用できる。

プレミアム機能を実行しようとした場合は、操作を止める。  
画面では、プレミアム契約が必要であることを説明する。

owner には契約画面への導線を出してよい。  
owner 以外には、契約操作のボタンを出さない。

## 4. プレミアムトライアル

owner は、条件を満たす組織で7日間のトライアルを開始できる。

同じ組織で開始できるトライアルは1回だけとする。  
すでにトライアル中、プレミアム契約中、または過去にトライアルを使った組織では、新しいトライアルを開始できない。

トライアル中はプレミアム機能を利用できる。  
画面では、終了予定日と支払い方法の登録状況を表示する。

トライアルを使い終わった無料プランの組織では、トライアル開始ボタンを出さない。
owner には月額または年額の有料契約開始を案内する。

Stripe の Premium Price が設定され、`STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED=true` の環境では、トライアル開始時に Stripe subscription も作成する。
この subscription は 7 日間の trial とし、支払い方法がないまま trial が終了した場合は Stripe 側でも cancel される。

トライアル終了前に支払い方法が登録されていれば、有料契約へ進む。  
登録されていなければ、無料プランへ戻る。

無料プランへ戻っても、組織、教室、予約、参加者などの業務データは削除しない。  
プレミアム機能だけを利用不可にする。

## 5. 支払い方法の登録と契約管理

支払い方法の登録は owner だけが開始できる。

支払い情報の入力画面は Stripe が提供する画面を使う。  
このアプリはカード番号などの支払い詳細を保存しない。

支払い方法の登録後は、登録が完了しているか、確認中かを画面に表示する。  
完了していない状態を、成功したように見せてはいけない。

Stripe Checkout の setup 完了通知を受け取ったら、作成された PaymentMethod を Customer と subscription の default payment method に設定する。
これにより、trial 終了後の請求に同じ支払い方法を利用できるようにする。

有料契約の開始では、owner が月額または年額を選ぶ。
利用できる請求周期は、設定済みの Premium Price に基づく。

同じ owner 操作を短時間に繰り返しても、新しい Stripe の手続きを乱立させない。
同じ組織、同じ目的の有効な手続きは 30 分間再利用する。

プレミアム契約中のプラン変更や契約管理も owner だけが開始できる。  
契約管理は Stripe Customer Portal へ移動して行う。

Customer Portal は、Stripe と連携済みで `active`、`trialing`、`past_due`、`unpaid`、`incomplete` の契約だけで使える。
無料プラン、解約済み、または Stripe subscription がない組織では表示しない。

## 5.1 回数券購入の支払い

参加者は、回数券の購入申請を送信できる。

現在利用できる支払い方法は、現地決済と銀行振込のみとする。
申請後、運営が入金や支払い状況を確認して承認すると、回数券が付与される。

アプリ内の Stripe 決済は利用できない。
API でも回数券購入の Stripe 決済は受け付けない。

既存の Stripe Checkout 完了通知を処理する経路は、過去に作成済みの checkout session を完了させるためだけに残す。
新しい回数券購入では checkout session を作成しない。

## 6. プレミアム機能

プレミアム機能は、組織の契約状態が有効な場合だけ利用できる。

対象になる主な機能は次のとおり。

- 複数教室の管理
- スタッフ招待とロール管理
- 定期スケジュール
- 承認制予約
- 回数券や継続支払いに関係する操作
- 高度な契約管理
- 参加者招待
- CSV 出力
- 分析や監査向けの表示
- 優先サポート

無料プランの組織では、これらの操作をサーバ側で止める。  
画面だけで隠す対応にはしない。

## 7. 通知

トライアル終了の3日前に、owner へメールで案内する。

案内では、支払い方法を登録するとプレミアム機能を継続できることを伝える。  
何もしない場合は無料プランへ戻ることも伝える。

メール送信が成功したか、失敗したか、再試行中かを後から確認できるようにする。  
送信失敗を利用者向け操作の失敗として扱わない場合でも、調査できる記録は残す。

支払い失敗または支払い対応要求が届いた場合は、検証済みメールアドレスを持つ owner 全員へすぐに通知する。
支払い遅延の猶予期限が近づいた場合も、期限の3日前に owner へ案内する。

検証済み owner がいない場合は、admin、manager、staff、participant へ課金通知を送らない。
この場合は、社内調査で確認できる印だけを残す。

## 8. Stripe との同期

契約状態の変更は Stripe から届く通知でも反映する。

同じ通知が複数回来ても、契約状態が二重に変わらないようにする。  
通知の順番が前後しても、最終的に正しい契約状態へ戻せるようにする。

Stripe 側の状態とアプリ側の契約状態がずれた場合は、調査できる印を残す。  
一時的に Stripe へ確認できない場合も、後で再確認できるようにする。

Stripe からの通知は、正当な送信元であることを確認してから処理する。  
確認できない通知では、契約状態を変えない。

Webhook では、主に次の通知を扱う。

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
- `invoice.finalized`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `invoice.payment_action_required`

Stripe の event id は、重複排除のために保持する。
同じ event id の通知が再送された場合は、契約状態、通知、請求イベントを再作成しない。

署名がない通知、署名が一致しない通知、期限切れの署名は処理しない。
その場合も、支払い情報や raw payload は保存せず、調査に必要な安全な理由だけを残す。

1時間ごとに、支払い問題や処理中などの危険な状態を対象に照合する。
1日1回、Stripe と連携済みの契約全体も照合する。

## 9. 請求書・領収書・請求イベント

owner は、Stripe が提供する請求書または領収書の参照を契約画面で確認できる。
アプリはカード番号、支払い方法の詳細、税務詳細、Stripe の raw payload を保存しない。

請求書や領収書がまだない場合は、「未生成」「確認中」「利用不可」として扱う。
存在しない書類を成功状態として表示しない。

契約履歴と社内調査では、次のイベントを確認できる。

- 請求書が利用可能になった
- 支払いに成功した
- 支払いに失敗した
- 支払い対応が必要になった

返金とクレジットノートは、この版のアプリ内履歴では扱わない。

## 10. 請求先情報と価格

請求先名、連絡先、税務に関係する入力は Stripe の画面で扱う。
アプリは入力内容そのものではなく、入力が必要か、完了しているか、確認できないかという状態だけを持つ。

請求先情報が未完了または確認不可でも、それだけで有料契約開始やプレミアム機能を止めない。
owner には次に必要な操作を案内し、社内調査では確認できる印を残す。

Stripe から未知の Price が届いた場合は、プレミアム機能を有効にしない。
価格カタログに登録された Price だけを、期待する有料プランとして扱う。

## 11. 社内調査

許可された社内担当者だけが、契約状態の調査画面を利用できる。

調査画面では、現在の契約状態、支払い方法の状態、通知履歴、状態ずれの有無、契約変更の履歴を確認できる。  
これにより、問い合わせを DB 直接調査に頼らず分類できる。

社内調査では、支払い詳細を表示しない。  
表示してよいのは、調査に必要な Stripe 上の識別子や状態だけとする。

社内調査では、owner の課金操作履歴、Webhook の受信・重複・署名失敗、請求書参照、請求イベント、通知結果、照合結果も確認できる。

## 12. 表示の原則

契約状態は、色だけで伝えない。  
状態名、説明文、次に必要な操作を文章で示す。

読み込み中、確認中、成功、失敗、閲覧のみの状態は区別する。  
特に支払い方法の登録後は、確認中の状態を成功として扱わない。

owner 以外には、契約操作のボタンを出さない。  
操作できない理由は、業務上の権限として説明する。

## 13. 将来拡張

今後、複数の有料プラン、請求履歴、領収書、メール以外の通知を追加できる余地を残す。

ただし、契約の正本は今後も組織に置く。  
教室単位の契約へ分ける前提にはしない。

## 実装メモ

### 主な画面と API

- 契約画面: `apps/web/src/routes/contracts/+page.svelte`
- 契約状態の取得: `GET /api/v1/auth/organizations/billing`
- トライアル開始: `POST /api/v1/auth/organizations/billing/trial`
- 支払い方法登録: `POST /api/v1/auth/organizations/billing/payment-method`
- 有料契約の開始: `POST /api/v1/auth/organizations/billing/checkout`
- 契約管理: `POST /api/v1/auth/organizations/billing/portal`
- Stripe 通知: `POST /api/webhooks/stripe`
- 社内調査: `GET /api/v1/auth/internal/organizations/{organizationId}/billing-inspection`

### 主な保存先

- 組織の契約状態: `organization_billing`
- owner 課金操作の再利用・失敗履歴: `organization_billing_operation_attempt`
- 請求書・支払いイベント履歴: `organization_billing_invoice_event`
- 請求書・領収書の参照: `organization_billing_document_reference`
- Stripe 通知の処理履歴: `stripe_webhook_event`
- Stripe 通知の失敗履歴: `stripe_webhook_failure`
- owner 向け通知履歴: `organization_billing_notification`
- 契約変更の監査履歴: `organization_billing_audit_event`
- Stripe とアプリの状態差分: `organization_billing_signal`

### 主な環境変数

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PREMIUM_MONTHLY_PRICE_ID`
- `STRIPE_PREMIUM_YEARLY_PRICE_ID`
- `STRIPE_BILLING_PRODUCT_NAME`
- `STRIPE_BILLING_MONTHLY_LOOKUP_KEY`
- `STRIPE_BILLING_YEARLY_LOOKUP_KEY`
- `INTERNAL_OPERATOR_EMAILS`
- `WEB_BASE_URL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

### 関連コード

- 契約状態の判定: `apps/backend/src/billing/organization-billing-policy.ts`
- Stripe 通知の同期: `apps/backend/src/billing/stripe-webhook-sync.ts`
- 課金操作の再利用: `apps/backend/src/billing/organization-billing-operations.ts`
- 請求書・支払いイベント: `apps/backend/src/billing/organization-billing-invoice-events.ts`
- 請求書・領収書の表示判定: `apps/backend/src/billing/organization-billing-documents.ts`
- 請求先情報の状態: `apps/backend/src/billing/organization-billing-profile.ts`
- 定期照合: `apps/backend/src/billing/organization-billing-maintenance.ts`
- 通知履歴: `apps/backend/src/billing/organization-billing-notifications.ts`
- 監査履歴と状態ずれの記録: `apps/backend/src/billing/organization-billing-observability.ts`
- 社内調査の読み取り: `apps/backend/src/billing/internal-billing-inspection.ts`
- プレミアム機能の制御: `apps/backend/src/booking/authorization.ts`
