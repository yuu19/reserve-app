# Billing API 保守性改善 cutover runbook

最終更新: 2026-07-30

## この文書の扱い

この文書は、[Billing API 保守性改善計画](./billing-api-maintainability.md)のPhase 7以降で使う、開発／preview環境向けの切替手順です。
現行の運用手順ではありません。
必要な実装Phaseが完了するまで実行しません。

- 実装範囲、必須テスト、完了判定は改善計画の「実装対応表（正本）」を優先します。
- Billing APIの旧契約データ、旧outbox、旧Queue backlogは移行しません。
- 作業中はBilling操作が停止してよいものとします。
- 一時的なmaintenance flagやWebhook保留応答は実装しません。
- Backend D1のorganization、store、予約、認証、既存通知履歴は保持します。
- 旧ticket checkoutは停止・移行対象に含めません。

## 切替方針

Billing API D1とBilling Event Queueは、新schemaと新契約で作り直します。
旧resourceの件数は記録しますが、0件まで処理しません。

```text
旧Billing API D1／旧Queue
  -> 件数を記録
  -> 停止
  -> 新D1／Queue v2へ切替
  -> test subjectを再作成
  -> 検証後に旧resourceを削除
```

Backend D1は作り直しません。
通知履歴をorganization基準へ移行し、検証後に旧Billing投影だけを削除します。

旧データへのrollbackは行いません。
新構成の検証に失敗した場合は、新Billing API D1を再作成してmigrationとseedからやり直します。

## 対象resourceの記録

作業開始前に実値を記入します。
名前やIDを推測したまま操作しません。

| 項目                        | 対象環境の値                                                 |
| --------------------------- | ------------------------------------------------------------ |
| 作業環境                    | `<development または preview>`                               |
| 作業時間                    | `<開始予定時刻〜終了予定時刻>`                               |
| 対象commit                  | `<commit SHA>`                                               |
| Billing API Worker          | `<worker name／version>`                                     |
| Backend Worker              | `<worker name／version>`                                     |
| 旧Billing API D1            | `<database name／ID>`                                        |
| 新Billing API D1            | `<database name／ID>`                                        |
| Backend D1                  | `<database name／ID>`                                        |
| 旧Queue／DLQ                | `<queue name>／<dlq name>`                                   |
| 新Queue／DLQ                | `reserve-billing-events-v2`／`reserve-billing-events-v2-dlq` |
| Backend Stripe endpoint     | `<endpoint ID／URL>`                                         |
| Billing API Stripe endpoint | `<endpoint ID／URL>`                                         |
| 作業責任者                  | `<name>`                                                     |

raw API key、Stripe secret、Webhook signing secretは記録へ貼り付けません。

## 開始条件

次を一つでも満たさない場合は、切替を開始しません。

- 対象環境がdevelopmentまたはpreviewである。
- Billing APIの既存契約データを破棄してよい。
- 改善計画のPhase 0〜6が完了している。
- T01〜T08、T11が対象commitで成功している。
- T09を同じ構成のdevelopment環境でrehearsal済みである。
- Billing APIとBackendのmigrationを空のD1へ先頭から適用できる。
- Backend D1のbackupまたは復旧可能なexportを取得している。
- 新Queueには新schemaだけを送信することをcontract testで確認している。
- 旧ticket checkoutのrouteとStripe event設定を特定している。
- Sentry、Queue metrics、D1、Stripe event deliveryを作業中に確認できる。

## 事前rehearsal

development環境で次を最後まで実行します。

1. 空のBilling API D1へmigrationを先頭から適用する。
2. app、catalog、price、addon、redirect templateをseedする。
3. test subjectとTest Clock scenarioを作成する。
4. Backend D1の追加migrationと通知履歴backfillを複製データで実行する。
5. 新Queueへ新schemaの状態変更と通知要求を投入する。
6. 重複、順序逆転、不正payload、未知versionを投入する。
7. DLQ到達eventを既存Billing調査機能で確認する。
8. DLQ IDを指定して`resync`と`re-evaluate-notification`を実行する。
9. 新Billing API D1を削除し、migrationとseedから再作成する。

