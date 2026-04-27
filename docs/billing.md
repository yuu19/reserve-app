# 課金仕様

最終更新: 2026-04-28

## 1. 目的

組織ごとに契約状態を管理する。

契約状態によって、無料で使える機能とプレミアム機能の利用可否が決まる。  
契約の開始、支払い方法の登録、契約管理は組織の owner だけが実行できる。

admin、manager、staff、participant は契約状態を確認できる場合がある。  
ただし、プラン変更や支払い設定は実行できない。

回数券購入の決済は、この文書の対象外とする。  
ここでは、組織単位のプレミアム契約を扱う。

## 2. 契約状態

組織の契約状態は次の3つに分かれる。

| 状態 | 意味 | 主な挙動 |
| --- | --- | --- |
| 無料プラン | プレミアム契約がない状態 | プレミアム機能は利用できない |
| プレミアムトライアル | 7日間だけプレミアム機能を試せる状態 | 期間中はプレミアム機能を利用できる |
| プレミアム契約 | 有料契約が有効な状態 | プレミアム機能を継続して利用できる |

契約状態は組織に紐づく。  
教室ごとには契約を持たない。

1つの組織に複数の教室がある場合も、利用可否は組織の契約状態で決まる。  
教室ごとに異なるプレミアム状態にはしない。

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

プレミアム契約中のプラン変更や契約管理も owner だけが開始できる。  
契約管理は Stripe Customer Portal へ移動して行う。

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

## 8. Stripe との同期

契約状態の変更は Stripe から届く通知でも反映する。

同じ通知が複数回来ても、契約状態が二重に変わらないようにする。  
通知の順番が前後しても、最終的に正しい契約状態へ戻せるようにする。

Stripe 側の状態とアプリ側の契約状態がずれた場合は、調査できる印を残す。  
一時的に Stripe へ確認できない場合も、後で再確認できるようにする。

Stripe からの通知は、正当な送信元であることを確認してから処理する。  
確認できない通知では、契約状態を変えない。

## 9. 社内調査

許可された社内担当者だけが、契約状態の調査画面を利用できる。

調査画面では、現在の契約状態、支払い方法の状態、通知履歴、状態ずれの有無、契約変更の履歴を確認できる。  
これにより、問い合わせを DB 直接調査に頼らず分類できる。

社内調査では、支払い詳細を表示しない。  
表示してよいのは、調査に必要な Stripe 上の識別子や状態だけとする。

## 10. 表示の原則

契約状態は、色だけで伝えない。  
状態名、説明文、次に必要な操作を文章で示す。

読み込み中、確認中、成功、失敗、閲覧のみの状態は区別する。  
特に支払い方法の登録後は、確認中の状態を成功として扱わない。

owner 以外には、契約操作のボタンを出さない。  
操作できない理由は、業務上の権限として説明する。

## 11. 将来拡張

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

### 関連コード

- 契約状態の判定: `apps/backend/src/billing/organization-billing-policy.ts`
- Stripe 通知の同期: `apps/backend/src/billing/stripe-webhook-sync.ts`
- 通知履歴: `apps/backend/src/billing/organization-billing-notifications.ts`
- 監査履歴と状態ずれの記録: `apps/backend/src/billing/organization-billing-observability.ts`
- 社内調査の読み取り: `apps/backend/src/billing/internal-billing-inspection.ts`
- プレミアム機能の制御: `apps/backend/src/booking/authorization.ts`
