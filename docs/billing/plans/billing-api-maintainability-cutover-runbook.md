# Billing API 保守性改善 cutover runbook

最終更新: 2026-07-31

## この文書の扱い

この文書は、[Billing API 保守性改善計画](./billing-api-maintainability.md)のMilestone 4〜5で使う専用preview Queueの準備と、Milestone 6以降の正式切替を扱う開発／preview環境向けの手順です。
現行の運用手順ではありません。
必要な実装マイルストーンが完了するまで実行しません。

- アーキテクチャ上の不変条件、実装マイルストーン、リスクと必須テストの対応関係は改善計画を正とします。
- resource名、対象環境、切替順序、中止条件、再実行手順、実施証跡はこのrunbookを正とします。
- 両文書に矛盾がある場合は、どちらかを暗黙に優先せず、切替開始前に文書不備として修正します。
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

## Milestone 4〜5: preview準備とend-to-end検証

### Backend D1

Backend D1全体はresetしません。

1. Milestone 4で最小Entitlement投影とDLQ記録のmigrationを適用する。
2. Milestone 5で予約通知から配信engineを抽出し、schemaと挙動に差分がないことを確認する。
3. 一般化したNotification Outbox／Logのmigrationを適用し、`billing_notification`へorganization、subject snapshot、trigger key、dedupe key、Outbox参照を追加する。
4. 予約通知を一般化したOutbox／Logへ移し、件数、再試行、管理画面の参照結果に差分がないことを確認する。
5. 新しいBilling通知だけをorganization基準で保存し、owner向け履歴と内部調査で参照できることを確認する。

この時点では既存`billing_notification`をbackfillせず、`billing_account`、旧retry列、直接Resend呼出し、旧Billing投影tableも削除しません。

### 新しいBilling API D1

1. 対象がdevelopment／preview環境であることをdatabase IDまで照合する。
2. 新schema用のD1を作成する。
3. migrationを先頭から適用する。
4. app、catalog、price、addon、redirect templateをseedする。
5. API credentialを再発行してsecret storeへ登録する。
6. migration version、seed件数、catalog／price対応を記録する。

### 新Queueとconsumer

1. `reserve-billing-events-v2`と`reserve-billing-events-v2-dlq`を作成する。
2. 専用preview bindingで新Queueだけを読むBackend consumerを準備する。
3. retry上限とDLQ bindingを確認する。
4. Milestone 4ではtest subjectの`state_changed`だけを送信し、runtime validation、inbox、cursor、Entitlement投影、認可時read-throughを確認する。
5. Milestone 5では`notification_requested`を追加し、状態eventとの独立性、通知判断、Notification Outbox／Logを確認する。
6. 旧schemaのfixtureが拒否され、業務状態を変更しないことを確認する。
7. Milestone 6までは旧producer／consumerの正式bindingを変更せず、専用preview経路をtest subjectに限定する。

## 正式切替rehearsal

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
rehearsalのbackfill結果は検証証跡であり、対象環境の実移行はMilestone 7まで行いません。

## 正式切替の開始条件

次を一つでも満たさない場合は、切替を開始しません。

- 対象環境がdevelopmentまたはpreviewである。
- Billing APIの既存契約データを破棄してよい。
- 改善計画のMilestone 0〜5が完了している。
- T01〜T08、T11が対象commitで成功している。
- Milestone 3〜4に対応するT10aが検証環境で成功している。
- T09を同じ構成のdevelopment環境でrehearsal済みである。
- Billing APIとBackendのmigrationを空のD1へ先頭から適用できる。
- Backend D1のbackupまたは復旧可能なexportを取得している。
- 新Queueには新schemaだけを送信することをcontract testで確認している。
- 旧ticket checkoutのrouteとStripe event設定を特定している。
- Sentry、Queue metrics、D1、Stripe event deliveryを作業中に確認できる。

## 正式切替1: Queue v2

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

Backendを、新Queueと新DLQだけを読む正式bindingで配置します。
専用preview経路で検証したschema versionだけが残っていることを確認します。

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

## 正式切替2: 直接WebhookとDLQ

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
- 直接Webhookとevent再送に対応するT10aが成功する。

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

## Milestone 7: 通知履歴移行と旧実装撤去

1. `billing_account`とのjoinで既存`billing_notification`へorganization、subject、trigger key、dedupe key、Outbox参照をbackfillする。
2. 次の結果を保存する。

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

3. 検証成功後に、Billing通知の直接Resend呼出しと旧retry列を削除する。
4. R14、R15の参照ゼロ確認後に、`billing_account`と旧Billing投影tableのrebuild／drop migrationを適用する。

一つでも期待値を満たさない場合はtableを削除せず、backfillと参照実装を修正して再検証します。

## 最終検証と文書昇格

Milestone 7のcleanup後、Milestone 8として次を実施します。

1. T10bのTest Clock全scenarioを対象commitと切替後resourceで実行する。
2. Queue／DLQ復旧、Sentry、organization単位の内部調査結果を再確認する。
3. T12に従い、現行仕様・運用文書を実装結果へ更新する。
4. R01〜R16の証跡が揃ったことを確認してから、改善計画をhistoryへ移す。

T10bが失敗した場合は、実Stripe確認済みまたは計画完了として記録しません。

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
6. 「正式切替1: Queue v2」の手順3から再実行する。

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
- R07 / T04,T05,T10a:
- R10 / T04,T06,T09:
- R11 / T06,T09:
- R14 / T08,T09:
- R15 / T01,T04,T09,T11:
- R16 / T09,T10b,T12:

再作成の有無:
中止条件の該当:
残課題:
旧resource削除判断:
```