T09の結果には、commit、migration、resource、開始・終了時刻、件数、失敗内容を残します。

## 事前準備

### Backend D1

Backend D1全体はresetしません。

1. 最小Entitlement投影、DLQ記録、一般化したNotification Outbox／Logのmigrationを適用する。
2. `billing_notification`へorganization、subject snapshot、trigger key、dedupe key、Outbox参照を追加する。
3. `billing_account`とのjoinで既存通知履歴をbackfillする。
4. 次の結果を保存する。

| 検証項目                                | 期待値 |
| --------------------------------------- | ------ |
| 移行前後のBilling通知履歴件数           | 一致   |
| organizationを解決できない履歴          | 0件    |
| subjectを解決できない履歴               | 0件    |
| `billing_notification.dedupe_key`の衝突 | 0件    |
| Billing通知判断とOutboxの1:1違反        | 0件    |
| Outboxとattempt number単位Logの重複     | 0件    |
| organization基準のowner向け参照差分     | 0件    |
| organization基準の内部調査参照差分      | 0件    |
| 既存予約通知のOutbox／Log件数差分       | 0件    |

この時点では`billing_account`と旧Billing投影tableを削除しません。

### 新しいBilling API D1

1. 対象がdevelopment／preview環境であることをdatabase IDまで照合する。
2. 新schema用のD1を作成する。
3. migrationを先頭から適用する。
4. app、catalog、price、addon、redirect templateをseedする。
5. API credentialを再発行してsecret storeへ登録する。
6. migration version、seed件数、catalog／price対応を記録する。

### 新Queueとconsumer

1. `reserve-billing-events-v2`と`reserve-billing-events-v2-dlq`を作成する。
2. 新Queueだけを読むBackend consumerを準備する。
3. retry上限とDLQ bindingを確認する。
4. fixtureでruntime validation、inbox、cursor、投影、通知Outboxを確認する。
5. 旧schemaのfixtureが拒否され、業務状態を変更しないことを確認する。
6. Billing API producerを有効化するまでは新Queueを空にする。

## Phase 7: Queue v2切替

### 1. 旧resourceを記録する

次の件数を同じ時点で取得します。

- 旧Billing API D1のsubject、subscription、outbox
- 旧Queueのbacklog
- 旧DLQの件数
- Backend inboxの最終eventとsubject別cursor

これらの件数は移行完了条件にしません。
破棄対象の記録として保存します。

### 2. 旧producer／consumerを停止する

旧Billing API outbox dispatcherと旧Queue consumerを停止します。
旧outboxと旧Queueはdrainしません。

作業中は新しいCheckout、Portal、trial、addon変更を実行しません。
この停止は運用上の作業ルールであり、アプリへmaintenance機構を追加しません。

### 3. 新consumerを配置する

Backendを、新Queueと新DLQだけを読むbindingで配置します。
新Queueが空であることを確認します。

### 4. 新Billing APIを配置する

新Billing API D1と新Queueだけを参照するbindingでBilling APIを配置します。
旧Queueへ送るbindingは残しません。

### 5. test subjectを再作成する

必要なorganization subject、test subject、Test Clock scenarioを新D1へ作成します。

次を確認します。

- organization、app、subject IDの対応
- catalog、price、addon参照
- 初期revision
- provider-linked subjectのStripe照合結果と`syncedAt`

### 6. Queue v2を確認する

- 新規操作が新Queueだけへeventを送る。
- 新Queue／Inboxの全eventが新schema versionである。
- 旧schema payloadが0件である。
- 状態変更と通知要求が別のidentity規則で保存される。
- 通知要求の失敗が状態cursorを停止しない。

旧schema payloadが1件でも見つかった場合は、新Billing API D1を再作成して手順3からやり直します。

## Phase 8: 直接WebhookとDLQ

### 1. Stripe endpointを分離する

Billing用eventをBilling APIの直接endpointへ設定します。
対象event typeに`subscription_schedule.canceled`と`customer.subscription.trial_will_end`を含めます。

