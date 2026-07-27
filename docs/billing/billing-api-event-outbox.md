# Billing API の課金イベント配送

## 目的

契約状態が変わると、reserve-app はその変更を順番どおりに受け取ります。
支払いに問題が発生した場合は、現在も問題が続いていることを確認してから組織の確認済みオーナーへ通知します。

課金状態の保存には成功したが通知イベントだけ失われる状態を防ぎます。
同じイベントが複数回届いても、同じ相手へ同じメールを重複送信しません。

## 対象となる変更

次の正常終了した変更を配送します。

- Stripe Checkout の完了
- Stripe subscription の作成、更新、削除
- Stripe Subscription Schedule の作成、更新、release、完了
- 請求書の確定、支払い完了、支払い失敗、追加認証要求
- ローカルトライアルの開始、完了
- アドオン数量の更新

読み取り、画面引き継ぎ URL の作成、失敗、競合、重複、変更のないアドオン更新は配送しません。
subject の同期も対象外です。

実装上の理由は `BillingSubjectChangedReason` で表します。
公開するイベント名は `billing.subject.changed.v1` です。

## 保存と配送

Billing API は、契約状態とイベントを同じ D1 batch で保存します。
各 subject は `1` から始まる連番を持ちます。
状態更新、連番更新、outbox 追加のいずれかが失敗した場合は、すべてロールバックします。

Stripe API の呼び出しは D1 batch の外側です。
addon の Schedule 操作では、Stripe metadata と専用の操作記録に所有権と変更予定を残します。
Stripe の更新後に D1 保存が失敗した場合は、同じ冪等性キーの再送または
`subscription_schedule.*` webhook から復旧します。

保存後は Cloudflare Queue へすぐに送信します。
送信に失敗しても課金操作の成功は取り消しません。
未送信イベントは1分ごとの Cron が再送します。

Queue 送信後に outbox の更新だけ失敗すると、同じイベントが再送される場合があります。
そのため配送保証は at-least-once です。

## イベントに含める情報

イベントには次の情報だけを含めます。

- schema version とイベント ID
- app と subject の識別子
- subject ごとの revision
- 変更理由と影響した課金対象
- 発生時刻
- Stripe event、customer、subscription の識別子
- 請求イベントの種別と安全な識別情報

メールアドレス、Stripe の生 payload、請求書 URL、PDF URL、契約状態全体は含めません。
通知時の宛先と現在状態は reserve-app backend が取得します。

## テストクロック

Stripe Test Clock の subject にも outbox 行と revision を保存します。
配送状態は `suppressed`、配送モードは `test` とします。
本番 Queue には送りません。

## reserve-app backend の処理

backend は受信イベントを inbox に保存します。
subject ごとに最後に処理した revision を保持します。

- 処理済み revision は重複として ACK します。
- 次の revision だけを処理します。
- 欠番がある場合は先行イベントを待つため retry します。
- 通知対象でないイベントも inbox に記録し、revision を進めます。

処理を開始したイベントには5分間の lease を設定します。
Worker が強制終了した場合は、期限切れ lease を次の配信が token 付き条件更新で回収します。
古い Worker は、回収後の inbox 確定や cursor 更新を行えません。
inbox 確定後、cursor 更新前に停止した場合は、次の配信が確定済み inbox から cursor を修復します。

支払い失敗と追加認証要求では、Billing API から最新の契約概要と請求イベントを取得します。
契約が `past_due`、`unpaid`、`incomplete` のいずれでもない場合は通知しません。
同じ請求書に後続の支払い成功がある場合も通知しません。

通知先は backend が確認済みオーナーから解決します。
メール配送は既存の recipient 単位の重複排除を利用します。

## retry と終端処理

Billing API、D1、Resend の一時障害、429、5xx、revision 欠番は retry します。
30秒から最大12時間まで待ち時間を延ばし、最大8回失敗したイベントは
`reserve-billing-events-dlq` へ送ります。

payload 不正、対象外の app または subject、確認済みオーナー不在、メール設定不正は終端失敗です。
理由を inbox と既存の課金 signal に残して ACK します。

## メール送信の有効化

初回リリースでは課金イベントによるメール送信を無効にします。
Queue、inbox、順序制御、現在状態の確認までは通常どおり動作します。
通知対象イベントは `suppressed_disabled` として記録します。

検証後に backend の `BILLING_EVENT_NOTIFICATIONS_ENABLED=true` を設定すると、
以後に処理する支払い問題イベントからメールを送ります。
無効期間中に抑止したイベントは自動再送しません。

## Cloudflare リソース

- Queue: `reserve-billing-events`
- Dead Letter Queue: `reserve-billing-events-dlq`
- producer: `reserve-billing-api`
- consumer: `reserve-app-backend`
- outbox 回収 Cron: 1分ごと

Queue と Dead Letter Queue は Worker のデプロイ前に作成します。
D1 migration は Billing API、backend の順に適用します。