Backend endpointは旧ticket checkoutに必要な`checkout.session.completed`だけを受け取ります。
Billing metadataを持つCheckoutはBilling API、ticket metadataを持つCheckoutはBackendが処理します。

### 2. Backend転送を削除する

次を同じ変更で削除します。

- BackendからBilling APIへのWebhook転送
- `BILLING_API_WEBHOOK_FORWARD_ENABLED`
- Backend内のStripe Billing同期処理
- 関連する環境変数、binding、test、運用記述

### 3. 直接配送を確認する

- Stripe Billing eventがBilling APIへ直接届く。
- provider event claimが同じevent IDを1件へ収束させる。
- 状態変更がQueue v2を経由してBackend投影へ届く。
- `trial_will_end`がrecipient単位の通知判断とOutboxを作る。
- 旧ticket checkoutがBackendで継続する。

### 4. DLQ復旧を確認する

1. test eventをretry上限まで失敗させる。
2. DLQ consumerがD1へ保存してSentry通知する。
3. organization単位Billing調査機能でDLQ情報を確認する。
4. 状態eventへ`resync`を実行する。
5. 通知eventへ`re-evaluate-notification`を実行する。
6. 古いQueue payloadが業務状態へ再適用されていないことを確認する。

専用DLQ一覧画面や汎用payload replayは検証対象に含めません。

## 旧resourceの削除

次をすべて満たした後にだけ実施します。

- R07、R10、R11が完了している。
- 新Queueへ旧schema payloadが入っていない。
- Stripe Billing eventがBilling APIへ直接届く。
- 旧ticket checkoutがBackendで継続している。
- 旧resourceの名前、ID、破棄前件数を記録している。
- 旧データへrollbackしないことを確認している。

条件を満たしたら、旧Queue／DLQと旧Billing API D1を対象IDを再確認して削除します。

Backend D1の旧Billing tableはPhase 9で削除します。
通知履歴の件数、欠損、一意性、1:1:N関係、owner／内部調査結果を確認してからtable rebuild／drop migrationを適用します。

## 中止条件と再実行

次のいずれかが発生した場合は、切替作業を中止します。

- 対象resourceがdevelopment／preview環境だと確認できない
- Backend D1の非Billingデータへ差分が出る
- 通知履歴の件数、organization、subject、一意性、1:1:N関係が一致しない
- 新Queueへ旧schema payloadが入る
- state changeのrevision gapを最新summaryで修復できない
- `syncedAt`がsummary読取や照合失敗で更新される
- 通知判断とOutboxの保存前にQueue ACKされる
- 旧ticket checkoutを処理できない
- Sentry、Queue metrics、D1、Stripe event deliveryのいずれかを確認できない

旧構成へデータrollbackしません。

1. 新producer／consumerを停止する。
2. 新Billing API D1と新Queueの対象IDを記録する。
3. 原因を修正する。
4. 新Billing API D1を再作成する。
5. migration、seed、credential設定、test subject作成をやり直す。
6. Phase 7の手順3から再実行する。

## 実施記録テンプレート

```text
実施日:
環境:
作業責任者:
commit／deploy version:

対象resource:
- Billing API Worker:
- Backend Worker:
- 旧Billing API D1:
- 新Billing API D1:
- Backend D1:
- 旧Queue／DLQ:
- 新Queue／DLQ:
- Backend Stripe endpoint:
- Billing API Stripe endpoint:

破棄前件数:
- 旧subject:
- 旧subscription:
- 旧outbox:
- 旧Queue:
- 旧DLQ:

履歴移行:
- billing_notification件数:
- dedupe key衝突:
- 判断とOutboxの1:1違反:
- OutboxとLogのattempt重複:
- owner／内部調査差分:

リスク別証跡:
- R07 / T04,T05,T10:
- R10 / T04,T06,T09:
- R11 / T06,T09:
- R14 / T08,T09:
- R15 / T01,T04,T09,T11:
- R16 / T09,T10,T12:

再作成の有無:
中止条件の該当:
残課題:
旧resource削除判断:
```
